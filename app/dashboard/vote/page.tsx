"use client";

import { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
} from "firebase/firestore";

import { db } from "@/lib/firebaseServices";

/* TYPES */
type Vote = {
  id: string;
  title: string;
  link: string;
};

export default function Page() {
  const [votes, setVotes] = useState<Vote[]>([]);
  const [form, setForm] = useState({ title: "", link: "" });

  const [editing, setEditing] = useState<Vote | null>(null);
  const [deleting, setDeleting] = useState<Vote | null>(null);

  const [loading, setLoading] = useState(false);

  /* FETCH */
  useEffect(() => {
    const fetchVotes = async () => {
      const snap = await getDocs(collection(db, "vote"));
      const data = snap.docs.map((d) => ({
        id: d.id,
        title: d.data().title,
        link: d.data().link,
      }));
      setVotes(data);
    };

    fetchVotes();
  }, []);

  /* ADD / UPDATE */
  const handleSubmit = async () => {
    if (!form.title || !form.link) return;

    setLoading(true);

    if (editing) {
      await updateDoc(doc(db, "vote", editing.id), {
        title: form.title,
        link: form.link,
      });

      setVotes((prev) =>
        prev.map((v) =>
          v.id === editing.id ? { ...v, ...form } : v
        )
      );
    } else {
      const docRef = await addDoc(collection(db, "vote"), {
        title: form.title,
        link: form.link,
      });

      setVotes((prev) => [
        { id: docRef.id, ...form },
        ...prev,
      ]);
    }

    setLoading(false);
    setEditing(null);
    setForm({ title: "", link: "" });
  };

  /* The app shows exactly one item: the first by `link`, alphabetically. */
  const liveId = votes
    .filter((v) => typeof v.link === "string")
    .reduce<Vote | null>((first, v) => (!first || v.link < first.link ? v : first), null)?.id;

  /* DELETE */
  const confirmDelete = async () => {
    if (!deleting) return;

    setLoading(true);

    await deleteDoc(doc(db, "vote", deleting.id));

    setVotes((prev) =>
      prev.filter((v) => v.id !== deleting.id)
    );

    setDeleting(null);
    setLoading(false);
  };

  return (
    <div className="px-4 pt-6 pb-10 md:px-8">

      {/* HEADER */}
      <div>
        <h1 className="text-4xl font-bold tracking-tight text-[#ff7a59] md:text-5xl">
          Vote For Your Favorite
        </h1>

        <p className="mt-2 text-lg font-medium text-[#e8dcc7] md:text-xl">
          Submit a link that users can vote for.
        </p>
        <p className="mt-1 text-sm text-[#e8dcc7]/70">
          The app shows one link only: the first alphabetically. Delete the
          others, or the one marked &ldquo;Live in app&rdquo;, to change it.
        </p>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-2">

        {/* FORM */}
        <div className="rounded-2xl border border-[#ff7a59]/60 bg-[#0a0a0a] p-6">
          <h2 className="mb-6 text-xl font-semibold text-white">
            {editing ? "Update Vote" : "What would you like to submit?"}
          </h2>

          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-[#f3ead7]">
                Title
              </label>

              <input
                value={form.title}
                onChange={(e) =>
                  setForm({ ...form, title: e.target.value })
                }
                className="mt-2 w-full rounded-lg border border-white/20 bg-black px-4 py-3 text-sm text-white outline-none focus:border-[#ff7a59]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#f3ead7]">
                Add Link
              </label>

              <input
                value={form.link}
                onChange={(e) =>
                  setForm({ ...form, link: e.target.value })
                }
                className="mt-2 w-full rounded-lg border border-white/20 bg-black px-4 py-3 text-sm text-white outline-none focus:border-[#ff7a59]"
              />
            </div>

            <button
              onClick={handleSubmit}
              disabled={loading}
              className="mt-2 inline-flex items-center justify-center rounded-lg bg-[#ff7a59] px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90"
            >
              {loading ? <Spinner /> : editing ? "Update" : "Submit"}
            </button>
          </div>
        </div>

        {/* LIST */}
        <div className="space-y-4">
          {votes.map((vote) => (
            <VoteCard
              key={vote.id}
              {...vote}
              live={vote.id === liveId}
              onEdit={() => {
                setEditing(vote);
                setForm({ title: vote.title, link: vote.link });
              }}
              onDelete={() => setDeleting(vote)}
            />
          ))}
        </div>
      </div>

      {/* DELETE MODAL */}
      {deleting && (
        <Modal title="Delete Vote" onClose={() => setDeleting(null)}>
          <p className="text-black">
            Delete <b>{deleting.title}</b>?
          </p>

          <div className="flex gap-3 mt-6">
            <button
              onClick={() => setDeleting(null)}
              className="w-full border py-2 rounded-lg"
            >
              Cancel
            </button>

            <button
              onClick={confirmDelete}
              disabled={loading}
              className="w-full bg-red-500 text-white py-2 rounded-lg flex justify-center"
            >
              {loading ? <Spinner /> : "Delete"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* CARD */
function VoteCard({ title, link, live, onEdit, onDelete }: any) {
  return (
    <div className="rounded-xl bg-[#ff7a59] p-5 text-white">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-semibold md:text-base">
          {title}
          {live && (
            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase text-[#ff7a59]">
              Live in app
            </span>
          )}
        </span>

        <div className="flex items-center gap-3">
          <button onClick={onEdit} aria-label="Edit">
            ✏️
          </button>

          <button onClick={onDelete} aria-label="Delete">
            🗑️
          </button>
        </div>
      </div>

      <a
        href={link}
        target="_blank"
        className="mt-2 block text-xs text-white/80 underline"
      >
        {link}
      </a>
    </div>
  );
}

/* MODAL */
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

/* SPINNER */
function Spinner() {
  return (
    <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
  );
}