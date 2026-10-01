"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Heart } from "lucide-react";
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
} from "firebase/firestore";

import { db } from "@/lib/firebaseServices";
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
  TextInput,
} from "@/components/ui";

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
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");

  /* FETCH */
  useEffect(() => {
    const fetchVotes = async () => {
      try {
        const snap = await getDocs(collection(db, "vote"));
        const data = snap.docs.map((d) => ({
          id: d.id,
          title: d.data().title,
          link: d.data().link,
        }));
        setVotes(data);
      } catch (err) {
        console.error(err);
        setListError("Failed to load vote links.");
      } finally {
        setListLoading(false);
      }
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
    <div>
      <PageHeader
        title="Vote For Your Favorite"
        description="Submit a link that users can vote for."
      >
        <p className="mt-1 text-sm text-[#e8dcc7]/70">
          The app shows one link only: the first alphabetically. Delete the
          others, or the one marked &ldquo;Live in app&rdquo;, to change it.
        </p>
      </PageHeader>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        {/* FORM */}
        <Card title={editing ? "Update Vote" : "What would you like to submit?"}>
          <Field label="Title" tone="dark">
            <TextInput
              tone="dark"
              value={form.title}
              onChange={(e) =>
                setForm({ ...form, title: e.target.value })
              }
            />
          </Field>

          <Field label="Add Link" tone="dark">
            <TextInput
              tone="dark"
              value={form.link}
              onChange={(e) =>
                setForm({ ...form, link: e.target.value })
              }
            />
          </Field>

          <div className="mt-6 flex justify-end">
            <Button onClick={handleSubmit} loading={loading}>
              {editing ? "Update" : "Submit"}
            </Button>
          </div>
        </Card>

        {/* LIST */}
        <div className="space-y-3">
          {listError && (
            <Alert onDismiss={() => setListError("")}>{listError}</Alert>
          )}
          {listLoading ? (
            <LoadingState label="Loading vote links…" />
          ) : (
            votes.length === 0 && <EmptyState icon={Heart} title="No vote links yet." />
          )}
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
        <Modal
          title="Delete Vote"
          size="sm"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button variant="light" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button variant="danger-solid" onClick={confirmDelete} loading={loading}>
                Delete
              </Button>
            </>
          }
        >
          <p>
            Delete <span className="font-semibold">{deleting.title}</span>?
          </p>
        </Modal>
      )}
    </div>
  );
}

/* CARD */
function VoteCard({
  title,
  link,
  live,
  onEdit,
  onDelete,
}: Vote & { live: boolean; onEdit: () => void; onDelete: () => void }) {
  return (
    <Card tone="cream">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold break-words">{title}</span>
            {live && <Badge tone="green">Live in app</Badge>}
          </div>

          <a
            href={link}
            target="_blank"
            className="mt-1.5 inline-flex max-w-full items-start gap-1.5 text-xs text-black/60 underline transition hover:text-[#ff7a59]"
          >
            <ExternalLink className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="break-all">{link}</span>
          </a>
        </div>

        <div className="flex shrink-0 gap-2">
          <Button size="sm" onClick={onEdit}>
            Edit
          </Button>
          <Button size="sm" variant="danger" onClick={onDelete}>
            Delete
          </Button>
        </div>
      </div>
    </Card>
  );
}
