"use client";

import { useEffect, useState } from "react";
import { BarChart3, Calendar, Eye, Plus, Send, X } from "lucide-react";
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
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  FilterSelect,
  LoadingState,
  Modal,
  PageHeader,
  SectionHeading,
  Segmented,
  Spinner,
  SwitchRow,
  TextInput,
} from "@/components/ui";

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
    <div>
      <PageHeader
        title="Polls & Questions"
        description={
          <>
            Create a multiple-choice poll or an open question and send it to one or
            more groups. It appears above the messaging bar in each group&apos;s
            chat.
          </>
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-2">
        {/* FORM */}
        <Card title="Create">
          {/* TYPE */}
          <Field label="Type" tone="dark">
            <Segmented<PollType>
              value={type}
              onChange={setType}
              options={[
                { value: "poll", label: "Poll (choices)" },
                { value: "question", label: "Question (free text)" },
              ]}
            />
          </Field>

          {/* GROUPS */}
          <div className="mt-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-[#f4ead7]">
                Groups{" "}
                <span className="font-normal text-[#f4ead7]/55">
                  ({selectedGroupIds.length} selected)
                </span>
              </p>
              {groups.length > 0 && (
                <Button size="sm" variant="secondary" onClick={toggleAllGroups}>
                  {allSelected ? "Clear all" : "Select all"}
                </Button>
              )}
            </div>
            <div className="mt-2 max-h-44 space-y-0.5 overflow-y-auto rounded-xl border border-white/15 bg-[#0a0a0a] p-1.5">
              {groups.length === 0 && (
                <p className="px-2.5 py-2 text-sm text-white/50">
                  No groups found
                </p>
              )}
              {groups.map((g) => (
                <label
                  key={g.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-[#f4ead7] transition hover:bg-white/5"
                >
                  <input
                    type="checkbox"
                    checked={selectedGroupIds.includes(g.id)}
                    onChange={() => toggleGroup(g.id)}
                    className="h-4 w-4 shrink-0 accent-[#ff7a59]"
                  />
                  <span className="min-w-0 truncate">{g.name}</span>
                </label>
              ))}
            </div>
          </div>

          {/* QUESTION */}
          <Field label={type === "poll" ? "Poll question" : "Question"} tone="dark">
            <TextInput
              tone="dark"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={
                type === "poll"
                  ? "What's your favorite spot in Owensboro?"
                  : "What would you like to see more of?"
              }
            />
          </Field>

          {/* OPTIONS (poll only) */}
          {type === "poll" && (
            <>
              <Field label="Options" tone="dark">
                <div className="space-y-2">
                  {options.map((opt, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <TextInput
                        tone="dark"
                        value={opt}
                        onChange={(e) => updateOption(i, e.target.value)}
                        placeholder={`Option ${i + 1}`}
                      />
                      {options.length > 2 && (
                        <Button
                          variant="secondary"
                          icon={X}
                          onClick={() => removeOption(i)}
                          className="self-stretch"
                          aria-label="Remove option"
                        />
                      )}
                    </div>
                  ))}
                </div>
                {options.length < 6 && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={Plus}
                    onClick={addOption}
                    className="mt-3"
                  >
                    Add option
                  </Button>
                )}
              </Field>

              {/* ALLOW OTHER */}
              <SwitchRow
                tone="dark"
                title={<>Add an &ldquo;Other&rdquo; option where users type their own answer</>}
                checked={allowOther}
                onChange={setAllowOther}
              />
            </>
          )}

          {error && (
            <Alert className="mt-4" onDismiss={() => setError("")}>
              {error}
            </Alert>
          )}
          {notice && (
            <Alert tone="success" className="mt-4" onDismiss={() => setNotice("")}>
              {notice}
            </Alert>
          )}

          <div className="mt-6 flex justify-end">
            <Button icon={Send} onClick={handleSubmit} loading={saving}>
              {`Send ${type === "poll" ? "poll" : "question"}`}
            </Button>
          </div>
        </Card>

        {/* LIST */}
        <div className="min-w-0">
          <SectionHeading
            title="Existing in group"
            actions={
              <FilterSelect
                value={viewGroupId}
                onChange={(e) => setViewGroupId(e.target.value)}
                className="max-w-full"
              >
                {groups.length === 0 && <option value="">No groups</option>}
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </FilterSelect>
            }
          />

          {loadingPolls ? (
            <LoadingState label="Loading polls…" />
          ) : polls.length === 0 ? (
            <EmptyState icon={BarChart3} title="Nothing for this group yet." />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-1">
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
        <Modal
          title="Delete"
          size="sm"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button variant="light" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button variant="danger-solid" onClick={confirmDelete} loading={saving}>
                Delete
              </Button>
            </>
          }
        >
          <p>
            Delete this {deleting.type === "poll" ? "poll" : "question"} from
            this group? Other groups it was sent to keep their copy.
          </p>
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
    <Card tone="cream" className="flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={poll.type === "poll" ? "purple" : "blue"}>
              {poll.type === "poll" ? "Poll" : "Question"}
            </Badge>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-black/55">
              <Calendar className="h-3.5 w-3.5" aria-hidden />
              {poll.date}
            </span>
            {isToday && <Badge tone="orange">Today</Badge>}
          </div>
          <p className="mt-2 text-base font-semibold break-words">{poll.question}</p>
        </div>
        <Button size="sm" variant="danger" onClick={onDelete}>
          Delete
        </Button>
      </div>

      {poll.type === "poll" && (
        <div className="mt-4 space-y-2.5">
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
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-black/10 pt-3">
        <p className="text-xs text-black/55">
          {poll.type === "poll"
            ? `${poll.totalVotes} total vote${poll.totalVotes === 1 ? "" : "s"}`
            : `${poll.answerCount} answer${poll.answerCount === 1 ? "" : "s"}`}
        </p>
        <Button size="sm" variant="light" icon={Eye} onClick={onViewAnswers}>
          View all answers
        </Button>
      </div>
    </Card>
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
      <div className="flex justify-between gap-3 text-xs text-black/70">
        <span className="min-w-0 break-words">{label}</span>
        <span className="shrink-0 tabular-nums">
          {count} ({pct}%)
        </span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-black/10">
        <div className="h-full rounded-full bg-[#ff7a59]" style={{ width: `${pct}%` }} />
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
    <Modal
      title="All answers"
      description={poll.question}
      size="md"
      onClose={onClose}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {error && (
        <Alert surface="light" className="mb-4">
          {error}
        </Alert>
      )}
      {answers === null ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : answers.length === 0 ? (
        <p className="text-sm text-black/60">No answers yet.</p>
      ) : (
        <div className="space-y-2">
          {answers.map((a) => (
            <div
              key={a.uid}
              className="flex items-start justify-between gap-3 rounded-xl border border-black/5 bg-white/50 px-3 py-2.5 text-sm"
            >
              <span className="shrink-0 font-semibold">{a.userName}</span>
              <span className="min-w-0 text-right break-words text-black/70">{label(a)}</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
