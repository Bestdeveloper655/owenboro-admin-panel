"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  Eye,
  IdCard,
  Info,
  RefreshCw,
  Store,
  UserCheck,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  collection,
  doc,
  average,
  documentId,
  getAggregateFromServer,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  Timestamp,
  where,
  type DocumentData,
  type Query,
} from "firebase/firestore";
import { db } from "@/lib/firebaseServices";
import { listingImages } from "@/lib/products";
import { Alert, Button, cx } from "@/components/ui";

/*
 * Analytics (Oct 2026): what people do in the app, from the counts the app's
 * UsageTracker sends (theowensboroapp lib/core/analytics).
 *
 *  - `analytics_daily/{day}/shards/{0..19}`: counter docs the app increments
 *    every few minutes ({pages, listings, buttons, events} maps). A day's total
 *    for a key is the sum across its shards.
 *  - `analytics_daily/{day}/active/{id}`: one doc per active user/device.
 *  - `analytics_daily/{day}`: the nightly rollup's summary of a FINISHED day.
 *
 * To stay cheap, today is read from its shards (≤20 docs) plus three count
 * queries; past days come from their summaries (one doc each, cached for the
 * session), falling back to shards + counts only for a few recent days of the
 * selected range the rollup hasn't reached yet. The previous period (for the
 * deltas) and the 14-day trend use summaries only. Nothing is listened to in
 * realtime: Today re-reads itself every minute while visible.
 *
 * A day is the calendar date in America/Chicago, midnight to midnight.
 */

type RangeKey = "today" | "yesterday" | "7d" | "30d";

type Counters = Record<string, number>;

type DayStats = {
  day: string;
  pages: Counters;
  listings: Counters;
  buttons: Counters;
  events: Counters;
  /* null: the count failed or the summary doesn't have it. */
  activeUsers: number | null;
  activeSignedIn: number | null;
  newAccounts: number | null;
  profilesCreated: number;
};

type RangeResult = {
  /* The selected period: its days, and the ones with no data in it. */
  span: string[];
  days: DayStats[];
  /* Past days in the range without a summary that weren't read live (cap). */
  missing: string[];
  /* The equal period before it (summaries only), for the deltas. */
  previous: DayStats[];
  /* The days the chart shows: the range, or the last 14 days for one day. */
  trend: string[];
  trendStats: DayStats[];
  loadedAt: Date;
};

type ProductInfo = { name: string; image: string };

/* Days read for the session: summaries and live fallbacks, the days whose
 * summary was looked for and missing, and which entries were read live (those
 * are re-read on Refresh; summaries never change). */
type DayCache = {
  stats: Map<string, DayStats>;
  checked: Set<string>;
  live: Set<string>;
};

const TZ = "America/Chicago";
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/* Most unsummarized past days read from their shards in one load. */
const FALLBACK_MAX = 7;
/* Days in the chart for the Today and Yesterday views. */
const TREND_DAYS = 14;
/* Rows a list shows before "View all"; also the listings whose names are fetched. */
const TOP_ROWS = 8;
/* Firestore's limit for `in` queries. */
const IN_CHUNK = 30;
/* How often the Today view re-reads while open. */
const AUTO_REFRESH_MS = 60_000;

const ACCENT = "#38bdf8";
const SURFACE = "#0d0d0d";

const RANGE_OPTIONS: Array<{ value: RangeKey; label: ReactNode }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  {
    value: "7d",
    label: (
      <>
        <span className="hidden sm:inline">Last </span>7 days
      </>
    ),
  },
  {
    value: "30d",
    label: (
      <>
        <span className="hidden sm:inline">Last </span>30 days
      </>
    ),
  },
];

const VS_LABEL: Record<RangeKey, string> = {
  today: "vs yesterday",
  yesterday: "vs the day before",
  "7d": "vs previous 7 days",
  "30d": "vs previous 30 days",
};

const LAG_HINT =
  "Counts are collected in the app and sent every few minutes, so today's numbers can lag slightly.";
const DAYS_HINT = "Days run midnight to midnight, Central time (Owensboro).";

/* ------------------------------------------------------------------ DAYS */

/* Calendar arithmetic on day ids, independent of the browser's time zone. */
function addDays(id: string, n: number): string {
  const [y, m, d] = id.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/* Today in Owensboro, "YYYY-MM-DD", read from the Central wall clock. */
function centralToday(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/* Central wall-clock time minus UTC at `at`, in ms (-5 h in CDT, -6 h in CST). */
function centralOffsetMs(at: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // Some engines print midnight as "24" even with h23.
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return wall - Math.floor(at / 1000) * 1000;
}

/* The UTC instant of midnight Central at the start of `day`. Midnight is never
 * inside a DST jump (those happen at 2 AM), so a second pass with the offset
 * at the first guess settles it on change days too. */
function centralMidnight(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d);
  const guess = wall - centralOffsetMs(wall);
  return new Date(wall - centralOffsetMs(guess));
}

/* `count` days ending with `last`, oldest first. */
const daysEnding = (last: string, count: number) =>
  Array.from({ length: count }, (_, i) => addDays(last, i - count + 1));

/* The selected period. 7 and 30 days are full days ending yesterday. */
function rangeDays(range: RangeKey, today: string): string[] {
  if (range === "today") return [today];
  return daysEnding(addDays(today, -1), range === "yesterday" ? 1 : range === "7d" ? 7 : 30);
}

const dayDate = (id: string) => new Date(`${id}T12:00:00Z`);

/* "Oct 24" / "Fri, Oct 24". */
const dayLabel = (id: string, weekday = false) =>
  dayDate(id).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: weekday ? "short" : undefined,
    month: "short",
    day: "numeric",
  });

/* In the admin's own time zone. */
const localTime = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/* ----------------------------------------------------------------- LABELS */

/* Names for the keys the app sends; anything else falls back to humanize(). */
const KEY_LABELS: Record<string, string> = {
  tab_home: "Home tab",
  tab_explore: "Explore tab",
  tab_search: "Search tab",
  tab_events: "Events tab",
  tab_community: "Community tab",
  tab_friends: "Friends tab",
  tab_chat: "Chat tab",
  tab_profile: "Profile tab",
  listing_detail: "Listing details",
  listing_detail_page: "Listing details",
  listing_call: "Listing · Call",
  listing_directions: "Listing · Directions",
  listing_website: "Listing · Website",
  listing_email: "Listing · Email",
  listing_facebook: "Listing · Facebook",
  listing_share: "Listing · Share",
  listing_favorite: "Listing · Favorite",
  listing_review: "Listing · Review",
  home_page: "Home",
  search_page: "Search",
  all_categories_page: "All categories",
  more_categories_screen: "More categories",
  sub_catagory_screen: "Sub category",
  events_entertainment_screen: "Events & entertainment",
  profile_page: "Profile",
  user_profile_view: "Someone's profile",
  create_profile: "Create profile",
  sign_up_screen: "Sign up",
  user_side_sign_up_screen: "Sign up",
  login_screen: "Log in",
  user_side_login_screen: "Log in",
  onboarding_screen: "Onboarding",
  settings_page: "Settings",
  notifications: "Notifications",
  chat_hub: "Chats",
  direct_message: "Direct message",
  group_chat: "Group chat",
  friends_list: "Friends",
  friend_requests: "Friend requests",
  premium_paywall: "Premium paywall",
  contact_us: "Contact us",
  advertise_with_us: "Advertise with us",
  submit_listing: "Suggest a listing",
  costume_contest: "Costume contest",
  costume_contest_vote: "Costume contest · Vote",
  question_of_the_day: "Question of the day",
  account_created: "Account created",
  profile_created: "Profile created",
};

function humanize(key: string): string {
  const known = KEY_LABELS[key];
  if (known) return known;
  const words = (k: string) => {
    const s = k.replace(/_+/g, " ").replace(/catagor/gi, "categor").trim();
    return s ? s[0].toUpperCase() + s.slice(1) : key;
  };
  if (key.startsWith("tab_")) return `${words(key.slice(4))} tab`;
  return words(key.replace(/_(page|screen)$/, ""));
}

/* ------------------------------------------------------------------ DATA */

function readCounters(v: unknown): Counters {
  const out: Counters = {};
  if (!v || typeof v !== "object") return out;
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
    if (typeof n === "number" && Number.isFinite(n) && n > 0) out[k] = n;
  }
  return out;
}

function addInto(target: Counters, src: Counters) {
  for (const [k, n] of Object.entries(src)) target[k] = (target[k] ?? 0) + n;
}

const sum = (c: Counters) => Object.values(c).reduce((a, b) => a + b, 0);

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function readSummary(day: string, d: DocumentData): DayStats {
  const events = readCounters(d.events);
  return {
    day,
    pages: readCounters(d.pages),
    listings: readCounters(d.listings),
    buttons: readCounters(d.buttons),
    events,
    activeUsers: num(d.activeUsers),
    activeSignedIn: num(d.activeSignedIn),
    newAccounts: num(d.newAccounts),
    profilesCreated: num(d.profilesCreated) ?? events.profile_created ?? 0,
  };
}

/* One aggregation read per 1,000 matches; null when it fails, so one bad
 * count doesn't hide the rest of the page. */
async function count(q: Query, what: string): Promise<number | null> {
  try {
    return (await getCountFromServer(q)).data().count;
  } catch (err) {
    console.error(`Analytics: counting ${what} failed:`, err);
    return null;
  }
}

/* A day read from its shards (≤20 docs) plus three count queries. */
async function loadLiveDay(day: string): Promise<DayStats> {
  const dayRef = doc(db, "analytics_daily", day);
  const active = collection(dayRef, "active");
  const [shards, activeUsers, activeSignedIn, newAccounts] = await Promise.all([
    getDocs(collection(dayRef, "shards")),
    count(active, `active users on ${day}`),
    count(query(active, where("signedIn", "==", true)), `signed-in users on ${day}`),
    count(
      query(
        collection(db, "Users"),
        where("created_time", ">=", Timestamp.fromDate(centralMidnight(day))),
        where("created_time", "<", Timestamp.fromDate(centralMidnight(addDays(day, 1)))),
      ),
      `new accounts on ${day}`,
    ),
  ]);
  const stats: DayStats = {
    day,
    pages: {},
    listings: {},
    buttons: {},
    events: {},
    activeUsers,
    activeSignedIn,
    newAccounts,
    profilesCreated: 0,
  };
  for (const s of shards.docs) {
    const x = s.data();
    addInto(stats.pages, readCounters(x.pages));
    addInto(stats.listings, readCounters(x.listings));
    addInto(stats.buttons, readCounters(x.buttons));
    addInto(stats.events, readCounters(x.events));
  }
  stats.profilesCreated = stats.events.profile_created ?? 0;
  return stats;
}

/* Reads the summaries of the `days` not looked up yet: one query per run of
 * consecutive days, so days already cached in between aren't read again. */
async function ensureSummaries(days: string[], cache: DayCache) {
  const need = [...new Set(days)].filter((d) => !cache.stats.has(d) && !cache.checked.has(d)).sort();
  if (need.length === 0) return;
  const runs: string[][] = [];
  for (const d of need) {
    const run = runs[runs.length - 1];
    if (run && addDays(run[run.length - 1], 1) === d) run.push(d);
    else runs.push([d]);
  }
  const snaps = await Promise.all(
    runs.map((run) =>
      getDocs(
        query(
          collection(db, "analytics_daily"),
          where(documentId(), ">=", run[0]),
          where(documentId(), "<=", run[run.length - 1]),
        ),
      ),
    ),
  );
  for (const snap of snaps) {
    for (const d of snap.docs) {
      if (DAY_RE.test(d.id)) cache.stats.set(d.id, readSummary(d.id, d.data()));
    }
  }
  need.forEach((d) => cache.checked.add(d));
}

/* `mode`: "initial" reads what isn't cached; "live" re-reads only today
 * (the auto-refresh); "manual" (Refresh) also looks again for summaries that
 * were missing and re-reads the days that were read live. */
async function loadRange(
  range: RangeKey,
  today: string,
  cache: DayCache,
  mode: "initial" | "live" | "manual",
): Promise<RangeResult> {
  const span = rangeDays(range, today);
  const prevSpan = span.map((d) => addDays(d, -span.length));
  const trend = span.length === 1 ? daysEnding(span[0], TREND_DAYS) : span;
  const past = [...span, ...prevSpan, ...trend].filter((d) => d < today);

  if (mode === "manual") {
    for (const d of past) {
      cache.checked.delete(d);
      if (cache.live.has(d)) {
        cache.stats.delete(d);
        cache.live.delete(d);
      }
    }
  }

  const [todayStats] = await Promise.all([
    range === "today" ? loadLiveDay(today) : null,
    ensureSummaries(past, cache),
  ]);

  // Days of the selected range the rollup hasn't reached: the most recent few, read live.
  const unsummarized = span.filter((d) => d < today && !cache.stats.has(d)).reverse();
  const live = await Promise.all(unsummarized.slice(0, FALLBACK_MAX).map(loadLiveDay));
  for (const d of live) {
    cache.stats.set(d.day, d);
    cache.live.add(d.day);
  }

  const get = (d: string) => (d === today ? todayStats : cache.stats.get(d)) ?? [];
  return {
    span,
    days: span.flatMap(get),
    missing: span.filter((d) => d < today && !cache.stats.has(d)),
    previous: prevSpan.flatMap(get),
    trend,
    trendStats: trend.flatMap(get),
    loadedAt: new Date(),
  };
}

async function fetchProducts(ids: string[]): Promise<Record<string, ProductInfo | null>> {
  const out: Record<string, ProductInfo | null> = {};
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) chunks.push(ids.slice(i, i + IN_CHUNK));
  const snaps = await Promise.all(
    chunks.map((chunk) =>
      getDocs(query(collection(db, "Products"), where(documentId(), "in", chunk))),
    ),
  );
  for (const id of ids) out[id] = null;
  for (const snap of snaps) {
    for (const d of snap.docs) {
      const x = d.data();
      out[d.id] = {
        name: typeof x.productName === "string" && x.productName.trim() ? x.productName : "(untitled listing)",
        image: listingImages(x)[0] ?? "",
      };
    }
  }
  return out;
}

/* ---------------------------------------------------------------- STREAKS */

/* Daily messaging streaks, counted by the server on each user:
 * `Users/{uid}.streak` {current, longest, lastDay (Central day of their last
 * message), updatedAt}. A streak is alive while lastDay is today or
 * yesterday. Read "right now", independent of the selected range: 1 count +
 * 1 average aggregation + 25 user docs. */

type StreakUser = {
  uid: string;
  name: string;
  photo: string;
  current: number;
  longest: number;
};

type Streaks = {
  /* null: the query failed. */
  alive: number | null;
  average: number | null;
  top: StreakUser[] | null;
  loadedAt: Date;
};

const STREAK_CANDIDATES = 25;
const STREAK_TOP = 10;

async function loadStreaks(today: string): Promise<Streaks> {
  const yesterday = addDays(today, -1);
  const users = collection(db, "Users");
  // Single-field range: no composite index needed. Filtering current >= 2 as
  // well would need one, so this counts every alive streak.
  const alive = query(users, where("streak.lastDay", ">=", yesterday));
  const [aliveCount, avg, top] = await Promise.all([
    count(alive, "alive streaks"),
    getAggregateFromServer(alive, { avg: average("streak.current") })
      .then((snap) => snap.data().avg)
      .catch((err) => {
        console.error("Analytics: average streak failed:", err);
        return null;
      }),
    getDocs(query(users, orderBy("streak.current", "desc"), limit(STREAK_CANDIDATES)))
      .then((snap) =>
        snap.docs.flatMap((d): StreakUser[] => {
          const x = d.data();
          const st = (x.streak ?? {}) as { current?: unknown; longest?: unknown; lastDay?: unknown };
          const current = num(st.current) ?? 0;
          // Lapsed streaks still carry their old `current`; leave them out.
          if (typeof st.lastDay !== "string" || st.lastDay < yesterday || current <= 0) return [];
          const photos = Array.isArray(x.photo_urls)
            ? x.photo_urls.filter((u: unknown): u is string => typeof u === "string" && u !== "")
            : [];
          return [
            {
              uid: d.id,
              name: x.full_name || x.display_name || "No name",
              photo: (typeof x.photo_url === "string" && x.photo_url) || photos[0] || "",
              current,
              longest: Math.max(num(st.longest) ?? 0, current),
            },
          ];
        }).slice(0, STREAK_TOP),
      )
      .catch((err) => {
        console.error("Analytics: top streaks failed:", err);
        return null;
      }),
  ]);
  return { alive: aliveCount, average: avg ?? null, top, loadedAt: new Date() };
}

function describeError(err: unknown): string {
  const { code, message } = (err ?? {}) as { code?: string; message?: string };
  if (code === "permission-denied") {
    return "Only admins can see analytics. If you are one, the Firestore rules for analytics_daily may not be deployed yet.";
  }
  return message || "Check your connection, then try again.";
}

/* ---------------------------------------------------------------- FORMAT */

const fmt = (n: number) => n.toLocaleString("en-US");
const fmtAvg = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 1 : 0 });
const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
const pctLabel = (p: number) => (p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`);

function without<T>(map: Record<string, T>, key: string): Record<string, T> {
  const next = { ...map };
  delete next[key];
  return next;
}

/* --------------------------------------------------------------- METRICS */

type Metric = {
  label: string;
  icon: LucideIcon;
  pick: (d: DayStats) => number | null;
  /* "avg": a per-day measure (average over a range); "total": summed. */
  kind: "avg" | "total";
};

const METRICS: Metric[] = [
  { label: "Daily active users", icon: Users, pick: (d) => d.activeUsers, kind: "avg" },
  { label: "Signed-in users", icon: UserCheck, pick: (d) => d.activeSignedIn, kind: "avg" },
  { label: "New accounts", icon: UserPlus, pick: (d) => d.newAccounts, kind: "total" },
  { label: "Profiles created", icon: IdCard, pick: (d) => d.profilesCreated, kind: "total" },
  { label: "Page views", icon: Eye, pick: (d) => sum(d.pages), kind: "total" },
  { label: "Listing opens", icon: Store, pick: (d) => sum(d.listings), kind: "total" },
];

const known = (days: DayStats[], pick: Metric["pick"]) =>
  days.flatMap((d) => {
    const v = pick(d);
    return v === null ? [] : [{ day: d.day, v }];
  });

const mean = (xs: Array<{ v: number }>) => xs.reduce((a, x) => a + x.v, 0) / xs.length;

/* ------------------------------------------------------------------ PAGE */

type ListKey = "pages" | "listings" | "buttons";

export default function AnalyticsPage() {
  const [range, setRange] = useState<RangeKey>("today");
  const [today, setToday] = useState(centralToday);
  const [results, setResults] = useState<Record<string, RangeResult>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<Record<ListKey, boolean>>({
    pages: false,
    listings: false,
    buttons: false,
  });
  const [products, setProducts] = useState<Record<string, ProductInfo | null>>({});
  const [streaks, setStreaks] = useState<Streaks | null>(null);
  const dayCache = useRef<DayCache>({ stats: new Map(), checked: new Set(), live: new Set() });
  const loading = useRef(new Set<string>());
  const requested = useRef(new Set<string>());

  // Roll over to the next day at midnight Central if the page is left open.
  useEffect(() => {
    const timer = setInterval(() => setToday(centralToday()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const key = `${range}|${today}`;
  const result = results[key];
  const error = errors[key];

  const load = (mode: "initial" | "live" | "manual") => {
    loading.current.add(key);
    return loadRange(range, today, dayCache.current, mode)
      .then((r) => {
        setResults((prev) => ({ ...prev, [key]: r }));
        setErrors((prev) => without(prev, key));
      })
      .catch((err) => {
        console.error("Analytics failed to load:", err);
        setErrors((prev) => ({ ...prev, [key]: describeError(err) }));
      })
      .finally(() => loading.current.delete(key));
  };

  // Each range is read once and kept, so switching back is instant.
  useEffect(() => {
    if (result || error || loading.current.has(key)) return;
    load("initial");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, result, error]);

  // Streaks are "right now": read on page load and on Refresh, not on the
  // 1-minute auto-refresh.
  const fetchStreaks = () => loadStreaks(centralToday()).then(setStreaks);
  useEffect(() => {
    fetchStreaks();
  }, []);

  const refresh = () => {
    if (loading.current.has(key)) return;
    setRefreshing(true);
    Promise.all([load("manual"), fetchStreaks()]).finally(() => setRefreshing(false));
  };

  /* Clearing the error makes the effect above read the range again. */
  const retry = () => setErrors((prev) => without(prev, key));

  // Today refreshes itself every minute while the tab is visible (and as
  // soon as it's shown again), so the live numbers need no Refresh. Only
  // today's shards and counts are re-read; past days don't change.
  const latest = useRef({ load, key, loadedAt: result?.loadedAt });
  useEffect(() => {
    latest.current = { load, key, loadedAt: result?.loadedAt };
  });
  useEffect(() => {
    if (range !== "today") return;
    const tick = () => {
      const { load: reload, key: k, loadedAt } = latest.current;
      if (document.visibilityState !== "visible" || loading.current.has(k)) return;
      if (loadedAt && Date.now() - loadedAt.getTime() < AUTO_REFRESH_MS - 5_000) return;
      reload("live");
    };
    const timer = setInterval(tick, AUTO_REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [range]);

  const sorted = useMemo(() => {
    const t = { pages: {} as Counters, listings: {} as Counters, buttons: {} as Counters };
    for (const d of result?.days ?? []) {
      addInto(t.pages, d.pages);
      addInto(t.listings, d.listings);
      addInto(t.buttons, d.buttons);
    }
    const desc = (c: Counters) => Object.entries(c).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return { pages: desc(t.pages), listings: desc(t.listings), buttons: desc(t.buttons) };
  }, [result]);

  // Names and photos only for the listings on screen.
  const shownListingIds = useMemo(
    () => (expanded.listings ? sorted.listings : sorted.listings.slice(0, TOP_ROWS)).map(([id]) => id),
    [sorted, expanded.listings],
  );
  useEffect(() => {
    const ids = shownListingIds.filter((id) => !requested.current.has(id));
    if (ids.length === 0) return;
    ids.forEach((id) => requested.current.add(id));
    // A "/" can't be a document id, so there is no such listing.
    const invalid = Object.fromEntries(ids.filter((id) => id.includes("/")).map((id) => [id, null]));
    fetchProducts(ids.filter((id) => !id.includes("/")))
      .then((found) => setProducts((prev) => ({ ...prev, ...invalid, ...found })))
      .catch((err) => {
        console.error("Analytics: listing names failed to load:", err);
        // Let them be tried again next time they're shown.
        ids.forEach((id) => requested.current.delete(id));
      });
  }, [shownListingIds]);

  const toggle = (k: ListKey) => () => setExpanded((e) => ({ ...e, [k]: !e[k] }));
  const span = result?.span ?? rangeDays(range, today);
  const period =
    span.length === 1
      ? dayLabel(span[0], true)
      : `${dayLabel(span[0])} – ${dayLabel(span[span.length - 1])}`;

  return (
    <div className="text-white">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-white">Analytics</h1>
          <p className="mt-1 text-sm text-white/55">
            Daily users, the pages and listings people open, the buttons they tap, and new
            accounts and profiles.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RangeTabs value={range} onChange={setRange} />
          <button
            type="button"
            onClick={refresh}
            disabled={!result || refreshing}
            aria-label="Refresh"
            title="Refresh"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 text-white/60 transition hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-[#38bdf8]/50 focus-visible:outline-none disabled:opacity-40"
          >
            <RefreshCw className={cx("h-4 w-4", refreshing && "animate-spin")} aria-hidden />
          </button>
        </div>
      </div>

      {/* Status */}
      <div className="mt-3 mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/50">
        {range === "today" && (
          <>
            <span className="inline-flex items-center gap-1.5 font-medium text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
              Live
            </span>
            <Dot />
          </>
        )}
        <span>{period}</span>
        {result && (
          <>
            <Dot />
            <span>Updated {localTime(result.loadedAt)}</span>
          </>
        )}
        <InfoTip text={`${DAYS_HINT} ${LAG_HINT}`} />
        {result && result.missing.length > 0 && (
          <>
            <Dot />
            <span
              className="text-amber-300/80"
              title="These days have no nightly summary yet, or predate the app update. They appear once the summary has run."
            >
              {plural(result.missing.length, "older day")} not yet summarized
            </span>
          </>
        )}
      </div>

      {error && result && (
        <Alert className="mb-6" onDismiss={retry}>
          Couldn&apos;t refresh: {error}
        </Alert>
      )}

      {error && !result ? (
        <Panel title="Couldn't load analytics">
          <div className="flex flex-col items-start gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-white/60">{error}</p>
            <Button variant="secondary" icon={RefreshCw} onClick={retry}>
              Try again
            </Button>
          </div>
        </Panel>
      ) : !result ? (
        <PageSkeleton />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {METRICS.map((m) => (
              <KpiCard key={m.label} metric={m} result={result} range={range} />
            ))}
          </div>

          <StreaksRow streaks={streaks} />

          <TrendChart
            key={range}
            days={result.trend}
            stats={result.trendStats}
            today={today}
            subtitle={span.length === 1 ? `Last ${TREND_DAYS} days` : period}
          />

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <RankedList
              title="Top pages"
              unit="view"
              rows={sorted.pages.map(([k, n]) => ({ key: k, label: humanize(k), value: n }))}
              expanded={expanded.pages}
              onToggle={toggle("pages")}
            />
            <RankedList
              title="Button taps"
              unit="tap"
              rows={sorted.buttons.map(([k, n]) => ({ key: k, label: humanize(k), value: n }))}
              expanded={expanded.buttons}
              onToggle={toggle("buttons")}
            />
            <RankedList
              className="lg:col-span-2"
              title="Top listings"
              unit="open"
              columns
              rows={sorted.listings.map(([id, n]) => {
                const p = products[id];
                return {
                  key: id,
                  label:
                    p === undefined ? (
                      <span className="inline-block h-3 w-32 animate-pulse rounded bg-white/8 align-middle" />
                    ) : p === null ? (
                      <span className="text-white/40 italic">(deleted listing)</span>
                    ) : (
                      p.name
                    ),
                  title: p ? p.name : id,
                  thumb: p === undefined ? undefined : (p?.image ?? ""),
                  value: n,
                };
              })}
              thumbs
              expanded={expanded.listings}
              onToggle={toggle("listings")}
            />
          </div>
        </>
      )}

      <p className="mt-8 text-xs text-white/35">
        {LAG_HINT} {DAYS_HINT}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------- CONTROLS */

function RangeTabs({ value, onChange }: { value: RangeKey; onChange: (v: RangeKey) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Period"
      className="inline-flex rounded-lg border border-white/10 bg-white/3 p-0.5 text-[13px]"
    >
      {RANGE_OPTIONS.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cx(
              "rounded-md px-2.5 py-1.5 font-medium whitespace-nowrap transition focus-visible:ring-2 focus-visible:ring-[#38bdf8]/50 focus-visible:outline-none sm:px-3",
              active ? "bg-white/10 text-white" : "text-white/55 hover:text-white",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const Dot = () => (
  <span className="text-white/25" aria-hidden>
    ·
  </span>
);

function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={text}
        className="rounded p-0.5 text-white/35 transition hover:text-white/70 focus-visible:text-white/70 focus-visible:outline-none"
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute top-full left-1/2 z-20 mt-2 w-64 -translate-x-1/2 rounded-lg border border-white/10 bg-[#161616] px-3 py-2 text-xs leading-relaxed text-white/75 opacity-0 shadow-xl transition group-focus-within:opacity-100 group-hover:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

/* ---------------------------------------------------------------- PANELS */

function Panel({
  title,
  meta,
  footer,
  className,
  children,
}: {
  title: ReactNode;
  meta?: ReactNode;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cx("min-w-0 rounded-2xl border border-white/8 bg-[#0d0d0d]", className)}>
      <header className="flex items-center justify-between gap-3 border-b border-white/6 px-5 py-3.5">
        <h2 className="text-sm font-medium text-white">{title}</h2>
        {meta && <div className="text-xs text-white/45 tabular-nums">{meta}</div>}
      </header>
      <div className="px-5 py-3">{children}</div>
      {footer && <footer className="border-t border-white/6 px-5 py-2.5">{footer}</footer>}
    </section>
  );
}

function PanelEmpty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="py-10 text-center">
      <p className="text-sm text-white/70">{title}</p>
      {hint && <p className="mt-1 text-xs text-white/40">{hint}</p>}
    </div>
  );
}

/* ---------------------------------------------------------- STREAKS UI */

function StreaksRow({ streaks }: { streaks: Streaks | null }) {
  const stat = (label: string, value: string, hint: string) => (
    <div className="min-w-0 rounded-2xl border border-white/8 bg-[#0d0d0d] p-4">
      <p className="truncate text-xs font-medium text-white/55">{label}</p>
      {streaks ? (
        <p className="mt-2 text-2xl font-semibold tracking-tight text-white tabular-nums">{value}</p>
      ) : (
        <Bone className="mt-3 h-7 w-16" />
      )}
      <p className="mt-1.5 text-xs text-white/40">{hint}</p>
    </div>
  );

  return (
    <div className="mb-4">
      <p className="mb-2 flex items-center gap-2 text-[11px] font-medium tracking-wider text-white/40 uppercase">
        Streaks
        <Dot />
        <span className="normal-case tracking-normal">Right now</span>
      </p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {stat(
          "Alive streaks",
          streaks?.alive == null ? "—" : fmt(streaks.alive),
          "People who sent a message today or yesterday",
        )}
        {stat(
          "Average streak",
          streaks?.average == null ? "—" : `${fmtAvg(streaks.average)} ${streaks.average === 1 ? "day" : "days"}`,
          "Across alive streaks",
        )}
        <Panel
          className="md:col-span-2"
          title="Top streaks"
          meta={streaks?.top?.length ? `Top ${streaks.top.length}` : undefined}
        >
          {!streaks ? (
            <div className="grid gap-x-8 sm:grid-cols-2">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="flex items-center gap-3 py-1.5">
                  <Bone className="h-7 w-7 rounded-full" />
                  <Bone className="h-3 flex-1" />
                </div>
              ))}
            </div>
          ) : streaks.top === null ? (
            <PanelEmpty title="Couldn't load streaks" hint="Try Refresh in a moment." />
          ) : streaks.top.length === 0 ? (
            <PanelEmpty title="No streaks right now" hint="Streaks start when someone sends messages on consecutive days." />
          ) : (
            <ol className="sm:columns-2 sm:gap-x-8">
              {streaks.top.map((u, i) => (
                <li key={u.uid} className="flex break-inside-avoid items-center gap-3 py-1.5">
                  <span className="w-5 shrink-0 text-right text-xs text-white/35 tabular-nums">{i + 1}</span>
                  {u.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={u.photo}
                      alt=""
                      className="h-7 w-7 shrink-0 rounded-full border border-white/10 bg-white/5 object-cover"
                    />
                  ) : (
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[11px] font-medium text-white/60">
                      {u.name.trim()[0]?.toUpperCase() ?? "?"}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm text-white/90" title={u.name}>
                    {u.name}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm font-medium text-[#38bdf8] tabular-nums">
                      <span aria-hidden>🔥 </span>
                      {fmt(u.current)}
                      <span className="sr-only"> day streak</span>
                    </span>
                    <span className="block text-[11px] text-white/40 tabular-nums">longest {fmt(u.longest)}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </div>
  );
}

const Bone = ({ className }: { className?: string }) => (
  <div className={cx("animate-pulse rounded-md bg-white/6", className)} />
);

function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading analytics">
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {METRICS.map((m) => (
          <div key={m.label} className="rounded-2xl border border-white/8 bg-[#0d0d0d] p-4">
            <Bone className="h-3 w-24" />
            <Bone className="mt-3 h-7 w-16" />
            <Bone className="mt-3 h-3 w-28" />
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-white/8 bg-[#0d0d0d] p-5">
        <Bone className="h-4 w-32" />
        <Bone className="mt-5 h-56 w-full" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-2xl border border-white/8 bg-[#0d0d0d] p-5">
            <Bone className="h-4 w-28" />
            {Array.from({ length: 5 }, (_, j) => (
              <div key={j} className="mt-4">
                <Bone className="h-3 w-full" />
                <Bone className="mt-2 h-1 w-2/3" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ KPIS */

function KpiCard({ metric, result, range }: { metric: Metric; result: RangeResult; range: RangeKey }) {
  const { label, icon: Icon, pick, kind } = metric;
  const multiDay = result.span.length > 1;
  const cur = known(result.days, pick);
  const prev = known(result.previous, pick);

  let value = "—";
  let sub: string | undefined;
  if (cur.length > 0) {
    if (kind === "avg" && multiDay) {
      const peak = cur.reduce((a, k) => (k.v > a.v ? k : a));
      value = fmtAvg(mean(cur));
      sub = `Avg per day · peak ${fmt(peak.v)}`;
    } else {
      value = fmt(cur.reduce((a, k) => a + k.v, 0));
      const uncounted = result.days.length - cur.length + result.missing.length;
      if (multiDay && uncounted > 0) sub = `${plural(uncounted, "day")} without data`;
    }
  } else {
    sub = result.days.length > 0 ? "Couldn't count" : undefined;
  }

  // Per-day averages on both sides, so a period with fewer days of data
  // compares fairly.
  const prevMean = prev.length > 0 ? mean(prev) : 0;
  const delta = cur.length > 0 && prevMean > 0 ? ((mean(cur) - prevMean) / prevMean) * 100 : null;

  const byDay = new Map(result.days.map((d) => [d.day, d]));
  const spark = multiDay
    ? result.span.map((d) => {
        const s = byDay.get(d);
        return s ? pick(s) : null;
      })
    : null;

  return (
    <div className="min-w-0 rounded-2xl border border-white/8 bg-[#0d0d0d] p-4">
      <p className="flex items-center gap-1.5 truncate text-xs font-medium text-white/55">
        <Icon className="h-3.5 w-3.5 shrink-0 text-white/35" aria-hidden />
        {label}
      </p>
      <div className="mt-2 flex items-end justify-between gap-2">
        <p className="text-2xl font-semibold tracking-tight text-white tabular-nums">{value}</p>
        {spark && <Sparkline values={spark} />}
      </div>
      <p
        className="mt-1.5 truncate text-xs"
        title={range === "today" ? "Today so far, compared with all of yesterday" : undefined}
      >
        {delta === null ? (
          <span className="text-white/35">—</span>
        ) : (
          <span
            className={cx(
              "font-medium tabular-nums",
              Math.round(delta) > 0 ? "text-emerald-400" : Math.round(delta) < 0 ? "text-red-400" : "text-white/55",
            )}
          >
            {Math.round(delta) > 0 ? "▲ " : Math.round(delta) < 0 ? "▼ " : ""}
            {Math.abs(Math.round(delta))}%
          </span>
        )}{" "}
        <span className="text-white/40">{VS_LABEL[range]}</span>
      </p>
      {sub && <p className="mt-0.5 truncate text-[11px] text-white/35">{sub}</p>}
    </div>
  );
}

/* ----------------------------------------------------------------- CHART */

/* A smooth path through the points (monotone cubic, so it never overshoots
 * between days); gaps (null) split it into segments. */
function smoothSegments(points: Array<[number, number] | null>): Array<Array<[number, number]>> {
  const segments: Array<Array<[number, number]>> = [];
  let run: Array<[number, number]> = [];
  for (const p of points) {
    if (p) run.push(p);
    else if (run.length) {
      segments.push(run);
      run = [];
    }
  }
  if (run.length) segments.push(run);
  return segments;
}

function monotonePath(pts: Array<[number, number]>): string {
  if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`;
  const n = pts.length;
  const dx = (i: number) => pts[i + 1][0] - pts[i][0];
  const slope = Array.from({ length: n - 1 }, (_, i) => (pts[i + 1][1] - pts[i][1]) / dx(i));
  const m = pts.map((_, i) => {
    if (i === 0) return slope[0];
    if (i === n - 1) return slope[n - 2];
    if (slope[i - 1] * slope[i] <= 0) return 0;
    return (2 * slope[i - 1] * slope[i]) / (slope[i - 1] + slope[i]);
  });
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx(i) / 3;
    d += ` C${pts[i][0] + h},${pts[i][1] + m[i] * h} ${pts[i + 1][0] - h},${pts[i + 1][1] - m[i + 1] * h} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  return d;
}

/* Gridline step of 1 / 2 / 2.5 / 5 × 10ⁿ for about four intervals. */
function niceScale(v: number): { max: number; ticks: number[] } {
  const raw = Math.max(v, 1) / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 2.5, 5, 10].map((s) => s * pow).find((s) => s >= raw) ?? 10 * pow);
  const max = Math.max(step, Math.ceil(v / step) * step);
  const ticks: number[] = [];
  for (let t = 0; t <= max + 1e-9; t += step) ticks.push(t);
  return { max, ticks };
}

function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

const CHART_H = 240;
const PAD = { l: 40, r: 12, t: 12, b: 28 };

/* Daily active users (area) and new accounts (dashed), on one axis: both are
 * counts of people. */
function TrendChart({
  days,
  stats,
  today,
  subtitle,
}: {
  days: string[];
  stats: DayStats[];
  today: string;
  subtitle: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const [hover, setHover] = useState<number | null>(null);

  const byDay = new Map(stats.map((s) => [s.day, s]));
  const dau = days.map((d) => byDay.get(d)?.activeUsers ?? null);
  const accounts = days.map((d) => byDay.get(d)?.newAccounts ?? null);
  const hasData = [...dau, ...accounts].some((v) => v !== null && v > 0);
  const { max, ticks } = niceScale(Math.max(0, ...dau.map((v) => v ?? 0), ...accounts.map((v) => v ?? 0)));

  const innerW = Math.max(0, width - PAD.l - PAD.r);
  const innerH = CHART_H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (days.length === 1 ? innerW / 2 : (i * innerW) / (days.length - 1));
  const y = (v: number) => PAD.t + innerH - (v / max) * innerH;
  const baseline = PAD.t + innerH;
  const toPoints = (vals: Array<number | null>) =>
    smoothSegments(vals.map((v, i) => (v === null ? null : [x(i), y(v)])));
  const dauSegs = toPoints(dau);
  const accSegs = toPoints(accounts);

  const labelEvery = Math.max(1, Math.ceil(days.length / (width < 520 ? 4 : 8)));

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    if (days.length === 0 || innerW <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - PAD.l;
    const i = days.length === 1 ? 0 : Math.round((px / innerW) * (days.length - 1));
    setHover(Math.min(days.length - 1, Math.max(0, i)));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = e.key === "ArrowLeft" ? -1 : 1;
    setHover((h) => Math.min(days.length - 1, Math.max(0, (h ?? days.length - 1) + (h === null ? 0 : step))));
  };

  const h = hover !== null ? { day: days[hover], s: byDay.get(days[hover]) } : null;

  return (
    <Panel
      title="Active users"
      meta={
        <span className="flex items-center gap-4">
          <span className="hidden text-white/40 sm:inline">{subtitle}</span>
          <LegendItem label="Active users" swatch={<span className="h-2 w-2 rounded-full" style={{ background: ACCENT }} />} />
          <LegendItem
            label="New accounts"
            swatch={<span className="w-3 border-t-2 border-dashed border-white/55" />}
          />
        </span>
      }
    >
      <div
        ref={box}
        className="relative outline-none focus-visible:ring-2 focus-visible:ring-[#38bdf8]/40 rounded-lg"
        style={{ height: CHART_H }}
        tabIndex={hasData ? 0 : -1}
        aria-label="Active users and new accounts per day. Use the arrow keys to read each day."
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
      >
        {!hasData ? (
          <div className="flex h-full items-center justify-center">
            <PanelEmpty
              title="No data yet"
              hint="The app starts reporting after the update is installed."
            />
          </div>
        ) : (
          width > 0 && (
            <svg
              width={width}
              height={CHART_H}
              className="block touch-none select-none"
              onPointerMove={pick}
              onPointerDown={pick}
              onPointerLeave={() => setHover(null)}
              aria-hidden
            >
              <defs>
                <linearGradient id="dau-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ACCENT} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                </linearGradient>
              </defs>

              {ticks.map((t) => (
                <g key={t}>
                  <line
                    x1={PAD.l}
                    x2={width - PAD.r}
                    y1={y(t)}
                    y2={y(t)}
                    stroke="white"
                    strokeOpacity={t === 0 ? 0.14 : 0.06}
                  />
                  <text
                    x={PAD.l - 8}
                    y={y(t)}
                    dy="0.32em"
                    textAnchor="end"
                    className="fill-white/40 text-[10px] tabular-nums"
                  >
                    {fmt(t)}
                  </text>
                </g>
              ))}

              {days.map((d, i) =>
                (days.length - 1 - i) % labelEvery === 0 ? (
                  <text
                    key={d}
                    x={x(i)}
                    y={CHART_H - 8}
                    textAnchor={days.length > 1 && i === 0 ? "start" : days.length > 1 && i === days.length - 1 ? "end" : "middle"}
                    className="fill-white/40 text-[10px]"
                  >
                    {d === today ? "Today" : dayLabel(d)}
                  </text>
                ) : null,
              )}

              {dauSegs.map((seg, i) => {
                const line = monotonePath(seg);
                return (
                  <g key={`dau${i}`}>
                    {seg.length > 1 && (
                      <path
                        d={`${line} L${seg[seg.length - 1][0]},${baseline} L${seg[0][0]},${baseline} Z`}
                        fill="url(#dau-fill)"
                      />
                    )}
                    {seg.length > 1 ? (
                      <path d={line} fill="none" stroke={ACCENT} strokeWidth={2} strokeLinejoin="round" />
                    ) : (
                      <circle cx={seg[0][0]} cy={seg[0][1]} r={3} fill={ACCENT} />
                    )}
                  </g>
                );
              })}
              {accSegs.map((seg, i) =>
                seg.length > 1 ? (
                  <path
                    key={`acc${i}`}
                    d={monotonePath(seg)}
                    fill="none"
                    stroke="white"
                    strokeOpacity={0.55}
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                  />
                ) : (
                  <circle key={`acc${i}`} cx={seg[0][0]} cy={seg[0][1]} r={2.5} fill="white" fillOpacity={0.55} />
                ),
              )}

              {hover !== null && (
                <g>
                  <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={baseline} stroke="white" strokeOpacity={0.2} />
                  {dau[hover] !== null && (
                    <circle cx={x(hover)} cy={y(dau[hover]!)} r={4.5} fill={ACCENT} stroke={SURFACE} strokeWidth={2} />
                  )}
                  {accounts[hover] !== null && (
                    <circle cx={x(hover)} cy={y(accounts[hover]!)} r={4} fill="#d4d4d4" stroke={SURFACE} strokeWidth={2} />
                  )}
                </g>
              )}
              {/* Fills the plot so the whole area tracks the pointer. */}
              <rect x={PAD.l} y={PAD.t} width={innerW} height={innerH} fill="transparent" />
            </svg>
          )
        )}

        {h && hover !== null && (
          <div
            className="pointer-events-none absolute top-2 z-10 w-48 rounded-lg border border-white/10 bg-[#161616]/95 px-3 py-2 text-xs shadow-xl"
            style={{
              left: x(hover),
              transform: x(hover) > width / 2 ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
            }}
          >
            <p className="mb-1.5 font-medium text-white">
              {dayLabel(h.day, true)}
              {h.day === today && <span className="font-normal text-white/45"> · so far</span>}
            </p>
            {h.s ? (
              <div className="space-y-1">
                <TipRow label="Active users" value={h.s.activeUsers} swatch={ACCENT} />
                <TipRow label="Signed in" value={h.s.activeSignedIn} />
                <TipRow label="New accounts" value={h.s.newAccounts} swatch="#d4d4d4" />
              </div>
            ) : (
              <p className="text-white/50">No summary for this day</p>
            )}
          </div>
        )}

        {/* The same numbers for screen readers. */}
        <table className="sr-only">
          <caption>Active users and new accounts per day</caption>
          <thead>
            <tr>
              <th>Day</th>
              <th>Active users</th>
              <th>New accounts</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d, i) => (
              <tr key={d}>
                <td>{dayLabel(d, true)}</td>
                <td>{dau[i] ?? "no data"}</td>
                <td>{accounts[i] ?? "no data"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function LegendItem({ label, swatch }: { label: string; swatch: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-white/60">
      <span className="flex items-center" aria-hidden>
        {swatch}
      </span>
      {label}
    </span>
  );
}

function TipRow({ label, value, swatch }: { label: string; value: number | null; swatch?: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="inline-flex items-center gap-1.5 text-white/60">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: swatch ?? "transparent" }} aria-hidden />
        {label}
      </span>
      <span className="font-medium text-white tabular-nums">{value === null ? "—" : fmt(value)}</span>
    </div>
  );
}

function Sparkline({ values }: { values: Array<number | null> }) {
  const W = 64;
  const H = 22;
  const present = values.filter((v): v is number => v !== null);
  if (present.length < 2) return null;
  const max = Math.max(...present, 1);
  const x = (i: number) => (values.length === 1 ? W / 2 : (i * (W - 2)) / (values.length - 1) + 1);
  const y = (v: number) => H - 2 - (v / max) * (H - 4);
  const segs = smoothSegments(values.map((v, i) => (v === null ? null : [x(i), y(v)])));
  const last = segs[segs.length - 1];
  const end = last[last.length - 1];
  return (
    <svg width={W} height={H} className="mb-1 shrink-0 overflow-visible" aria-hidden>
      {segs.map((seg, i) =>
        seg.length > 1 ? (
          <path key={i} d={monotonePath(seg)} fill="none" stroke={ACCENT} strokeWidth={1.5} strokeOpacity={0.9} />
        ) : null,
      )}
      <circle cx={end[0]} cy={end[1]} r={2} fill={ACCENT} />
    </svg>
  );
}

/* ----------------------------------------------------------------- LISTS */

type Row = {
  key: string;
  label: ReactNode;
  /* Hover text; defaults to the key. */
  title?: string;
  /* Thumbnail URL; "" = no photo, undefined = still loading. */
  thumb?: string;
  value: number;
};

/* Ranked list: the bar is relative to the top row (so the ranking reads at a
 * glance), the percentage is the row's share of the total. */
function RankedList({
  title,
  unit,
  rows,
  thumbs = false,
  columns = false,
  expanded,
  onToggle,
  className,
}: {
  title: string;
  unit: string;
  rows: Row[];
  thumbs?: boolean;
  /* Two columns on wide screens (full-width card). */
  columns?: boolean;
  expanded: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const total = rows.reduce((a, r) => a + r.value, 0);
  const top = rows[0]?.value ?? 0;
  const shown = expanded ? rows : rows.slice(0, TOP_ROWS);

  return (
    <Panel
      className={className}
      title={title}
      meta={rows.length > 0 ? plural(total, unit) : undefined}
      footer={
        rows.length > TOP_ROWS ? (
          <button
            type="button"
            onClick={onToggle}
            className="text-xs font-medium text-white/55 transition hover:text-white"
          >
            {expanded ? "Show less" : `View all ${fmt(rows.length)}`}
          </button>
        ) : undefined
      }
    >
      {rows.length === 0 ? (
        <PanelEmpty title={`No ${unit}s in this period`} hint="The app starts reporting after the update is installed." />
      ) : (
        <ol className={cx(columns && "lg:columns-2 lg:gap-x-10")}>
          {shown.map((r, i) => (
            <li key={r.key} className="flex break-inside-avoid items-center gap-3 py-1.5">
              <span className="w-5 shrink-0 self-start pt-0.5 text-right text-xs text-white/35 tabular-nums">
                {i + 1}
              </span>
              {thumbs &&
                (r.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={r.thumb}
                    alt=""
                    className="h-9 w-9 shrink-0 rounded-md border border-white/10 bg-white/5 object-cover"
                  />
                ) : (
                  <span
                    className={cx(
                      "h-9 w-9 shrink-0 rounded-md border border-white/10 bg-white/4",
                      r.thumb === undefined && "animate-pulse",
                    )}
                  />
                ))}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm text-white/90" title={r.title ?? r.key}>
                    {r.label}
                  </span>
                  <span className="shrink-0 text-sm font-medium text-white tabular-nums">{fmt(r.value)}</span>
                </div>
                <div className="mt-1 flex items-center gap-3">
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/6">
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${top ? (r.value / top) * 100 : 0}%`, background: ACCENT }}
                    />
                  </span>
                  <span className="w-9 shrink-0 text-right text-[11px] text-white/45 tabular-nums">
                    {pctLabel(total ? (r.value / total) * 100 : 0)}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
