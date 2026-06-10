"use client";

import { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  setDoc,
  deleteDoc,
  doc,
  orderBy,
  query,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "@/lib/firebaseServices";

/* TYPES */
type Group = {
  id: string;
  name: string;
};

type PollType = "poll" | "question";

type Poll = {
  id: string; // doc id == shared pollId
  pollId: string;
  type: PollType;
  question: string;
  options: string[];
  allowOther: boolean;
  groupIds: string[];
  date: string;
  active: boolean;
  totalVotes: number;
  answerCount: number;
  voteCounts: Record<string, number>;
};

type Answer = {
  uid: string;
  userName: string;
  optionIndex: number | null;
  otherText: string;
  answerText: string;
};

/* Local yyyy-MM-dd for the date stamp. */
function todayKey(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/* Cheap unique id shared across every targeted group's copy of the poll. */
function makePollId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function Page() {
  const [groups, setGroups] = useState<Group[]>([]);

  /* CREATE FORM STATE */
  const [type, setType] = useState<PollType>("poll");
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [allowOther, setAllowOther] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  /* LIST STATE (per group) */
  const [viewGroupId, setViewGroupId] = useState<string>("");
  const [polls, setPolls] = useState<Poll[]>([]);
  const [loadingPolls, setLoadingPolls] = useState(false);

  const [deleting, setDeleting] = useState<Poll | null>(null);
  const [viewingAnswers, setViewingAnswers] = useState<Poll | null>(null);

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
      if (data.length) setViewGroupId((prev) => prev || data[0].id);
    };
    fetchGroups().catch((e) => {
      console.error(e);
      setError("Failed to load groups");
    });
  }, []);

  /* LIVE POLLS FOR THE GROUP BEING VIEWED — updates as users answer */
  useEffect(() => {
    if (!viewGroupId) {
      setPolls([]);
      return;
    }
    setLoadingPolls(true);
    const unsub = onSnapshot(
      query(
        collection(db, "Groups", viewGroupId, "polls"),
        orderBy("date", "desc"),
      ),
      (snap) => {
        const data: Poll[] = snap.docs.map((d) => {
          const x = d.data();
          return {
            id: d.id,
            pollId: (x.pollId as string) || d.id,
            type: (x.type as PollType) === "question" ? "question" : "poll",
            question: x.question || "",
            options: Array.isArray(x.options) ? x.options : [],
            allowOther: x.allowOther === true,
            groupIds: Array.isArray(x.groupIds) ? x.groupIds : [],
            date: x.date || d.id,
            active: x.active !== false,
            totalVotes: x.totalVotes || 0,
            answerCount: x.answerCount || 0,
            voteCounts: x.voteCounts || {},
          };
        });
        setPolls(data);
        setLoadingPolls(false);
      },
      (e) => {
        console.error(e);
        setError("Failed to load polls");
        setLoadingPolls(false);
      },
    );
    return () => unsub();
  }, [viewGroupId]);

  /* OPTION HELPERS */
  const updateOption = (i: number, value: string) =>
    setOptions((prev) => prev.map((o, idx) => (idx === i ? value : o)));
  const addOption = () =>
    setOptions((prev) => (prev.length >= 6 ? prev : [...prev, ""]));
  const removeOption = (i: number) =>
    setOptions((prev) =>
      prev.length <= 2 ? prev : prev.filter((_, idx) => idx !== i),
    );

  const toggleGroup = (id: string) =>
    setSelectedGroupIds((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id],
    );
  const allSelected =
    groups.length > 0 && selectedGroupIds.length === groups.length;
  const toggleAllGroups = () =>
    setSelectedGroupIds(allSelected ? [] : groups.map((g) => g.id));

  const resetForm = () => {
    setQuestion("");
    setOptions(["", ""]);
    setAllowOther(false);
    setSelectedGroupIds([]);
  };

  /* CREATE — fan the same poll out to every selected group */
  const handleSubmit = async () => {
    setError("");
    setNotice("");

    const q = question.trim();
    if (!q) return setError("Enter a question.");
    if (selectedGroupIds.length === 0)
      return setError("Select at least one group.");

    let cleanOptions: string[] = [];
    if (type === "poll") {
      cleanOptions = options.map((o) => o.trim()).filter(Boolean);
      if (cleanOptions.length < 2)
        return setError("A poll needs at least two non-empty options.");
    }

    setSaving(true);
    try {
      const pollId = makePollId();
      const date = todayKey();
      const payload = {
        pollId,
        type,
        question: q,
        options: cleanOptions,
        allowOther: type === "poll" ? allowOther : false,
        groupIds: selectedGroupIds,
        date,
        active: true,
        totalVotes: 0,
        answerCount: 0,
        voteCounts: {},
        createdAt: serverTimestamp(),
      };

      await Promise.all(
        selectedGroupIds.map((gid) =>
          setDoc(doc(db, "Groups", gid, "polls", pollId), payload),
        ),
      );

      setNotice(
        `${type === "poll" ? "Poll" : "Question"} sent to ${selectedGroupIds.length} group${selectedGroupIds.length === 1 ? "" : "s"}.`,
      );
      resetForm();
    } catch (e) {
      console.error(e);
      setError("Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  /* DELETE (from the group being viewed) */
  const confirmDelete = async () => {
    if (!deleting || !viewGroupId) return;
    setSaving(true);
    try {
      await deleteDoc(doc(db, "Groups", viewGroupId, "polls", deleting.id));
      setPolls((prev) => prev.filter((p) => p.id !== deleting.id));
      setDeleting(null);
    } catch (e) {
      console.error(e);
      setError("Failed to delete.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-4 pt-6 pb-10 md:px-8">
      {/* HEADER */}
      <div>
        <h1 className="text-4xl font-bold tracking-tight text-[#ff7a59] md:text-5xl">
          Polls &amp; Questions
        </h1>
        <p className="mt-2 text-lg font-medium text-[#e8dcc7] md:text-xl">
          Create a multiple-choice poll or an open question and send it to one or
          more groups. It appears above the messaging bar in each group&apos;s
          chat.
        </p>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        {/* FORM */}
        <div className="rounded-2xl border border-[#ff7a59]/60 bg-[#0a0a0a] p-6">
          <h2 className="mb-6 text-xl font-semibold text-white">Create</h2>

          <div className="space-y-5">
            {/* TYPE */}
            <div>
              <label className="block text-sm font-medium text-[#f3ead7]">
                Type
              </label>
              <div className="mt-2 flex gap-2">
                {(["poll", "question"] as PollType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={`flex-1 rounded-lg border px-4 py-3 text-sm font-semibold transition ${
                      type === t
                        ? "border-[#ff7a59] bg-[#ff7a59] text-white"
                        : "border-white/20 bg-black text-white/70 hover:bg-white/10"
                    }`}
                  >
                    {t === "poll" ? "Poll (choices)" : "Question (free text)"}
                  </button>
                ))}
              </div>
            </div>

            {/* GROUPS */}
            <div>
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-[#f3ead7]">
                  Groups ({selectedGroupIds.length} selected)
                </label>
                {groups.length > 0 && (
                  <button
                    type="button"
                    onClick={toggleAllGroups}
                    className="text-xs font-medium text-[#ff7a59] hover:underline"
                  >
                    {allSelected ? "Clear all" : "Select all"}
                  </button>
                )}
              </div>
              <div className="mt-2 max-h-44 space-y-1 overflow-y-auto rounded-lg border border-white/20 bg-black p-2">
                {groups.length === 0 && (
                  <p className="px-2 py-1 text-sm text-white/50">
                    No groups found
                  </p>
                )}
                {groups.map((g) => (
                  <label
                    key={g.id}
                    className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm text-white hover:bg-white/10"
                  >
                    <input
                      type="checkbox"
                      checked={selectedGroupIds.includes(g.id)}
                      onChange={() => toggleGroup(g.id)}
                      className="h-4 w-4 accent-[#ff7a59]"
                    />
                    {g.name}
                  </label>
                ))}
              </div>
            </div>

            {/* QUESTION */}
            <div>
              <label className="block text-sm font-medium text-[#f3ead7]">
                {type === "poll" ? "Poll question" : "Question"}
              </label>
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={
                  type === "poll"
                    ? "What's your favorite spot in Owensboro?"
                    : "What would you like to see more of?"
                }
                className="mt-2 w-full rounded-lg border border-white/20 bg-black px-4 py-3 text-sm text-white outline-none focus:border-[#ff7a59]"
              />
            </div>

            {/* OPTIONS (poll only) */}
            {type === "poll" && (
              <>
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

                {/* ALLOW OTHER */}
                <label className="flex cursor-pointer items-center gap-3 text-sm text-white">
                  <input
                    type="checkbox"
                    checked={allowOther}
                    onChange={(e) => setAllowOther(e.target.checked)}
                    className="h-4 w-4 accent-[#ff7a59]"
                  />
                  Add an &ldquo;Other&rdquo; option where users type their own
                  answer
                </label>
              </>
            )}

            {error && <p className="text-sm text-red-400">{error}</p>}
            {notice && <p className="text-sm text-green-400">{notice}</p>}

            <button
              onClick={handleSubmit}
              disabled={saving}
              className="mt-2 inline-flex items-center justify-center rounded-lg bg-[#ff7a59] px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {saving ? <Spinner /> : `Send ${type === "poll" ? "poll" : "question"}`}
            </button>
          </div>
        </div>

        {/* LIST */}
        <div>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold text-[#e8dcc7]">
              Existing in group
            </h2>
            <select
              value={viewGroupId}
              onChange={(e) => setViewGroupId(e.target.value)}
              className="rounded-lg border border-white/20 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#ff7a59]"
            >
              {groups.length === 0 && <option value="">No groups</option>}
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          {loadingPolls ? (
            <div className="flex justify-center py-10">
              <Spinner dark />
            </div>
          ) : polls.length === 0 ? (
            <p className="text-[#e8dcc7]/70">
              Nothing for this group yet.
            </p>
          ) : (
            <div className="space-y-4">
              {polls.map((poll) => (
                <PollCard
                  key={poll.id}
                  poll={poll}
                  onDelete={() => setDeleting(poll)}
                  onViewAnswers={() => setViewingAnswers(poll)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* DELETE MODAL */}
      {deleting && (
        <Modal title="Delete" onClose={() => setDeleting(null)}>
          <p className="text-black">
            Delete this {deleting.type === "poll" ? "poll" : "question"} from
            this group? Other groups it was sent to keep their copy.
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

      {/* ANSWERS MODAL */}
      {viewingAnswers && viewGroupId && (
        <AnswersModal
          groupId={viewGroupId}
          poll={viewingAnswers}
          onClose={() => setViewingAnswers(null)}
        />
      )}
    </div>
  );
}

/* CARD */
function PollCard({
  poll,
  onDelete,
  onViewAnswers,
}: {
  poll: Poll;
  onDelete: () => void;
  onViewAnswers: () => void;
}) {
  const isToday = poll.date === todayKey();
  const otherCount = poll.voteCounts?.["other"] || 0;
  return (
    <div className="rounded-xl border border-[#ff7a59]/40 bg-[#0a0a0a] p-5 text-white">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-[#ff7a59]/60 px-2 py-0.5 text-[10px] font-bold uppercase text-[#ff7a59]">
              {poll.type === "poll" ? "Poll" : "Question"}
            </span>
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
        <button onClick={onDelete} aria-label="Delete">
          🗑️
        </button>
      </div>

      {poll.type === "poll" ? (
        <>
          <div className="mt-3 space-y-2">
            {poll.options.map((opt, i) => {
              const count = poll.voteCounts?.[String(i)] || 0;
              const pct =
                poll.totalVotes > 0
                  ? Math.round((count / poll.totalVotes) * 100)
                  : 0;
              return <OptionBar key={i} label={opt} count={count} pct={pct} />;
            })}
            {poll.allowOther && (
              <OptionBar
                label="Other (typed)"
                count={otherCount}
                pct={
                  poll.totalVotes > 0
                    ? Math.round((otherCount / poll.totalVotes) * 100)
                    : 0
                }
              />
            )}
          </div>
          <p className="mt-3 text-xs text-white/60">
            {poll.totalVotes} total vote{poll.totalVotes === 1 ? "" : "s"}
          </p>
        </>
      ) : (
        <p className="mt-3 text-xs text-white/60">
          {poll.answerCount} answer{poll.answerCount === 1 ? "" : "s"}
        </p>
      )}

      <button
        onClick={onViewAnswers}
        className="mt-3 text-sm font-medium text-[#ff7a59] hover:underline"
      >
        View all answers
      </button>
    </div>
  );
}

function OptionBar({
  label,
  count,
  pct,
}: {
  label: string;
  count: number;
  pct: number;
}) {
  return (
    <div>
      <div className="flex justify-between text-xs text-white/80">
        <span>{label}</span>
        <span>
          {count} ({pct}%)
        </span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div className="h-full bg-[#ff7a59]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ANSWERS MODAL — reads the responses subcollection for this group */
function AnswersModal({
  groupId,
  poll,
  onClose,
}: {
  groupId: string;
  poll: Poll;
  onClose: () => void;
}) {
  const [answers, setAnswers] = useState<Answer[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const snap = await getDocs(
          collection(db, "Groups", groupId, "polls", poll.id, "responses"),
        );
        const rows: Answer[] = snap.docs.map((d) => {
          const x = d.data();
          return {
            uid: d.id,
            userName: (x.userName as string) || "Someone",
            optionIndex:
              typeof x.optionIndex === "number" ? x.optionIndex : null,
            otherText: (x.otherText as string) || "",
            answerText: (x.answerText as string) || "",
          };
        });
        setAnswers(rows);
      } catch (e) {
        console.error(e);
        setError("Failed to load answers.");
      }
    };
    load();
  }, [groupId, poll.id]);

  const label = (a: Answer): string => {
    if (poll.type === "question") return a.answerText || "(blank)";
    if (a.otherText) return `Other: ${a.otherText}`;
    if (a.optionIndex != null && poll.options[a.optionIndex] != null)
      return poll.options[a.optionIndex];
    return "(no choice)";
  };

  return (
    <Modal title="All answers" onClose={onClose}>
      <p className="mb-4 text-sm font-semibold text-black">{poll.question}</p>
      {error && <p className="text-sm text-red-500">{error}</p>}
      {answers === null ? (
        <div className="flex justify-center py-6">
          <Spinner dark />
        </div>
      ) : answers.length === 0 ? (
        <p className="text-black/60">No answers yet.</p>
      ) : (
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {answers.map((a) => (
            <div
              key={a.uid}
              className="flex items-start justify-between gap-3 rounded-lg bg-black/5 px-3 py-2 text-sm text-black"
            >
              <span className="font-semibold">{a.userName}</span>
              <span className="text-right text-black/70">{label(a)}</span>
            </div>
          ))}
        </div>
      )}
      <button
        onClick={onClose}
        className="mt-6 w-full rounded-lg bg-[#ff7a59] py-2 font-semibold text-white"
      >
        Close
      </button>
    </Modal>
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
    <div className="fixed inset-0 flex items-center justify-center bg-black/70 p-4">
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
