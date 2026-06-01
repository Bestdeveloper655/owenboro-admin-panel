"use client";

import { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  doc,
  orderBy,
  query,
} from "firebase/firestore";

import { db } from "@/lib/firebaseServices";

/* TYPES */
type Group = {
  id: string;
  name: string;
};

type Poll = {
  id: string; // doc id == date (yyyy-MM-dd)
  question: string;
  options: string[];
  date: string;
  active: boolean;
  totalVotes: number;
  voteCounts: Record<string, number>;
};

/* Local yyyy-MM-dd for the date input default. */
function todayKey(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export default function Page() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupId, setGroupId] = useState<string>("");

  const [polls, setPolls] = useState<Poll[]>([]);
  const [loadingPolls, setLoadingPolls] = useState(false);

  const [question, setQuestion] = useState("");
  const [date, setDate] = useState(todayKey());
  const [options, setOptions] = useState<string[]>(["", ""]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [deleting, setDeleting] = useState<Poll | null>(null);

  /* FETCH GROUPS */
  useEffect(() => {
    const fetchGroups = async () => {
      const snap = await getDocs(collection(db, "Groups"));
      const data = snap.docs.map((d) => ({
        id: d.id,
        name: (d.data().name as string) || "(unnamed group)",
      }));
      data.sort((a, b) => a.name.localeCompare(b.name));
      setGroups(data);
      if (data.length && !groupId) setGroupId(data[0].id);
    };
    fetchGroups().catch((e) => {
      console.error(e);
      setError("Failed to load groups");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* FETCH POLLS FOR SELECTED GROUP */
  const fetchPolls = async (gid: string) => {
    if (!gid) return;
    setLoadingPolls(true);
    try {
      const snap = await getDocs(
        query(collection(db, "Groups", gid, "polls"), orderBy("date", "desc")),
      );
      const data: Poll[] = snap.docs.map((d) => {
        const x = d.data();
        return {
          id: d.id,
          question: x.question || "",
          options: Array.isArray(x.options) ? x.options : [],
          date: x.date || d.id,
          active: x.active !== false,
          totalVotes: x.totalVotes || 0,
          voteCounts: x.voteCounts || {},
        };
      });
      setPolls(data);
    } catch (e) {
      console.error(e);
      setError("Failed to load polls");
    } finally {
      setLoadingPolls(false);
    }
  };

  useEffect(() => {
    if (groupId) fetchPolls(groupId);
  }, [groupId]);

  /* OPTION HELPERS */
  const updateOption = (i: number, value: string) =>
    setOptions((prev) => prev.map((o, idx) => (idx === i ? value : o)));
  const addOption = () =>
    setOptions((prev) => (prev.length >= 6 ? prev : [...prev, ""]));
  const removeOption = (i: number) =>
    setOptions((prev) => (prev.length <= 2 ? prev : prev.filter((_, idx) => idx !== i)));

  const resetForm = () => {
    setQuestion("");
    setDate(todayKey());
    setOptions(["", ""]);
  };

  /* CREATE / OVERWRITE POLL */
  const handleSubmit = async () => {
    setError("");
    setNotice("");

    if (!groupId) return setError("Select a group first.");
    const q = question.trim();
    const cleanOptions = options.map((o) => o.trim()).filter(Boolean);
    if (!q) return setError("Enter a poll question.");
    if (cleanOptions.length < 2)
      return setError("Add at least two non-empty options.");

    setSaving(true);
    try {
      const pollRef = doc(db, "Groups", groupId, "polls", date);
      const existing = await getDoc(pollRef);
      if (existing.exists()) {
        const ok = window.confirm(
          `A poll already exists for ${date}. Replacing it will reset its votes. Continue?`,
        );
        if (!ok) {
          setSaving(false);
          return;
        }
      }

      await setDoc(pollRef, {
        question: q,
        options: cleanOptions,
        date,
        active: true,
        totalVotes: 0,
        voteCounts: {},
        createdAt: new Date(),
      });

      setNotice(`Poll saved for ${date}.`);
      resetForm();
      await fetchPolls(groupId);
    } catch (e) {
      console.error(e);
      setError("Failed to save poll.");
    } finally {
      setSaving(false);
    }
  };

  /* DELETE */
  const confirmDelete = async () => {
    if (!deleting || !groupId) return;
    setSaving(true);
    try {
      await deleteDoc(doc(db, "Groups", groupId, "polls", deleting.id));
      setPolls((prev) => prev.filter((p) => p.id !== deleting.id));
      setDeleting(null);
    } catch (e) {
      console.error(e);
      setError("Failed to delete poll.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-4 pt-6 pb-10 md:px-8">
      {/* HEADER */}
      <div>
        <h1 className="text-4xl font-bold tracking-tight text-[#ff7a59] md:text-5xl">
          Group Polls
        </h1>
        <p className="mt-2 text-lg font-medium text-[#e8dcc7] md:text-xl">
          Add a daily poll for a specific group. It appears above the messaging
          bar in that group&apos;s chat.
        </p>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        {/* FORM */}
        <div className="rounded-2xl border border-[#ff7a59]/60 bg-[#0a0a0a] p-6">
          <h2 className="mb-6 text-xl font-semibold text-white">
            Create a poll
          </h2>

          <div className="space-y-5">
            {/* GROUP */}
            <div>
              <label className="block text-sm font-medium text-[#f3ead7]">
                Group
              </label>
              <select
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                className="mt-2 w-full rounded-lg border border-white/20 bg-black px-4 py-3 text-sm text-white outline-none focus:border-[#ff7a59]"
              >
                {groups.length === 0 && <option value="">No groups found</option>}
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>

            {/* DATE */}
            <div>
              <label className="block text-sm font-medium text-[#f3ead7]">
                Date (one poll per group per day)
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-2 w-full rounded-lg border border-white/20 bg-black px-4 py-3 text-sm text-white outline-none focus:border-[#ff7a59] [color-scheme:dark]"
              />
            </div>

            {/* QUESTION */}
            <div>
              <label className="block text-sm font-medium text-[#f3ead7]">
                Question
              </label>
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="What's your favorite spot in Owensboro?"
                className="mt-2 w-full rounded-lg border border-white/20 bg-black px-4 py-3 text-sm text-white outline-none focus:border-[#ff7a59]"
              />
            </div>

            {/* OPTIONS */}
            <div>
              <label className="block text-sm font-medium text-[#f3ead7]">
                Options
              </label>
              <div className="mt-2 space-y-3">
                {options.map((opt, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      value={opt}
                      onChange={(e) => updateOption(i, e.target.value)}
                      placeholder={`Option ${i + 1}`}
                      className="w-full rounded-lg border border-white/20 bg-black px-4 py-3 text-sm text-white outline-none focus:border-[#ff7a59]"
                    />
                    {options.length > 2 && (
                      <button
                        type="button"
                        onClick={() => removeOption(i)}
                        className="shrink-0 rounded-lg border border-white/20 px-3 py-2 text-sm text-white/70 hover:bg-white/10"
                        aria-label="Remove option"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {options.length < 6 && (
                <button
                  type="button"
                  onClick={addOption}
                  className="mt-3 text-sm font-medium text-[#ff7a59] hover:underline"
                >
                  + Add option
                </button>
              )}
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}
            {notice && <p className="text-sm text-green-400">{notice}</p>}

            <button
              onClick={handleSubmit}
              disabled={saving}
              className="mt-2 inline-flex items-center justify-center rounded-lg bg-[#ff7a59] px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {saving ? <Spinner /> : "Save poll"}
            </button>
          </div>
        </div>

        {/* LIST */}
        <div>
          <h2 className="mb-4 text-xl font-semibold text-[#e8dcc7]">
            Existing polls
          </h2>

          {loadingPolls ? (
            <div className="flex justify-center py-10">
              <Spinner dark />
            </div>
          ) : polls.length === 0 ? (
            <p className="text-[#e8dcc7]/70">No polls for this group yet.</p>
          ) : (
            <div className="space-y-4">
              {polls.map((poll) => (
                <PollCard
                  key={poll.id}
                  poll={poll}
                  onDelete={() => setDeleting(poll)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* DELETE MODAL */}
      {deleting && (
        <Modal title="Delete Poll" onClose={() => setDeleting(null)}>
          <p className="text-black">
            Delete the poll for <b>{deleting.date}</b>?
          </p>
          <div className="mt-6 flex gap-3">
            <button
              onClick={() => setDeleting(null)}
              className="w-full rounded-lg border py-2"
            >
              Cancel
            </button>
            <button
              onClick={confirmDelete}
              disabled={saving}
              className="flex w-full justify-center rounded-lg bg-red-500 py-2 text-white"
            >
              {saving ? <Spinner /> : "Delete"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* CARD */
function PollCard({
  poll,
  onDelete,
}: {
  poll: Poll;
  onDelete: () => void;
}) {
  const isToday = poll.date === todayKey();
  return (
    <div className="rounded-xl border border-[#ff7a59]/40 bg-[#0a0a0a] p-5 text-white">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-[#ff7a59]">
              {poll.date}
            </span>
            {isToday && (
              <span className="rounded-full bg-[#ff7a59] px-2 py-0.5 text-[10px] font-bold uppercase">
                Today
              </span>
            )}
          </div>
          <p className="mt-1 text-base font-semibold">{poll.question}</p>
        </div>
        <button onClick={onDelete} aria-label="Delete poll">
          🗑️
        </button>
      </div>

      <div className="mt-3 space-y-2">
        {poll.options.map((opt, i) => {
          const count = poll.voteCounts?.[String(i)] || 0;
          const pct =
            poll.totalVotes > 0
              ? Math.round((count / poll.totalVotes) * 100)
              : 0;
          return (
            <div key={i}>
              <div className="flex justify-between text-xs text-white/80">
                <span>{opt}</span>
                <span>
                  {count} ({pct}%)
                </span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full bg-[#ff7a59]"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-xs text-white/60">
        {poll.totalVotes} total vote{poll.totalVotes === 1 ? "" : "s"}
      </p>
    </div>
  );
}

/* MODAL */
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
    <div className="fixed inset-0 flex items-center justify-center bg-black/70">
      <div className="w-[90%] max-w-lg rounded-3xl bg-[#e8dcc7] p-6 text-black">
        <div className="mb-4 flex justify-between">
          <h2 className="text-xl font-bold text-[#ff7a59]">{title}</h2>
          <button onClick={onClose}>✖</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* SPINNER */
function Spinner({ dark = false }: { dark?: boolean }) {
  return (
    <div
      className={`h-5 w-5 animate-spin rounded-full border-2 border-t-transparent ${
        dark ? "border-[#ff7a59]" : "border-white"
      }`}
    />
  );
}
