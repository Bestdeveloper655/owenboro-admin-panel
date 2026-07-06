"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "@/lib/firebaseServices";
import { notifyModeration } from "@/lib/moderationNotify";

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
  reportCount: number;
};

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

        const snap = await getDoc(doc(db, "Users", selected.reportedUserId));
        if (cancelled) return;
        if (!snap.exists()) {
          setProfile({
            displayName: selected.reportedUserName || "Unknown",
            photoUrl: "",
            photoUrls: [],
            age: "",
            gender: "",
            bio: "",
            email: "",
            isBanned: false,
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
          isBanned: x.is_banned === true,
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

  const banUser = async (report: Report) => {
    if (!report.reportedUserId) return;
    if (
      !confirm(
        `Ban ${report.reportedUserName || "this user"}? They will be flagged as banned.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const reviewer = auth.currentUser?.uid ?? "";
      await Promise.all([
        updateDoc(doc(db, "Users", report.reportedUserId), {
          is_banned: true,
          banned_at: serverTimestamp(),
          banned_by: reviewer,
          banned_reason: note.trim() || `Report ${report.id}`,
        }),
        updateDoc(doc(db, "reports", report.id), {
          status: "action_taken",
          reviewed_at: serverTimestamp(),
          reviewed_by: reviewer,
          moderator_notes: note.trim() || "User banned.",
        }),
      ]);
      await notifyModeration({
        uid: report.reportedUserId,
        event: "banned",
        reason: note.trim(),
      });
      setSelected(null);
      setNote("");
    } catch (e) {
      console.error(e);
      alert("Ban failed. Check console.");
    } finally {
      setBusy(false);
    }
  };

  const unbanUser = async (report: Report) => {
    if (!report.reportedUserId) return;
    if (!confirm(`Unban ${report.reportedUserName || "this user"}?`)) return;
    setBusy(true);
    try {
      const reviewer = auth.currentUser?.uid ?? "";
      await updateDoc(doc(db, "Users", report.reportedUserId), {
        is_banned: false,
        unbanned_at: serverTimestamp(),
        unbanned_by: reviewer,
      });
      await notifyModeration({
        uid: report.reportedUserId,
        event: "unbanned",
      });
      setProfile((p) => (p ? { ...p, isBanned: false } : p));
    } catch (e) {
      console.error(e);
      alert("Unban failed. Check console.");
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
    <div className="px-2 pt-4 pb-8 sm:px-6 sm:pt-6 sm:pb-10">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-3xl font-bold text-[#ff7a59] sm:text-4xl lg:text-5xl">
          Report Board
        </h1>
        <p className="mt-2 text-base text-[#e8dcc7] sm:text-lg">
          Review user reports from chats and profiles. Take moderation action
          when needed.
        </p>
      </div>

      {/* USER LOOKUP — search any user to see how many times they were reported */}
      <section className="mb-6 rounded-3xl border border-[#ff7a59]/40 bg-[#0a0a0a] p-4 sm:p-6">
        <h2 className="mb-1 text-lg font-bold text-[#ff7a59] sm:text-xl">
          Look up a user
        </h2>
        <p className="mb-4 text-sm text-[#e8dcc7]/80">
          Search any reported user by name or UID to see how many times they’ve
          been reported.
        </p>

        <div className="relative max-w-xl">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#ff7a59]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
            placeholder="Search by name or UID…"
            className="w-full rounded-xl border border-white/15 bg-[#0a0a0a] py-3 pl-11 pr-10 text-white outline-none placeholder:text-white/40 focus:border-[#ff7a59]"
          />
          {userSearch && (
            <button
              onClick={() => setUserSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50 hover:text-white"
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        {userSearch.trim() && (
          <div className="mt-4 space-y-3">
            {allLoading ? (
              <p className="text-[#f3ead7]/70">Loading reports…</p>
            ) : userMatches.length === 0 ? (
              <p className="text-[#f3ead7]/70">
                No reported user matches “{userSearch.trim()}”.
              </p>
            ) : (
              userMatches.map((u) => {
                const open = expandedUid === u.uid;
                return (
                  <div
                    key={u.uid}
                    className="rounded-2xl border border-white/10 bg-[#ece2cb] text-black"
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedUid(open ? null : u.uid)}
                      className="flex w-full items-center justify-between gap-3 p-4 text-left"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-base font-semibold">
                          {u.name || "Unknown user"}
                        </p>
                        <p className="truncate text-xs text-black/60">
                          UID: {u.uid}
                        </p>
                        <p className="mt-1 text-xs text-black/60">
                          Last reported: {formatTs(u.lastReportedAt)}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${
                            u.count > 1
                              ? "bg-[#c0392b] text-white"
                              : "bg-black/10 text-black/70"
                          }`}
                        >
                          Reported {u.count}×
                        </span>
                        <span className="text-[11px] text-black/50">
                          {open ? "Hide reports ▲" : "Show reports ▼"}
                        </span>
                      </div>
                    </button>

                    <div className="flex flex-wrap gap-1.5 px-4 pb-3">
                      {TABS.map((t) =>
                        u.statusCounts[t.value] > 0 ? (
                          <span
                            key={t.value}
                            className="rounded-full bg-black/10 px-2.5 py-0.5 text-[11px] font-medium text-black/70"
                          >
                            {t.label}: {u.statusCounts[t.value]}
                          </span>
                        ) : null,
                      )}
                    </div>

                    {open && (
                      <div className="space-y-2 border-t border-black/10 p-4">
                        {u.reports.map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => {
                              setSelected(r);
                              setNote(r.moderatorNotes ?? "");
                            }}
                            className="flex w-full items-center justify-between gap-3 rounded-lg bg-white/60 px-3 py-2 text-left transition hover:bg-white"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm">
                                <span className="font-semibold">
                                  {sourceLabel(r.source)}
                                </span>{" "}
                                · by {r.reporterName || r.reporterId || "Unknown"}
                              </p>
                              {r.reporterMessage && (
                                <p className="truncate text-xs text-black/60">
                                  {r.reporterMessage}
                                </p>
                              )}
                            </div>
                            <div className="shrink-0 text-right">
                              <span className="block rounded-full bg-[#ff7a59]/20 px-2 py-0.5 text-[11px] font-semibold text-[#c0392b]">
                                {r.status}
                              </span>
                              <span className="mt-0.5 block text-[11px] text-black/50">
                                {formatTs(r.createdAt)}
                              </span>
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
      </section>

      <div className="mb-6 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`rounded-xl px-5 py-2 text-sm font-semibold transition ${
              tab === t.value
                ? "bg-[#ff7a59] text-white"
                : "border border-[#ff7a59]/40 text-[#e8dcc7] hover:bg-[#ff7a59]/20"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <section className="rounded-3xl border border-[#ff7a59]/40 bg-[#0a0a0a] p-4 sm:p-6">
        <h2 className="mb-6 text-xl font-bold text-[#ff7a59] sm:text-2xl lg:text-3xl">
          {TABS.find((t) => t.value === tab)?.label} ({counts})
        </h2>

        {loading ? (
          <p className="text-[#f3ead7]">Loading...</p>
        ) : items.length === 0 ? (
          <p className="text-[#f3ead7]/70">No reports in this tab.</p>
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
                className="rounded-2xl border border-white/10 bg-[#ece2cb] p-4 text-left text-black transition hover:border-[#ff7a59]"
              >
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-[#ff7a59]/20 px-3 py-1 text-xs font-semibold text-[#ff7a59]">
                    {sourceLabel(r.source)}
                  </span>
                  <span className="text-xs text-black/60">
                    {formatTs(r.createdAt)}
                  </span>
                </div>
                <p className="mt-3 text-base font-semibold">
                  Reported:{" "}
                  <span className="text-[#c0392b]">
                    {r.reportedUserName || r.reportedUserId || "Unknown"}
                  </span>
                </p>
                <p className="text-sm text-black/70">
                  By: {r.reporterName || r.reporterId || "Unknown"}
                </p>
                {r.reporterMessage && (
                  <div className="mt-3 rounded-lg border border-[#ff7a59]/40 bg-[#ff7a59]/10 p-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[#c0392b]">
                      Reason
                    </p>
                    <p className="line-clamp-3 text-sm text-black/80">
                      {r.reporterMessage}
                    </p>
                  </div>
                )}
                {r.messageText && (
                  <p className="mt-3 line-clamp-3 rounded-lg bg-black/5 p-2 text-sm italic text-black/80">
                    “{r.messageText}”
                  </p>
                )}
                {r.moderatorNotes && (
                  <p className="mt-3 text-xs text-black/70">
                    <b>Note:</b> {r.moderatorNotes}
                  </p>
                )}
              </button>
            ))}
          </div>
        )}
      </section>

      {selected && (
        <Modal
          title={`Report: ${selected.reportedUserName || "Unknown user"}`}
          onClose={() => {
            setSelected(null);
            setNote("");
          }}
        >
          <div className="space-y-5 text-sm text-black">
            <section className="rounded-2xl bg-white/60 p-4">
              <h3 className="mb-2 font-semibold text-[#ff7a59]">
                Reported user
              </h3>
              {profileLoading ? (
                <p>Loading profile...</p>
              ) : profile ? (
                <div className="space-y-4">
                  <div className="flex gap-4">
                    <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full bg-black/10">
                      {profile.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={profile.photoUrl}
                          alt={profile.displayName}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-xs text-black/50">
                          No photo
                        </div>
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="text-base font-semibold">
                        {profile.displayName}
                      </p>
                      <p className="text-xs text-black/70">
                        {[
                          profile.age && `Age ${profile.age}`,
                          profile.gender,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "Age/gender not set"}
                      </p>
                      {profile.email && (
                        <p className="text-xs text-black/60">{profile.email}</p>
                      )}
                      <p className="break-all text-xs text-black/60">
                        UID: {selected.reportedUserId}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${
                            profile.reportCount > 1
                              ? "bg-[#c0392b] text-white"
                              : "bg-black/10 text-black/70"
                          }`}
                        >
                          Reported {profile.reportCount}×
                        </span>
                        {profile.isBanned && (
                          <span className="inline-block rounded-full bg-red-600 px-3 py-1 text-xs font-semibold text-white">
                            Banned
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {profile.photoUrls.length > 1 && (
                    <div className="flex flex-wrap gap-2">
                      {profile.photoUrls.map((url, i) => (
                        <a
                          key={i}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="h-16 w-16 overflow-hidden rounded-lg bg-black/10"
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
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-black/50">
                        Bio
                      </p>
                      <p className="whitespace-pre-wrap text-sm text-black/80">
                        {profile.bio}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-black/60">No profile data.</p>
              )}
            </section>

            <section className="rounded-2xl bg-white/60 p-4">
              <h3 className="mb-2 font-semibold text-[#ff7a59]">
                Report details
              </h3>
              <p>
                <b>Reporter:</b> {selected.reporterName || "Unknown"} (
                <span className="break-all">{selected.reporterId}</span>)
              </p>
              <p>
                <b>Source:</b> {sourceLabel(selected.source)}
              </p>
              {selected.conversationId && (
                <p className="break-all">
                  <b>Conversation:</b> {selected.conversationId}
                </p>
              )}
              {selected.groupId && (
                <p className="break-all">
                  <b>Group:</b> {selected.groupId}
                </p>
              )}
              <p>
                <b>Reported at:</b> {formatTs(selected.createdAt)}
              </p>
              {selected.status !== "pending" && (
                <>
                  <p>
                    <b>Status:</b> {selected.status}
                  </p>
                  <p>
                    <b>Reviewed at:</b> {formatTs(selected.reviewedAt)}
                  </p>
                  {selected.reviewedBy && (
                    <p className="break-all">
                      <b>Reviewed by:</b> {selected.reviewedBy}
                    </p>
                  )}
                </>
              )}
            </section>

            <section className="rounded-2xl bg-white/60 p-4">
              <h3 className="mb-2 font-semibold text-[#ff7a59]">
                Reason from reporter
              </h3>
              {selected.reporterMessage ? (
                <p className="whitespace-pre-wrap rounded-lg bg-[#ff7a59]/10 p-3 text-black/90">
                  {selected.reporterMessage}
                </p>
              ) : (
                <p className="text-black/50">No message provided.</p>
              )}
            </section>

            {selected.messageText && (
              <section className="rounded-2xl bg-white/60 p-4">
                <h3 className="mb-2 font-semibold text-[#ff7a59]">
                  Reported message
                </h3>
                <p className="rounded-lg bg-black/5 p-3 italic">
                  “{selected.messageText}”
                </p>
                {selected.messageSentAt && (
                  <p className="mt-2 text-xs text-black/60">
                    Sent: {formatTs(selected.messageSentAt)}
                  </p>
                )}
                {canDeleteMessage(selected) ? (
                  <button
                    disabled={busy}
                    onClick={() => deleteMessage(selected)}
                    className="mt-3 rounded-lg bg-[#c0392b] px-4 py-2 text-sm font-semibold text-white hover:bg-[#a93226] disabled:opacity-50"
                  >
                    {busy ? "Working..." : "Delete Message"}
                  </button>
                ) : (
                  <p className="mt-3 text-xs text-black/50">
                    This message can’t be deleted from here — the report didn’t
                    record its message id.
                  </p>
                )}
              </section>
            )}

            <section className="rounded-2xl bg-white/60 p-4">
              <h3 className="mb-2 font-semibold text-[#ff7a59]">
                Moderator note
              </h3>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional note — recorded with this action."
                className="w-full rounded-xl border border-black/20 bg-white p-3 outline-none focus:border-[#ff7a59]"
                rows={3}
              />
            </section>

            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <button
                disabled={busy}
                onClick={() => setStatus(selected, "dismissed")}
                className="rounded-lg border border-black/30 px-4 py-2 text-sm font-semibold disabled:opacity-50"
              >
                Dismiss
              </button>
              <button
                disabled={busy}
                onClick={() => setStatus(selected, "reviewed")}
                className="rounded-lg bg-[#1F2C34] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2A3942] disabled:opacity-50"
              >
                Mark Reviewed
              </button>
              {profile?.isBanned ? (
                <button
                  disabled={busy}
                  onClick={() => unbanUser(selected)}
                  className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  Unban User
                </button>
              ) : (
                <button
                  disabled={busy}
                  onClick={() => banUser(selected)}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {busy ? "Working..." : "Ban User"}
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ children, title, onClose }: any) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-[#e8dcc7] p-6">
        <div className="mb-4 flex justify-between">
          <h2 className="text-xl font-bold text-[#ff7a59]">{title}</h2>
          <button onClick={onClose} className="text-2xl">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
