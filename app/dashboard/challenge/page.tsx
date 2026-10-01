"use client";

import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Plus,
  Star,
  Trophy,
  VideoOff,
} from "lucide-react";
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
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  LoadingState,
  Modal,
  PageHeader,
  Spinner,
  SwitchRow,
  TextArea,
  TextInput,
} from "@/components/ui";

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
    <div>
      <PageHeader
        title="Challenge"
        description="The app shows the active challenge. Only one can be active at a time."
        actions={
          <Button
            variant="outline"
            icon={Plus}
            onClick={() => {
              closeModal();
              setAdding(true);
            }}
          >
            Add Challenge
          </Button>
        }
      />

      {error && !adding && !editing && (
        <Alert className="mb-6" onDismiss={() => setError("")}>
          {error}
        </Alert>
      )}

      {/* LIST */}
      {loading ? (
        <LoadingState label="Loading challenges…" />
      ) : challenges.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title="No challenges yet."
          description="The challenge section is hidden in the app until one is added."
        />
      ) : (
        <div className="grid items-start gap-5 md:grid-cols-2 xl:grid-cols-3">
          {challenges.map((challenge) => (
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
          ))}
        </div>
      )}

      {/* MODAL */}
      {(adding || editing) && (
        <Modal
          title={adding ? "Add Challenge" : "Edit Challenge"}
          size="md"
          onClose={closeModal}
          footer={
            <>
              <Button variant="light" onClick={closeModal}>
                Cancel
              </Button>
              <Button onClick={adding ? handleAdd : handleUpdate} loading={busy}>
                {busy ? (progress !== null ? `Uploading ${progress}%` : "Saving…") : "Save"}
              </Button>
            </>
          }
        >
          {error && (
            <Alert surface="light" className="mb-4">
              {error}
            </Alert>
          )}

          <Field label="Challenge name">
            <TextInput
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>

          <Field label="Description">
            <TextArea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>

          <Field label="Video URL">
            <TextInput
              value={form.videoUrl}
              onChange={(e) => setForm({ ...form, videoUrl: e.target.value })}
            />
          </Field>

          <Field
            label="…or upload a video"
            hint={file ? "The uploaded file replaces the URL above." : undefined}
          >
            <input
              type="file"
              accept="video/*"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className={fileInputClass}
            />
          </Field>

          {adding && (
            <SwitchRow
              title="Make this the active challenge"
              description="The current one is deactivated."
              checked={form.makeActive}
              onChange={(checked) => setForm({ ...form, makeActive: checked })}
            />
          )}

          {progress !== null && <ProgressBar value={progress} />}
        </Modal>
      )}

      {/* DELETE */}
      {deleting && (
        <Modal
          title="Delete challenge"
          size="sm"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button variant="light" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button variant="danger-solid" onClick={confirmDelete} loading={busy}>
                {busy ? "Deleting…" : "Delete"}
              </Button>
            </>
          }
        >
          <p>
            Delete <span className="font-semibold">{deleting.name || "this challenge"}</span>?
          </p>
          <p className="mt-2 text-sm text-black/60">
            Its video and all of its reviews are deleted too. This can&rsquo;t be undone.
          </p>
          {deleting.isActive && (
            <Alert tone="warning" surface="light" className="mt-4">
              {remainingAfterDelete.length > 0
                ? `This is the active challenge. "${remainingAfterDelete[0].name || "The newest remaining challenge"}" will become active instead.`
                : "This is the only challenge. The challenge section will be hidden in the app."}
            </Alert>
          )}
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
    <Card tone="cream" className="flex flex-col gap-4">
      {/* HEADER */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold">
            {challenge.name || "Untitled challenge"}
          </h3>
          {challenge.description && (
            <p className="mt-1 text-sm break-words text-black/60">{challenge.description}</p>
          )}
        </div>

        {challenge.isActive && (
          <Badge tone="green" className="shrink-0">
            Active
          </Badge>
        )}
      </div>

      {/* VIDEO */}
      {challenge.videoUrl ? (
        <video
          controls
          className="aspect-video w-full rounded-xl border border-black/10 bg-black"
          src={challenge.videoUrl}
        />
      ) : (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-black/20 bg-black/5 text-sm text-black/45">
          <VideoOff className="h-5 w-5" aria-hidden />
          No video
        </div>
      )}

      {/* INFO BAR */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-1.5 text-black/60">
          <MessageSquare className="h-4 w-4" aria-hidden />
          <span className="font-semibold text-black tabular-nums">{count ?? "–"}</span>
          <span>{count === 1 ? "Review" : "Reviews"}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!challenge.isActive && (
            <Button size="sm" variant="success" onClick={onSetActive} disabled={busy}>
              Set Active
            </Button>
          )}

          <Button
            size="sm"
            variant="light"
            icon={open ? ChevronUp : ChevronDown}
            onClick={toggleReviews}
          >
            {open ? "Hide Reviews" : "View Reviews"}
          </Button>
        </div>
      </div>

      {/* REVIEWS */}
      {open && (
        <div className="border-t border-black/10 pt-4">
          {loadingReviews || reviews === null ? (
            <p className="flex items-center gap-2 text-sm text-black/55">
              <Spinner className="h-4 w-4" />
              Loading reviews…
            </p>
          ) : reviews.length === 0 ? (
            <div className="rounded-xl border border-dashed border-black/15 bg-black/5 p-3 text-center text-sm text-black/50">
              No reviews yet
            </div>
          ) : (
            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {reviews.map((r) => {
                const stars = Math.max(0, Math.min(5, r.rating));
                return (
                  <div
                    key={r.id}
                    className="flex items-start justify-between gap-3 rounded-xl border border-black/5 bg-[#f5ecd7] px-3 py-2.5 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold">
                        {r.userName}
                        {stars > 0 && (
                          <span
                            className="inline-flex items-center gap-0.5"
                            aria-label={`${stars} out of 5 stars`}
                          >
                            {Array.from({ length: stars }, (_, i) => (
                              <Star
                                key={i}
                                className="h-3.5 w-3.5 fill-amber-500 text-amber-500"
                                aria-hidden
                              />
                            ))}
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 break-words text-black/75">{r.reviewText}</p>
                    </div>
                    <Button size="sm" variant="danger" onClick={() => deleteReview(r)}>
                      Delete
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ACTIONS */}
      <div className="flex justify-end gap-2 border-t border-black/10 pt-4">
        <Button size="sm" onClick={onEdit}>
          Edit
        </Button>
        <Button size="sm" variant="danger" onClick={onDelete}>
          Delete
        </Button>
      </div>
    </Card>
  );
}

/* UI */

/* Native file picker styled like the kit's outline button. */
const fileInputClass =
  "block w-full cursor-pointer text-sm text-black/60 file:mr-3 file:cursor-pointer file:rounded-xl file:border file:border-[#ff7a59] file:bg-transparent file:px-4 file:py-2 file:text-sm file:font-medium file:text-[#ff7a59] file:transition hover:file:bg-[#ff7a59] hover:file:text-white";

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-black/10">
      <div className="h-full rounded-full bg-[#ff7a59] transition-all" style={{ width: `${value}%` }} />
    </div>
  );
}
