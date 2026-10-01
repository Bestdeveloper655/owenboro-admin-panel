"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Ban,
  ChevronDown,
  ChevronUp,
  Clock,
  Flag,
  MessageSquare,
  MessagesSquare,
  Search,
  Trash2,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "@/lib/firebaseServices";
import { notifyModeration } from "@/lib/moderationNotify";
import {
  ACTIVE_BLOCK_STATUSES,
  APP_BLOCK_LABEL,
  setAppBlock,
  type AppBlockStatus,
} from "@/lib/userBlocks";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  LoadingState,
  Modal,
  PageHeader,
  Segmented,
  Spinner,
  TextArea,
  Toolbar,
  cx,
  filterControlClass,
  type BadgeTone,
} from "@/components/ui";

type ReportStatus = "pending" | "reviewed" | "dismissed" | "action_taken";
type ReportSource = "direct_message" | "group_chat" | "profile" | string;

type Report = {
  id: string;
  reporterId: string;
  reporterName: string;
  reporterMessage: string;
  reportedUserId: string;
  reportedUserName: string;
  source: ReportSource;
  conversationId?: string;
  groupId?: string;
  messageId?: string;
  messageText?: string;
  messageSentAt?: any;
  createdAt?: any;
  status: ReportStatus;
  reviewedAt?: any;
  reviewedBy?: string;
  moderatorNotes?: string;
};

type ReportedProfile = {
  displayName: string;
  photoUrl: string;
  photoUrls: string[];
  age: string;
  gender: string;
  bio: string;
  email: string;
  isBanned: boolean;
  /* App block state from user_blocks/{uid}; null when never blocked. */
  blockStatus: AppBlockStatus | null;
  timeoutUntil: Date | null;
  reportCount: number;
};

/* Temporary-block durations. Reuses the same messaging-restriction mechanism
 * (timeout_until) the Users page uses, which the mobile app already enforces —
 * a temp-blocked user can still view content but cannot send messages or post
 * until the block expires. Permanent removal is handled by "Ban User". */
const DAY_MS = 24 * 60 * 60 * 1000;
const TEMP_BLOCK_OPTIONS: { label: string; ms: number }[] = [
  { label: "1 day", ms: 1 * DAY_MS },
  { label: "3 days", ms: 3 * DAY_MS },
  { label: "1 week", ms: 7 * DAY_MS },
  { label: "2 weeks", ms: 14 * DAY_MS },
  { label: "1 month", ms: 30 * DAY_MS },
];

function isTempBlocked(until: Date | null): boolean {
  return until != null && until.getTime() > Date.now();
}

type Tab = "pending" | "reviewed" | "dismissed" | "action_taken";

const TABS: { value: Tab; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "reviewed", label: "Reviewed" },
  { value: "action_taken", label: "Action Taken" },
  { value: "dismissed", label: "Dismissed" },
];

function formatTs(ts: any): string {
  if (!ts) return "-";
  if (typeof ts.toDate === "function") return ts.toDate().toLocaleString();
  return "-";
}

function tsMillis(ts: any): number {
  if (ts && typeof ts.toDate === "function") return ts.toDate().getTime();
  return 0;
}

/**
 * Whether a report points at a concrete chat message we can delete.
 * Needs a messageId plus the parent reference for its source:
 *  - direct_message → conversationId (DirectMessages/{id}/messages/{id})
 *  - group_chat     → groupId        (Groups/{id}/messages/{id})
 * Older group reports were filed without a messageId, so they return false.
 */
function canDeleteMessage(r: Report): boolean {
  if (!r.messageId) return false;
  if (r.source === "direct_message") return !!r.conversationId;
  if (r.source === "group_chat") return !!r.groupId;
  return false;
}

// Map a Firestore report document into our Report shape.
function mapReport(id: string, x: any): Report {
  return {
    id,
    reporterId: x.reporter_uid ?? "",
    reporterName: x.reporter_name ?? "",
    reporterMessage: x.reporter_message ?? "",
    reportedUserId: x.reported_uid ?? "",
    reportedUserName: x.reported_name ?? "",
    source: x.source ?? "unknown",
    conversationId: x.conversation_id ?? "",
    groupId: x.group_id ?? "",
    messageId: x.message_id ?? "",
    messageText: x.message_text ?? "",
    messageSentAt: x.message_sent_at ?? null,
    createdAt: x.created_at ?? null,
    status: (x.status ?? "pending") as ReportStatus,
    reviewedAt: x.reviewed_at ?? null,
    reviewedBy: x.reviewed_by ?? "",
    moderatorNotes: x.moderator_notes ?? "",
  };
}

// Aggregated report history for a single reported user.
type ReportedUserSummary = {
  uid: string;
  name: string;
  count: number;
  statusCounts: Record<ReportStatus, number>;
  lastReportedAt: any;
  reports: Report[];
};

function sourceLabel(source: ReportSource): string {
  switch (source) {
    case "direct_message":
      return "Direct message";
    case "group_chat":
      return "Group chat";
    case "profile":
      return "Profile";
    default:
      return source || "Unknown";
  }
}

export default function Page() {
  const [tab, setTab] = useState<Tab>("pending");
  const [items, setItems] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Report | null>(null);
  const [profile, setProfile] = useState<ReportedProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [showTempBlock, setShowTempBlock] = useState(false);

  // User lookup: load every report once so we can count reports per user.
  const [allReports, setAllReports] = useState<Report[]>([]);
  const [allLoading, setAllLoading] = useState(true);
  const [userSearch, setUserSearch] = useState("");
  const [expandedUid, setExpandedUid] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const q = query(
      collection(db, "reports"),
      where("status", "==", tab),
      orderBy("created_at", "desc"),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const data: Report[] = snap.docs.map((d) => mapReport(d.id, d.data()));
        setItems(data);
        setLoading(false);
      },
      (err) => {
        console.error(err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [tab]);

  // Load every report once (live) so the lookup tool can count reports per user
  // across all statuses.
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "reports"),
      (snap) => {
        setAllReports(snap.docs.map((d) => mapReport(d.id, d.data())));
        setAllLoading(false);
      },
      (err) => {
        console.error(err);
        setAllLoading(false);
      },
    );
    return () => unsub();
  }, []);

  // Group all reports by the reported user.
  const reportedUsers = useMemo<ReportedUserSummary[]>(() => {
    const map = new Map<string, ReportedUserSummary>();
    for (const r of allReports) {
      const uid = r.reportedUserId || "unknown";
      let entry = map.get(uid);
      if (!entry) {
        entry = {
          uid,
          name: r.reportedUserName || "",
          count: 0,
          statusCounts: {
            pending: 0,
            reviewed: 0,
            dismissed: 0,
            action_taken: 0,
          },
          lastReportedAt: null,
          reports: [],
        };
        map.set(uid, entry);
      }
      entry.count += 1;
      if (entry.statusCounts[r.status] != null) entry.statusCounts[r.status] += 1;
      if (!entry.name && r.reportedUserName) entry.name = r.reportedUserName;
      if (tsMillis(r.createdAt) > tsMillis(entry.lastReportedAt)) {
        entry.lastReportedAt = r.createdAt;
      }
      entry.reports.push(r);
    }
    const list = Array.from(map.values());
    for (const u of list) {
      u.reports.sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
    }
    list.sort((a, b) => b.count - a.count);
    return list;
  }, [allReports]);

  // Filter the lookup results by the admin's search query.
  const userMatches = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return [];
    return reportedUsers.filter((u) =>
      [u.name, u.uid].filter(Boolean).some((f) => f.toLowerCase().includes(q)),
    );
  }, [reportedUsers, userSearch]);

  // Load the reported user's profile when a report is opened.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      // Reset the temp-block picker whenever a different report is opened.
      setShowTempBlock(false);
      if (!selected?.reportedUserId) {
        setProfile(null);
        return;
      }
      setProfileLoading(true);
      try {
        // Count how many times this user has been reported (all statuses).
        const countSnap = await getCountFromServer(
          query(
            collection(db, "reports"),
            where("reported_uid", "==", selected.reportedUserId),
          ),
        );
        const reportCount = countSnap.data().count;

        const [snap, blockSnap] = await Promise.all([
          getDoc(doc(db, "Users", selected.reportedUserId)),
          // Optional: before the user_blocks rules are deployed this read is
          // denied; the profile must still load.
          getDoc(doc(db, "user_blocks", selected.reportedUserId)).catch(() => null),
        ]);
        if (cancelled) return;
        const blockStatus = blockSnap?.exists()
          ? ((blockSnap.data().status as AppBlockStatus) ?? null)
          : null;
        const isBanned = blockStatus !== null && ACTIVE_BLOCK_STATUSES.includes(blockStatus);
        if (!snap.exists()) {
          setProfile({
            displayName: selected.reportedUserName || "Unknown",
            photoUrl: "",
            photoUrls: [],
            age: "",
            gender: "",
            bio: "",
            email: blockSnap?.exists() ? blockSnap.data().email || "" : "",
            isBanned,
            blockStatus,
            timeoutUntil: null,
            reportCount,
          });
          return;
        }
        const x = snap.data() as any;
        const photoUrls: string[] = Array.isArray(x.photo_urls)
          ? x.photo_urls.filter((u: any) => typeof u === "string" && u)
          : [];
        setProfile({
          displayName:
            x.display_name || x.full_name || selected.reportedUserName || "Unknown",
          photoUrl: x.photo_url || photoUrls[0] || "",
          photoUrls,
          age: x.age != null ? String(x.age) : "",
          gender: x.gender || "",
          bio: x.bio || "",
          email: x.email || "",
          isBanned,
          blockStatus,
          timeoutUntil:
            x.timeout_until && x.timeout_until.toDate
              ? x.timeout_until.toDate()
              : null,
          reportCount,
        });
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const setStatus = async (
    report: Report,
    nextStatus: ReportStatus,
    extras?: Record<string, any>,
  ) => {
    setBusy(true);
    try {
      const reviewer = auth.currentUser?.uid ?? "";
      await updateDoc(doc(db, "reports", report.id), {
        status: nextStatus,
        reviewed_at: serverTimestamp(),
        reviewed_by: reviewer,
        moderator_notes: note.trim() || report.moderatorNotes || "",
        ...(extras ?? {}),
      });
      // Notify the reported user when their case is marked reviewed.
      if (nextStatus === "reviewed") {
        await notifyModeration({
          uid: report.reportedUserId,
          event: "report_reviewed",
        });
      }
      setSelected(null);
      setNote("");
    } catch (e) {
      console.error(e);
      alert("Update failed. Check console.");
    } finally {
      setBusy(false);
    }
  };

  /* Full app block (docs/user-blocking-contract.md §1): the server route
   * disables their login; a Cloud Function hides everything they created. */
  const banUser = async (report: Report) => {
    if (!report.reportedUserId) return;
    if (
      !confirm(
        `Ban ${report.reportedUserName || "this user"} from the app?\n\nThey'll be signed out and can't log back in, and their profile, messages, posts and everything else they created will be hidden. You can undo this with Unban or from Blocked Users.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const reviewer = auth.currentUser?.uid ?? "";
      await setAppBlock(report.reportedUserId, true, {
        reason: note.trim() || `Report ${report.id}`,
        source: "report",
        reportId: report.id,
      });
      await updateDoc(doc(db, "reports", report.id), {
        status: "action_taken",
        reviewed_at: serverTimestamp(),
        reviewed_by: reviewer,
        moderator_notes: note.trim() || "User banned.",
      });
      setSelected(null);
      setNote("");
    } catch (e) {
      console.error(e);
      alert(`Ban failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const unbanUser = async (report: Report) => {
    if (!report.reportedUserId) return;
    if (
      !confirm(
        `Unban ${report.reportedUserName || "this user"}? Their login is re-enabled and everything that was hidden is restored.`,
      )
    )
      return;
    setBusy(true);
    try {
      await setAppBlock(report.reportedUserId, false);
      await notifyModeration({
        uid: report.reportedUserId,
        event: "unbanned",
      });
      setProfile((p) => (p ? { ...p, isBanned: true, blockStatus: "restoring" } : p));
    } catch (e) {
      console.error(e);
      alert(`Unban failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  /* TEMP BLOCK — restrict the reported user from messaging/posting for a fixed
     duration using the same timeout_until mechanism the Users page uses. The
     block auto-expires; it does not fully ban the account. */
  const tempBlockUser = async (
    report: Report,
    option: { label: string; ms: number },
  ) => {
    if (!report.reportedUserId) return;
    setBusy(true);
    try {
      const reviewer = auth.currentUser?.uid ?? "";
      const until = new Date(Date.now() + option.ms);
      const reason = note.trim()
        ? `Temporarily blocked by admin (${option.label}) — ${note.trim()}`
        : `Temporarily blocked by admin (${option.label})`;
      await Promise.all([
        updateDoc(doc(db, "Users", report.reportedUserId), {
          timeout_until: Timestamp.fromDate(until),
          timeout_reason: reason,
          timeout_set_at: serverTimestamp(),
        }),
        updateDoc(doc(db, "reports", report.id), {
          status: "action_taken",
          reviewed_at: serverTimestamp(),
          reviewed_by: reviewer,
          moderator_notes: note.trim() || `Temp block (${option.label}).`,
        }),
      ]);
      await notifyModeration({
        uid: report.reportedUserId,
        event: "messaging_restricted",
        label: option.label,
        reason: note.trim(),
      });
      setSelected(null);
      setNote("");
      setShowTempBlock(false);
    } catch (e) {
      console.error(e);
      alert("Temp block failed. Check console.");
    } finally {
      setBusy(false);
    }
  };

  /* REMOVE TEMP BLOCK — lift an active temporary block early. */
  const removeTempBlock = async (report: Report) => {
    if (!report.reportedUserId) return;
    if (!confirm(`Remove the temporary block on ${report.reportedUserName || "this user"}?`))
      return;
    setBusy(true);
    try {
      await updateDoc(doc(db, "Users", report.reportedUserId), {
        timeout_until: null,
        timeout_reason: "",
        timeout_set_at: serverTimestamp(),
      });
      await notifyModeration({
        uid: report.reportedUserId,
        event: "messaging_restriction_removed",
      });
      setProfile((p) => (p ? { ...p, timeoutUntil: null } : p));
    } catch (e) {
      console.error(e);
      alert("Failed to remove block. Check console.");
    } finally {
      setBusy(false);
    }
  };

  /* DELETE MESSAGE — hard-delete the reported message via a secure Cloud
     Function that re-checks the caller's admin/moderator role server-side. */
  const deleteMessage = async (report: Report) => {
    if (!canDeleteMessage(report)) {
      alert(
        "This report doesn't reference a deletable message (no message id was recorded).",
      );
      return;
    }
    if (
      !confirm(
        "Permanently delete this message from the chat? This cannot be undone.",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const call = httpsCallable(functions, "deleteMessage");
      await call({
        reportId: report.id,
        source: report.source,
        conversationId: report.conversationId ?? "",
        groupId: report.groupId ?? "",
        messageId: report.messageId ?? "",
        offenderUid: report.reportedUserId,
        offenderName: report.reportedUserName,
        messageText: report.messageText ?? "",
      });
      setSelected(null);
      setNote("");
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Delete failed. Check console.");
    } finally {
      setBusy(false);
    }
  };

  const counts = useMemo(() => items.length, [items]);

  return (
    <div>
      <PageHeader
        title="Report Board"
        description="Review user reports from chats and profiles. Take moderation action when needed."
      />

      {/* USER LOOKUP — search any user to see how many times they were reported */}
      <Card
        className="mb-6"
        title="Look up a user"
        description="Search any reported user by name or UID to see how many times they’ve been reported."
      >
        <div className="relative max-w-xl">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-white/40"
            aria-hidden
          />
          <input
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
            placeholder="Search by name or UID…"
            className={cx(filterControlClass, "w-full pr-10 pl-9")}
          />
          {userSearch && (
            <button
              type="button"
              onClick={() => setUserSearch("")}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-white/50 transition hover:text-white"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {userSearch.trim() && (
          <div className="mt-4 space-y-3">
            {allLoading ? (
              <p className="flex items-center gap-2 text-sm text-[#f4ead7]/60">
                <Spinner className="h-4 w-4" />
                Loading reports…
              </p>
            ) : userMatches.length === 0 ? (
              <p className="text-sm text-[#f4ead7]/60">
                No reported user matches “{userSearch.trim()}”.
              </p>
            ) : (
              userMatches.map((u) => {
                const open = expandedUid === u.uid;
                return (
                  <div
                    key={u.uid}
                    className="overflow-hidden rounded-2xl border border-black/5 bg-[#ece2cb] text-black"
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedUid(open ? null : u.uid)}
                      aria-expanded={open}
                      className="group flex w-full items-start justify-between gap-3 p-4 text-left"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{u.name || "Unknown user"}</p>
                        <p className="truncate text-xs text-black/55">UID: {u.uid}</p>
                        <p className="mt-1 text-xs text-black/55">
                          Last reported: {formatTs(u.lastReportedAt)}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <Badge tone={u.count > 1 ? "red" : "neutral"}>Reported {u.count}×</Badge>
                        <span className="inline-flex items-center gap-1 text-[11px] text-black/50 transition group-hover:text-black">
                          {open ? "Hide reports" : "Show reports"}
                          {open ? (
                            <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                          )}
                        </span>
                      </div>
                    </button>

                    <div className="flex flex-wrap gap-1.5 px-4 pb-3">
                      {TABS.map((t) =>
                        u.statusCounts[t.value] > 0 ? (
                          <Badge key={t.value} tone={STATUS_TONE[t.value]}>
                            {t.label}: {u.statusCounts[t.value]}
                          </Badge>
                        ) : null,
                      )}
                    </div>

                    {open && (
                      <div className="space-y-2 border-t border-black/10 p-3 sm:p-4">
                        {u.reports.map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => {
                              setSelected(r);
                              setNote(r.moderatorNotes ?? "");
                            }}
                            className="flex w-full items-center justify-between gap-3 rounded-xl bg-white/60 px-3 py-2.5 text-left transition hover:bg-white"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm">
                                <span className="font-semibold">{sourceLabel(r.source)}</span> · by{" "}
                                {r.reporterName || r.reporterId || "Unknown"}
                              </p>
                              {r.reporterMessage && (
                                <p className="truncate text-xs text-black/60">{r.reporterMessage}</p>
                              )}
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-1">
                              <StatusBadge status={r.status} />
                              <span className="text-[11px] text-black/50">{formatTs(r.createdAt)}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </Card>

      {/* STATUS TABS */}
      <Toolbar>
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={TABS.map((t) => ({
            value: t.value,
            label: t.label,
            count: t.value === tab && !loading ? counts : undefined,
          }))}
        />
      </Toolbar>

      {/* REPORTS */}
      {loading ? (
        <LoadingState label="Loading reports…" />
      ) : items.length === 0 ? (
        <EmptyState icon={Flag} title="No reports in this tab." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => {
                setSelected(r);
                setNote(r.moderatorNotes ?? "");
              }}
              className="flex min-w-0 flex-col rounded-2xl border border-black/5 bg-[#ece2cb] p-4 text-left text-black transition hover:border-[#ff7a59]/60 hover:bg-[#f5ecd7] focus-visible:ring-2 focus-visible:ring-[#ff7a59]/50 focus-visible:outline-none sm:p-5"
            >
              <div className="flex w-full flex-wrap items-center justify-between gap-2">
                <SourceBadge source={r.source} />
                <span className="text-xs text-black/55">{formatTs(r.createdAt)}</span>
              </div>

              <p className="mt-3 font-semibold wrap-break-word">
                <span className="font-normal text-black/55">Reported:</span>{" "}
                {r.reportedUserName || r.reportedUserId || "Unknown"}
              </p>
              <p className="text-sm wrap-break-word text-black/60">
                By: {r.reporterName || r.reporterId || "Unknown"}
              </p>

              {r.reporterMessage && (
                <div className="mt-3 w-full rounded-xl border-l-2 border-[#ff7a59] bg-white/55 px-3 py-2">
                  <p className="text-[11px] font-semibold tracking-wide text-black/50 uppercase">
                    Reason
                  </p>
                  <p className="line-clamp-3 text-sm wrap-break-word text-black/80">
                    {r.reporterMessage}
                  </p>
                </div>
              )}

              {r.messageText && (
                <p className="mt-3 line-clamp-3 w-full rounded-xl bg-black/5 px-3 py-2 text-sm wrap-break-word text-black/75 italic">
                  “{r.messageText}”
                </p>
              )}

              {r.moderatorNotes && (
                <p className="mt-3 text-xs wrap-break-word text-black/60">
                  <span className="font-semibold text-black/75">Note:</span> {r.moderatorNotes}
                </p>
              )}
            </button>
          ))}
        </div>
      )}

      {/* REPORT DETAIL */}
      {selected && (
        <Modal
          title={`Report: ${selected.reportedUserName || "Unknown user"}`}
          onClose={() => {
            setSelected(null);
            setNote("");
            setShowTempBlock(false);
          }}
          footer={
            <>
              {/* TEMP BLOCK DURATION PICKER — sits above the buttons so it
                  opens next to the Temp Block button that toggles it. */}
              {showTempBlock && !profile?.isBanned && (
                <div className="w-full rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900">
                  <p className="text-sm font-semibold">Temporarily block user</p>
                  <p className="mt-0.5 text-xs text-amber-900/80">
                    They can still view content but can’t send messages or post until the
                    block expires. Pick a duration:
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {TEMP_BLOCK_OPTIONS.map((opt) => (
                      <Button
                        key={opt.label}
                        size="sm"
                        variant="warning"
                        disabled={busy}
                        onClick={() => tempBlockUser(selected, opt)}
                      >
                        {opt.label}
                      </Button>
                    ))}
                    <Button
                      size="sm"
                      variant="light"
                      disabled={busy}
                      onClick={() => setShowTempBlock(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              <Button
                variant="light"
                disabled={busy}
                onClick={() => setStatus(selected, "dismissed")}
              >
                Dismiss
              </Button>
              <Button disabled={busy} onClick={() => setStatus(selected, "reviewed")}>
                Mark Reviewed
              </Button>
              {isTempBlocked(profile?.timeoutUntil ?? null) ? (
                <Button
                  variant="warning"
                  disabled={busy}
                  onClick={() => removeTempBlock(selected)}
                >
                  Remove Block
                </Button>
              ) : (
                !profile?.isBanned && (
                  <Button
                    variant="light"
                    icon={Clock}
                    disabled={busy}
                    onClick={() => setShowTempBlock((v) => !v)}
                  >
                    Temp Block
                  </Button>
                )
              )}
              {profile?.isBanned ? (
                <Button
                  variant="warning"
                  disabled={
                    busy ||
                    profile.blockStatus === "blocking" ||
                    profile.blockStatus === "restoring"
                  }
                  onClick={() => unbanUser(selected)}
                >
                  Unban User
                </Button>
              ) : (
                <Button
                  variant="danger-solid"
                  icon={Ban}
                  loading={busy}
                  onClick={() => banUser(selected)}
                >
                  {busy ? "Working…" : "Ban User"}
                </Button>
              )}
            </>
          }
        >
          <div className="space-y-4 text-sm">
            <DetailSection title="Reported user">
              {profileLoading ? (
                <p className="flex items-center gap-2 text-black/60">
                  <Spinner className="h-4 w-4" />
                  Loading profile…
                </p>
              ) : profile ? (
                <div className="space-y-4">
                  <div className="flex gap-4">
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full border border-black/10 bg-black/5 sm:h-20 sm:w-20">
                      {profile.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={profile.photoUrl}
                          alt={profile.displayName}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-[10px] text-black/40">
                          No photo
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-semibold wrap-break-word">{profile.displayName}</p>
                      <p className="text-xs text-black/60">
                        {[profile.age && `Age ${profile.age}`, profile.gender]
                          .filter(Boolean)
                          .join(" · ") || "Age/gender not set"}
                      </p>
                      {profile.email && (
                        <p className="text-xs break-all text-black/60">{profile.email}</p>
                      )}
                      <p className="text-xs break-all text-black/50">
                        UID: {selected.reportedUserId}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={profile.reportCount > 1 ? "red" : "neutral"}>
                      Reported {profile.reportCount}×
                    </Badge>
                    {profile.isBanned && profile.blockStatus && (
                      <Badge tone="red">
                        {profile.blockStatus === "blocked"
                          ? "Banned"
                          : APP_BLOCK_LABEL[profile.blockStatus]}
                      </Badge>
                    )}
                    {isTempBlocked(profile.timeoutUntil) && (
                      <Badge tone="amber">
                        Temp blocked until {profile.timeoutUntil!.toLocaleString()}
                      </Badge>
                    )}
                  </div>

                  {profile.photoUrls.length > 1 && (
                    <div className="flex flex-wrap gap-2">
                      {profile.photoUrls.map((url, i) => (
                        <a
                          key={i}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="h-16 w-16 overflow-hidden rounded-lg border border-black/10 bg-black/5 transition hover:opacity-80"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt={`Photo ${i + 1}`}
                            className="h-full w-full object-cover"
                          />
                        </a>
                      ))}
                    </div>
                  )}

                  {profile.bio && (
                    <div>
                      <p className="text-[11px] font-semibold tracking-wide text-black/50 uppercase">
                        Bio
                      </p>
                      <p className="mt-0.5 wrap-break-word whitespace-pre-wrap text-black/80">
                        {profile.bio}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-black/60">No profile data.</p>
              )}
            </DetailSection>

            <DetailSection title="Report details">
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
                <DetailRow label="Reporter">
                  {selected.reporterName || "Unknown"} (
                  <span className="break-all">{selected.reporterId}</span>)
                </DetailRow>
                <DetailRow label="Source">{sourceLabel(selected.source)}</DetailRow>
                {selected.conversationId && (
                  <DetailRow label="Conversation" breakAll>
                    {selected.conversationId}
                  </DetailRow>
                )}
                {selected.groupId && (
                  <DetailRow label="Group" breakAll>
                    {selected.groupId}
                  </DetailRow>
                )}
                <DetailRow label="Reported at">{formatTs(selected.createdAt)}</DetailRow>
                {selected.status !== "pending" && (
                  <>
                    <DetailRow label="Status">
                      <StatusBadge status={selected.status} />
                    </DetailRow>
                    <DetailRow label="Reviewed at">{formatTs(selected.reviewedAt)}</DetailRow>
                    {selected.reviewedBy && (
                      <DetailRow label="Reviewed by" breakAll>
                        {selected.reviewedBy}
                      </DetailRow>
                    )}
                  </>
                )}
              </dl>
            </DetailSection>

            <DetailSection title="Reason from reporter">
              {selected.reporterMessage ? (
                <p className="rounded-xl border-l-2 border-[#ff7a59] bg-[#ff7a59]/10 px-3 py-2.5 wrap-break-word whitespace-pre-wrap text-black/90">
                  {selected.reporterMessage}
                </p>
              ) : (
                <p className="text-black/50">No message provided.</p>
              )}
            </DetailSection>

            {selected.messageText && (
              <DetailSection title="Reported message">
                <p className="rounded-xl bg-black/5 px-3 py-2.5 wrap-break-word italic">
                  “{selected.messageText}”
                </p>
                {selected.messageSentAt && (
                  <p className="mt-2 text-xs text-black/60">
                    Sent: {formatTs(selected.messageSentAt)}
                  </p>
                )}
                {canDeleteMessage(selected) ? (
                  <Button
                    size="sm"
                    variant="danger-solid"
                    icon={Trash2}
                    loading={busy}
                    onClick={() => deleteMessage(selected)}
                    className="mt-3"
                  >
                    {busy ? "Working…" : "Delete Message"}
                  </Button>
                ) : (
                  <p className="mt-3 text-xs text-black/50">
                    This message can’t be deleted from here — the report didn’t record its
                    message id.
                  </p>
                )}
              </DetailSection>
            )}

            <Field label="Moderator note">
              <TextArea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional note — recorded with this action."
                rows={3}
              />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* Report status as a coloured pill, using the tab labels. */
const STATUS_TONE: Record<ReportStatus, BadgeTone> = {
  pending: "amber",
  reviewed: "blue",
  action_taken: "red",
  dismissed: "neutral",
};

function StatusBadge({ status }: { status: ReportStatus }) {
  const label = TABS.find((t) => t.value === status)?.label ?? status;
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{label}</Badge>;
}

const SOURCE_ICON: Record<string, LucideIcon> = {
  direct_message: MessageSquare,
  group_chat: MessagesSquare,
  profile: UserRound,
};

function SourceBadge({ source }: { source: ReportSource }) {
  const Icon = SOURCE_ICON[source] ?? Flag;
  return (
    <Badge>
      <Icon className="h-3 w-3" aria-hidden />
      {sourceLabel(source)}
    </Badge>
  );
}

/* A titled block inside the report modal. */
function DetailSection({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-black/10 bg-white/50 p-4">
      <h3 className="mb-3 text-xs font-bold tracking-wide text-black/55 uppercase">{title}</h3>
      {children}
    </section>
  );
}

function DetailRow({
  label,
  breakAll = false,
  children,
}: {
  label: string;
  breakAll?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <dt className="text-black/55">{label}</dt>
      <dd className={cx("min-w-0", breakAll && "break-all")}>{children}</dd>
    </>
  );
}
