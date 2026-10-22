"use client";

import { useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, Flag, Heart, ImageOff, Trash2 } from "lucide-react";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  type DocumentData,
} from "firebase/firestore";
import { db } from "@/lib/firebaseServices";
import { useUserRole } from "@/lib/useUserRole";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingState,
  PageHeader,
  Segmented,
  SwitchRow,
} from "@/components/ui";

/*
 * Halloween Costume Contest (mobile app, Oct 2026). The switch writes
 * app_config/costume_contest, which the app watches live: on shows the contest
 * card on the home screen and lets anyone, signed in or not, enter and vote.
 * Entries, votes and reports are written only by the mobile repo's Cloud
 * Functions (functions/costume_contest.js). Staff can hide, restore or delete
 * entries here; deleting also removes the photo and frees its votes.
 */

const CONFIG_REF = () => doc(db, "app_config", "costume_contest");
const DEFAULT_CONTEST_ID = "halloween-2026";
const DEFAULT_TITLE = "Halloween Costume Contest";

type Config = { enabled: boolean; contestId: string; title: string };

type Entry = {
  id: string;
  name: string;
  caption: string;
  imageUrl: string;
  voteCount: number;
  reportCount: number;
  status: "visible" | "hidden";
  hiddenReason: string;
  isGuest: boolean;
  createdAt: Date | null;
};

type Tab = "visible" | "hidden";

function readConfig(data: DocumentData | undefined): Config {
  const text = (v: unknown, fallback: string) =>
    typeof v === "string" && v.trim() ? v.trim() : fallback;
  return {
    enabled: data?.enabled === true,
    contestId: text(data?.contestId, DEFAULT_CONTEST_ID),
    title: text(data?.title, DEFAULT_TITLE),
  };
}

function readEntry(id: string, data: DocumentData): Entry {
  return {
    id,
    name: data.name ?? "",
    caption: data.caption ?? "",
    imageUrl: data.imageUrl ?? "",
    voteCount: Number(data.voteCount) || 0,
    reportCount: Number(data.reportCount) || 0,
    status: data.status === "visible" ? "visible" : "hidden",
    hiddenReason: data.hiddenReason ?? "",
    isGuest: data.isGuest === true,
    createdAt: data.createdAt?.toDate?.() ?? null,
  };
}

/* Most votes first; ties go to whoever entered first (same as the app). */
function byVotes(a: Entry, b: Entry) {
  if (b.voteCount !== a.voteCount) return b.voteCount - a.voteCount;
  return (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0);
}

/* Firestore errors carry a `code`; anything else falls back to [fallback]. */
function describeError(err: unknown, fallback: string) {
  const { code, message } = (err ?? {}) as { code?: string; message?: string };
  if (code === "permission-denied") return "You don't have permission to do that.";
  return message || fallback;
}

const formatDate = (d: Date | null) =>
  d
    ? d.toLocaleString("en-US", {
        timeZone: "America/Chicago",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

export default function CostumeContestPage() {
  const { role } = useUserRole();
  const isAdmin = role === "admin";

  const [config, setConfig] = useState<Config | null>(null);
  // Tagged with their contest, so a contest switch shows "loading" without
  // clearing state inside the effect.
  const [loaded, setLoaded] = useState<{ contestId: string; list: Entry[] } | null>(null);
  const [tab, setTab] = useState<Tab>("visible");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(
    () =>
      onSnapshot(
        CONFIG_REF(),
        (snap) => setConfig(readConfig(snap.data())),
        () => setError("Couldn't load the contest settings."),
      ),
    [],
  );

  const contestId = config?.contestId;
  useEffect(() => {
    if (!contestId) return;
    return onSnapshot(
      collection(db, "costume_contests", contestId, "entries"),
      (snap) =>
        setLoaded({
          contestId,
          list: snap.docs.map((d) => readEntry(d.id, d.data())).sort(byVotes),
        }),
      () => setError("Couldn't load the entries."),
    );
  }, [contestId]);
  const entries = loaded && loaded.contestId === contestId ? loaded.list : null;

  const counts = useMemo(() => {
    const list = entries ?? [];
    return {
      visible: list.filter((e) => e.status === "visible").length,
      hidden: list.filter((e) => e.status === "hidden").length,
      votes: list.reduce((sum, e) => sum + e.voteCount, 0),
    };
  }, [entries]);

  const shown = (entries ?? []).filter((e) => e.status === tab);

  const toggle = async (enabled: boolean) => {
    if (!config) return;
    setSaving(true);
    setError("");
    try {
      // Written directly by the signed-in admin; Firestore rules allow only
      // role "admin" to change these fields.
      await setDoc(
        CONFIG_REF(),
        {
          enabled,
          contestId: config.contestId,
          title: config.title,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    } catch (err: unknown) {
      setError(
        (err as { code?: string })?.code === "permission-denied"
          ? "Only admins can turn the contest on or off."
          : describeError(err, "Couldn't save the setting."),
      );
    } finally {
      setSaving(false);
    }
  };

  const entryRef = (id: string) =>
    doc(db, "costume_contests", config!.contestId, "entries", id);

  const setVisibility = async (entry: Entry, status: Tab) => {
    setBusyId(entry.id);
    setError("");
    try {
      await updateDoc(entryRef(entry.id), {
        status,
        hiddenReason: status === "hidden" ? "staff" : "",
        updatedAt: serverTimestamp(),
      });
    } catch (err: unknown) {
      setError(describeError(err, "Couldn't update the entry."));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (entry: Entry) => {
    if (
      !window.confirm(
        `Delete ${entry.name || "this"}'s costume? The photo and its ${entry.voteCount} vote(s) are removed, and those people can vote again.`,
      )
    ) {
      return;
    }
    setBusyId(entry.id);
    setError("");
    try {
      await deleteDoc(entryRef(entry.id));
    } catch (err: unknown) {
      setError(describeError(err, "Couldn't delete the entry."));
    } finally {
      setBusyId(null);
    }
  };

  if (!config) return <LoadingState label="Loading costume contest…" />;

  return (
    <div>
      <PageHeader
        title="Costume Contest"
        description={`${config.title}: turn it on or off in the app and review the entries. Anyone can enter and vote, with or without an account.`}
      />

      {error && <Alert className="mb-4">{error}</Alert>}

      <Card className="mb-6">
        <SwitchRow
          tone="dark"
          flush
          title="Show the contest in the app"
          description={
            isAdmin
              ? "On: the home screen shows the contest card, and people can enter costumes and vote. Off: the contest disappears from the app."
              : "Only admins can turn the contest on or off."
          }
          checked={config.enabled}
          onChange={toggle}
          disabled={!isAdmin || saving}
        />
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-[#f4ead7]/70">
          <span>
            Status:{" "}
            <span className={config.enabled ? "text-emerald-400" : "text-[#f4ead7]"}>
              {config.enabled ? "Live in the app" : "Off"}
            </span>
          </span>
          <span>Entries: {counts.visible + counts.hidden}</span>
          <span>Votes: {counts.votes}</span>
          <span>Contest ID: {config.contestId}</span>
        </div>
      </Card>

      <div className="mb-4">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: "visible", label: "In the contest", count: counts.visible },
            { value: "hidden", label: "Hidden", count: counts.hidden },
          ]}
        />
      </div>

      {entries === null ? (
        <LoadingState label="Loading entries…" />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={ImageOff}
          title={tab === "visible" ? "No entries yet" : "No hidden entries"}
          description={
            tab === "visible"
              ? "Costumes appear here as soon as people enter them."
              : "Entries hidden by staff, or by 3 reports, appear here."
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {shown.map((entry, i) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              rank={tab === "visible" ? i + 1 : null}
              busy={busyId === entry.id}
              onHide={() => setVisibility(entry, "hidden")}
              onRestore={() => setVisibility(entry, "visible")}
              onDelete={() => remove(entry)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EntryCard({
  entry,
  rank,
  busy,
  onHide,
  onRestore,
  onDelete,
}: {
  entry: Entry;
  rank: number | null;
  busy: boolean;
  onHide: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0d0d0d]">
      <a
        href={entry.imageUrl}
        target="_blank"
        rel="noreferrer"
        className="relative block aspect-[3/4] bg-white/5"
        title="Open the full photo"
      >
        {entry.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={entry.imageUrl} alt={entry.name} className="h-full w-full object-cover" />
        ) : (
          <ImageOff className="absolute inset-0 m-auto h-8 w-8 text-white/30" aria-hidden />
        )}
        {rank !== null && (
          <span className="absolute top-2 left-2 rounded-full bg-black/70 px-2 py-0.5 text-xs font-semibold text-white">
            #{rank}
          </span>
        )}
      </a>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[#f4ead7]">{entry.name}</p>
          {entry.caption && (
            <p className="truncate text-xs text-[#f4ead7]/60">{entry.caption}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="dark">
            <Heart className="mr-1 inline h-3 w-3" aria-hidden />
            {entry.voteCount}
          </Badge>
          {entry.reportCount > 0 && (
            <Badge tone="red">
              <Flag className="mr-1 inline h-3 w-3" aria-hidden />
              {entry.reportCount}
            </Badge>
          )}
          <Badge tone={entry.isGuest ? "purple" : "blue"}>
            {entry.isGuest ? "Guest" : "Account"}
          </Badge>
          {entry.status === "hidden" && entry.hiddenReason && (
            <Badge tone="amber">
              {entry.hiddenReason === "reports" ? "Hidden by reports" : "Hidden by staff"}
            </Badge>
          )}
        </div>
        <p className="text-xs text-[#f4ead7]/45">{formatDate(entry.createdAt)}</p>
        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          {entry.status === "visible" ? (
            <Button size="sm" variant="secondary" icon={EyeOff} onClick={onHide} disabled={busy}>
              Hide
            </Button>
          ) : (
            <Button size="sm" variant="success" icon={Eye} onClick={onRestore} disabled={busy}>
              Restore
            </Button>
          )}
          <Button size="sm" variant="danger" icon={Trash2} onClick={onDelete} disabled={busy}>
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
