"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  orderBy,
} from "firebase/firestore";
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import { serverTimestamp } from "firebase/firestore";
import { db, storage } from "@/lib/firebaseServices";

type Group = {
  id: string;
  name: string;
  description: string;
  image?: string;
  imagePath?: string;
  status: "active" | "inactive";
  createdAt?: any;
  memberCount?: number;
};

type Member = {
  id: string;
  userId: string;
  name: string;
  email: string;
  joinedAt?: any;
  status: "active" | "removed";
};

export default function Page() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [viewingMembers, setViewingMembers] = useState<Group | null>(null);

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Group | null>(null);
  const [deleting, setDeleting] = useState<Group | null>(null);

  const [loading, setLoading] = useState(true);
  const [saveLoading, setSaveLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [oldImage, setOldImage] = useState<string>("");

  const [form, setForm] = useState({
    name: "",
    description: "",
  });

  const [error, setError] = useState("");

  const [page, setPage] = useState(1);
  const perPage = 9;

  /* FETCH GROUPS */
  useEffect(() => {
    const fetchGroups = async () => {
      try {
        const groupsQuery = query(
          collection(db, "Groups"),
          orderBy("createdAt", "desc")
        );
        const snap = await getDocs(groupsQuery);

        const data = await Promise.all(
          snap.docs.map(async (d) => {
            const x = d.data();

            // Fetch member count for this group
            let memberCount = 0;
            try {
              const membersSnap = await getDocs(
                collection(db, "Groups", d.id, "members")
              );
              memberCount = membersSnap.docs.filter(
                (m) => m.data().status === "active"
              ).length;
            } catch (err) {
              console.error(`Error fetching members for group ${d.id}:`, err);
            }

            return {
              id: d.id,
              name: x.name || "",
              description: x.description || "",
              image: x.image || "",
              imagePath: x.imagePath || "",
              status: x.status || "active",
              createdAt: x.createdAt || null,
              memberCount: memberCount,
            };
          })
        );

        setGroups(data);
      } catch (err) {
        console.error("Error fetching groups:", err);
        setError("Failed to fetch groups");
      } finally {
        setLoading(false);
      }
    };

    fetchGroups();
  }, []);

  /* FETCH MEMBERS */
  const fetchMembers = async (groupId: string) => {
    try {
      const membersSnap = await getDocs(
        collection(db, "Groups", groupId, "members")
      );

      const data = membersSnap.docs.map((d) => {
        const x = d.data();
        return {
          id: d.id,
          userId: x.userId || "",
          name: x.name || "",
          email: x.email || "",
          joinedAt: x.joinedAt || null,
          status: x.status || "active",
        };
      });

      const activeMembers = data.filter((m) => m.status === "active");
      setMembers(activeMembers);
    } catch (err) {
      console.error("Error fetching members:", err);
      setError("Failed to fetch members");
    }
  };

  /* UPLOAD IMAGE */
  const uploadImage = async (): Promise<{ url: string; path: string }> => {
    if (!file) return { url: "", path: "" };

    try {
      const path = `groups/${Date.now()}-${file.name}`;
      const r = ref(storage, path);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      return { url, path };
    } catch (err) {
      console.error("Error uploading image:", err);
      throw new Error("Failed to upload image");
    }
  };

  /* DELETE IMAGE */
  const deleteImage = async (path: string) => {
    if (!path) return;
    try {
      await deleteObject(ref(storage, path));
    } catch (err) {
      console.error("Error deleting image:", err);
    }
  };

  /* ADD GROUP */
  const handleAdd = async () => {
    setError("");
    if (!form.name.trim()) {
      setError("Group name is required");
      return;
    }

    try {
      setSaveLoading(true);

      let imageUrl = "";
      let imagePath = "";

      if (file) {
        const upload = await uploadImage();
        imageUrl = upload.url;
        imagePath = upload.path;
      }

      const newGroup = {
        name: form.name.trim(),
        description: form.description.trim(),
        image: imageUrl,
        imagePath: imagePath,
        status: "active",
        createdAt: serverTimestamp(),
      };

      const docRef = await addDoc(collection(db, "Groups"), newGroup);

      setGroups((prev) => [
        {
          id: docRef.id,
          ...newGroup,
          createdAt: new Date(),
          memberCount: 0,
        } as Group,
        ...prev,
      ]);

      closeModal();
    } catch (err) {
      console.error("Error adding group:", err);
      setError("Failed to create group");
    } finally {
      setSaveLoading(false);
    }
  };

  /* EDIT GROUP */
  const handleEdit = async () => {
    setError("");
    if (!form.name.trim()) {
      setError("Group name is required");
      return;
    }

    if (!editing) return;

    try {
      setSaveLoading(true);

      let imageUrl = editing.image;
      let imagePath = editing.imagePath;

      if (file) {
        if (editing.imagePath) {
          await deleteImage(editing.imagePath);
        }
        const upload = await uploadImage();
        imageUrl = upload.url;
        imagePath = upload.path;
      }

      const updatedData = {
        name: form.name.trim(),
        description: form.description.trim(),
        image: imageUrl,
        imagePath: imagePath,
      };

      await updateDoc(doc(db, "Groups", editing.id), updatedData);

      setGroups((prev) =>
        prev.map((g) =>
          g.id === editing.id ? { ...g, ...updatedData } : g
        )
      );

      closeModal();
    } catch (err) {
      console.error("Error updating group:", err);
      setError("Failed to update group");
    } finally {
      setSaveLoading(false);
    }
  };

  /* TOGGLE STATUS */
  const toggleStatus = async (group: Group) => {
    try {
      const newStatus = group.status === "active" ? "inactive" : "active";
      await updateDoc(doc(db, "Groups", group.id), { status: newStatus });

      setGroups((prev) =>
        prev.map((g) =>
          g.id === group.id ? { ...g, status: newStatus } : g
        )
      );
    } catch (err) {
      console.error("Error toggling status:", err);
      setError("Failed to update status");
    }
  };

  /* DELETE GROUP */
  const confirmDelete = async () => {
    if (!deleting) return;

    try {
      setDeleteLoading(true);

      if (deleting.imagePath) {
        await deleteImage(deleting.imagePath);
      }

      await deleteDoc(doc(db, "Groups", deleting.id));

      setGroups((prev) => prev.filter((g) => g.id !== deleting.id));
      setDeleting(null);
    } catch (err) {
      console.error("Error deleting group:", err);
      setError("Failed to delete group");
    } finally {
      setDeleteLoading(false);
    }
  };

  /* REMOVE MEMBER */
  const removeMember = async (memberId: string) => {
    if (!viewingMembers) return;

    try {
      await updateDoc(
        doc(db, "Groups", viewingMembers.id, "members", memberId),
        { status: "removed" }
      );

      setMembers((prev) => prev.filter((m) => m.id !== memberId));

      // Update member count for this group
      setGroups((prev) =>
        prev.map((g) =>
          g.id === viewingMembers.id
            ? {
                ...g,
                memberCount: Math.max(0, (g.memberCount || 0) - 1),
              }
            : g
        )
      );
    } catch (err) {
      console.error("Error removing member:", err);
      setError("Failed to remove member");
    }
  };

  /* CLOSE MODAL */
  const closeModal = () => {
    setAdding(false);
    setEditing(null);
    setFile(null);
    setOldImage("");
    setForm({ name: "", description: "" });
    setError("");
  };

  /* OPEN EDIT MODAL */
  const openEdit = (group: Group) => {
    setEditing(group);
    setForm({
      name: group.name,
      description: group.description,
    });
    setOldImage(group.image || "");
    setAdding(false);
  };

  /* OPEN MEMBERS MODAL */
  const openMembers = async (group: Group) => {
    setViewingMembers(group);
    await fetchMembers(group.id);
  };

  /* PAGINATION */
  const totalPages = Math.max(1, Math.ceil(groups.length / perPage));

  const paginated = useMemo(() => {
    const start = (page - 1) * perPage;
    return groups.slice(start, start + perPage);
  }, [groups, page]);

  return (
    <div className="px-2 pt-4 pb-8 sm:px-6 sm:pt-6 sm:pb-10">
      {/* HEADER */}
      <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[#ff7a59] sm:text-4xl lg:text-5xl">
            Groups
          </h1>
          <p className="mt-2 text-base text-[#e8dcc7] sm:text-lg">
            Manage community groups for the mobile app.
          </p>
        </div>

        <button
          onClick={() => {
            setAdding(true);
            setEditing(null);
            setForm({ name: "", description: "" });
            setFile(null);
            setError("");
          }}
          className="self-start rounded-xl border border-[#ff7a59] px-4 py-2 text-sm text-[#ff7a59] hover:bg-[#ff7a59] hover:text-white sm:self-auto sm:px-5 sm:text-base"
        >
          + Create Group
        </button>
      </div>

      {/* TABLE */}
      <section className="rounded-3xl border border-[#ff7a59]/40 bg-[#0a0a0a] p-4 sm:p-6">
        <h2 className="mb-6 text-xl font-bold text-[#ff7a59] sm:text-2xl lg:text-3xl">
          All Groups ({groups.length})
        </h2>

        {loading ? (
          <p className="text-[#f3ead7]">Loading...</p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-2xl border border-white/10">
              <table className="w-full min-w-[800px] text-left">
                <thead className="bg-[#ece2cb] text-black">
                  <tr>
                    <th className="p-3">Name</th>
                    <th className="p-3">Description</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Members</th>
                    <th className="p-3">Created</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {paginated.map((g) => (
                    <tr
                      key={g.id}
                      className="border-b bg-[#ece2cb] text-black hover:bg-[#f5ecd7]"
                    >
                      <td className="p-3 font-semibold">{g.name}</td>
                      <td className="p-3 text-sm max-w-xs truncate">
                        {g.description || "-"}
                      </td>
                      <td className="p-3">
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-semibold ${
                            g.status === "active"
                              ? "bg-green-500/20 text-green-400"
                              : "bg-red-500/20 text-red-400"
                          }`}
                        >
                          {g.status === "active" ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="p-3 text-sm">{g.memberCount || 0}</td>
                      <td className="p-3 text-black/60">
                        {g.createdAt?.toDate
                          ? g.createdAt.toDate().toLocaleDateString()
                          : "-"}
                      </td>

                      <td className="p-3 text-right">
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => openEdit(g)}
                            className="rounded-lg bg-[#ff7a59] px-2 py-1 text-white text-xs"
                          >
                            Edit
                          </button>

                          <button
                            onClick={() => toggleStatus(g)}
                            className={`rounded-lg px-2 py-1 text-white text-xs ${
                              g.status === "active"
                                ? "bg-red-600"
                                : "bg-green-600"
                            }`}
                          >
                            {g.status === "active" ? "Deactivate" : "Activate"}
                          </button>

                          <button
                            onClick={() => openMembers(g)}
                            className="rounded-lg bg-blue-600 px-2 py-1 text-white text-xs"
                          >
                            Members
                          </button>

                          <button
                            onClick={() => setDeleting(g)}
                            className="rounded-lg bg-red-600 px-2 py-1 text-white text-xs hover:bg-red-700"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* PAGINATION */}
            <div className="mt-8 flex flex-col md:flex-row justify-between items-center gap-4 text-[#f3ead7]">
              <p className="text-sm text-[#f3ead7]/70">
                Showing {(page - 1) * perPage + 1}–
                {Math.min(page * perPage, groups.length)} of {groups.length}
              </p>

              <div className="flex gap-2">
                <button
                  disabled={page === 1}
                  onClick={() => setPage(page - 1)}
                  className="px-3 py-1 border border-white/10 rounded-lg disabled:opacity-30"
                >
                  Prev
                </button>

                {Array.from({ length: totalPages }).map((_, i) => {
                  const p = i + 1;

                  if (
                    p !== 1 &&
                    p !== totalPages &&
                    Math.abs(p - page) > 1
                  )
                    return null;

                  return (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      className={`px-3 py-1 rounded-lg ${
                        page === p
                          ? "bg-[#ff7a59] text-white"
                          : "border border-white/10"
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}

                <button
                  disabled={page === totalPages}
                  onClick={() => setPage(page + 1)}
                  className="px-3 py-1 border border-white/10 rounded-lg disabled:opacity-30"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {/* CREATE/EDIT MODAL */}
      {(adding || editing) && (
        <Modal title={editing ? "Edit Group" : "Create Group"} onClose={closeModal}>
          {error && (
            <p className="mb-4 p-3 bg-red-500/20 text-red-400 rounded-lg text-sm">
              {error}
            </p>
          )}

          <div className="space-y-4">
            <Input
              label="Group Name *"
              value={form.name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, name: e.target.value })}
              placeholder="Enter group name"
            />

            <Textarea
              label="Description"
              value={form.description}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                setForm({ ...form, description: e.target.value })
              }
              placeholder="Enter group description (optional)"
            />

            <div>
              <label className="block text-sm font-semibold text-black mb-2">
                Group Image (optional)
              </label>
              {(file || oldImage) && (
                <div className="mb-3 relative w-20 h-20">
                  <img
                    src={
                      file
                        ? URL.createObjectURL(file)
                        : oldImage
                    }
                    alt="preview"
                    className="w-full h-full object-cover rounded-lg"
                  />
                  <button
                    onClick={() => setFile(null)}
                    className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs"
                  >
                    ✕
                  </button>
                </div>
              )}
              <label className="block cursor-pointer">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
                <span className="inline-block px-4 py-2 bg-[#ff7a59] text-white rounded-lg text-sm">
                  Choose Image
                </span>
              </label>
            </div>
          </div>

          <button
            onClick={editing ? handleEdit : handleAdd}
            disabled={saveLoading}
            className="mt-6 w-full bg-[#ff7a59] text-white py-3 rounded-xl font-semibold disabled:opacity-50"
          >
            {saveLoading ? "Saving..." : "Save Group"}
          </button>
        </Modal>
      )}

      {/* DELETE MODAL */}
      {deleting && (
        <Modal title="Delete Group" onClose={() => setDeleting(null)}>
          <p className="text-black mb-6">
            Are you sure you want to delete <b>{deleting.name}</b>? This action
            cannot be undone.
          </p>

          <div className="flex gap-3">
            <button
              onClick={() => setDeleting(null)}
              className="flex-1 px-4 py-2 border border-black rounded-lg text-black"
            >
              Cancel
            </button>

            <button
              onClick={confirmDelete}
              disabled={deleteLoading}
              className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg disabled:opacity-50"
            >
              {deleteLoading ? "Deleting..." : "Delete"}
            </button>
          </div>
        </Modal>
      )}

      {/* MEMBERS MODAL */}
      {viewingMembers && (
        <Modal
          title={`Members of ${viewingMembers.name}`}
          onClose={() => {
            setViewingMembers(null);
            setMembers([]);
          }}
        >
          {members.length === 0 ? (
            <p className="text-black text-center py-6">No members yet</p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b bg-[#efe5cf]">
                    <th className="p-2">Name</th>
                    <th className="p-2">Email</th>
                    <th className="p-2">Joined</th>
                    <th className="p-2 text-right">Action</th>
                  </tr>
                </thead>

                <tbody>
                  {members.map((m) => (
                    <tr key={m.id} className="border-b">
                      <td className="p-2 font-semibold">{m.name}</td>
                      <td className="p-2 text-xs">{m.email}</td>
                      <td className="p-2 text-xs">
                        {m.joinedAt?.toDate
                          ? m.joinedAt.toDate().toLocaleDateString()
                          : "-"}
                      </td>

                      <td className="p-2 text-right">
                        <button
                          onClick={() => removeMember(m.id)}
                          className="text-red-600 text-xs hover:underline"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

/* MODAL */
function Modal({ children, title, onClose }: any) {
  return (
    <div className="fixed inset-0 bg-black/70 flex justify-center items-center z-50">
      <div className="bg-[#e8dcc7] p-6 rounded-3xl w-[90%] max-w-lg text-black">
        <div className="flex justify-between mb-4">
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

/* INPUT */
function Input({ label, ...props }: { label: string; [key: string]: any }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-black mb-2">
        {label}
      </label>
      <input
        {...props}
        className="w-full px-4 py-2 border border-black/20 rounded-lg text-black placeholder-black/50"
      />
    </div>
  );
}

/* TEXTAREA */
function Textarea({ label, ...props }: { label: string; [key: string]: any }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-black mb-2">
        {label}
      </label>
      <textarea
        {...props}
        rows={3}
        className="w-full px-4 py-2 border border-black/20 rounded-lg text-black placeholder-black/50"
      />
    </div>
  );
}
