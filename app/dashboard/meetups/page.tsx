"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentReference,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import {
  CalendarDays,
  MessageSquareOff,
  Pause,
  Play,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from "lucide-react";

import { db } from "@/lib/firebaseServices";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  FilterSelect,
  FormSection,
  LoadingState,
  Modal,
  PageHeader,
  Segmented,
  Spinner,
  Toolbar,
  cx,
  filterControlClass,
  table,
  type BadgeTone,
} from "@/components/ui";

/* Meetup with Friends moderation (docs/meetups-contract.md §8). Staff may only
 * read meetups, toggle `chatPaused`, delete a meetup and delete chat messages.
 * Everything else is written by the app or by Cloud Functions. */

type Meetup = {
  id: string;
  ref: DocumentReference;
  groupId: string;
  title: string;
  description: string;
  startAt: Date | null;
  spots: number | null;
  joinedCount: number;
  likeCount: number;
  dislikeCount: number;
  kickedCount: number;
  blockedCount: number;
  creatorName: string;
  creatorPhoto: string;
  chatPaused: boolean;
};

type Member = { id: string; name: string; photo: string; joinedAt: Date | null; via: string };
type Message = {
  id: string;
  type: string;
  userName: string;
  message: string;
  createdAt: Date | null;
};

type Status = "Upcoming" | "Full" | "Past";
type StatusFilter = "upcoming" | "past" | "all";

const TZ = "America/Chicago";
const PAST_DAYS = 90;
const BATCH_LIMIT = 450;

const toDate = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null);
const asInt = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/* "Sat, Oct 4 · 7:00 PM" in Central time, matching the app. */
function formatWhen(date: Date | null): string {
  if (!date) return "—";
  const day = date.toLocaleDateString("en-US", {
    timeZone: TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = date.toLocaleTimeString("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day} · ${time}`;
}

function statusOf(m: Meetup, now: number): Status {
  if (m.startAt && m.startAt.getTime() <= now) return "Past";
  if (m.spots !== null && m.joinedCount >= m.spots) return "Full";
  return "Upcoming";
}

function toMeetup(d: QueryDocumentSnapshot): Meetup {
  const x = d.data();
  return {
    id: d.id,
    ref: d.ref,
    groupId: x.groupId || d.ref.parent.parent?.id || "",
    title: x.title || "Untitled meetup",
    description: x.description || "",
    startAt: toDate(x.startAt),
    spots: typeof x.spots === "number" ? x.spots : null,
    joinedCount: asInt(x.joinedCount),
    likeCount: asInt(x.likeCount),
    dislikeCount: asInt(x.dislikeCount),
    kickedCount: Array.isArray(x.kickedUids) ? x.kickedUids.length : 0,
    blockedCount: Array.isArray(x.blockedUids) ? x.blockedUids.length : 0,
    creatorName: x.creatorName || "Unknown",
    creatorPhoto: x.creatorPhoto || "",
    chatPaused: x.chatPaused === true,
  };
}

const STATUS_TONE: Record<Status, BadgeTone> = {
  Upcoming: "green",
  Full: "amber",
  Past: "neutral",
};

export default function Page() {
  const [groups, setGroups] = useState<Map<string, string>>(new Map());
  const [groupId, setGroupId] = useState(""); // "" = all groups
  const [meetups, setMeetups] = useState<Meetup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [pausedOnly, setPausedOnly] = useState(false);

  const [selected, setSelected] = useState<Meetup | null>(null);
  const [deleting, setDeleting] = useState<Meetup | null>(null);
  const [busy, setBusy] = useState(false);
  const [bulk, setBulk] = useState<Meetup[] | null>(null);

  const [now, setNow] = useState(() => Date.now());

  /* Group names for the picker and the Group column. */
  useEffect(() => {
    getDocs(collection(db, "Groups"))
      .then((snap) =>
        setGroups(
          new Map(
            snap.docs
              .map((d) => [d.id, (d.data().name as string) || "Untitled group"] as [string, string])
              .sort((a, b) => a[1].localeCompare(b[1])),
          ),
        ),
      )
      .catch((err) => console.error("Failed to load groups:", err));
  }, []);

  const load = async (gid: string) => {
    setLoading(true);
    setError("");
    try {
      const q = gid
        ? query(collection(db, "Groups", gid, "meetups"), orderBy("createdAt", "desc"))
        : query(collectionGroup(db, "meetups"), orderBy("createdAt", "desc"));
      const snap = await getDocs(q);
      setMeetups(snap.docs.map(toMeetup));
      setNow(Date.now());
    } catch (err) {
      console.error(err);
      setError("Failed to load meetups.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(groupId);
  }, [groupId]);

  const visible = useMemo(
    () =>
      meetups.filter((m) => {
        const status = statusOf(m, now);
        if (statusFilter === "past" && status !== "Past") return false;
        if (statusFilter === "upcoming" && status === "Past") return false;
        if (pausedOnly && !m.chatPaused) return false;
        return true;
      }),
    [meetups, statusFilter, pausedOnly, now],
  );

  const patchMeetup = (id: string, patch: Partial<Meetup>) => {
    setMeetups((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
    setSelected((prev) => (prev && prev.id === id ? { ...prev, ...patch } : prev));
  };

  /* The only meetup field staff may change (plus updatedAt). */
  const setChatPaused = async (m: Meetup, paused: boolean) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await updateDoc(m.ref, { chatPaused: paused, updatedAt: serverTimestamp() });
      patchMeetup(m.id, { chatPaused: paused });
      setNotice(`Chat ${paused ? "paused" : "resumed"} for "${m.title}".`);
    } catch (err) {
      console.error(err);
      setError(`Failed to ${paused ? "pause" : "resume"} the chat.`);
    } finally {
      setBusy(false);
    }
  };

  /* A plain delete: the onMeetupDeleted function notifies members and removes
   * the subcollections and the group-chat card. */
  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await deleteDoc(deleting.ref);
      setMeetups((prev) => prev.filter((m) => m.id !== deleting.id));
      if (selected?.id === deleting.id) setSelected(null);
      setNotice(`Deleted "${deleting.title}".`);
      setDeleting(null);
    } catch (err) {
      console.error(err);
      setError("Failed to delete the meetup.");
    } finally {
      setBusy(false);
    }
  };

  /* Bulk: find meetups that started more than 90 days ago and aren't paused. */
  const findOldUnpaused = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const cutoff = Timestamp.fromMillis(Date.now() - PAST_DAYS * 24 * 60 * 60 * 1000);
      const snap = await getDocs(
        query(collectionGroup(db, "meetups"), where("startAt", "<", cutoff)),
      );
      setBulk(snap.docs.map(toMeetup).filter((m) => !m.chatPaused));
    } catch (err) {
      console.error(err);
      setError("Failed to look up old meetups.");
    } finally {
      setBusy(false);
    }
  };

  const confirmBulkPause = async () => {
    if (!bulk || bulk.length === 0) return setBulk(null);
    setBusy(true);
    setError("");
    try {
      for (let i = 0; i < bulk.length; i += BATCH_LIMIT) {
        const batch = writeBatch(db);
        bulk
          .slice(i, i + BATCH_LIMIT)
          .forEach((m) => batch.update(m.ref, { chatPaused: true, updatedAt: serverTimestamp() }));
        await batch.commit();
      }
      const ids = new Set(bulk.map((m) => m.id));
      setMeetups((prev) => prev.map((m) => (ids.has(m.id) ? { ...m, chatPaused: true } : m)));
      setNotice(`Paused the chat of ${bulk.length} meetup${bulk.length === 1 ? "" : "s"}.`);
      setBulk(null);
    } catch (err) {
      console.error(err);
      setError("Failed to pause some chats. Run it again to finish the rest.");
    } finally {
      setBusy(false);
    }
  };

  const groupName = (gid: string) => groups.get(gid) || gid || "—";

  return (
    <div>
      <PageHeader
        title="Meetups"
        description="Meetup with Friends across all groups. Times are shown in Central time, as in the app."
        actions={
          <Button variant="outline" icon={MessageSquareOff} onClick={findOldUnpaused} disabled={busy}>
            Pause chats of meetups over {PAST_DAYS} days old
          </Button>
        }
      />

      {/* FILTERS */}
      <Toolbar>
        <FilterSelect value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          <option value="">All groups</option>
          {[...groups].map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </FilterSelect>

        <Segmented<StatusFilter>
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "upcoming", label: "Upcoming" },
            { value: "past", label: "Past" },
            { value: "all", label: "All" },
          ]}
        />

        <label className={cx(filterControlClass, "flex cursor-pointer items-center gap-2 text-[#f4ead7]")}>
          <input
            type="checkbox"
            checked={pausedOnly}
            onChange={(e) => setPausedOnly(e.target.checked)}
            className="h-4 w-4 accent-[#ff7a59]"
          />
          Chat paused only
        </label>

        <Button variant="secondary" icon={RefreshCw} onClick={() => load(groupId)}>
          Refresh
        </Button>
      </Toolbar>

      {error && (
        <Alert className="mb-6" onDismiss={() => setError("")}>
          {error}
        </Alert>
      )}
      {notice && !error && (
        <Alert tone="success" className="mb-6" onDismiss={() => setNotice("")}>
          {notice}
        </Alert>
      )}

      {/* LIST */}
      {loading ? (
        <LoadingState label="Loading meetups…" />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={meetups.length === 0 ? "No meetups yet." : "No meetups match these filters."}
        />
      ) : (
        <div className={table.wrap}>
          <table className={`${table.table} min-w-[900px]`}>
            <thead className={table.thead}>
              <tr>
                <th className={table.th}>Title</th>
                <th className={table.th}>Group · Host</th>
                <th className={table.th}>When</th>
                <th className={table.th}>Status</th>
                <th className={table.th}>Joined</th>
                <th className={table.th}>Reactions</th>
                <th className={`${table.th} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((m) => {
                const status = statusOf(m, now);
                return (
                  <tr key={m.ref.path} className={table.row}>
                    <td className={table.td}>
                      <p className="max-w-[220px] truncate font-semibold" title={m.title}>
                        {m.title}
                      </p>
                    </td>
                    <td className={table.td}>
                      <div className="max-w-[200px]">
                        <p className="truncate" title={groupName(m.groupId)}>
                          {groupName(m.groupId)}
                        </p>
                        <p className="truncate text-xs text-black/55" title={m.creatorName}>
                          by {m.creatorName}
                        </p>
                      </div>
                    </td>
                    <td className={`${table.td} whitespace-nowrap`}>{formatWhen(m.startAt)}</td>
                    <td className={table.td}>
                      <div className="flex flex-col items-start gap-1">
                        <Badge tone={STATUS_TONE[status]}>{status}</Badge>
                        {m.chatPaused && <Badge tone="red">Chat paused</Badge>}
                      </div>
                    </td>
                    <td className={`${table.td} whitespace-nowrap tabular-nums`}>
                      {m.joinedCount} / {m.spots ?? "∞"}
                    </td>
                    <td className={`${table.td} whitespace-nowrap tabular-nums`}>
                      <span className="inline-flex items-center gap-3 text-black/70">
                        <span className="inline-flex items-center gap-1" title="Likes">
                          <ThumbsUp className="h-3.5 w-3.5 text-black/40" aria-label="Likes" />
                          {m.likeCount}
                        </span>
                        <span className="inline-flex items-center gap-1" title="Dislikes">
                          <ThumbsDown className="h-3.5 w-3.5 text-black/40" aria-label="Dislikes" />
                          {m.dislikeCount}
                        </span>
                      </span>
                    </td>
                    <td className={table.td}>
                      <div className={table.actions}>
                        <Button size="sm" onClick={() => setSelected(m)}>
                          View
                        </Button>
                        <Button
                          size="sm"
                          variant="light"
                          icon={m.chatPaused ? Play : Pause}
                          onClick={() => setChatPaused(m, !m.chatPaused)}
                          disabled={busy}
                          title={m.chatPaused ? "Resume chat" : "Pause chat"}
                          aria-label={m.chatPaused ? "Resume chat" : "Pause chat"}
                        />
                        <Button
                          size="sm"
                          variant="danger"
                          icon={Trash2}
                          onClick={() => setDeleting(m)}
                          title="Delete meetup"
                          aria-label="Delete meetup"
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <MeetupDrawer
          key={selected.ref.path}
          meetup={selected}
          groupName={groupName(selected.groupId)}
          status={statusOf(selected, now)}
          busy={busy}
          onClose={() => setSelected(null)}
          onToggleChat={() => setChatPaused(selected, !selected.chatPaused)}
          onDelete={() => setDeleting(selected)}
        />
      )}

      {/* Confirm dialogs sit above the drawer. */}
      {deleting && (
        <Modal
          layer="top"
          title="Delete meetup"
          size="sm"
          onClose={() => !busy && setDeleting(null)}
          footer={
            <>
              <Button variant="light" onClick={() => setDeleting(null)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="danger-solid" onClick={confirmDelete} loading={busy}>
                {busy ? "Deleting…" : "Delete"}
              </Button>
            </>
          }
        >
          <p>
            Delete <span className="font-semibold">{deleting.title}</span>? Its chat, members,
            votes, invites and the card in the group chat are removed too. This can&rsquo;t be
            undone.
          </p>
          {statusOf(deleting, now) !== "Past" && deleting.joinedCount > 0 && (
            <Alert tone="warning" surface="light" className="mt-4">
              {deleting.joinedCount} member{deleting.joinedCount === 1 ? "" : "s"} will be
              notified that the meetup was cancelled.
            </Alert>
          )}
        </Modal>
      )}

      {bulk && (
        <Modal
          layer="top"
          title="Pause old meetup chats"
          size="sm"
          onClose={() => !busy && setBulk(null)}
          footer={
            <>
              <Button variant="light" onClick={() => setBulk(null)} disabled={busy}>
                {bulk.length === 0 ? "Close" : "Cancel"}
              </Button>
              {bulk.length > 0 && (
                <Button onClick={confirmBulkPause} loading={busy}>
                  {busy ? "Pausing…" : `Pause ${bulk.length}`}
                </Button>
              )}
            </>
          }
        >
          {bulk.length === 0 ? (
            <p>
              Every meetup that started more than {PAST_DAYS} days ago already has its chat
              paused.
            </p>
          ) : (
            <p>
              Pause the chat of <span className="font-semibold">{bulk.length}</span> meetup
              {bulk.length === 1 ? "" : "s"} that started more than {PAST_DAYS} days ago?
              Members can still read the chat but can&rsquo;t send new messages.
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}

/* DETAIL DRAWER — a side panel the kit's Modal can't express, styled with the
 * same tokens (cream panel, dimmed blurred overlay, round X button). */
function MeetupDrawer({
  meetup,
  groupName,
  status,
  busy,
  onClose,
  onToggleChat,
  onDelete,
}: {
  meetup: Meetup;
  groupName: string;
  status: Status;
  busy: boolean;
  onClose: () => void;
  onToggleChat: () => void;
  onDelete: () => void;
}) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getDocs(collection(meetup.ref, "members"))
      .then((snap) =>
        setMembers(
          snap.docs
            .map((d) => {
              const x = d.data();
              return {
                id: d.id,
                name: x.name || "Unknown",
                photo: x.photo || "",
                joinedAt: toDate(x.joinedAt),
                via: x.via || "join",
              };
            })
            .sort((a, b) => (a.joinedAt?.getTime() ?? 0) - (b.joinedAt?.getTime() ?? 0)),
        ),
      )
      .catch((err) => {
        console.error(err);
        setError("Failed to load members.");
        setMembers([]);
      });

    // Live, so deletions and new messages show straight away.
    const unsub = onSnapshot(
      query(collection(meetup.ref, "messages"), orderBy("createdAt")),
      (snap) =>
        setMessages(
          snap.docs.map((d) => {
            const x = d.data();
            return {
              id: d.id,
              type: x.type || "text",
              userName: x.userName || "Unknown",
              message: x.message || "",
              createdAt: toDate(x.createdAt),
            };
          }),
        ),
      (err) => {
        console.error(err);
        setError("Failed to load the chat.");
        setMessages([]);
      },
    );
    return () => unsub();
  }, [meetup.ref]);

  const deleteMessage = async (m: Message) => {
    const preview = m.message.length > 80 ? `${m.message.slice(0, 80)}…` : m.message;
    if (!window.confirm(`Delete this message from ${m.userName}?\n\n"${preview}"`)) return;
    try {
      await deleteDoc(doc(meetup.ref, "messages", m.id));
    } catch (err) {
      console.error(err);
      setError("Failed to delete the message.");
    }
  };

  const stats: Array<[string, ReactNode]> = [
    ["Status", <Badge key="status" tone={STATUS_TONE[status]}>{status}</Badge>],
    ["Spots", `${meetup.joinedCount} / ${meetup.spots ?? "unlimited"}`],
    ["Likes", meetup.likeCount],
    ["Dislikes", meetup.dislikeCount],
    ["Kicked", meetup.kickedCount],
    ["Blocked", meetup.blockedCount],
    [
      "Chat",
      meetup.chatPaused ? (
        <Badge key="chat" tone="red">Paused</Badge>
      ) : (
        "Open"
      ),
    ],
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={meetup.title}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-xl flex-col overflow-hidden bg-[#e8dcc7] text-black shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-black/10 px-6 pt-6 pb-4">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-bold text-[#ff7a59]">{meetup.title}</h2>
            <p className="mt-1 text-sm text-black/60">
              {groupName} · {formatWhen(meetup.startAt)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/10 text-black transition hover:bg-black/20"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-6">
          {error && (
            <Alert surface="light" className="mb-4">
              {error}
            </Alert>
          )}

          {/* INFO */}
          <section className="text-sm">
            {meetup.description && (
              <p className="mb-4 whitespace-pre-wrap break-words">{meetup.description}</p>
            )}
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {stats.map(([label, value]) => (
                <div key={label} className="rounded-xl border border-black/10 bg-white/50 px-3 py-2">
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-black/50">
                    {label}
                  </dt>
                  <dd className="mt-0.5 font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="light"
                size="sm"
                icon={meetup.chatPaused ? Play : Pause}
                onClick={onToggleChat}
                disabled={busy}
              >
                {meetup.chatPaused ? "Resume chat" : "Pause chat"}
              </Button>
              <Button variant="danger" size="sm" icon={Trash2} onClick={onDelete}>
                Delete meetup
              </Button>
            </div>
          </section>

          {/* HOST + MEMBERS */}
          <section>
            <FormSection>Host</FormSection>
            <div className="mt-3">
              <Person name={meetup.creatorName} photo={meetup.creatorPhoto} />
            </div>

            <FormSection>Members {members ? `(${members.length})` : ""}</FormSection>
            {members === null ? (
              <DrawerLoading />
            ) : members.length === 0 ? (
              <p className="mt-3 text-sm text-black/50">Nobody has joined yet.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {members.map((mem) => (
                  <li
                    key={mem.id}
                    className="flex items-center justify-between gap-3 rounded-xl bg-white/50 px-3 py-2"
                  >
                    <Person name={mem.name} photo={mem.photo} />
                    <span className="flex shrink-0 items-center gap-2 text-xs text-black/55">
                      {mem.via !== "join" && <Badge>{mem.via}</Badge>}
                      {formatWhen(mem.joinedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* CHAT */}
          <section>
            <FormSection>Chat {messages ? `(${messages.length})` : ""}</FormSection>
            {messages === null ? (
              <DrawerLoading />
            ) : messages.length === 0 ? (
              <p className="mt-3 text-sm text-black/50">No messages yet.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {messages.map((msg) =>
                  msg.type === "system" ? (
                    <li
                      key={msg.id}
                      className="flex items-center justify-center gap-2 py-1 text-xs italic text-black/50"
                    >
                      <span>{msg.message}</span>
                      <DeleteLink onClick={() => deleteMessage(msg)} />
                    </li>
                  ) : (
                    <li
                      key={msg.id}
                      className="rounded-xl border border-black/5 bg-white/70 px-3 py-2 text-sm"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 truncate font-semibold">{msg.userName}</span>
                        <span className="flex shrink-0 items-center gap-2 text-xs text-black/45">
                          {msg.createdAt ? formatWhen(msg.createdAt) : "sending…"}
                          <DeleteLink onClick={() => deleteMessage(msg)} />
                        </span>
                      </div>
                      <p className="mt-0.5 whitespace-pre-wrap break-words">{msg.message}</p>
                    </li>
                  ),
                )}
              </ul>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}

function DrawerLoading() {
  return (
    <p className="mt-3 flex items-center gap-2 text-sm text-black/50">
      <Spinner className="h-4 w-4" />
      Loading…
    </p>
  );
}

function Person({ name, photo }: { name: string; photo: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {photo ? (
        <img
          src={photo}
          alt=""
          className="h-8 w-8 shrink-0 rounded-full border border-black/10 object-cover"
        />
      ) : (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/10 text-xs font-semibold">
          {name.charAt(0).toUpperCase()}
        </div>
      )}
      <span className="truncate text-sm font-medium">{name}</span>
    </div>
  );
}

function DeleteLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded font-medium not-italic text-red-600 transition hover:text-red-700 hover:underline"
    >
      Delete
    </button>
  );
}
