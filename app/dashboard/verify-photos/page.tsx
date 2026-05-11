"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebaseServices";

type Submission = {
  id: string;
  uid: string;
  userDisplayName: string;
  photoUrl: string;
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
      (snap) => {
        const data: Submission[] = snap.docs.map((d) => {
          const x = d.data() as any;
          return {
            id: d.id,
            uid: x.uid ?? "",
            userDisplayName: x.user_display_name ?? "",
            photoUrl: x.photo_url ?? "",
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

  const approve = async (s: Submission) => {
    if (!s.uid) return;
    setBusy(true);
    try {
      const reviewer = auth.currentUser?.uid ?? "";
      await Promise.all([
        updateDoc(doc(db, "VerificationPhotos", s.id), {
          status: "approved",
          reviewed_at: serverTimestamp(),
          reviewed_by: reviewer,
          rejection_reason: "",
        }),
        updateDoc(doc(db, "Users", s.uid), {
          is_verified: true,
        }),
      ]);
      setSelected(null);
    } catch (e) {
      console.error(e);
      alert("Approve failed. Check console.");
    } finally {
      setBusy(false);
    }
  };

  const reject = async (s: Submission, why: string) => {
    setBusy(true);
    try {
      const reviewer = auth.currentUser?.uid ?? "";
      await updateDoc(doc(db, "VerificationPhotos", s.id), {
        status: "rejected",
        reviewed_at: serverTimestamp(),
        reviewed_by: reviewer,
        rejection_reason: why,
      });
      setRejectingId(null);
      setReason("");
      setSelected(null);
    } catch (e) {
      console.error(e);
      alert("Reject failed. Check console.");
    } finally {
      setBusy(false);
    }
  };

  const counts = useMemo(() => items.length, [items]);

  return (
    <div className="px-6 pt-6 pb-10">
      <div className="mb-8">
        <h1 className="text-5xl font-bold text-[#ff7a59]">Verify Photos</h1>
        <p className="mt-2 text-lg text-[#e8dcc7]">
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

      <section className="rounded-3xl border border-[#ff7a59]/40 bg-[#0a0a0a] p-6">
        <h2 className="mb-6 text-3xl font-bold text-[#ff7a59] capitalize">
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
                  className="block aspect-square w-full overflow-hidden rounded-xl bg-black/10"
                >
                  {s.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={s.photoUrl}
                      alt={s.userDisplayName}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-black/50">
                      No image
                    </div>
                  )}
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
          {selected.photoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={selected.photoUrl}
              alt=""
              className="max-h-[70vh] w-full rounded-xl object-contain"
            />
          )}
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
