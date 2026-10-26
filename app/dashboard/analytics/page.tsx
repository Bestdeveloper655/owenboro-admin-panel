"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ChartSpline,
  Eye,
  IdCard,
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
  documentId,
  getCountFromServer,
  getDocs,
  query,
  Timestamp,
  where,
  type DocumentData,
  type Query,
} from "firebase/firestore";
import { db } from "@/lib/firebaseServices";
import { listingImages } from "@/lib/products";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  LoadingState,
  PageHeader,
  SectionHeading,
  Segmented,
  cx,
  table,
} from "@/components/ui";

/*
 * Reports & Analytics (Oct 2026): what people do in the app, from the counts
 * the app's UsageTracker sends (theowensboroapp lib/core/analytics).
 *
 *  - `analytics_daily/{day}/shards/{0..19}`: counter docs the app increments
 *    every few minutes ({pages, listings, buttons, events} maps). A day's total
 *    for a key is the sum across its shards.
 *  - `analytics_daily/{day}/active/{id}`: one doc per active user/device.
 *  - `analytics_daily/{day}`: the nightly rollup's summary of a FINISHED day.
 *
 * To stay cheap, today is read from its shards (≤20 docs) plus three count
 * queries; past days come from their summaries (one doc each), falling back to
 * shards + counts only for a few recent days the rollup hasn't reached yet.
 * Nothing is listened to in realtime; "Refresh" reads again.
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
  days: DayStats[];
  /* Past days in the range without a summary that weren't read live (cap). */
  missing: string[];
  loadedAt: Date;
};

type ProductInfo = { name: string; image: string };

const TZ = "America/Chicago";
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const SHARDS = "shards";
/* Most unsummarized past days read from their shards in one load. */
const FALLBACK_MAX = 7;
/* Rows a table shows before "Show all"; also the listings whose names are fetched. */
const TOP_ROWS = 15;
/* Firestore's limit for `in` queries. */
const IN_CHUNK = 30;

const SERIES = {
  active: "#ee5a36",
  accounts: "#0b9ad8",
};

const RANGE_OPTIONS: Array<{ value: RangeKey; label: string }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

const LAG_HINT =
  "Counts are collected in the app and sent every few minutes, so today's numbers can lag slightly.";

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

function rangeDays(range: RangeKey, today: string): string[] {
  const count = range === "today" ? 1 : range === "yesterday" ? 1 : range === "7d" ? 7 : 30;
  const last = range === "today" ? today : addDays(today, -1);
  return Array.from({ length: count }, (_, i) => addDays(last, i - count + 1));
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

const timeLabel = (d: Date) =>
  d.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });

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
    getDocs(collection(dayRef, SHARDS)),
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

/* Past days kept for the session (summaries don't change; "Refresh" clears
 * the days of the range it reloads). */
async function loadRange(
  range: RangeKey,
  today: string,
  cache: Map<string, DayStats>,
  fresh: boolean,
): Promise<RangeResult> {
  if (range === "today") {
    return { days: [await loadLiveDay(today)], missing: [], loadedAt: new Date() };
  }

  const days = rangeDays(range, today);
  if (fresh) days.forEach((d) => cache.delete(d));
  const need = days.filter((d) => !cache.has(d));

  if (need.length > 0) {
    const snap = await getDocs(
      query(
        collection(db, "analytics_daily"),
        where(documentId(), ">=", need[0]),
        where(documentId(), "<=", need[need.length - 1]),
      ),
    );
    for (const d of snap.docs) {
      if (DAY_RE.test(d.id) && need.includes(d.id)) cache.set(d.id, readSummary(d.id, d.data()));
    }
    // Days the rollup hasn't reached: the most recent few, read live.
    const unsummarized = need.filter((d) => !cache.has(d)).reverse();
    const live = await Promise.all(unsummarized.slice(0, FALLBACK_MAX).map(loadLiveDay));
    for (const d of live) cache.set(d.day, d);
  }

  return {
    days: days.flatMap((d) => cache.get(d) ?? []),
    missing: days.filter((d) => !cache.has(d)),
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

function without<T>(map: Record<string, T>, key: string): Record<string, T> {
  const next = { ...map };
  delete next[key];
  return next;
}

/* ------------------------------------------------------------------ PAGE */

type TableKey = "pages" | "listings" | "buttons";

/* How often the Today view re-reads while open. */
const AUTO_REFRESH_MS = 60_000;

export default function AnalyticsPage() {
  const [range, setRange] = useState<RangeKey>("today");
  const [today, setToday] = useState(centralToday);
  const [results, setResults] = useState<Record<string, RangeResult>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<Record<TableKey, boolean>>({
    pages: false,
    listings: false,
    buttons: false,
  });
  const [products, setProducts] = useState<Record<string, ProductInfo | null>>({});
  const dayCache = useRef(new Map<string, DayStats>());
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

  const load = (fresh: boolean) => {
    loading.current.add(key);
    return loadRange(range, today, dayCache.current, fresh)
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
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, result, error]);

  const refresh = () => {
    if (loading.current.has(key)) return;
    setRefreshing(true);
    load(true).finally(() => setRefreshing(false));
  };

  /* Clearing the error makes the effect above read the range again. */
  const retry = () => setErrors((prev) => without(prev, key));

  // Today refreshes itself every minute while the tab is visible (and as
  // soon as it's shown again), so the live numbers need no Refresh. Past
  // days don't change, so they aren't re-read.
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
      reload(true);
    };
    const timer = setInterval(tick, AUTO_REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [range]);

  const totals = useMemo(() => {
    const t = { pages: {} as Counters, listings: {} as Counters, buttons: {} as Counters, events: {} as Counters };
    for (const d of result?.days ?? []) {
      addInto(t.pages, d.pages);
      addInto(t.listings, d.listings);
      addInto(t.buttons, d.buttons);
      addInto(t.events, d.events);
    }
    return t;
  }, [result]);

  const sorted = useMemo(() => {
    const desc = (c: Counters) => Object.entries(c).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return { pages: desc(totals.pages), listings: desc(totals.listings), buttons: desc(totals.buttons) };
  }, [totals]);

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

  const multiDay = range === "7d" || range === "30d";
  const days = result?.days ?? [];
  const hasUsage =
    days.some((d) => (d.activeUsers ?? 0) > 0) ||
    sum(totals.pages) + sum(totals.listings) + sum(totals.buttons) + sum(totals.events) > 0;
  const newAccountsTotal = days.reduce((a, d) => a + (d.newAccounts ?? 0), 0);
  const rangeSpan = rangeDays(range, today);

  return (
    <div>
      <PageHeader
        title="Reports & Analytics"
        description="What people do in the app: daily users, the pages and listings they open, the buttons they tap, and new accounts and profiles."
        actions={
          <Button
            variant="outline"
            icon={RefreshCw}
            loading={refreshing}
            disabled={!result}
            onClick={refresh}
          >
            Refresh
          </Button>
        }
      >
        <p className="mt-2 text-xs text-[#f4ead7]/50">
          {LAG_HINT} Days run midnight to midnight, Central time.
        </p>
      </PageHeader>

      <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3">
        <Segmented<RangeKey> value={range} onChange={setRange} options={RANGE_OPTIONS} />
        <p className="flex flex-wrap items-center gap-2 text-xs text-[#f4ead7]/55">
          {range === "today" ? (
            <>
              <Badge tone="green">Live</Badge>
              <span>{dayLabel(today, true)} · refreshes every minute</span>
            </>
          ) : rangeSpan.length === 1 ? (
            <span>{dayLabel(rangeSpan[0], true)}</span>
          ) : (
            <span>
              {dayLabel(rangeSpan[0], true)} – {dayLabel(rangeSpan[rangeSpan.length - 1], true)}
            </span>
          )}
          {result && <span>· Updated {timeLabel(result.loadedAt)}</span>}
        </p>
      </div>

      {error && result && (
        <Alert className="mb-6" onDismiss={retry}>
          Couldn&apos;t refresh: {error}
        </Alert>
      )}

      {error && !result ? (
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't load analytics"
          description={error}
          action={
            <Button variant="outline" icon={RefreshCw} onClick={retry}>
              Try again
            </Button>
          }
        />
      ) : !result ? (
        <LoadingState label="Loading analytics…" />
      ) : (
        <>
          {result.missing.length > 0 && (
            <Alert tone="info" className="mb-6">
              Some older days not yet summarized: {plural(result.missing.length, "day")} (
              {result.missing.length === 1
                ? dayLabel(result.missing[0])
                : `${dayLabel(result.missing[0])} – ${dayLabel(result.missing[result.missing.length - 1])}`}
              ) {result.missing.length === 1 ? "isn't" : "aren't"} included. They appear once the
              nightly summary has run, or if they predate the app update there is nothing to show.
            </Alert>
          )}

          {(hasUsage || newAccountsTotal > 0) && <KpiRow days={days} multiDay={multiDay} totals={totals} />}

          {!hasUsage ? (
            <EmptyState
              icon={ChartSpline}
              title="No data yet"
              description="The app starts reporting after the update is installed."
            />
          ) : (
            <>
              {multiDay && <DailyChart days={rangeSpan} stats={days} />}

              <div className="grid gap-6 xl:grid-cols-3">
                <TopTable
                  title="Top pages"
                  unit="view"
                  rows={sorted.pages.map(([k, n]) => ({ key: k, label: humanize(k), value: n }))}
                  share
                  expanded={expanded.pages}
                  onToggle={() => setExpanded((e) => ({ ...e, pages: !e.pages }))}
                />
                <TopTable
                  title="Top listings"
                  unit="open"
                  rows={sorted.listings.map(([id, n]) => {
                    const p = products[id];
                    return {
                      key: id,
                      label:
                        p === undefined ? (
                          <span className="text-black/40">Loading…</span>
                        ) : p === null ? (
                          <span className="text-black/45 italic">(deleted listing)</span>
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
                  onToggle={() => setExpanded((e) => ({ ...e, listings: !e.listings }))}
                />
                <TopTable
                  title="Button taps"
                  unit="tap"
                  rows={sorted.buttons.map(([k, n]) => ({ key: k, label: humanize(k), value: n }))}
                  expanded={expanded.buttons}
                  onToggle={() => setExpanded((e) => ({ ...e, buttons: !e.buttons }))}
                />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ KPIS */

function KpiRow({
  days,
  multiDay,
  totals,
}: {
  days: DayStats[];
  multiDay: boolean;
  totals: { pages: Counters; listings: Counters };
}) {
  /* A per-day measure: the day's value, or average and peak over a range. */
  const perDay = (pick: (d: DayStats) => number | null) => {
    const known = days.flatMap((d) => {
      const v = pick(d);
      return v === null ? [] : [{ day: d.day, v }];
    });
    if (known.length === 0) return { value: "—", sub: "Couldn't count" };
    if (!multiDay) return { value: fmt(known[0].v), sub: undefined };
    const avg = known.reduce((a, k) => a + k.v, 0) / known.length;
    const peak = known.reduce((a, k) => (k.v > a.v ? k : a));
    return { value: fmtAvg(avg), sub: `avg per day · peak ${fmt(peak.v)} on ${dayLabel(peak.day)}` };
  };

  const accounts = days.filter((d) => d.newAccounts !== null);
  const uncounted = days.length - accounts.length;
  const accountsTotal = accounts.reduce((a, d) => a + (d.newAccounts ?? 0), 0);

  const dau = perDay((d) => d.activeUsers);
  const signedIn = perDay((d) => d.activeSignedIn);

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      <Kpi icon={Users} label="Daily active users" value={dau.value} sub={dau.sub} />
      <Kpi icon={UserCheck} label="Signed-in users" value={signedIn.value} sub={signedIn.sub} />
      <Kpi
        icon={UserPlus}
        label="New accounts"
        value={accounts.length === 0 ? "—" : fmt(accountsTotal)}
        sub={
          accounts.length === 0
            ? "Couldn't count"
            : uncounted > 0
              ? `${plural(uncounted, "day")} not counted`
              : undefined
        }
      />
      <Kpi
        icon={IdCard}
        label="Profiles created"
        value={fmt(days.reduce((a, d) => a + d.profilesCreated, 0))}
      />
      <Kpi icon={Eye} label="Page views" value={fmt(sum(totals.pages))} />
      <Kpi icon={Store} label="Listing opens" value={fmt(sum(totals.listings))} />
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-4">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#ff6b4a]/15 text-[#ff6b4a]">
        <Icon className="h-4.5 w-4.5" aria-hidden />
      </span>
      <p className="mt-4 text-2xl font-bold tabular-nums text-[#f4ead7]">{value}</p>
      <p className="mt-0.5 text-sm text-[#f4ead7]/60">{label}</p>
      {sub && <p className="mt-1 text-xs text-[#f4ead7]/40">{sub}</p>}
    </div>
  );
}

/* ----------------------------------------------------------------- CHART */

/* The smallest 1 / 2 / 2.5 / 5 × 10ⁿ at or above `v`. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((s) => s * pow).find((s) => s >= v) ?? 10 * pow;
}

/* Daily active users and new accounts per day (one axis: both are people). */
function DailyChart({ days, stats }: { days: string[]; stats: DayStats[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const byDay = new Map(stats.map((s) => [s.day, s]));
  const max = niceMax(
    Math.max(0, ...stats.map((s) => Math.max(s.activeUsers ?? 0, s.newAccounts ?? 0))),
  );
  const step = days.length > 10 ? 5 : 1;
  const height = (v: number | null) => (v ? `max(2px, ${(v / max) * 100}%)` : "0");

  return (
    <section className="mb-6 rounded-2xl border border-white/10 bg-[#0d0d0d] p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[#f4ead7]">Daily users</h2>
          <p className="mt-1 text-sm text-[#f4ead7]/60">Hover a day for its numbers.</p>
        </div>
        <div className="flex items-center gap-4 text-xs text-[#f4ead7]/70">
          <Legend color={SERIES.active} label="Active users" />
          <Legend color={SERIES.accounts} label="New accounts" />
        </div>
      </div>

      <div className="flex gap-2">
        {/* Y axis */}
        <div className="relative h-48 w-8 shrink-0 text-right text-[10px] text-[#f4ead7]/40 tabular-nums">
          <span className="absolute top-0 right-0 -translate-y-1/2">{fmt(max)}</span>
          <span className="absolute top-1/2 right-0 -translate-y-1/2">{fmtAvg(max / 2)}</span>
          <span className="absolute bottom-0 right-0 translate-y-1/2">0</span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="relative h-48" onMouseLeave={() => setHover(null)}>
            {/* Grid */}
            <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-white/5" />
            <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-white/5" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-white/15" />

            <div className="absolute inset-0 flex">
              {days.map((day, i) => {
                const s = byDay.get(day);
                const active = hover === i;
                return (
                  <div
                    key={day}
                    tabIndex={0}
                    role="img"
                    aria-label={
                      s
                        ? `${dayLabel(day, true)}: ${s.activeUsers ?? "unknown"} active users, ${s.newAccounts ?? "unknown"} new accounts`
                        : `${dayLabel(day, true)}: no data`
                    }
                    onMouseEnter={() => setHover(i)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    className={cx(
                      "relative flex h-full min-w-0 flex-1 items-end justify-center gap-0.5 rounded-sm px-px outline-none",
                      active && "bg-white/4",
                    )}
                  >
                    {s ? (
                      <>
                        <span
                          className="w-full max-w-4 rounded-t-sm"
                          style={{ height: height(s.activeUsers), background: SERIES.active }}
                        />
                        <span
                          className="w-full max-w-4 rounded-t-sm"
                          style={{ height: height(s.newAccounts), background: SERIES.accounts }}
                        />
                      </>
                    ) : (
                      <span className="h-0.5 w-3/4 bg-white/15" />
                    )}
                    {active && (
                      <Tooltip day={day} stats={s} align={i < days.length / 2 ? "left" : "right"} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* X axis */}
          <div className="mt-2 flex h-4 text-[10px] text-[#f4ead7]/40">
            {days.map((day, i) => (
              <span key={day} className="relative min-w-0 flex-1 text-center whitespace-nowrap">
                {(days.length - 1 - i) % step === 0 && (
                  <span className="absolute left-1/2 -translate-x-1/2">
                    {step === 1 ? dayLabel(day, true).replace(",", "") : dayLabel(day)}
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} aria-hidden />
      {label}
    </span>
  );
}

function Tooltip({
  day,
  stats,
  align,
}: {
  day: string;
  stats: DayStats | undefined;
  align: "left" | "right";
}) {
  const row = (color: string | null, label: string, v: number | null) => (
    <div className="flex items-center justify-between gap-4">
      <span className="inline-flex items-center gap-1.5 text-[#f4ead7]/70">
        {color && <span className="h-2 w-2 rounded-sm" style={{ background: color }} aria-hidden />}
        {label}
      </span>
      <span className="font-semibold text-[#f4ead7] tabular-nums">{v === null ? "—" : fmt(v)}</span>
    </div>
  );
  return (
    <div
      className={cx(
        "pointer-events-none absolute top-0 z-10 w-48 rounded-xl border border-white/15 bg-[#161616] px-3 py-2 text-xs shadow-xl",
        align === "left" ? "left-0" : "right-0",
      )}
    >
      <p className="mb-1.5 font-semibold text-[#f4ead7]">{dayLabel(day, true)}</p>
      {stats ? (
        <div className="space-y-1">
          {row(SERIES.active, "Active users", stats.activeUsers)}
          {row(null, "Signed in", stats.activeSignedIn)}
          {row(SERIES.accounts, "New accounts", stats.newAccounts)}
        </div>
      ) : (
        <p className="text-[#f4ead7]/60">Not summarized yet</p>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- TABLES */

type Row = {
  key: string;
  label: ReactNode;
  /* Hover text; defaults to the key. */
  title?: string;
  /* Thumbnail URL; "" = no photo, undefined = still loading. */
  thumb?: string;
  value: number;
};

function TopTable({
  title,
  unit,
  rows,
  share = false,
  thumbs = false,
  expanded,
  onToggle,
}: {
  title: string;
  unit: string;
  rows: Row[];
  /* Show each row's share of the total as a bar. */
  share?: boolean;
  /* Show a thumbnail column (listings). */
  thumbs?: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const total = rows.reduce((a, r) => a + r.value, 0);
  const shown = expanded ? rows : rows.slice(0, TOP_ROWS);

  return (
    <section className="min-w-0">
      <SectionHeading
        title={title}
        description={rows.length ? `${plural(total, unit)} · ${plural(rows.length, "item")}` : undefined}
        className="mb-3"
      />
      {rows.length === 0 ? (
        <EmptyState title={`No ${unit}s in this period`} className="py-8" />
      ) : (
        <>
          <div className={table.wrap}>
            <table className={table.table}>
              <thead className={table.thead}>
                <tr>
                  <th className={cx(table.th, "w-8 text-right")}>#</th>
                  <th className={table.th}>Name</th>
                  <th className={cx(table.th, "text-right")}>{unit[0].toUpperCase() + unit.slice(1)}s</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => {
                  const pct = total ? (r.value / total) * 100 : 0;
                  return (
                    <tr key={r.key} className={table.row}>
                      <td className={cx(table.td, "text-right text-black/40 tabular-nums")}>{i + 1}</td>
                      <td className={cx(table.td, "max-w-0 w-full")}>
                        <div className="flex min-w-0 items-center gap-2.5">
                          {thumbs &&
                            (r.thumb ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={r.thumb} alt="" className={cx(table.thumb, "shrink-0")} />
                            ) : (
                              <span className={cx(table.thumbEmpty, "shrink-0")}>
                                {r.thumb === "" ? "No photo" : ""}
                              </span>
                            ))}
                          <div className="min-w-0 flex-1">
                            <p className="truncate" title={r.title ?? r.key}>
                              {r.label}
                            </p>
                            {share && (
                              <div className="mt-1 flex items-center gap-2">
                                <span className="h-1 flex-1 overflow-hidden rounded-full bg-black/10">
                                  <span
                                    className="block h-full rounded-full"
                                    style={{ width: `${pct}%`, background: SERIES.active }}
                                  />
                                </span>
                                <span className="w-9 text-right text-[11px] text-black/50 tabular-nums">
                                  {pct < 1 ? "<1" : Math.round(pct)}%
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className={cx(table.td, "text-right font-semibold tabular-nums")}>{fmt(r.value)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length > TOP_ROWS && (
            <div className="mt-2 flex justify-end">
              <Button variant="secondary" size="sm" onClick={onToggle}>
                {expanded ? `Show top ${TOP_ROWS}` : `Show all ${fmt(rows.length)}`}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
