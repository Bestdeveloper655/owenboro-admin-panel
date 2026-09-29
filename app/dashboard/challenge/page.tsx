"use client";

import { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  getCountFromServer,
  updateDoc,
  deleteDoc,
  deleteField,
  doc,
  serverTimestamp,
  writeBatch,
  Timestamp,
} from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";

import { db, storage } from "@/lib/firebaseServices";
import { deleteDocDeep, deleteStorageFileByUrl } from "@/lib/adminData";

/* TYPES */
type Challenge = {
  id: string;
  name: string;
  description: string;
  videoUrl: string;
  isActive: boolean;
  createdAt: Date | null;
  reviewCount: number | null;
};

type Review = {
  id: string;
  reviewText: string;
  rating: number;
  userName: string;
  createdAt: Date | null;
};

const toDate = (value: unknown): Date | null =>
  value instanceof Timestamp ? value.toDate() : null;

const byNewest = (a: Challenge, b: Challenge) =>
  (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0);

/* The app shows the first `challenges` doc with `isActive == true` and has no
 * orderBy, so this screen keeps exactly one challenge active at all times. */
export default function Page() {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Challenge | null>(null);
  const [deleting, setDeleting] = useState<Challenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    name: "",
    description: "",
    videoUrl: "",
    makeActive: true,
  });

  const [file, setFile] = useState<File | null>(null);

  /* FETCH — no orderBy, so older docs without `createdAt` still show. */
  const fetchData = async () => {
    try {
      setLoading(true);
      const snap = await getDocs(collection(db, "challenges"));

      const data: Challenge[] = snap.docs
        .map((d) => {
          const x = d.data();
          return {
            id: d.id,
            name: x.challengeName || x.title || "",
            description: x.description || "",
            videoUrl: x.videoUrl || x.videoURL || x.video || "",
            isActive: x.isActive === true,
            createdAt: toDate(x.createdAt),
            reviewCount: null,
          };
        })
        .sort(byNewest);

      setChallenges(data);

      const counts = await Promise.all(
        data.map((c) =>
          getCountFromServer(collection(db, "challenges", c.id, "reviews"))
            .then((r) => r.data().count)
            .catch(() => null),
        ),
      );
      setChallenges((prev) =>
        prev.map((c) => {
          const i = data.findIndex((d) => d.id === c.id);
          return i === -1 ? c : { ...c, reviewCount: counts[i] };
        }),
      );
    } catch (err) {
      console.error(err);
      setError("Failed to load challenges.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  /* UPLOAD VIDEO */
  const uploadVideo = async () => {
    if (!file) return "";

    const storageRef = ref(storage, `challenges/${Date.now()}-${file.name}`);
    const task = uploadBytesResumable(storageRef, file, { contentType: file.type });

    await new Promise<void>((resolve, reject) => {
      task.on(
        "state_changed",
        (s) => setProgress(Math.round((s.bytesTransferred / s.totalBytes) * 100)),
        reject,
        () => resolve(),
      );
    });
    setProgress(null);
    return await getDownloadURL(storageRef);
  };

  /* Make exactly one challenge active (or none, when the list is empty). */
  const activateOnly = async (activeId: string | null, ids: string[]) => {
    const batch = writeBatch(db);
    ids.forEach((id) =>
      batch.update(doc(db, "challenges", id), {
        isActive: id === activeId,
        updatedAt: serverTimestamp(),
      }),
    );
    await batch.commit();
  };

  const setActiveChallenge = async (id: string) => {
    try {
      setBusy(true);
      await activateOnly(id, challenges.map((c) => c.id));
      setChallenges((prev) => prev.map((c) => ({ ...c, isActive: c.id === id })));
    } catch (err) {
      console.error(err);
      setError("Failed to change the active challenge.");
    } finally {
      setBusy(false);
    }
  };

  const validate = () => {
    if (!form.name.trim()) return "Challenge name is required.";
    if (!file && !form.videoUrl.trim()) return "Upload a video or paste a video URL.";
    return "";
  };

  /* ADD — always writes `isActive`. The first challenge, or any created with
   * "make active", becomes the only active one. */
  const handleAdd = async () => {
    const validationError = validate();
    if (validationError) return setError(validationError);

    try {
      setBusy(true);
      setError("");
      const videoUrl = file ? await uploadVideo() : form.videoUrl.trim();
      const makeActive = form.makeActive || !challenges.some((c) => c.isActive);

      const newRef = doc(collection(db, "challenges"));
      const batch = writeBatch(db);
      batch.set(newRef, {
        challengeName: form.name.trim(),
        description: form.description.trim(),
        videoUrl,
        isActive: makeActive,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      if (makeActive) {
        challenges
          .filter((c) => c.isActive)
          .forEach((c) =>
            batch.update(doc(db, "challenges", c.id), {
              isActive: false,
              updatedAt: serverTimestamp(),
            }),
          );
      }
      await batch.commit();

      closeModal();
      await fetchData();
    } catch (err) {
      console.error(err);
      setError("Failed to create the challenge.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  /* UPDATE — also migrates older docs from `title` / `video` to the field
   * names the app reads. */
  const handleUpdate = async () => {
    if (!editing) return;
    const validationError = validate();
    if (validationError) return setError(validationError);

    try {
      setBusy(true);
      setError("");
      const videoUrl = file ? await uploadVideo() : form.videoUrl.trim();

      await updateDoc(doc(db, "challenges", editing.id), {
        challengeName: form.name.trim(),
        description: form.description.trim(),
        videoUrl,
        isActive: editing.isActive,
        updatedAt: serverTimestamp(),
        title: deleteField(),
        video: deleteField(),
        videoURL: deleteField(),
      });

      if (videoUrl !== editing.videoUrl) {
        await deleteStorageFileByUrl(editing.videoUrl);
      }

      closeModal();
      await fetchData();
    } catch (err) {
      console.error(err);
      setError("Failed to update the challenge.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  /* DELETE — removes the reviews subcollection and the uploaded video too. If
   * the active challenge is deleted, the newest remaining one takes over. */
  const confirmDelete = async () => {
    if (!deleting) return;

    try {
      setBusy(true);
      setError("");
      await deleteDocDeep(doc(db, "challenges", deleting.id), { reviews: [] });
      await deleteStorageFileByUrl(deleting.videoUrl);

      const remaining = challenges.filter((c) => c.id !== deleting.id);
      if (deleting.isActive && remaining.length > 0) {
        await activateOnly(remaining[0].id, remaining.map((c) => c.id));
      }

      setDeleting(null);
      await fetchData();
    } catch (err) {
      console.error(err);
      setError("Failed to delete the challenge.");
    } finally {
      setBusy(false);
    }
  };

  const closeModal = () => {
    setAdding(false);
    setEditing(null);
    setForm({ name: "", description: "", videoUrl: "", makeActive: true });
    setFile(null);
    setError("");
  };

  const remainingAfterDelete = deleting
    ? challenges.filter((c) => c.id !== deleting.id)
    : [];

  return (
    <div className="px-4 pt-6 pb-10 md:px-8">

      {/* HEADER */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[#ff7a59] sm:text-4xl">
            Challenge
          </h1>
          <p className="mt-1 text-sm text-[#e8dcc7]/70">
            The app shows the active challenge. Only one can be active at a time.
          </p>
        </div>

        <button
          onClick={() => {
            closeModal();
            setAdding(true);
          }}
          className="self-start rounded-xl border border-[#ff7a59] px-4 py-2 text-sm text-[#ff7a59] transition hover:bg-[#ff7a59] hover:text-white sm:self-auto sm:px-5 sm:text-base"
        >
          Add Challenge
        </button>
      </div>

      {error && !adding && !editing && (
        <div className="mt-6 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* LIST */}
      <section className="mt-10 space-y-6">
        {loading ? (
          <p className="text-[#f3ead7]/70">Loading challenges…</p>
        ) : challenges.length === 0 ? (
          <p className="text-[#f3ead7]/70">
            No challenges yet. The challenge section is hidden in the app until
            one is added.
          </p>
        ) : (
          challenges.map((challenge) => (
            <ChallengeCard
              key={challenge.id}
              challenge={challenge}
              busy={busy}
              onEdit={() => {
                setError("");
                setFile(null);
                setEditing(challenge);
                setForm({
                  name: challenge.name,
                  description: challenge.description,
                  videoUrl: challenge.videoUrl,
                  makeActive: challenge.isActive,
                });
              }}
              onDelete={() => setDeleting(challenge)}
              onSetActive={() => setActiveChallenge(challenge.id)}
              onReviewDeleted={() =>
                setChallenges((prev) =>
                  prev.map((c) =>
                    c.id === challenge.id && c.reviewCount
                      ? { ...c, reviewCount: c.reviewCount - 1 }
                      : c,
                  ),
                )
              }
            />
          ))
        )}
      </section>

      {/* MODAL */}
      {(adding || editing) && (
        <Modal title={adding ? "Add Challenge" : "Edit Challenge"} onClose={closeModal}>
          {error && (
            <div className="mb-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <Input
            label="Challenge name"
            value={form.name}
            onChange={(v: string) => setForm({ ...form, name: v })}
          />

          <div className="mt-3">
            <label className="font-semibold">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="mt-1 h-24 w-full rounded-xl border border-[#ff7a59] p-3"
            />
          </div>

          <Input
            label="Video URL"
            value={form.videoUrl}
            onChange={(v: string) => setForm({ ...form, videoUrl: v })}
          />

          <label className="mt-3 block text-sm font-semibold">…or upload a video</label>
          <input
            type="file"
            accept="video/*"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="mt-1"
          />
          {file && (
            <p className="mt-1 text-xs text-black/60">
              The uploaded file replaces the URL above.
            </p>
          )}

          {adding && (
            <label className="mt-4 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.makeActive}
                onChange={(e) => setForm({ ...form, makeActive: e.target.checked })}
              />
              Make this the active challenge (the current one is deactivated)
            </label>
          )}

          {progress !== null && (
            <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-black/10">
              <div className="h-full bg-[#ff7a59] transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}

          <button
            onClick={adding ? handleAdd : handleUpdate}
            disabled={busy}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#ff7a59] py-3 text-white disabled:opacity-60"
          >
            {busy && (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            )}
            {busy ? (progress !== null ? `Uploading ${progress}%` : "Saving…") : "Save"}
          </button>
        </Modal>
      )}

      {/* DELETE */}
      {deleting && (
        <Modal title="Delete challenge" onClose={() => setDeleting(null)}>
          <p>
            Delete <b>{deleting.name || "this challenge"}</b>? Its video and all of
            its reviews are deleted too. This can&rsquo;t be undone.
          </p>
          {deleting.isActive && (
            <p className="mt-3 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">
              {remainingAfterDelete.length > 0
                ? `This is the active challenge. "${remainingAfterDelete[0].name || "The newest remaining challenge"}" will become active instead.`
                : "This is the only challenge. The challenge section will be hidden in the app."}
            </p>
          )}
          <div className="mt-6 flex justify-end gap-3">
            <button
              onClick={() => setDeleting(null)}
              className="rounded-xl border border-black/15 px-4 py-2"
            >
              Cancel
            </button>
            <button
              onClick={confirmDelete}
              disabled={busy}
              className="rounded-xl bg-red-500 px-4 py-2 text-white disabled:opacity-60"
            >
              {busy ? "Deleting…" : "Delete"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* CARD */
function ChallengeCard({
  challenge,
  busy,
  onEdit,
  onDelete,
  onSetActive,
  onReviewDeleted,
}: {
  challenge: Challenge;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onSetActive: () => void;
  onReviewDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [loadingReviews, setLoadingReviews] = useState(false);

  const loadReviews = async () => {
    setLoadingReviews(true);
    try {
      const snap = await getDocs(collection(db, "challenges", challenge.id, "reviews"));
      setReviews(
        snap.docs
          .map((d) => {
            const x = d.data();
            return {
              id: d.id,
              reviewText: x.reviewText || "",
              rating: typeof x.rating === "number" ? x.rating : 0,
              userName: x.userName || "Anonymous",
              createdAt: toDate(x.createdAt),
            };
          })
          .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)),
      );
    } catch (err) {
      console.error(err);
      setReviews([]);
    } finally {
      setLoadingReviews(false);
    }
  };

  const toggleReviews = () => {
    if (!open && reviews === null) loadReviews();
    setOpen(!open);
  };

  const deleteReview = async (review: Review) => {
    if (!window.confirm(`Delete this review by ${review.userName}?`)) return;
    try {
      await deleteDoc(doc(db, "challenges", challenge.id, "reviews", review.id));
      setReviews((prev) => prev?.filter((r) => r.id !== review.id) ?? null);
      onReviewDeleted();
    } catch (err) {
      console.error(err);
      alert("Failed to delete the review.");
    }
  };

  const count = challenge.reviewCount;

  return (
    <div className="rounded-2xl border border-[#ff7a59]/60 bg-[#0a0a0a] p-6 space-y-5">

      {/* HEADER */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold text-white">
            {challenge.name || "Untitled challenge"}
          </h3>
          {challenge.description && (
            <p className="mt-1 text-sm text-white/60">{challenge.description}</p>
          )}
        </div>

        {challenge.isActive && (
          <span className="shrink-0 rounded-full bg-green-500/20 px-3 py-1 text-xs text-green-400">
            Active
          </span>
        )}
      </div>

      {/* VIDEO */}
      {challenge.videoUrl ? (
        <video controls className="w-full rounded-xl" src={challenge.videoUrl} />
      ) : (
        <p className="rounded-xl bg-white/5 p-4 text-sm text-white/50">No video</p>
      )}

      {/* INFO BAR */}
      <div className="flex items-center justify-between text-sm text-[#f3ead7]">

        <div className="flex items-center gap-2">
          <span className="font-medium">{count ?? "–"}</span>
          <span className="text-white/60">{count === 1 ? "Review" : "Reviews"}</span>
        </div>

        <div className="flex items-center gap-2">

          {!challenge.isActive && (
            <button
              onClick={onSetActive}
              disabled={busy}
              className="rounded-lg bg-[#ff7a59] px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
            >
              Set Active
            </button>
          )}

          <button
            onClick={toggleReviews}
            className="rounded-lg border border-white/20 px-3 py-1 text-xs text-white"
          >
            {open ? "Hide Reviews" : "View Reviews"}
          </button>
        </div>
      </div>

      {/* REVIEWS */}
      {open && (
        <div className="border-t border-white/10 pt-4">
          {loadingReviews || reviews === null ? (
            <p className="text-sm text-white/50">Loading reviews…</p>
          ) : reviews.length === 0 ? (
            <div className="rounded-lg bg-white/5 p-3 text-center text-sm text-white/50">
              No reviews yet
            </div>
          ) : (
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {reviews.map((r) => (
                <div
                  key={r.id}
                  className="flex items-start justify-between gap-3 rounded-lg bg-[#ece2cb] px-3 py-2 text-sm text-black"
                >
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {r.userName}{" "}
                      <span className="font-normal text-amber-700">
                        {"★".repeat(Math.max(0, Math.min(5, r.rating)))}
                      </span>
                    </p>
                    <p className="text-black/80">{r.reviewText}</p>
                  </div>
                  <button
                    onClick={() => deleteReview(r)}
                    className="shrink-0 text-xs text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ACTIONS */}
      <div className="flex justify-end gap-3 border-t border-white/10 pt-4">

        <button
          onClick={onEdit}
          className="rounded-lg bg-[#ff7a59] px-4 py-1.5 text-xs font-semibold text-white"
        >
          Edit
        </button>

        <button
          onClick={onDelete}
          className="rounded-lg border border-red-400 px-4 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500 hover:text-white"
        >
          Delete
        </button>

      </div>
    </div>
  );
}

/* UI */
function Modal({ children, title, onClose }: any) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-[#e8dcc7] p-6 text-black">
        <div className="flex justify-between mb-4">
          <h2 className="text-xl font-bold text-[#ff7a59]">{title}</h2>
          <button onClick={onClose}>✖</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Input({ label, value, onChange }: any) {
  return (
    <div className="mt-3">
      <label className="font-semibold">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-[#ff7a59] rounded-xl p-3 mt-1"
      />
    </div>
  );
}
