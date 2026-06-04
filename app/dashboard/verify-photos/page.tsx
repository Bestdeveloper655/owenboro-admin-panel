"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebaseServices";

type Submission = {
  id: string;
  uid: string;
  userDisplayName: string;
  photoUrl: string;
  profilePhotoUrl: string;
  status: "pending" | "approved" | "rejected";
  submittedAt: any;
  reviewedAt?: any;
  reviewedBy?: string;
  rejectionReason?: string;
};

type Tab = "pending" | "approved" | "rejected";

export default function Page() {
  const [tab, setTab] = useState<Tab>("pending");
  const [items, setItems] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Submission | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLoading(true);
    const q = query(
      collection(db, "VerificationPhotos"),
      where("status", "==", tab),
      orderBy("submitted_at", "desc"),
    );
    const unsub = onSnapshot(
      q,
      async (snap) => {
        const data: Submission[] = snap.docs.map((d) => {
          const x = d.data() as any;
          return {
            id: d.id,
            uid: x.uid ?? "",
            userDisplayName: x.user_display_name ?? "",
            photoUrl: x.photo_url ?? "",
            profilePhotoUrl: x.profile_photo_url ?? "",
            status: x.status ?? "pending",
            submittedAt: x.submitted_at ?? null,
            reviewedAt: x.reviewed_at ?? null,
            reviewedBy: x.reviewed_by ?? "",
            rejectionReason: x.rejection_reason ?? "",
          };
        });

        // Keep only the most recent submission per user.
        // Query is ordered by submitted_at desc, so the first
        // occurrence of each uid is the newest.
        const seen = new Set<string>();
        const deduped: Submission[] = [];
        for (const s of data) {
          const key = s.uid || s.id;
          if (seen.has(key)) continue;
          seen.add(key);
          deduped.push(s);
        }

        // Backfill the profile picture from the Users doc for older
        // submissions that didn't snapshot it, so admins can always compare
        // the live selfie against the user's current profile photo.
        await Promise.all(
          deduped.map(async (s) => {
            if (s.profilePhotoUrl || !s.uid) return;
            try {
              const userSnap = await getDoc(doc(db, "Users", s.uid));
              const u = userSnap.data() as any;
              const photo =
                u?.photo_url ||
                (Array.isArray(u?.photo_urls) ? u.photo_urls[0] : "") ||
                "";
              s.profilePhotoUrl = photo;
            } catch (e) {
              console.error(e);
            }
          }),
        );

        setItems(deduped);
        setLoading(false);
      },
      (err) => {
        console.error(err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [tab]);

  // Resolve every pending submission for a user in one batch, so older
  // duplicate submissions don't resurface in the pending tab afterwards.
  const resolvePending = async (
    uid: string,
    status: "approved" | "rejected",
    why: string,
    reviewer: string,
  ) => {
    const pendingSnap = await getDocs(
      query(
        collection(db, "VerificationPhotos"),
        where("uid", "==", uid),
        where("status", "==", "pending"),
      ),
    );
    const batch = writeBatch(db);
    pendingSnap.forEach((d) => {
      batch.update(d.ref, {
        status,
        reviewed_at: serverTimestamp(),
        reviewed_by: reviewer,
        rejection_reason: status === "rejected" ? why : "",
      });
    });
    if (status === "approved") {
      batch.update(doc(db, "Users", uid), { is_verified: true });
    }
    await batch.commit();
  };

  const approve = async (s: Submission) => {
    if (!s.uid) return;
    setBusy(true);
    // Optimistically remove the card so it moves out of pending immediately.
    setItems((prev) => prev.filter((i) => i.uid !== s.uid));
    setSelected(null);
    try {
      const reviewer = auth.currentUser?.uid ?? "";
      await resolvePending(s.uid, "approved", "", reviewer);
    } catch (e) {
      console.error(e);
      alert("Approve failed. Check console.");
      setItems((prev) => (prev.some((i) => i.id === s.id) ? prev : [s, ...prev]));
    } finally {
      setBusy(false);
    }
  };

  const reject = async (s: Submission, why: string) => {
    if (!s.uid) return;
    setBusy(true);
    // Optimistically remove the card so it moves out of pending immediately.
    setItems((prev) => prev.filter((i) => i.uid !== s.uid));
    setRejectingId(null);
    setReason("");
    setSelected(null);
    try {
      const reviewer = auth.currentUser?.uid ?? "";
      await resolvePending(s.uid, "rejected", why, reviewer);
    } catch (e) {
      console.error(e);
      alert("Reject failed. Check console.");
      setItems((prev) => (prev.some((i) => i.id === s.id) ? prev : [s, ...prev]));
    } finally {
      setBusy(false);
    }
  };

  const counts = useMemo(() => items.length, [items]);

  return (
    <div className="px-2 pt-4 pb-8 sm:px-6 sm:pt-6 sm:pb-10">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-3xl font-bold text-[#ff7a59] sm:text-4xl lg:text-5xl">
          Verify Photos
        </h1>
        <p className="mt-2 text-base text-[#e8dcc7] sm:text-lg">
          Review identity photos submitted by users.
        </p>
      </div>

      {/* TABS */}
      <div className="mb-6 flex gap-2">
        {(["pending", "approved", "rejected"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-xl px-5 py-2 text-sm font-semibold capitalize transition ${
              tab === t
                ? "bg-[#ff7a59] text-white"
                : "border border-[#ff7a59]/40 text-[#e8dcc7] hover:bg-[#ff7a59]/20"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <section className="rounded-3xl border border-[#ff7a59]/40 bg-[#0a0a0a] p-4 sm:p-6">
        <h2 className="mb-6 text-xl font-bold capitalize text-[#ff7a59] sm:text-2xl lg:text-3xl">
          {tab} ({counts})
        </h2>

        {loading ? (
          <p className="text-[#f3ead7]">Loading...</p>
        ) : items.length === 0 ? (
          <p className="text-[#f3ead7]/70">No {tab} submissions.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((s) => (
              <div
                key={s.id}
                className="rounded-2xl border border-white/10 bg-[#ece2cb] p-3 text-black"
              >
                <button
                  type="button"
                  onClick={() => setSelected(s)}
                  className="block w-full"
                >
                  <div className="grid grid-cols-2 gap-1.5">
                    <div>
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-black/50">
                        Live photo
                      </p>
                      <div className="aspect-square w-full overflow-hidden rounded-xl bg-black/10">
                        {s.photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={s.photoUrl}
                            alt="Live selfie"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-xs text-black/50">
                            No image
                          </div>
                        )}
                      </div>
                    </div>
                    <div>
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-black/50">
                        Profile pic
                      </p>
                      <div className="aspect-square w-full overflow-hidden rounded-xl bg-black/10">
                        {s.profilePhotoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={s.profilePhotoUrl}
                            alt="Profile picture"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-xs text-black/50">
                            No image
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </button>

                <div className="mt-3">
                  <p className="truncate font-semibold">
                    {s.userDisplayName || "Unknown user"}
                  </p>
                  <p className="truncate text-xs text-black/60">{s.uid}</p>
                  <p className="mt-1 text-xs text-black/60">
                    {s.submittedAt?.toDate
                      ? s.submittedAt.toDate().toLocaleString()
                      : ""}
                  </p>
                  {tab === "rejected" && s.rejectionReason && (
                    <p className="mt-2 text-xs text-red-700">
                      <b>Reason:</b> {s.rejectionReason}
                    </p>
                  )}
                </div>

                {tab === "pending" && (
                  <div className="mt-3 flex gap-2">
                    <button
                      disabled={busy}
                      onClick={() => approve(s)}
                      className="flex-1 rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => {
                        setRejectingId(s.id);
                        setReason("");
                      }}
                      className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* REJECT MODAL */}
      {rejectingId && (
        <Modal
          title="Reject submission"
          onClose={() => {
            setRejectingId(null);
            setReason("");
          }}
        >
          <p className="text-sm text-black/70">
            Optionally, give the user a reason. They can resubmit a new photo.
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Photo is blurry, please retake."
            className="mt-3 w-full rounded-xl border border-black/20 bg-white p-3 text-black outline-none focus:border-[#ff7a59]"
            rows={4}
          />
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={() => {
                setRejectingId(null);
                setReason("");
              }}
              className="rounded-lg border border-black/20 px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              disabled={busy}
              onClick={() => {
                const target = items.find((i) => i.id === rejectingId);
                if (target) reject(target, reason.trim());
              }}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? "Rejecting..." : "Confirm reject"}
            </button>
          </div>
        </Modal>
      )}

      {/* PHOTO LIGHTBOX */}
      {selected && (
        <Modal title={selected.userDisplayName || "Submission"} onClose={() => setSelected(null)}>
          <p className="mb-3 text-sm text-black/70">
            Compare the live photo against the profile picture to confirm they
            are the same person.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-black/60">
                Live photo
              </p>
              {selected.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selected.photoUrl}
                  alt="Live selfie"
                  className="max-h-[55vh] w-full rounded-xl bg-black/10 object-contain"
                />
              ) : (
                <div className="flex h-40 items-center justify-center rounded-xl bg-black/10 text-sm text-black/50">
                  No image
                </div>
              )}
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-black/60">
                Profile picture
              </p>
              {selected.profilePhotoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selected.profilePhotoUrl}
                  alt="Profile picture"
                  className="max-h-[55vh] w-full rounded-xl bg-black/10 object-contain"
                />
              ) : (
                <div className="flex h-40 items-center justify-center rounded-xl bg-black/10 text-sm text-black/50">
                  No profile picture
                </div>
              )}
            </div>
          </div>
          <div className="mt-4 space-y-1 text-sm text-black">
            <p>
              <b>UID:</b> {selected.uid}
            </p>
            <p>
              <b>Status:</b> {selected.status}
            </p>
            <p>
              <b>Submitted:</b>{" "}
              {selected.submittedAt?.toDate
                ? selected.submittedAt.toDate().toLocaleString()
                : "-"}
            </p>
          </div>
          {selected.status === "pending" && (
            <div className="mt-5 flex gap-2">
              <button
                disabled={busy}
                onClick={() => approve(selected)}
                className="flex-1 rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
              >
                Approve
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setRejectingId(selected.id);
                  setReason("");
                }}
                className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          )}
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
