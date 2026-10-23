"use client";

import { useState } from "react";
import { Clock, Eraser } from "lucide-react";

import {
  ALL_DAY,
  DAY_KEYS,
  DAY_NAMES,
  DAY_SHORT_NAMES,
  dayLabel,
  hasHours,
  toMinutes,
  withDays,
  type OpeningHours,
} from "@/lib/openingHours";
import { Button, TextInput, cx } from "@/components/ui";

/* Weekly opening hours, edited the way Google's business panel does it: the
 * week is listed day by day, and "Set hours" applies one choice (Open with
 * times, Open 24 hours, or Closed) to whichever days are ticked. For cream
 * modals. */

type Mode = "open" | "allDay" | "closed";

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

const QUICK_PICKS: Array<{ label: string; days: number[] }> = [
  { label: "All days", days: ALL_DAYS },
  { label: "Weekdays", days: [0, 1, 2, 3, 4] },
  { label: "Weekends", days: [5, 6] },
];

const MODES: Array<{ value: Mode; label: string }> = [
  { value: "open", label: "Open" },
  { value: "allDay", label: "Open 24 hours" },
  { value: "closed", label: "Closed" },
];

/* Monday = 0 … Sunday = 6, like the stored keys. */
const todayIndex = () => (new Date().getDay() + 6) % 7;

/* The seven days with their hours, today in bold. Rows are buttons when
 * `onDayClick` is given. */
export function OpeningHoursWeek({
  hours,
  onDayClick,
  selected = [],
  className,
}: {
  hours: OpeningHours;
  onDayClick?: (day: number) => void;
  /* Days highlighted while "Set hours" is open. */
  selected?: number[];
  className?: string;
}) {
  const [today] = useState(todayIndex);

  return (
    <ul className={cx("divide-y divide-black/5", className)}>
      {ALL_DAYS.map((day) => {
        const label = dayLabel(hours, day);
        const isToday = day === today;
        const row = (
          <>
            <span className={cx("w-28 shrink-0", isToday ? "font-bold" : "text-black/70")}>
              {DAY_NAMES[day]}
            </span>
            <span
              className={cx(
                "min-w-0 flex-1",
                isToday && "font-bold",
                label === "Closed" && "text-black/45",
              )}
            >
              {label}
            </span>
          </>
        );
        const rowClass = cx(
          "flex w-full items-center gap-3 px-4 py-2 text-left text-sm",
          selected.includes(day) && "bg-[#ff7a59]/10",
        );
        return (
          <li key={day}>
            {onDayClick ? (
              <button
                type="button"
                onClick={() => onDayClick(day)}
                className={cx(rowClass, "transition hover:bg-black/5")}
                title={`Set ${DAY_NAMES[day]}'s hours`}
              >
                {row}
              </button>
            ) : (
              <div className={rowClass}>{row}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function OpeningHoursEditor({
  value,
  onChange,
}: {
  value: OpeningHours;
  onChange: (next: OpeningHours) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [days, setDays] = useState<number[]>([]);
  const [mode, setMode] = useState<Mode>("open");
  const [open, setOpen] = useState("09:00");
  const [close, setClose] = useState("17:00");
  const [error, setError] = useState("");

  /* Opens "Set hours" with these days ticked, prefilled from the first one. */
  const startEditing = (preselect: number[]) => {
    setDays(preselect);
    setError("");
    const current = preselect.length ? value[DAY_KEYS[preselect[0]]] : undefined;
    if (current && current.open === ALL_DAY.open && current.close === ALL_DAY.close) {
      setMode("allDay");
    } else if (current) {
      setMode("open");
      setOpen(current.open);
      // <input type="time"> can't show 24:00; midnight reads the same.
      setClose(current.close === "24:00" ? "00:00" : current.close);
    } else {
      setMode("open");
    }
    setEditing(true);
  };

  const toggleDay = (day: number) =>
    setDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b),
    );

  const apply = () => {
    if (days.length === 0) return;
    if (mode === "open") {
      const o = toMinutes(open);
      const c = toMinutes(close);
      if (o === null || c === null) {
        setError("Enter both an opening and a closing time.");
        return;
      }
      if (o === c) {
        setError("Opening and closing times can't be the same. For a full day choose Open 24 hours.");
        return;
      }
    }
    onChange(
      withDays(value, days, mode === "closed" ? null : mode === "allDay" ? ALL_DAY : { open, close }),
    );
    setEditing(false);
    setDays([]);
  };

  const overnight =
    mode === "open" &&
    (toMinutes(close) ?? 0) < (toMinutes(open) ?? 0);

  const chip = (active: boolean) =>
    cx(
      "inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm transition select-none",
      active
        ? "border-[#ff7a59] bg-[#ff7a59]/10 text-black"
        : "border-black/15 bg-white text-black/70 hover:border-black/30",
    );

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-black/10 bg-white/50">
      <OpeningHoursWeek
        hours={value}
        selected={editing ? days : []}
        onDayClick={(day) => startEditing([day])}
        className="py-1"
      />

      {editing ? (
        <div className="space-y-4 border-t border-black/10 bg-white/60 px-4 py-4">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">Days</p>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_PICKS.map((pick) => (
                  <Button
                    key={pick.label}
                    size="sm"
                    variant="light"
                    onClick={() => setDays(pick.days)}
                  >
                    {pick.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ALL_DAYS.map((day) => (
                <label key={day} className={chip(days.includes(day))}>
                  <input
                    type="checkbox"
                    className="accent-[#ff7a59]"
                    checked={days.includes(day)}
                    onChange={() => toggleDay(day)}
                  />
                  {DAY_SHORT_NAMES[day]}
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold">Hours</p>
            <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={mode === m.value}
                  onClick={() => {
                    setMode(m.value);
                    setError("");
                  }}
                  className={chip(mode === m.value)}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {mode === "open" && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <label className="text-xs font-semibold text-black/60">
                  Opens
                  <TextInput
                    type="time"
                    className="mt-1"
                    value={open}
                    onChange={(e) => {
                      setOpen(e.target.value);
                      setError("");
                    }}
                  />
                </label>
                <label className="text-xs font-semibold text-black/60">
                  Closes
                  <TextInput
                    type="time"
                    className="mt-1"
                    value={close}
                    onChange={(e) => {
                      setClose(e.target.value);
                      setError("");
                    }}
                  />
                </label>
              </div>
            )}
            {overnight && (
              <p className="mt-1 text-xs text-black/55">Closes after midnight, the next day.</p>
            )}
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="light" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={apply} disabled={days.length === 0}>
              {days.length === 0
                ? "Tick the days to change"
                : `Apply to ${days.length === 7 ? "all days" : days.map((d) => DAY_SHORT_NAMES[d]).join(", ")}`}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/10 px-4 py-3">
          <p className="text-xs text-black/55">
            {hasHours(value)
              ? "Click a day, or Set hours to change several at once."
              : "No hours set, so the app shows none for this listing."}
          </p>
          <div className="flex gap-2">
            {hasHours(value) && (
              <Button size="sm" variant="light" icon={Eraser} onClick={() => onChange({})}>
                Clear
              </Button>
            )}
            <Button size="sm" variant="outline" icon={Clock} onClick={() => startEditing([])}>
              Set hours
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
