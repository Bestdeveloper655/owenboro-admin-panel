"use client";

import { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";

import {
  ref,
  uploadBytes,
  getDownloadURL,
} from "firebase/storage";

import { db, storage } from "@/lib/firebaseServices";

/* TYPES */
type Challenge = {
  id: string;
  title: string;
  video: string;
  isActive: boolean;
  reviews?: string[];
};

export default function Page() {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Challenge | null>(null);
  const [deleting, setDeleting] = useState<Challenge | null>(null);

  const [form, setForm] = useState({
    title: "",
    video: "",
  });

  const [file, setFile] = useState<File | null>(null);

  /* FETCH */
  useEffect(() => {
    const fetchData = async () => {
      const q = query(
        collection(db, "challenges"),
        orderBy("createdAt", "desc")
      );

      const snap = await getDocs(q);

      const data = snap.docs.map((d) => {
        const x = d.data();

        return {
          id: d.id,
          title: x.title,
          video: x.video,
          isActive: x.isActive || false,
          reviews: x.reviews || [],
        };
      });

      setChallenges(data);
    };

    fetchData();
  }, []);

  /* UPLOAD VIDEO */
  const uploadVideo = async () => {
    if (!file) return "";

    const storageRef = ref(
      storage,
      `challenges/${Date.now()}-${file.name}`
    );

    await uploadBytes(storageRef, file);
    return await getDownloadURL(storageRef);
  };

  /* SET ACTIVE */
  const setActiveChallenge = async (id: string) => {
    const snap = await getDocs(collection(db, "challenges"));

    await Promise.all(
      snap.docs.map((d) =>
        updateDoc(doc(db, "challenges", d.id), {
          isActive: d.id === id,
        })
      )
    );

    setChallenges((prev) =>
      prev.map((c) => ({
        ...c,
        isActive: c.id === id,
      }))
    );
  };

  /* ADD (AUTO ACTIVE) */
  const handleAdd = async () => {
    let videoUrl = form.video;

    if (file) {
      videoUrl = await uploadVideo();
    }

    if (!form.title || !videoUrl) return;

    // deactivate all
    const snap = await getDocs(collection(db, "challenges"));

    await Promise.all(
      snap.docs.map((d) =>
        updateDoc(doc(db, "challenges", d.id), {
          isActive: false,
        })
      )
    );

    // create new active
    const docRef = await addDoc(collection(db, "challenges"), {
      title: form.title,
      video: videoUrl,
      createdAt: serverTimestamp(),
      isActive: true,
      reviews: [],
    });

    setChallenges((prev) => [
      {
        id: docRef.id,
        title: form.title,
        video: videoUrl,
        isActive: true,
        reviews: [],
      },
      ...prev.map((c) => ({ ...c, isActive: false })),
    ]);

    closeModal();
  };

  /* UPDATE */
  const handleUpdate = async () => {
    if (!editing) return;

    let videoUrl = editing.video;

    if (file) {
      videoUrl = await uploadVideo();
    }

    await updateDoc(doc(db, "challenges", editing.id), {
      title: form.title,
      video: videoUrl,
    });

    setChallenges((prev) =>
      prev.map((c) =>
        c.id === editing.id
          ? { ...c, title: form.title, video: videoUrl }
          : c
      )
    );

    closeModal();
  };

  /* DELETE */
  const confirmDelete = async () => {
    if (!deleting) return;

    await deleteDoc(doc(db, "challenges", deleting.id));

    setChallenges((prev) =>
      prev.filter((c) => c.id !== deleting.id)
    );

    setDeleting(null);
  };

  const closeModal = () => {
    setAdding(false);
    setEditing(null);
    setForm({ title: "", video: "" });
    setFile(null);
  };

  return (
    <div className="px-4 pt-6 pb-10 md:px-8">

      {/* HEADER */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-3xl font-bold text-[#ff7a59] sm:text-4xl">
          Challenge
        </h1>

        <button
          onClick={() => setAdding(true)}
          className="self-start rounded-xl border border-[#ff7a59] px-4 py-2 text-sm text-[#ff7a59] transition hover:bg-[#ff7a59] hover:text-white sm:self-auto sm:px-5 sm:text-base"
        >
          Add Challenge
        </button>
      </div>

      {/* LIST */}
      <section className="mt-10 space-y-6">
        {challenges.map((challenge) => (
          <ChallengeCard
            key={challenge.id}
            {...challenge}
            onEdit={() => {
              setEditing(challenge);
              setForm({
                title: challenge.title,
                video: challenge.video,
              });
            }}
            onDelete={() => setDeleting(challenge)}
            onSetActive={() => setActiveChallenge(challenge.id)}
          />
        ))}
      </section>

      {/* MODAL */}
      {(adding || editing) && (
        <Modal title="Challenge" onClose={closeModal}>
          <Input
            label="Title"
            value={form.title}
            onChange={(v: string) =>
              setForm({ ...form, title: v })
            }
          />

          <Input
            label="Video URL"
            value={form.video}
            onChange={(v: string) =>
              setForm({ ...form, video: v })
            }
          />

          <input
            type="file"
            accept="video/*"
            onChange={(e) =>
              setFile(e.target.files?.[0] || null)
            }
            className="mt-3"
          />

          <button
            onClick={adding ? handleAdd : handleUpdate}
            className="mt-6 w-full bg-[#ff7a59] text-white py-3 rounded-xl"
          >
            Save
          </button>
        </Modal>
      )}

      {/* DELETE */}
      {deleting && (
        <Modal title="Delete" onClose={() => setDeleting(null)}>
          <button
            onClick={confirmDelete}
            className="w-full bg-red-500 text-white py-2 rounded-xl"
          >
            Delete
          </button>
        </Modal>
      )}
    </div>
  );
}

/* CARD */
function ChallengeCard({
  title,
  video,
  isActive,
  reviews = [],
  onEdit,
  onDelete,
  onSetActive,
}: any) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-2xl border border-[#ff7a59]/60 bg-[#0a0a0a] p-6 space-y-5">

      {/* HEADER */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white truncate">
          {title}
        </h3>

        {isActive && (
          <span className="text-xs bg-green-500/20 text-green-400 px-3 py-1 rounded-full">
            Active
          </span>
        )}
      </div>

      {/* VIDEO */}
      <video controls className="w-full rounded-xl">
        <source src={video} />
      </video>

      {/* INFO BAR */}
      <div className="flex items-center justify-between text-sm text-[#f3ead7]">

        <div className="flex items-center gap-2">
          <span className="font-medium">{reviews.length}</span>
          <span className="text-white/60">
            {reviews.length === 1 ? "Comment" : "Comments"}
          </span>
        </div>

        <div className="flex items-center gap-2">

          {!isActive && (
            <button
              onClick={onSetActive}
              className="rounded-lg bg-[#ff7a59] px-3 py-1 text-xs font-semibold text-white"
            >
              Set Active
            </button>
          )}

          <button
            onClick={() => setOpen(!open)}
            className="rounded-lg border border-white/20 px-3 py-1 text-xs text-white"
          >
            {open ? "Hide Comments" : "View Comments"}
          </button>
        </div>
      </div>

      {/* COMMENTS */}
      {open && (
        <div className="border-t border-white/10 pt-4">

          {reviews.length === 0 ? (
            <div className="rounded-lg bg-white/5 p-3 text-sm text-white/50 text-center">
              No comments yet
            </div>
          ) : (
            <div className="max-h-44 space-y-2 overflow-y-auto">
              {reviews.map((comment: string, i: number) => (
                <div
                  key={i}
                  className="rounded-lg bg-[#ece2cb] px-3 py-2 text-sm text-black"
                >
                  {comment}
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
    <div className="fixed inset-0 bg-black/70 flex justify-center items-center">
      <div className="bg-[#e8dcc7] p-6 rounded-3xl w-[90%] max-w-lg text-black">
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