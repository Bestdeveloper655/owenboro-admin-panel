"use client";

import { useEffect, useMemo, useState } from "react";
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
import { X } from "lucide-react";

import { db } from "@/lib/firebaseServices";

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

const STATUS_STYLE: Record<Status, string> = {
  Upcoming: "bg-green-600 text-white",
  Full: "bg-amber-500 text-black",
  Past: "bg-black/20 text-black",
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
    <div className="px-2 pt-4 pb-8 sm:px-6 sm:pt-6 sm:pb-10">
      <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[#ff7a59] sm:text-4xl">Meetups</h1>
          <p className="mt-2 max-w-3xl text-base text-[#e8dcc7] sm:text-lg">
            Meetup with Friends across all groups. Times are shown in Central time,
            as in the app.
          </p>
        </div>
        <button
          onClick={findOldUnpaused}
          disabled={busy}
          className="self-start rounded-xl border border-[#ff7a59] px-4 py-2 text-sm text-[#ff7a59] transition hover:bg-[#ff7a59] hover:text-white disabled:opacity-50"
        >
          Pause chats of meetups over {PAST_DAYS} days old
        </button>
      </div>

      {/* FILTERS */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <select
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          className="rounded-xl border border-white/15 bg-[#0a0a0a] px-3 py-2 text-sm text-white outline-none focus:border-[#ff7a59]"
        >
          <option value="">All groups</option>
          {[...groups].map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>

        <div className="inline-flex rounded-xl border border-[#ff7a59]/50 bg-[#0a0a0a] p-1 text-sm">
          {(["upcoming", "past", "all"] as StatusFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setStatusFilter(f)}
              className={`rounded-lg px-3 py-1.5 capitalize transition sm:px-4 ${
                statusFilter === f ? "bg-[#ff7a59] text-white" : "text-[#f3ead7]/80 hover:text-[#ff7a59]"
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm text-[#f3ead7]">
          <input
            type="checkbox"
            checked={pausedOnly}
            onChange={(e) => setPausedOnly(e.target.checked)}
          />
          Chat paused only
        </label>

        <button
          type="button"
          onClick={() => load(groupId)}
          className="text-sm text-[#f3ead7]/70 underline hover:text-white"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}
      {notice && !error && (
        <div className="mb-4 rounded-xl border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
          {notice}
        </div>
      )}

      {/* LIST */}
      {loading ? (
        <div className="rounded-2xl border border-[#ff7a59]/40 bg-[#0a0a0a] px-5 py-10 text-center text-[#f3ead7]/70">
          Loading meetups…
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-[#ff7a59]/40 bg-[#0a0a0a] px-5 py-10 text-center text-[#f3ead7]/70">
          {meetups.length === 0 ? "No meetups yet." : "No meetups match these filters."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[1000px] text-left">
            <thead className="bg-[#ece2cb] text-black">
              <tr>
                <th className="p-3">Title</th>
                <th className="p-3">Group</th>
                <th className="p-3">Host</th>
                <th className="p-3">When</th>
                <th className="p-3">Status</th>
                <th className="p-3">Joined</th>
                <th className="p-3">Likes</th>
                <th className="p-3">Dislikes</th>
                <th className="p-3">Chat</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((m) => {
                const status = statusOf(m, now);
                return (
                  <tr
                    key={m.ref.path}
                    className="border-b border-white/10 bg-[#ece2cb] text-black hover:bg-[#f5ecd7]"
                  >
                    <td className="max-w-[220px] truncate p-3 font-semibold">{m.title}</td>
                    <td className="p-3 text-black/70">{groupName(m.groupId)}</td>
                    <td className="p-3">{m.creatorName}</td>
                    <td className="whitespace-nowrap p-3">{formatWhen(m.startAt)}</td>
                    <td className="p-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]}`}>
                        {status}
                      </span>
                    </td>
                    <td className="p-3">
                      {m.joinedCount} / {m.spots ?? "∞"}
                    </td>
                    <td className="p-3">{m.likeCount}</td>
                    <td className="p-3">{m.dislikeCount}</td>
                    <td className="p-3">
                      {m.chatPaused ? (
                        <span className="rounded-full bg-red-500/90 px-2 py-0.5 text-xs font-semibold text-white">
                          Paused
                        </span>
                      ) : (
                        <span className="text-xs text-black/60">Open</span>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex justify-end gap-2 whitespace-nowrap">
                        <button
                          onClick={() => setSelected(m)}
                          className="rounded-lg bg-[#ff7a59] px-3 py-1 text-xs text-white"
                        >
                          View
                        </button>
                        <button
                          onClick={() => setChatPaused(m, !m.chatPaused)}
                          disabled={busy}
                          className="rounded-lg border border-black/20 px-3 py-1 text-xs disabled:opacity-50"
                        >
                          {m.chatPaused ? "Resume chat" : "Pause chat"}
                        </button>
                        <button
                          onClick={() => setDeleting(m)}
                          className="rounded-lg border border-red-400 px-3 py-1 text-xs text-red-500 hover:bg-red-500 hover:text-white"
                        >
                          Delete
                        </button>
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

      {deleting && (
        <Modal title="Delete meetup" onClose={() => !busy && setDeleting(null)}>
          <p>
            Delete <b>{deleting.title}</b>? Its chat, members, votes, invites and the
            card in the group chat are removed too. This can&rsquo;t be undone.
          </p>
          {statusOf(deleting, now) !== "Past" && deleting.joinedCount > 0 && (
            <p className="mt-3 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">
              {deleting.joinedCount} member{deleting.joinedCount === 1 ? "" : "s"} will be
              notified that the meetup was cancelled.
            </p>
          )}
          <div className="mt-6 flex justify-end gap-3">
            <button
              onClick={() => setDeleting(null)}
              disabled={busy}
              className="rounded-xl border border-black/15 px-4 py-2"
            >
              Cancel
            </button>
            <button
              onClick={confirmDelete}
              disabled={busy}
              className="rounded-xl bg-red-500 px-4 py-2 text-white disabled:opacity-60"
            >
              {busy ? "Deleting…" : "Delete"}
            </button>
          </div>
        </Modal>
      )}

      {bulk && (
        <Modal title="Pause old meetup chats" onClose={() => !busy && setBulk(null)}>
          {bulk.length === 0 ? (
            <p>
              Every meetup that started more than {PAST_DAYS} days ago already has its
              chat paused.
            </p>
          ) : (
            <p>
              Pause the chat of <b>{bulk.length}</b> meetup{bulk.length === 1 ? "" : "s"} that
              started more than {PAST_DAYS} days ago? Members can still read the chat
              but can&rsquo;t send new messages.
            </p>
          )}
          <div className="mt-6 flex justify-end gap-3">
            <button
              onClick={() => setBulk(null)}
              disabled={busy}
              className="rounded-xl border border-black/15 px-4 py-2"
            >
              {bulk.length === 0 ? "Close" : "Cancel"}
            </button>
            {bulk.length > 0 && (
              <button
                onClick={confirmBulkPause}
                disabled={busy}
                className="rounded-xl bg-[#ff7a59] px-4 py-2 text-white disabled:opacity-60"
              >
                {busy ? "Pausing…" : `Pause ${bulk.length}`}
              </button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

/* DETAIL DRAWER */
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

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose}>
      <aside
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-xl flex-col overflow-hidden bg-[#e8dcc7] text-black shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-black/10 p-5">
          <div className="min-w-0">
            <h2 className="truncate text-2xl font-bold text-[#ff7a59]">{meetup.title}</h2>
            <p className="text-sm text-black/60">
              {groupName} · {formatWhen(meetup.startAt)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/10 hover:bg-black/20"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          {error && (
            <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}

          {/* INFO */}
          <section className="space-y-2 text-sm">
            {meetup.description && <p className="whitespace-pre-wrap">{meetup.description}</p>}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <p><b>Status:</b> {status}</p>
              <p><b>Spots:</b> {meetup.joinedCount} / {meetup.spots ?? "unlimited"}</p>
              <p><b>Likes:</b> {meetup.likeCount}</p>
              <p><b>Dislikes:</b> {meetup.dislikeCount}</p>
              <p><b>Kicked:</b> {meetup.kickedCount}</p>
              <p><b>Blocked:</b> {meetup.blockedCount}</p>
              <p><b>Chat:</b> {meetup.chatPaused ? "Paused" : "Open"}</p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={onToggleChat}
                disabled={busy}
                className="rounded-lg border border-black/20 px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {meetup.chatPaused ? "Resume chat" : "Pause chat"}
              </button>
              <button
                onClick={onDelete}
                className="rounded-lg border border-red-400 px-3 py-1.5 text-sm text-red-500 hover:bg-red-500 hover:text-white"
              >
                Delete meetup
              </button>
            </div>
          </section>

          {/* HOST + MEMBERS */}
          <section>
            <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-black/60">Host</h3>
            <Person name={meetup.creatorName} photo={meetup.creatorPhoto} />

            <h3 className="mb-2 mt-4 text-sm font-bold uppercase tracking-wide text-black/60">
              Members {members ? `(${members.length})` : ""}
            </h3>
            {members === null ? (
              <p className="text-sm text-black/50">Loading…</p>
            ) : members.length === 0 ? (
              <p className="text-sm text-black/50">Nobody has joined yet.</p>
            ) : (
              <ul className="space-y-2">
                {members.map((mem) => (
                  <li key={mem.id} className="flex items-center justify-between gap-3">
                    <Person name={mem.name} photo={mem.photo} />
                    <span className="shrink-0 text-xs text-black/55">
                      {mem.via !== "join" && (
                        <span className="mr-2 rounded-full bg-black/10 px-2 py-0.5">{mem.via}</span>
                      )}
                      {formatWhen(mem.joinedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* CHAT */}
          <section>
            <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-black/60">
              Chat {messages ? `(${messages.length})` : ""}
            </h3>
            {messages === null ? (
              <p className="text-sm text-black/50">Loading…</p>
            ) : messages.length === 0 ? (
              <p className="text-sm text-black/50">No messages yet.</p>
            ) : (
              <ul className="space-y-2">
                {messages.map((msg) =>
                  msg.type === "system" ? (
                    <li key={msg.id} className="group flex items-center justify-center gap-2 text-xs italic text-black/50">
                      <span>{msg.message}</span>
                      <DeleteLink onClick={() => deleteMessage(msg)} />
                    </li>
                  ) : (
                    <li key={msg.id} className="rounded-xl bg-white/70 px-3 py-2 text-sm">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold">{msg.userName}</span>
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

function Person({ name, photo }: { name: string; photo: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {photo ? (
        <img src={photo} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
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
    <button onClick={onClick} className="not-italic text-red-600 hover:underline">
      Delete
    </button>
  );
}

function Modal({
  children,
  title,
  onClose,
}: {
  children: React.ReactNode;
  title: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-lg rounded-3xl bg-[#e8dcc7] p-6 text-black shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-[#ff7a59]">{title}</h2>
          <button onClick={onClose} aria-label="Close">
            ✖
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
