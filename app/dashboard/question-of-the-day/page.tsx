"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  Eraser,
  History,
  ListPlus,
  MessageCircleQuestionMark,
  MessagesSquare,
  PencilLine,
  Plus,
  RefreshCw,
  Reply,
  Trash2,
} from "lucide-react";
import {
  collection,
  deleteDoc,
  doc,
  documentId,
  getCountFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type Timestamp,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebaseServices";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Field,
  LoadingState,
  Modal,
  PageHeader,
  SectionHeading,
  Spinner,
  TextArea,
  cx,
  table,
} from "@/components/ui";

/*
 * The app's "Question of the Day" (Oct 2026). The app reads
 * `daily_questions/{YYYY-MM-DD}` for the current question day and, when
 * there is no doc for that day, shows a built-in question. Each day has a
 * chat, `daily_questions/{day}/messages/{autoId}`, whether or not it has a
 * question doc: `isAnswer` marks a user's answer to the question, the rest
 * are ordinary chat messages (optionally replies). Only admins write the
 * question docs (Firestore rules); nobody updates a message, and its author or
 * a moderator/admin may delete it.
 *
 * A question day starts at 4:00 AM Central and runs until 4:00 AM the next
 * day, the same rule the app uses.
 */

type DailyQuestion = {
  id: string;
  question: string;
  createdAt: Date | null;
  updatedAt: Date | null;
};

type Message = {
  id: string;
  uid: string;
  userName: string;
  userPhoto: string;
  text: string;
  isAnswer: boolean;
  /* On answers: the question text the user saw. */
  question: string;
  replyToId: string;
  replyToName: string;
  replyToText: string;
  createdAt: Date | null;
};

type DayCount = { answers: number; messages: number };

/* null: the count failed; missing: still loading. */
type Counts = Record<string, DayCount | null>;

const TZ = "America/Chicago";
/* Central wall-clock hour at which a new question day starts. */
const ROLLOVER_HOUR = 4;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LENGTH = 200;
const SCHEDULE_DAYS = 14;
const PAST_DAYS = 30;
/* Most lines one bulk add takes (and how many unset days it looks ahead). */
const BULK_MAX = 60;
const MESSAGES_PAGE = 100;

const FALLBACK_HINT = "Not set — the app uses a built-in question";
const ROLLOVER_HINT =
  "Each question goes live at 4:00 AM Central and runs until 4:00 AM the next day.";

/* Calendar arithmetic on day ids, independent of the browser's time zone. */
function addDays(id: string, n: number): string {
  const [y, m, d] = id.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/* The current question day, "YYYY-MM-DD": the Central wall-clock date, or the
 * day before it until 4:00 AM. Read from the wall clock rather than by
 * shifting the instant 4 hours, which is wrong on DST change days. */
function todayId(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  // Some engines print midnight as "24" even with h23.
  const hour = Number(get("hour")) % 24;
  return hour < ROLLOVER_HOUR ? addDays(date, -1) : date;
}

/* "Fri, Oct 24" for a day id. */
const dayLabel = (id: string) =>
  new Date(`${id}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });

const formatDate = (d: Date | null) =>
  d
    ? d.toLocaleString("en-US", {
        timeZone: TZ,
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

/* One line of text, as the app shows it. */
const normalize = (s: string) => s.replace(/\s+/g, " ").trim();

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

function readQuestion(id: string, d: DocumentData): DailyQuestion {
  const ts = (v: unknown) => (v && typeof v === "object" && "toDate" in v ? (v as Timestamp) : null);
  return {
    id,
    question: typeof d.question === "string" ? d.question : "",
    createdAt: ts(d.createdAt)?.toDate() ?? null,
    updatedAt: ts(d.updatedAt)?.toDate() ?? null,
  };
}

function readMessage(id: string, d: DocumentData): Message {
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  const ts = (v: unknown) => (v && typeof v === "object" && "toDate" in v ? (v as Timestamp) : null);
  return {
    id,
    uid: text(d.uid),
    userName: text(d.userName),
    userPhoto: text(d.userPhoto),
    text: text(d.text),
    isAnswer: d.isAnswer === true,
    question: text(d.question),
    replyToId: text(d.replyToId),
    replyToName: text(d.replyToName),
    replyToText: text(d.replyToText),
    createdAt: ts(d.createdAt)?.toDate() ?? null,
  };
}

function describeError(err: unknown, fallback: string) {
  const { code, message } = (err ?? {}) as { code?: string; message?: string };
  if (code === "permission-denied") return "Only admins can change the question of the day.";
  return message || fallback;
}

/* Answers and all messages per day: two aggregation queries each (a read per
 * 1,000 messages counted), no documents downloaded. */
async function countMessages(days: string[]): Promise<Counts> {
  const results = await Promise.all(
    days.map(async (day) => {
      const messages = collection(db, "daily_questions", day, "messages");
      try {
        const [answers, all] = await Promise.all([
          getCountFromServer(query(messages, where("isAnswer", "==", true))),
          getCountFromServer(messages),
        ]);
        return [day, { answers: answers.data().count, messages: all.data().count }] as const;
      } catch (err) {
        console.error(`Message counts for ${day} failed:`, err);
        return [day, null] as const;
      }
    }),
  );
  return Object.fromEntries(results);
}

export default function QuestionOfTheDayPage() {
  const [today, setToday] = useState(todayId);
  const [questions, setQuestions] = useState<Map<string, DailyQuestion> | null>(null);
  const [counts, setCounts] = useState<Counts>({});
  const [countsAttempt, setCountsAttempt] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [clearing, setClearing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  /* Bumped by "Try again" to subscribe afresh after a failed load. */
  const [attempt, setAttempt] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);

  // Roll the page over to the next question day at 4:00 AM Central if it is
  // left open. Checking the wall clock each minute (rather than one long
  // timer) also holds across sleep and DST changes.
  useEffect(() => {
    const timer = setInterval(() => setToday(todayId()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const firstPast = addDays(today, -PAST_DAYS);

  // Everything from the oldest past day on, including questions scheduled
  // beyond the 14-day window (a few dozen docs at most).
  useEffect(
    () =>
      onSnapshot(
        query(collection(db, "daily_questions"), where(documentId(), ">=", firstPast)),
        (snap) => {
          setLoadFailed(false);
          setQuestions(
            new Map(
              snap.docs
                .filter((d) => DAY_RE.test(d.id))
                .map((d) => [d.id, readQuestion(d.id, d.data())]),
            ),
          );
        },
        (err) => {
          console.error("Daily questions failed to load:", err);
          setLoadFailed(true);
        },
      ),
    [firstPast, attempt],
  );

  const scheduleDays = useMemo(
    () => Array.from({ length: SCHEDULE_DAYS }, (_, i) => addDays(today, i)),
    [today],
  );
  const pastDays = useMemo(
    () => Array.from({ length: PAST_DAYS }, (_, i) => addDays(today, -1 - i)),
    [today],
  );

  // Counted once per load (and on "Refresh counts"), not on every snapshot.
  useEffect(() => {
    let live = true;
    countMessages([today, ...pastDays]).then((c) => {
      if (live) setCounts(c);
    });
    return () => {
      live = false;
    };
  }, [today, pastDays, countsAttempt]);

  const lastScheduled = scheduleDays[scheduleDays.length - 1];
  const later = useMemo(
    () => [...(questions?.values() ?? [])].filter((q) => q.id > lastScheduled),
    [questions, lastScheduled],
  );

  /* Unset days from tomorrow on, for the bulk add. Today is left alone so a
   * question never changes under people who are already answering. */
  const openDays = useMemo(() => {
    const days: string[] = [];
    for (let i = 1; days.length < BULK_MAX && i < BULK_MAX * 10; i++) {
      const day = addDays(today, i);
      if (!questions?.has(day)) days.push(day);
    }
    return days;
  }, [questions, today]);

  const clear = async (day: string) => {
    const n = counts[day]?.answers;
    const keeps = n ? ` The ${plural(n, "answer")} already given stay.` : "";
    if (
      !window.confirm(
        `Clear the question for ${dayLabel(day)}? The app will show its built-in question that day instead.${keeps}`,
      )
    ) {
      return;
    }
    setClearing(day);
    setError("");
    try {
      await deleteDoc(doc(db, "daily_questions", day));
      setNotice(`${dayLabel(day)} now uses the app's built-in question.`);
    } catch (err) {
      setError(describeError(err, "Couldn't clear this question."));
    } finally {
      setClearing(null);
    }
  };

  const retry = () => {
    setLoadFailed(false);
    setQuestions(null);
    setAttempt((n) => n + 1);
  };

  return (
    <div>
      <PageHeader
        title="Question of the Day"
        description="One question a day in the app, with a chat for that day. Set questions ahead of time; any day left empty shows one of the app's built-in questions, and people can answer and chat either way."
        actions={
          <Button
            variant="outline"
            icon={ListPlus}
            onClick={() => setBulkOpen(true)}
            disabled={questions === null}
          >
            Add several
          </Button>
        }
      >
        <p className="mt-2 text-xs text-[#f4ead7]/50">
          {ROLLOVER_HINT} The current question day is {dayLabel(today)}.
        </p>
      </PageHeader>

      {notice && (
        <Alert tone="success" className="mb-4" onDismiss={() => setNotice("")}>
          {notice}
        </Alert>
      )}
      {error && (
        <Alert className="mb-4" onDismiss={() => setError("")}>
          {error}
        </Alert>
      )}

      {loadFailed ? (
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't load the questions"
          description="Check your connection, then try again. If it keeps failing, the Firestore rules for daily_questions may not be deployed."
          action={
            <Button variant="outline" icon={RefreshCw} onClick={retry}>
              Try again
            </Button>
          }
        />
      ) : questions === null ? (
        <LoadingState label="Loading questions…" />
      ) : (
        <>
          <SectionHeading
            title="Next 14 days"
            description="What the app asks each day. Tap Set to add a question to an empty day."
          />
          <div className="grid gap-2">
            {scheduleDays.map((day, i) => (
              <DayRow
                key={day}
                day={day}
                tag={i === 0 ? "Today" : i === 1 ? "Tomorrow" : undefined}
                question={questions.get(day)}
                count={i === 0 ? counts[day] : undefined}
                clearing={clearing === day}
                onEdit={() => setEditing(day)}
                onClear={() => clear(day)}
                onViewChat={i === 0 ? () => setViewing(day) : undefined}
              />
            ))}
          </div>

          {later.length > 0 && (
            <>
              <SectionHeading
                className="mt-8"
                title="Scheduled later"
                description="Questions set beyond the next 14 days."
              />
              <div className="grid gap-2">
                {later.map((q) => (
                  <DayRow
                    key={q.id}
                    day={q.id}
                    question={q}
                    clearing={clearing === q.id}
                    onEdit={() => setEditing(q.id)}
                    onClear={() => clear(q.id)}
                  />
                ))}
              </div>
            </>
          )}

          <SectionHeading
            className="mt-8"
            title="Past 30 days"
            description="Each day's question, how many people answered and how many chat messages were sent. Open a day's chat to read or remove messages."
            actions={
              <Button
                variant="secondary"
                size="sm"
                icon={RefreshCw}
                onClick={() => setCountsAttempt((n) => n + 1)}
              >
                Refresh counts
              </Button>
            }
          />
          <div className={table.wrap}>
            <table className={cx(table.table, "min-w-[640px]")}>
              <thead className={table.thead}>
                <tr>
                  <th className={table.th}>Day</th>
                  <th className={table.th}>Question</th>
                  <th className={cx(table.th, "text-right")}>Answers</th>
                  <th className={cx(table.th, "text-right")}>Messages</th>
                  <th className={table.th}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pastDays.map((day) => {
                  const q = questions.get(day);
                  const n = counts[day];
                  return (
                    <tr key={day} className={table.row}>
                      <td className={cx(table.td, "whitespace-nowrap font-medium")}>
                        {dayLabel(day)}
                      </td>
                      <td className={cx(table.td, "max-w-md")}>
                        {q ? (
                          <span className="line-clamp-2 break-words">{q.question}</span>
                        ) : (
                          <span className="text-black/45 italic">Built-in question</span>
                        )}
                      </td>
                      <td className={cx(table.td, "text-right tabular-nums")}>
                        <CountCell count={n} field="answers" />
                      </td>
                      <td className={cx(table.td, "text-right tabular-nums")}>
                        <CountCell count={n} field="messages" />
                      </td>
                      <td className={table.td}>
                        <div className={table.actions}>
                          <Button
                            size="sm"
                            variant="light"
                            icon={MessagesSquare}
                            onClick={() => setViewing(day)}
                            disabled={n?.messages === 0}
                          >
                            Chat
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editing && questions && (
        <QuestionModal
          day={editing}
          isToday={editing === today}
          current={questions.get(editing)}
          answered={editing === today ? counts[today]?.answers : undefined}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            setNotice(message);
          }}
        />
      )}

      {bulkOpen && (
        <BulkModal
          days={openDays}
          onClose={() => setBulkOpen(false)}
          onSaved={(message) => {
            setBulkOpen(false);
            setNotice(message);
          }}
        />
      )}

      {viewing && questions && (
        <ChatModal
          day={viewing}
          question={questions.get(viewing)?.question ?? ""}
          onClose={() => setViewing(null)}
          onDeleted={(m) =>
            setCounts((prev) => {
              const n = prev[viewing];
              if (!n) return prev;
              return {
                ...prev,
                [viewing]: {
                  answers: Math.max(0, n.answers - (m.isAnswer ? 1 : 0)),
                  messages: Math.max(0, n.messages - 1),
                },
              };
            })
          }
        />
      )}
    </div>
  );
}

function CountCell({
  count,
  field,
}: {
  count: DayCount | null | undefined;
  field: keyof DayCount;
}) {
  if (count === undefined) return <Spinner className="ml-auto h-3.5 w-3.5" />;
  if (count === null) {
    return (
      <span className="text-black/40" title="Couldn't count the messages. Try Refresh counts.">
        —
      </span>
    );
  }
  return <>{count[field]}</>;
}

function DayRow({
  day,
  tag,
  question,
  count,
  clearing,
  onEdit,
  onClear,
  onViewChat,
}: {
  day: string;
  tag?: string;
  question: DailyQuestion | undefined;
  /* Only shown for today. */
  count?: DayCount | null;
  clearing: boolean;
  onEdit: () => void;
  onClear: () => void;
  onViewChat?: () => void;
}) {
  const [weekday, ...rest] = dayLabel(day).split(", ");
  return (
    <div
      className={cx(
        "flex flex-col gap-3 rounded-2xl border bg-[#0d0d0d] p-3 sm:flex-row sm:items-center",
        tag === "Today" ? "border-[#38bdf8]/60" : "border-white/10",
      )}
    >
      <div className="flex shrink-0 items-center gap-3 sm:w-36">
        <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-white/5 leading-tight">
          <span className="text-[10px] font-semibold tracking-wide text-[#f4ead7]/50 uppercase">
            {weekday}
          </span>
          <span className="text-sm font-bold text-[#f4ead7] tabular-nums">
            {day.slice(8).replace(/^0/, "")}
          </span>
        </div>
        <div className="min-w-0">
          <p className="text-xs text-[#f4ead7]/60">{rest.join(", ")}</p>
          {tag && (
            <Badge tone={tag === "Today" ? "orange" : "dark"} className="mt-1">
              {tag}
            </Badge>
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        {question ? (
          <p className="text-sm break-words text-[#f4ead7]">{question.question}</p>
        ) : (
          <p className="text-sm text-[#f4ead7]/45 italic">{FALLBACK_HINT}</p>
        )}
        {question?.updatedAt && (
          <p className="mt-0.5 text-xs text-[#f4ead7]/40">
            {question.createdAt &&
            question.updatedAt.getTime() - question.createdAt.getTime() > 1000
              ? `Edited ${formatDate(question.updatedAt)}`
              : `Set ${formatDate(question.updatedAt)}`}
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
        {onViewChat && (
          <Button
            size="sm"
            variant="secondary"
            icon={MessagesSquare}
            onClick={onViewChat}
          >
            Chat
            {count && (
              <span className="rounded-full bg-white/10 px-1.5 text-[11px] font-semibold tabular-nums">
                {plural(count.answers, "answer")} · {plural(count.messages, "message")}
              </span>
            )}
          </Button>
        )}
        {question ? (
          <>
            <Button size="sm" variant="secondary" icon={PencilLine} onClick={onEdit} disabled={clearing}>
              Edit
            </Button>
            <Button size="sm" variant="danger" icon={Eraser} loading={clearing} onClick={onClear}>
              Clear
            </Button>
          </>
        ) : (
          <Button size="sm" variant="outline" icon={Plus} onClick={onEdit}>
            Set
          </Button>
        )}
      </div>
    </div>
  );
}

function QuestionModal({
  day,
  isToday,
  current,
  answered,
  onClose,
  onSaved,
}: {
  day: string;
  isToday: boolean;
  current: DailyQuestion | undefined;
  /* Answers already given today, if known. */
  answered?: number | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [text, setText] = useState(current?.question ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const value = normalize(text);
  const unchanged = current !== undefined && value === current.question;

  const close = () => {
    if (!busy) onClose();
  };

  const save = async () => {
    if (!value || value.length > MAX_LENGTH) return;
    setBusy(true);
    setError("");
    try {
      const ref = doc(db, "daily_questions", day);
      if (current) {
        await updateDoc(ref, { question: value, updatedAt: serverTimestamp() });
      } else {
        await setDoc(ref, {
          question: value,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: auth.currentUser?.uid ?? "",
        });
      }
      onSaved(`${current ? "Updated" : "Set"} the question for ${dayLabel(day)}.`);
    } catch (err) {
      setError(describeError(err, "Couldn't save this question."));
      setBusy(false);
    }
  };

  return (
    <Modal
      size="md"
      title={current ? "Edit question" : "Set question"}
      description={`${dayLabel(day)}${isToday ? " (today)" : ""}`}
      onClose={close}
      footer={
        <>
          <Button variant="light" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            icon={MessageCircleQuestionMark}
            loading={busy}
            disabled={!value || value.length > MAX_LENGTH || unchanged}
            onClick={save}
          >
            Save question
          </Button>
        </>
      }
    >
      {error && <Alert surface="light" className="mb-4">{error}</Alert>}
      {isToday && typeof answered === "number" && answered > 0 && (
        <Alert tone="warning" surface="light" className="mb-4">
          {plural(answered, "person has", "people have")} already answered today. Their answers
          keep the question they saw; anyone answering from now on sees the new one.
        </Alert>
      )}
      <Field
        flush
        label="Question"
        hint={
          <span className="flex justify-between gap-3">
            <span>One line, shown to everyone in the app that day.</span>
            <span className={cx("tabular-nums", text.length >= MAX_LENGTH && "text-red-600")}>
              {text.length}/{MAX_LENGTH}
            </span>
          </span>
        }
      >
        <TextArea
          rows={3}
          autoFocus
          value={text}
          maxLength={MAX_LENGTH}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter saves; the question is a single line.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (value && !unchanged && !busy) save();
            }
          }}
          placeholder="e.g. What's your favorite spot for breakfast in Owensboro?"
        />
      </Field>
    </Modal>
  );
}

/* "1. Question", "- Question" and "• Question" lose the list marker. */
const stripMarker = (line: string) => line.replace(/^(\d+[.)]|[-*•])\s+/, "");

function BulkModal({
  days,
  onClose,
  onSaved,
}: {
  /* Unset days from tomorrow on, in order. */
  days: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const lines = text
    .split("\n")
    .map((l) => stripMarker(normalize(l)))
    .filter(Boolean);
  const tooLong = lines
    .map((l, i) => (l.length > MAX_LENGTH ? i + 1 : 0))
    .filter((n) => n > 0);
  const tooMany = lines.length > days.length;
  const problem = tooLong.length
    ? `${tooLong.length === 1 ? "Question" : "Questions"} ${tooLong.join(", ")} ${
        tooLong.length === 1 ? "is" : "are"
      } over ${MAX_LENGTH} characters.`
    : tooMany
      ? `One add takes up to ${days.length} questions; remove ${lines.length - days.length}.`
      : "";

  const close = () => {
    if (!busy) onClose();
  };

  const save = async () => {
    if (!lines.length || problem) return;
    setBusy(true);
    setError("");
    try {
      const batch = writeBatch(db);
      const uid = auth.currentUser?.uid ?? "";
      lines.forEach((question, i) => {
        batch.set(doc(db, "daily_questions", days[i]), {
          question,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: uid,
        });
      });
      await batch.commit();
      onSaved(
        `Scheduled ${plural(lines.length, "question")}, ${dayLabel(days[0])}${
          lines.length > 1 ? ` to ${dayLabel(days[lines.length - 1])}` : ""
        }.`,
      );
    } catch (err) {
      setError(describeError(err, "Couldn't save these questions."));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Add several questions"
      description="One question per line. They fill the next empty days in order, starting tomorrow; days that already have a question are skipped."
      onClose={close}
      footer={
        <>
          <Button variant="light" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            icon={CalendarDays}
            loading={busy}
            disabled={!lines.length || !!problem}
            onClick={save}
          >
            {lines.length ? `Schedule ${plural(lines.length, "question")}` : "Schedule"}
          </Button>
        </>
      }
    >
      {error && <Alert surface="light" className="mb-4">{error}</Alert>}
      <Field
        flush
        label="Questions"
        hint={`Up to ${MAX_LENGTH} characters each. List markers like "1." or "-" are removed.`}
      >
        <TextArea
          rows={8}
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"What's the best pizza in town?\nWhere did you go on your first date?\nWhat's your go-to Owensboro festival?"}
        />
      </Field>

      {problem && (
        <Alert surface="light" className="mt-4">
          {problem}
        </Alert>
      )}

      {lines.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold tracking-wide text-black/50 uppercase">Preview</p>
          <ol className="mt-2 divide-y divide-black/10 rounded-xl border border-black/10 bg-white/50">
            {lines.map((line, i) => (
              <li key={i} className="flex gap-3 px-3 py-2 text-sm">
                <span className="w-24 shrink-0 font-medium whitespace-nowrap">
                  {days[i] ? dayLabel(days[i]) : "—"}
                </span>
                <span
                  className={cx(
                    "min-w-0 flex-1 break-words",
                    line.length > MAX_LENGTH && "text-red-600",
                  )}
                >
                  {line}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Modal>
  );
}

function ChatModal({
  day,
  question,
  onClose,
  onDeleted,
}: {
  day: string;
  /* The day's question doc text; "" when the app showed a built-in one. */
  question: string;
  onClose: () => void;
  onDeleted: (m: Message) => void;
}) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [max, setMax] = useState(MESSAGES_PAGE);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);

  // Newest first, a page at a time; "Show older" raises the limit.
  useEffect(
    () =>
      onSnapshot(
        query(
          collection(db, "daily_questions", day, "messages"),
          orderBy("createdAt", "desc"),
          limit(max),
        ),
        (snap) => {
          setLoadFailed(false);
          setMessages(snap.docs.map((d) => readMessage(d.id, d.data())));
        },
        (err) => {
          console.error(`Chat for ${day} failed to load:`, err);
          setLoadFailed(true);
        },
      ),
    [day, max, attempt],
  );

  // The app's built-in question isn't stored, but every answer records the
  // text it was given for.
  const shownQuestion = question || messages?.find((m) => m.isAnswer)?.question || "";

  const remove = async (m: Message) => {
    const kind = m.isAnswer ? "answer" : "message";
    if (
      !window.confirm(`Delete this ${kind} from ${m.userName || "this user"}?\n\n"${clip(m.text, 80)}"`)
    ) {
      return;
    }
    setDeleting(m.id);
    setError("");
    try {
      await deleteDoc(doc(db, "daily_questions", day, "messages", m.id));
      onDeleted(m);
    } catch (err) {
      const { code } = (err ?? {}) as { code?: string };
      setError(
        code === "permission-denied"
          ? "Only admins and moderators can delete messages."
          : describeError(err, `Couldn't delete this ${kind}.`),
      );
    } finally {
      setDeleting(null);
    }
  };

  return (
    <Modal
      size="xl"
      title={`Chat · ${dayLabel(day)}`}
      description={
        question ||
        (shownQuestion
          ? `Built-in question: ${shownQuestion}`
          : "The app shows a built-in question on days without one.")
      }
      onClose={onClose}
      footer={
        <Button variant="light" onClick={onClose}>
          Close
        </Button>
      }
    >
      {error && <Alert surface="light" className="mb-4">{error}</Alert>}
      {loadFailed ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-black/15 bg-black/5 px-4 py-8 text-center text-sm text-black/60">
          <AlertTriangle className="h-5 w-5 text-red-500" aria-hidden />
          Couldn&apos;t load the chat.
          <Button
            size="sm"
            variant="light"
            icon={RefreshCw}
            onClick={() => {
              setLoadFailed(false);
              setMessages(null);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </Button>
        </div>
      ) : messages === null ? (
        <p className="flex items-center justify-center gap-2 py-8 text-sm text-black/55">
          <Spinner className="h-4 w-4" />
          Loading chat…
        </p>
      ) : messages.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-black/15 bg-black/5 px-4 py-8 text-center text-sm text-black/50">
          <History className="h-5 w-5" aria-hidden />
          No messages for this day.
        </div>
      ) : (
        <ChatTimeline
          messages={messages}
          shownQuestion={shownQuestion}
          hasOlder={messages.length === max}
          onOlder={() => setMax((n) => n + MESSAGES_PAGE)}
          deleting={deleting}
          onDelete={remove}
        />
      )}
    </Modal>
  );
}

/* Messages from one person this close together are drawn as one run. */
const RUN_GAP_MS = 5 * 60 * 1000;

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const chatDay = (d: Date) => {
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};

const clock = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/*
 * The day's chat as the app shows it: oldest at the top, scrolled to the
 * latest, one sender's messages grouped with their photo and name, day
 * separators, answers tagged. Delete appears on hover.
 */
function ChatTimeline({
  messages,
  shownQuestion,
  hasOlder,
  onOlder,
  deleting,
  onDelete,
}: {
  /* Newest first, as loaded. */
  messages: Message[];
  shownQuestion: string;
  hasOlder: boolean;
  onOlder: () => void;
  deleting: string | null;
  onDelete: (m: Message) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const lastNewest = useRef<string | null>(null);
  const ordered = useMemo(() => [...messages].reverse(), [messages]);

  // Start at the bottom, and follow new messages while the admin is there.
  // Loading older ones keeps the view where it was.
  const prevHeight = useRef(0);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const newest = messages[0]?.id ?? null;
    if (newest !== lastNewest.current && pinned.current) {
      el.scrollTop = el.scrollHeight;
    } else if (newest === lastNewest.current && prevHeight.current) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
    }
    lastNewest.current = newest;
    prevHeight.current = el.scrollHeight;
  }, [messages]);

  const at = (m: Message) => m.createdAt ?? new Date();
  const run = (a: Message | undefined, b: Message | undefined) =>
    !!a &&
    !!b &&
    a.uid === b.uid &&
    sameDay(at(a), at(b)) &&
    Math.abs(at(a).getTime() - at(b).getTime()) <= RUN_GAP_MS;

  return (
    <div
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      }}
      className="max-h-[60vh] overflow-y-auto rounded-2xl bg-white px-3 py-3 sm:px-4"
    >
      {hasOlder && (
        <div className="mb-3 flex justify-center">
          <Button size="sm" variant="light" onClick={onOlder}>
            Show older messages
          </Button>
        </div>
      )}
      {ordered.map((m, i) => {
        const older = ordered[i - 1];
        const newer = ordered[i + 1];
        const showDay = !older || !sameDay(at(older), at(m));
        const first = showDay || !run(older, m);
        const last = !run(m, newer);
        const name = m.userName || "Unknown";
        return (
          <div key={m.id}>
            {showDay && (
              <div className="my-3 flex justify-center">
                <span className="rounded-full bg-black/5 px-3 py-1 text-xs font-semibold text-black/55">
                  {chatDay(at(m))}
                </span>
              </div>
            )}
            <div className={cx("group flex items-end gap-2", first ? "mt-3" : "mt-0.5")}>
              <div className="w-8 shrink-0">
                {last &&
                  (m.userPhoto ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.userPhoto}
                      alt=""
                      className="h-8 w-8 rounded-full border border-black/10 object-cover"
                    />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                      {name.charAt(0).toUpperCase()}
                    </div>
                  ))}
              </div>
              <div className="flex min-w-0 max-w-[75%] flex-col items-start">
                {first && <span className="mb-0.5 ml-1 text-xs font-semibold text-black/50">{name}</span>}
                <div
                  className={cx(
                    "rounded-[20px] px-3.5 py-2 text-sm text-black/85",
                    last ? "rounded-bl-[6px]" : "",
                    !first ? "rounded-tl-[6px]" : "",
                    m.isAnswer ? "border border-emerald-200 bg-emerald-50" : "bg-[#f1f1f4]",
                  )}
                >
                  {m.isAnswer && (
                    <span className="mb-0.5 flex items-center gap-1 text-[11px] font-bold text-emerald-700">
                      <MessageCircleQuestionMark className="h-3 w-3" aria-hidden />
                      Answer
                    </span>
                  )}
                  {(m.replyToName || m.replyToText) && (
                    <div className="mb-1 flex gap-1.5 rounded-lg border-l-2 border-blue-400 bg-black/5 px-2 py-1 text-xs text-black/60">
                      <Reply className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                      <span className="min-w-0 break-words">
                        <span className="font-semibold">{m.replyToName || "a message"}</span>
                        {m.replyToText ? `: ${clip(m.replyToText, 140)}` : ""}
                      </span>
                    </div>
                  )}
                  <p className="break-words whitespace-pre-line">{m.text}</p>
                  {m.isAnswer && m.question && m.question !== shownQuestion && (
                    <p className="mt-1 text-xs break-words text-black/45">Answered: “{m.question}”</p>
                  )}
                </div>
                {last && (
                  <span className="mt-0.5 ml-1 text-[11px] text-black/40" title={formatDate(m.createdAt)}>
                    {m.createdAt ? clock(m.createdAt) : "Sending…"}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => onDelete(m)}
                disabled={deleting !== null}
                title={`Delete this ${m.isAnswer ? "answer" : "message"}`}
                aria-label={`Delete ${m.isAnswer ? "answer" : "message"} from ${name}`}
                className={cx(
                  "mb-1 shrink-0 rounded-full p-1.5 text-red-500 transition hover:bg-red-50 focus:opacity-100",
                  deleting === m.id ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                )}
              >
                {deleting === m.id ? <Spinner className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
