/* A listing's weekly opening hours, Google style: one open–close range per
 * day, and days without one are closed (Oct 2026).
 *
 * Mirrors the app's model (theowensboroapp lib/data/models/opening_hours.dart)
 * exactly. Stored on `Products` and `listing_requests` as `openingHours`:
 * `{mon: {open: "09:00", close: "17:00"}, …}`, 24-hour "HH:MM" times, days
 * left out are closed. "00:00"–"24:00" is open 24 hours, and a close before
 * the open runs past midnight. Both sides also write `summary()` into the
 * listing's `time` text, which older app builds show. */

export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
export const DAY_SHORT_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export type DayHours = { open: string; close: string };
export type OpeningHours = Partial<Record<DayKey, DayHours>>;

export const ALL_DAY: DayHours = { open: "00:00", close: "24:00" };

/* "HH:MM" to minutes after midnight; null when malformed. "24:00" is allowed
 * as a close time. */
export function toMinutes(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
}

/* Reads a stored map; malformed days are dropped (they count as closed). */
export function parseOpeningHours(raw: unknown): OpeningHours {
  if (!raw || typeof raw !== "object") return {};
  const out: OpeningHours = {};
  for (const key of DAY_KEYS) {
    const day = (raw as Record<string, unknown>)[key];
    if (!day || typeof day !== "object") continue;
    const { open, close } = day as Record<string, unknown>;
    const o = toMinutes(open);
    const c = toMinutes(close);
    if (o !== null && c !== null && o !== c) {
      out[key] = { open: open as string, close: close as string };
    }
  }
  return out;
}

export function hasHours(hours: OpeningHours | null | undefined): boolean {
  return !!hours && DAY_KEYS.some((k) => hours[k]);
}

/* Sets (or, with null, closes) the given days, Monday = 0 … Sunday = 6. */
export function withDays(hours: OpeningHours, days: number[], value: DayHours | null): OpeningHours {
  const next: OpeningHours = { ...hours };
  for (const d of days) {
    if (value) next[DAY_KEYS[d]] = { ...value };
    else delete next[DAY_KEYS[d]];
  }
  return next;
}

/* "9 AM", "9:30 AM", "12 PM", "12 AM". */
export function formatMinutes(m: number): string {
  const minutes = m % (24 * 60);
  const h = Math.floor(minutes / 60);
  const min = minutes % 60;
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const suffix = h < 12 ? "AM" : "PM";
  return min === 0 ? `${hour12} ${suffix}` : `${hour12}:${String(min).padStart(2, "0")} ${suffix}`;
}

/* "9 AM–5 PM", "Open 24 hours" or "Closed" for one day, Monday = 0. */
export function dayLabel(hours: OpeningHours, day: number): string {
  const d = hours[DAY_KEYS[day]];
  const open = toMinutes(d?.open);
  const close = toMinutes(d?.close);
  if (open === null || close === null || open === close) return "Closed";
  if (open === 0 && close === 24 * 60) return "Open 24 hours";
  return `${formatMinutes(open)}–${formatMinutes(close)}`;
}

/* One line for the `time` field and cards, consecutive days with the same
 * hours grouped: "Mon–Fri 9 AM–5 PM · Sat 10 AM–2 PM · Sun Closed". Empty when
 * no hours are set. */
export function summary(hours: OpeningHours | null | undefined): string {
  if (!hours || !hasHours(hours)) return "";
  const parts: string[] = [];
  let start = 0;
  for (let d = 1; d <= 7; d++) {
    if (d < 7 && dayLabel(hours, d) === dayLabel(hours, start)) continue;
    const range =
      d - 1 === start ? DAY_SHORT_NAMES[start] : `${DAY_SHORT_NAMES[start]}–${DAY_SHORT_NAMES[d - 1]}`;
    parts.push(`${range} ${dayLabel(hours, start)}`);
    start = d;
  }
  return parts.join(" · ");
}
