"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebaseServices";

type ReportStatus = "pending" | "reviewed" | "dismissed" | "action_taken";
type ReportSource = "direct_message" | "group_chat" | "profile" | string;

type Report = {
  id: string;
  reporterId: string;
  reporterName: string;
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
  email: string;
  isBanned: boolean;
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
        const data: Report[] = snap.docs.map((d) => {
          const x = d.data() as any;
          return {
            id: d.id,
            reporterId: x.reporter_uid ?? "",
            reporterName: x.reporter_name ?? "",
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
        });
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
        const snap = await getDoc(doc(db, "Users", selected.reportedUserId));
        if (cancelled) return;
        if (!snap.exists()) {
          setProfile({
            displayName: selected.reportedUserName || "Unknown",
            photoUrl: "",
            email: "",
            isBanned: false,
          });
          return;
        }
        const x = snap.data() as any;
        setProfile({
          displayName:
            x.display_name || x.full_name || selected.reportedUserName || "Unknown",
          photoUrl: x.photo_url || "",
          email: x.email || "",
          isBanned: x.is_banned === true,
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
      setProfile((p) => (p ? { ...p, isBanned: false } : p));
    } catch (e) {
      console.error(e);
      alert("Unban failed. Check console.");
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
                <div className="flex gap-4">
                  <div className="h-20 w-20 overflow-hidden rounded-full bg-black/10">
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
                    {profile.email && (
                      <p className="text-xs text-black/60">{profile.email}</p>
                    )}
                    <p className="break-all text-xs text-black/60">
                      UID: {selected.reportedUserId}
                    </p>
                    {profile.isBanned && (
                      <span className="mt-2 inline-block rounded-full bg-red-600 px-3 py-1 text-xs font-semibold text-white">
                        Banned
                      </span>
                    )}
                  </div>
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
