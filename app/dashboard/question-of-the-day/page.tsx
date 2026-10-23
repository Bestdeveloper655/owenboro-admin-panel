"use client";

import { useEffect, useMemo, useState } from "react";
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
 * `daily_questions/{YYYY-MM-DD}` for the phone's local date and, when there
 * is no doc for that day, shows a built-in question; answers are saved under
 * `daily_questions/{day}/answers/{uid}` either way, so a day can have answers
 * without a question doc. Only admins write the question docs (Firestore
 * rules); admins and moderators may delete any answer.
 *
 * Days here are Owensboro (Central) dates, which is what users' phones show.
 */

type DailyQuestion = {
  id: string;
  question: string;
  createdAt: Date | null;
  updatedAt: Date | null;
};

type Answer = {
  uid: string;
  userName: string;
  userPhoto: string;
  answer: string;
  /* The question text the user saw when answering. */
  question: string;
  createdAt: Date | null;
  updatedAt: Date | null;
};

/* null: the count failed; missing: still loading. */
type Counts = Record<string, number | null>;

const TZ = "America/Chicago";
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LENGTH = 200;
const SCHEDULE_DAYS = 14;
const PAST_DAYS = 30;
/* Most lines one bulk add takes (and how many unset days it looks ahead). */
const BULK_MAX = 60;
const ANSWERS_PAGE = 100;

const FALLBACK_HINT = "Not set — the app uses a built-in question";

/* Today's "YYYY-MM-DD" in Owensboro. */
function todayId(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/* Calendar arithmetic on day ids, independent of the browser's time zone. */
function addDays(id: string, n: number): string {
  const [y, m, d] = id.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
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

function readQuestion(id: string, d: DocumentData): DailyQuestion {
  const ts = (v: unknown) => (v && typeof v === "object" && "toDate" in v ? (v as Timestamp) : null);
  return {
    id,
    question: typeof d.question === "string" ? d.question : "",
    createdAt: ts(d.createdAt)?.toDate() ?? null,
    updatedAt: ts(d.updatedAt)?.toDate() ?? null,
  };
}

function readAnswer(id: string, d: DocumentData): Answer {
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  const ts = (v: unknown) => (v && typeof v === "object" && "toDate" in v ? (v as Timestamp) : null);
  return {
    uid: text(d.uid) || id,
    userName: text(d.userName),
    userPhoto: text(d.userPhoto),
    answer: text(d.answer),
    question: text(d.question),
    createdAt: ts(d.createdAt)?.toDate() ?? null,
    updatedAt: ts(d.updatedAt)?.toDate() ?? null,
  };
}

function describeError(err: unknown, fallback: string) {
  const { code, message } = (err ?? {}) as { code?: string; message?: string };
  if (code === "permission-denied") return "Only admins can change the question of the day.";
  return message || fallback;
}

/* Answer counts per day, one aggregation query each (a read per 1,000 answers). */
async function countAnswers(days: string[]): Promise<Counts> {
  const results = await Promise.all(
    days.map(async (day) => {
      try {
        const snap = await getCountFromServer(collection(db, "daily_questions", day, "answers"));
        return [day, snap.data().count] as const;
      } catch (err) {
        console.error(`Answer count for ${day} failed:`, err);
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

  // Roll the schedule over at Owensboro midnight if the page is left open.
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
    countAnswers([today, ...pastDays]).then((c) => {
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
    const n = counts[day];
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
        description="One question a day in the app. Set questions ahead of time; any day left empty shows one of the app's built-in questions, and people can answer either way."
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
          Days follow Owensboro (Central) time, the date on people&apos;s phones. Today is{" "}
          {dayLabel(today)}.
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
                onViewAnswers={i === 0 ? () => setViewing(day) : undefined}
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
            description="Each day's question and how many people answered. Open a day to read or remove answers."
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
                        <CountCell count={n} />
                      </td>
                      <td className={table.td}>
                        <div className={table.actions}>
                          <Button
                            size="sm"
                            variant="light"
                            icon={MessagesSquare}
                            onClick={() => setViewing(day)}
                            disabled={n === 0}
                          >
                            Answers
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
          answered={editing === today ? counts[today] : undefined}
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
        <AnswersModal
          day={viewing}
          question={questions.get(viewing)?.question ?? ""}
          onClose={() => setViewing(null)}
          onDeleted={() =>
            setCounts((prev) => {
              const n = prev[viewing];
              return typeof n === "number" ? { ...prev, [viewing]: Math.max(0, n - 1) } : prev;
            })
          }
        />
      )}
    </div>
  );
}

function CountCell({ count }: { count: number | null | undefined }) {
  if (count === undefined) return <Spinner className="ml-auto h-3.5 w-3.5" />;
  if (count === null) {
    return (
      <span className="text-black/40" title="Couldn't count the answers. Try Refresh counts.">
        —
      </span>
    );
  }
  return <>{count}</>;
}

function DayRow({
  day,
  tag,
  question,
  count,
  clearing,
  onEdit,
  onClear,
  onViewAnswers,
}: {
  day: string;
  tag?: string;
  question: DailyQuestion | undefined;
  /* Only shown for today. */
  count?: number | null;
  clearing: boolean;
  onEdit: () => void;
  onClear: () => void;
  onViewAnswers?: () => void;
}) {
  const [weekday, ...rest] = dayLabel(day).split(", ");
  return (
    <div
      className={cx(
        "flex flex-col gap-3 rounded-2xl border bg-[#0d0d0d] p-3 sm:flex-row sm:items-center",
        tag === "Today" ? "border-[#ff7a59]/60" : "border-white/10",
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
        {onViewAnswers && (
          <Button size="sm" variant="secondary" icon={MessagesSquare} onClick={onViewAnswers}>
            Answers
            {typeof count === "number" && (
              <span className="rounded-full bg-white/10 px-1.5 text-[11px] font-semibold tabular-nums">
                {count}
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

function AnswersModal({
  day,
  question,
  onClose,
  onDeleted,
}: {
  day: string;
  /* The day's question doc text; "" when the app showed a built-in one. */
  question: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [answers, setAnswers] = useState<Answer[] | null>(null);
  const [max, setMax] = useState(ANSWERS_PAGE);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(
    () =>
      onSnapshot(
        query(
          collection(db, "daily_questions", day, "answers"),
          orderBy("createdAt", "desc"),
          limit(max),
        ),
        (snap) => {
          setLoadFailed(false);
          setAnswers(snap.docs.map((d) => readAnswer(d.id, d.data())));
        },
        (err) => {
          console.error(`Answers for ${day} failed to load:`, err);
          setLoadFailed(true);
        },
      ),
    [day, max, attempt],
  );

  // The app's built-in question isn't stored, but every answer records the
  // text it was given for.
  const shownQuestion = question || answers?.[0]?.question || "";

  const remove = async (a: Answer) => {
    const preview = a.answer.length > 80 ? `${a.answer.slice(0, 80)}…` : a.answer;
    if (!window.confirm(`Delete this answer from ${a.userName || "this user"}?\n\n"${preview}"`)) {
      return;
    }
    setDeleting(a.uid);
    setError("");
    try {
      await deleteDoc(doc(db, "daily_questions", day, "answers", a.uid));
      onDeleted();
    } catch (err) {
      const { code } = (err ?? {}) as { code?: string };
      setError(
        code === "permission-denied"
          ? "Only admins and moderators can delete answers."
          : describeError(err, "Couldn't delete this answer."),
      );
    } finally {
      setDeleting(null);
    }
  };

  return (
    <Modal
      title={`Answers · ${dayLabel(day)}`}
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
          Couldn&apos;t load the answers.
          <Button
            size="sm"
            variant="light"
            icon={RefreshCw}
            onClick={() => {
              setLoadFailed(false);
              setAnswers(null);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </Button>
        </div>
      ) : answers === null ? (
        <p className="flex items-center justify-center gap-2 py-8 text-sm text-black/55">
          <Spinner className="h-4 w-4" />
          Loading answers…
        </p>
      ) : answers.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-black/15 bg-black/5 px-4 py-8 text-center text-sm text-black/50">
          <History className="h-5 w-5" aria-hidden />
          No answers for this day.
        </div>
      ) : (
        <>
          <ul className="space-y-2">
            {answers.map((a) => (
              <li
                key={a.uid}
                className="flex items-start gap-3 rounded-xl border border-black/5 bg-[#f5ecd7] px-3 py-2.5 text-sm"
              >
                {a.userPhoto ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.userPhoto}
                    alt=""
                    className="h-9 w-9 shrink-0 rounded-full border border-black/10 object-cover"
                  />
                ) : (
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/10 text-xs font-semibold text-black/50">
                    {(a.userName || "?").charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold">{a.userName || "Unknown"}</span>
                    <span className="text-xs text-black/45">
                      {formatDate(a.createdAt)}
                      {a.updatedAt &&
                      a.createdAt &&
                      a.updatedAt.getTime() - a.createdAt.getTime() > 1000
                        ? " · edited"
                        : ""}
                    </span>
                  </p>
                  <p className="mt-0.5 break-words whitespace-pre-line text-black/80">{a.answer}</p>
                  {a.question && a.question !== shownQuestion && (
                    <p className="mt-1 text-xs break-words text-black/45">
                      Answered: “{a.question}”
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="danger"
                  icon={Trash2}
                  loading={deleting === a.uid}
                  disabled={deleting !== null && deleting !== a.uid}
                  onClick={() => remove(a)}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
          {answers.length === max && (
            <div className="mt-4 flex justify-center">
              <Button size="sm" variant="light" onClick={() => setMax((n) => n + ANSWERS_PAGE)}>
                Show more
              </Button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
