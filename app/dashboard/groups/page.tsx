"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  collection,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  setDoc,
  doc,
  query,
  orderBy,
  onSnapshot,
} from "firebase/firestore";
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import { serverTimestamp } from "firebase/firestore";
import {
  Check,
  ImagePlus,
  MoreVertical,
  Pause,
  Play,
  Plus,
  Power,
  Search,
  Trash2,
  Users,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { auth, db, storage } from "@/lib/firebaseServices";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  FormSection,
  LoadingState,
  Modal,
  PageHeader,
  Pagination,
  SectionHeading,
  SelectInput,
  Spinner,
  Switch,
  TextArea,
  TextInput,
  buttonClass,
  cx,
  table,
} from "@/components/ui";

/**
 * This user is automatically added as an admin member to every group the
 * admin creates. A backfill script (scripts/addDefaultUserToGroups.js) adds
 * them to any groups that already existed.
 */
const DEFAULT_MEMBER_UID = "KBXvaPEvJ0UL6rm8A7hwzAHqzV92";
const DEFAULT_MEMBER_EMAIL = "info@theowensboroapp.com";

const MAX_FEATURED = 3;

/** Add the default member to a freshly created group. */
async function addDefaultMember(groupId: string) {
  try {
    let name = "";
    let email = DEFAULT_MEMBER_EMAIL;
    try {
      const userSnap = await getDoc(doc(db, "Users", DEFAULT_MEMBER_UID));
      if (userSnap.exists()) {
        const u = userSnap.data();
        name = u.display_name || u.full_name || "";
        email = u.email || DEFAULT_MEMBER_EMAIL;
      }
    } catch (e) {
      console.error("Could not load default member profile:", e);
    }

    await setDoc(
      doc(db, "Groups", groupId, "members", DEFAULT_MEMBER_UID),
      {
        userId: DEFAULT_MEMBER_UID,
        name,
        email,
        joinedAt: serverTimestamp(),
        status: "active",
        role: "admin",
      },
      { merge: true }
    );
  } catch (err) {
    console.error("Failed to add default member to group:", err);
  }
}

type FeaturedListing = { id: string; name: string; image: string };

type Group = {
  id: string;
  name: string;
  description: string;
  image?: string;
  imagePath?: string;
  status: "active" | "inactive";
  createdAt?: any;
  memberCount?: number;
  messagingPaused: boolean;
  featuredListings: FeaturedListing[];
  /** Restrict visibility/membership to one gender ("Female" | "Male").
   *  Empty = open to everyone. Enforced in the app and firestore.rules. */
  allowedGender?: string;
};

type Member = {
  id: string;
  userId: string;
  name: string;
  email: string;
  joinedAt?: any;
  status: "active" | "removed" | "blocked";
  /* Group-block progress written by the Cloud Function
   * (docs/user-blocking-contract.md §2). */
  blockState?: string;
  blockReason?: string;
};

type Listing = { id: string; name: string; image: string };

export default function Page() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [viewingMembers, setViewingMembers] = useState<Group | null>(null);

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Group | null>(null);
  const [deleting, setDeleting] = useState<Group | null>(null);
  const [listingFor, setListingFor] = useState<Group | null>(null);

  const [loading, setLoading] = useState(true);
  const [saveLoading, setSaveLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [oldImage, setOldImage] = useState<string>("");

  const [form, setForm] = useState({
    name: "",
    description: "",
    allowedGender: "",
  });
  const [error, setError] = useState("");

  // 3-dot action menu (anchored, fixed-position to avoid table clipping).
  const [menu, setMenu] = useState<{ group: Group; x: number; y: number } | null>(
    null,
  );

  // Global "pause all messaging" flag from app_config/mobile.
  const [pauseAll, setPauseAll] = useState(false);
  const [pauseAllBusy, setPauseAllBusy] = useState(false);

  const [page, setPage] = useState(1);
  const perPage = 25;

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
              memberCount,
              messagingPaused: x.messaging_paused === true,
              featuredListings: Array.isArray(x.featured_listings)
                ? (x.featured_listings as FeaturedListing[])
                : [],
              allowedGender: x.allowedGender || "",
            } as Group;
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

  /* GLOBAL PAUSE — live read of app_config/mobile (client read is allowed) */
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "app_config", "mobile"), (snap) => {
      setPauseAll(snap.data()?.messaging_paused === true);
    });
    return () => unsub();
  }, []);

  const togglePauseAll = async () => {
    const next = !pauseAll;
    setPauseAllBusy(true);
    try {
      // Written directly by the signed-in moderator/admin; Firestore rules
      // permit toggling only this flag on app_config/mobile. setDoc(merge)
      // creates the doc on the very first toggle if it doesn't exist yet.
      await setDoc(
        doc(db, "app_config", "mobile"),
        { messaging_paused: next, updatedAt: serverTimestamp() },
        { merge: true },
      );
      // onSnapshot will reflect the new value; set optimistically too.
      setPauseAll(next);
    } catch (e) {
      console.error(e);
      setError(
        "Failed to update global messaging pause. Make sure the app config exists (App Config page).",
      );
    } finally {
      setPauseAllBusy(false);
    }
  };

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
          blockState: x.blockState || "",
          blockReason: "",
        };
      });
      // Block reasons live in a staff-only subcollection: member docs are
      // readable by every app user (docs/user-blocking-contract.md §2.1).
      const reasons = new Map<string, string>();
      if (data.some((m) => m.status === "blocked")) {
        try {
          const blocksSnap = await getDocs(
            collection(db, "Groups", groupId, "member_blocks")
          );
          blocksSnap.docs.forEach((d) => reasons.set(d.id, d.data().reason || ""));
        } catch (err) {
          console.error("Could not load block reasons:", err);
        }
      }
      setMembers(
        data
          .filter((m) => m.status === "active" || m.status === "blocked")
          .map((m) => ({ ...m, blockReason: reasons.get(m.id) ?? "" }))
      );
    } catch (err) {
      console.error("Error fetching members:", err);
      setError("Failed to fetch members");
    }
  };

  /* UPLOAD / DELETE IMAGE */
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
        imagePath,
        status: "active",
        createdAt: serverTimestamp(),
        allowedGender: form.allowedGender,
      };

      const docRef = await addDoc(collection(db, "Groups"), newGroup);
      await addDefaultMember(docRef.id);

      setGroups((prev) => [
        {
          id: docRef.id,
          ...newGroup,
          createdAt: new Date(),
          memberCount: 1,
          messagingPaused: false,
          featuredListings: [],
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
        if (editing.imagePath) await deleteImage(editing.imagePath);
        const upload = await uploadImage();
        imageUrl = upload.url;
        imagePath = upload.path;
      }

      const updatedData = {
        name: form.name.trim(),
        description: form.description.trim(),
        image: imageUrl,
        imagePath,
        allowedGender: form.allowedGender,
      };

      await updateDoc(doc(db, "Groups", editing.id), updatedData);
      setGroups((prev) =>
        prev.map((g) => (g.id === editing.id ? { ...g, ...updatedData } : g))
      );
      closeModal();
    } catch (err) {
      console.error("Error updating group:", err);
      setError("Failed to update group");
    } finally {
      setSaveLoading(false);
    }
  };

  /* TOGGLE STATUS (activate / deactivate) */
  const toggleStatus = async (group: Group) => {
    try {
      const newStatus = group.status === "active" ? "inactive" : "active";
      await updateDoc(doc(db, "Groups", group.id), { status: newStatus });
      setGroups((prev) =>
        prev.map((g) => (g.id === group.id ? { ...g, status: newStatus } : g))
      );
    } catch (err) {
      console.error("Error toggling status:", err);
      setError("Failed to update status");
    }
  };

  /* TOGGLE PER-GROUP MESSAGE PAUSE */
  const toggleGroupPause = async (group: Group) => {
    try {
      const next = !group.messagingPaused;
      await updateDoc(doc(db, "Groups", group.id), { messaging_paused: next });
      setGroups((prev) =>
        prev.map((g) =>
          g.id === group.id ? { ...g, messagingPaused: next } : g
        )
      );
    } catch (err) {
      console.error("Error pausing group:", err);
      setError("Failed to pause group messaging");
    }
  };

  /* SAVE FEATURED LISTINGS for a group */
  const saveListings = async (group: Group, listings: FeaturedListing[]) => {
    await updateDoc(doc(db, "Groups", group.id), {
      featured_listings: listings,
    });
    setGroups((prev) =>
      prev.map((g) =>
        g.id === group.id ? { ...g, featuredListings: listings } : g
      )
    );
  };

  /* DELETE GROUP */
  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      setDeleteLoading(true);
      if (deleting.imagePath) await deleteImage(deleting.imagePath);
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

  /* BLOCK FROM GROUP — the member can't rejoin, and a Cloud Function hides
   * their messages, poll votes and meetups in this group. Unblock restores
   * them and lets the person join again. */
  const blockMember = async (m: Member) => {
    if (!viewingMembers) return;
    const reason = window.prompt(
      `Block ${m.name || "this member"} from ${viewingMembers.name}?\n\nThey'll be removed, can't rejoin, and all their messages and poll votes in this group will be hidden. Meetups they host here are cancelled.\n\nReason (optional, staff only):`,
      "",
    );
    if (reason === null) return;
    try {
      // Public member doc: status only. The reason is staff-only.
      await setDoc(
        doc(db, "Groups", viewingMembers.id, "members", m.id),
        {
          userId: m.userId || m.id,
          status: "blocked",
          blockedAt: serverTimestamp(),
        },
        { merge: true }
      );
      try {
        await setDoc(doc(db, "Groups", viewingMembers.id, "member_blocks", m.id), {
          uid: m.userId || m.id,
          name: m.name || "",
          reason: reason.trim().slice(0, 500),
          blockedAt: serverTimestamp(),
          blockedBy: auth.currentUser?.uid ?? "",
        });
      } catch (err) {
        console.error("Block saved, but the reason could not be stored:", err);
        setError("Member blocked, but the reason couldn't be saved.");
      }
      await fetchMembers(viewingMembers.id);
      setGroups((prev) =>
        prev.map((g) =>
          g.id === viewingMembers.id && m.status === "active"
            ? { ...g, memberCount: Math.max(0, (g.memberCount || 0) - 1) }
            : g
        )
      );
    } catch (err) {
      console.error("Error blocking member:", err);
      setError("Failed to block member");
    }
  };

  const unblockMember = async (m: Member) => {
    if (!viewingMembers) return;
    if (
      !window.confirm(
        `Unblock ${m.name || "this member"}? Their hidden messages and votes in ${viewingMembers.name} are restored, and they can join again.`
      )
    )
      return;
    try {
      await updateDoc(doc(db, "Groups", viewingMembers.id, "members", m.id), {
        status: "removed",
        unblockedAt: serverTimestamp(),
        // Older blocks stored these publicly; clear them.
        blockReason: deleteField(),
        blockedBy: deleteField(),
      });
      await deleteDoc(doc(db, "Groups", viewingMembers.id, "member_blocks", m.id)).catch(
        (err) => console.error("Could not remove the block record:", err)
      );
      setMembers((prev) => prev.filter((x) => x.id !== m.id));
    } catch (err) {
      console.error("Error unblocking member:", err);
      setError("Failed to unblock member");
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
      setGroups((prev) =>
        prev.map((g) =>
          g.id === viewingMembers.id
            ? { ...g, memberCount: Math.max(0, (g.memberCount || 0) - 1) }
            : g
        )
      );
    } catch (err) {
      console.error("Error removing member:", err);
      setError("Failed to remove member");
    }
  };

  /* MODAL HELPERS */
  const closeModal = () => {
    setAdding(false);
    setEditing(null);
    setFile(null);
    setOldImage("");
    setForm({ name: "", description: "", allowedGender: "" });
    setError("");
  };

  const openEdit = (group: Group) => {
    setEditing(group);
    setForm({
      name: group.name,
      description: group.description,
      allowedGender: group.allowedGender || "",
    });
    setOldImage(group.image || "");
    setAdding(false);
  };

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

  const openMenu = (e: React.MouseEvent, g: Group) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ group: g, x: r.right, y: r.bottom });
  };

  const activeMembers = members.filter((m) => m.status === "active");
  const blockedMembers = members.filter((m) => m.status === "blocked");

  return (
    <div>
      <PageHeader
        title="Groups"
        description="Manage community groups for the mobile app."
        actions={
          <Button
            variant="outline"
            icon={Plus}
            onClick={() => {
              setAdding(true);
              setEditing(null);
              setForm({ name: "", description: "", allowedGender: "" });
              setFile(null);
              setError("");
            }}
          >
            Create Group
          </Button>
        }
      />

      {error && !adding && !editing && (
        <Alert className="mb-6" onDismiss={() => setError("")}>
          {error}
        </Alert>
      )}

      {/* GLOBAL PAUSE-ALL */}
      <Card className="mb-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-[#f4ead7]">Pause all messaging</h2>
            <p className="mt-1 text-sm text-[#f4ead7]/60">
              Stops new messages in{" "}
              <span className="font-semibold text-[#f4ead7]">every group and direct chat</span>{" "}
              until you turn it back on.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Badge tone={pauseAllBusy ? "dark" : pauseAll ? "red" : "green"}>
              {pauseAllBusy ? "Saving…" : pauseAll ? "Paused" : "Active"}
            </Badge>
            <Switch
              tone="dark"
              checked={pauseAll}
              onChange={() => togglePauseAll()}
              disabled={pauseAllBusy}
              label="Pause all messaging"
            />
          </div>
        </div>
      </Card>

      {/* TABLE */}
      <SectionHeading
        title={
          <>
            All Groups <span className="font-normal text-[#f4ead7]/50">({groups.length})</span>
          </>
        }
      />

      {loading ? (
        <LoadingState label="Loading groups…" />
      ) : groups.length === 0 ? (
        <EmptyState icon={UsersRound} title="No groups yet." />
      ) : (
        <div className={table.wrap}>
          <table className={`${table.table} min-w-[800px]`}>
            <thead className={table.thead}>
              <tr>
                <th className={table.th}>Name</th>
                <th className={table.th}>Description</th>
                <th className={table.th}>Status</th>
                <th className={table.th}>Members</th>
                <th className={table.th}>Created</th>
                <th className={`${table.th} text-right`}>Actions</th>
              </tr>
            </thead>

            <tbody>
              {paginated.map((g) => (
                <tr key={g.id} className={table.row}>
                  <td className={`${table.td} font-semibold`}>{g.name}</td>
                  <td className={table.td}>
                    <p className="max-w-xs truncate text-black/70" title={g.description || undefined}>
                      {g.description || "—"}
                    </p>
                  </td>
                  <td className={table.td}>
                    <div className="flex items-center gap-1.5 whitespace-nowrap">
                      <Badge tone={g.status === "active" ? "green" : "red"}>
                        {g.status === "active" ? "Active" : "Inactive"}
                      </Badge>
                      {g.messagingPaused && <Badge tone="amber">Msgs paused</Badge>}
                      {g.featuredListings.length > 0 && (
                        <Badge tone="blue">
                          {g.featuredListings.length} listing
                          {g.featuredListings.length === 1 ? "" : "s"}
                        </Badge>
                      )}
                      {g.allowedGender && <Badge tone="purple">{g.allowedGender} only</Badge>}
                    </div>
                  </td>
                  <td className={`${table.td} tabular-nums`}>{g.memberCount || 0}</td>
                  <td className={`${table.td} whitespace-nowrap text-black/60`}>
                    {g.createdAt?.toDate ? g.createdAt.toDate().toLocaleDateString() : "—"}
                  </td>

                  <td className={table.td}>
                    <div className={table.actions}>
                      <Button size="sm" onClick={() => openEdit(g)}>
                        Edit
                      </Button>

                      {/* 3-DOT MENU */}
                      <Button
                        size="sm"
                        variant="light"
                        icon={MoreVertical}
                        onClick={(e) => openMenu(e, g)}
                        aria-label="More actions"
                        aria-haspopup="menu"
                        aria-expanded={menu?.group.id === g.id}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && (
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          total={groups.length}
          perPage={perPage}
        />
      )}

      {/* 3-DOT ACTION MENU (fixed overlay, won't be clipped by the table) */}
      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />
          <div
            role="menu"
            className="fixed z-50 w-52 overflow-hidden rounded-xl border border-black/10 bg-[#f5ecd7] py-1 text-sm text-black shadow-2xl"
            style={{ top: menu.y + 6, left: Math.max(8, menu.x - 208) }}
          >
            <MenuItem
              icon={menu.group.messagingPaused ? Play : Pause}
              onClick={() => {
                toggleGroupPause(menu.group);
                setMenu(null);
              }}
            >
              {menu.group.messagingPaused ? "Resume messages" : "Pause messages"}
            </MenuItem>
            <MenuItem
              icon={Plus}
              onClick={() => {
                setListingFor(menu.group);
                setMenu(null);
              }}
            >
              Add listing
              {menu.group.featuredListings.length > 0
                ? ` (${menu.group.featuredListings.length}/${MAX_FEATURED})`
                : ""}
            </MenuItem>
            <div className="my-1 border-t border-black/10" />
            <MenuItem
              icon={Power}
              onClick={() => {
                toggleStatus(menu.group);
                setMenu(null);
              }}
            >
              {menu.group.status === "active" ? "Deactivate" : "Activate"}
            </MenuItem>
            <MenuItem
              icon={Users}
              onClick={() => {
                openMembers(menu.group);
                setMenu(null);
              }}
            >
              Members
            </MenuItem>
            <MenuItem
              icon={Trash2}
              danger
              onClick={() => {
                setDeleting(menu.group);
                setMenu(null);
              }}
            >
              Delete
            </MenuItem>
          </div>
        </>
      )}

      {/* CREATE/EDIT MODAL */}
      {(adding || editing) && (
        <Modal
          title={editing ? "Edit Group" : "Create Group"}
          onClose={closeModal}
          footer={
            <>
              <Button variant="light" onClick={closeModal}>
                Cancel
              </Button>
              <Button onClick={editing ? handleEdit : handleAdd} loading={saveLoading}>
                {saveLoading ? "Saving…" : "Save Group"}
              </Button>
            </>
          }
        >
          {error && (
            <Alert surface="light" className="mb-2">
              {error}
            </Alert>
          )}

          <Field label="Group Name *">
            <TextInput
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Enter group name"
            />
          </Field>

          <Field label="Description">
            <TextArea
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Enter group description (optional)"
            />
          </Field>

          <Field
            label="Restrict to gender"
            hint="Restricted groups are hidden from users of any other gender in the mobile app."
          >
            <SelectInput
              value={form.allowedGender}
              onChange={(e) => setForm({ ...form, allowedGender: e.target.value })}
            >
              <option value="">No restriction (everyone)</option>
              <option value="Female">Female only</option>
              <option value="Male">Male only</option>
            </SelectInput>
          </Field>

          <Field label="Group Image (optional)">
            <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-black/10 bg-white/50 p-4">
              {file || oldImage ? (
                <div className="relative h-20 w-20 shrink-0">
                  <img
                    src={file ? URL.createObjectURL(file) : oldImage}
                    alt="preview"
                    className="h-full w-full rounded-xl border border-black/10 object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setFile(null)}
                    aria-label="Remove image"
                    className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white shadow transition hover:bg-red-600"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border border-dashed border-black/20 bg-black/5 text-xs text-black/40">
                  No image
                </div>
              )}
              <label className={cx(buttonClass("outline"), "cursor-pointer")}>
                <ImagePlus className="h-4 w-4" aria-hidden />
                Choose Image
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
              </label>
            </div>
          </Field>
        </Modal>
      )}

      {/* DELETE MODAL */}
      {deleting && (
        <Modal
          title="Delete Group"
          size="sm"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button variant="light" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button variant="danger-solid" onClick={confirmDelete} loading={deleteLoading}>
                {deleteLoading ? "Deleting…" : "Delete"}
              </Button>
            </>
          }
        >
          <p>
            Are you sure you want to delete <span className="font-semibold">{deleting.name}</span>?
            This action cannot be undone.
          </p>
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
            <p className="py-6 text-center text-sm text-black/60">No members yet</p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-xl border border-black/10">
                <table className={`${table.table} min-w-[520px]`}>
                  <thead className={table.thead}>
                    <tr>
                      <th className={table.th}>Name</th>
                      <th className={table.th}>Email</th>
                      <th className={table.th}>Joined</th>
                      <th className={`${table.th} text-right`}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeMembers.map((m) => (
                      <tr key={m.id} className={table.row}>
                        <td className={`${table.td} font-semibold`}>{m.name}</td>
                        <td className={`${table.td} text-xs text-black/70`}>{m.email}</td>
                        <td className={`${table.td} whitespace-nowrap text-xs text-black/60`}>
                          {m.joinedAt?.toDate ? m.joinedAt.toDate().toLocaleDateString() : "—"}
                        </td>
                        <td className={table.td}>
                          <div className={table.actions}>
                            <Button size="sm" variant="danger" onClick={() => removeMember(m.id)}>
                              Remove
                            </Button>
                            <Button size="sm" variant="warning" onClick={() => blockMember(m)}>
                              Block
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {blockedMembers.length > 0 && (
                <>
                  <FormSection>Blocked from this group</FormSection>
                  <div className="mt-3 overflow-x-auto rounded-xl border border-black/10">
                    <table className={`${table.table} min-w-[520px]`}>
                      <tbody>
                        {blockedMembers.map((m) => (
                          <tr key={m.id} className={table.row}>
                            <td className={`${table.td} font-semibold`}>{m.name || m.userId}</td>
                            <td className={`${table.td} text-xs text-black/60`}>
                              {m.blockReason || "No reason given"}
                            </td>
                            <td className={table.td}>
                              <BlockStateBadge state={m.blockState} />
                            </td>
                            <td className={table.td}>
                              <div className={table.actions}>
                                <Button size="sm" variant="success" onClick={() => unblockMember(m)}>
                                  Unblock
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </Modal>
      )}

      {/* ADD LISTING MODAL */}
      {listingFor && (
        <ListingPickerModal
          group={listingFor}
          onClose={() => setListingFor(null)}
          onSave={async (listings) => {
            await saveListings(listingFor, listings);
            setListingFor(null);
          }}
        />
      )}
    </div>
  );
}

/* Progress of hiding a blocked member's content (Cloud Function). */
function BlockStateBadge({ state }: { state?: string }) {
  if (state === "archived") return <Badge tone="green">Content hidden</Badge>;
  if (state === "failed") return <Badge tone="red">Hiding failed</Badge>;
  if (state) return <Badge tone="amber">Hiding content…</Badge>;
  return <Badge>Waiting…</Badge>;
}

/* MENU ITEM */
function MenuItem({
  children,
  onClick,
  icon: Icon,
  danger = false,
}: {
  children: ReactNode;
  onClick: () => void;
  icon?: LucideIcon;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cx(
        "flex w-full items-center gap-2.5 px-4 py-2 text-left transition hover:bg-black/5",
        danger ? "font-semibold text-red-600" : "text-black",
      )}
    >
      {Icon && (
        <Icon
          className={cx("h-4 w-4 shrink-0", danger ? "text-red-500" : "text-black/50")}
          aria-hidden
        />
      )}
      <span className="min-w-0">{children}</span>
    </button>
  );
}

/* LISTING PICKER — choose up to 3 listings to feature in a group's chat */
function ListingPickerModal({
  group,
  onClose,
  onSave,
}: {
  group: Group;
  onClose: () => void;
  onSave: (listings: FeaturedListing[]) => Promise<void>;
}) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<FeaturedListing[]>(
    group.featuredListings || [],
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const snap = await getDocs(collection(db, "Products"));
        const data = snap.docs.map((d) => {
          const x = d.data();
          return {
            id: d.id,
            name: x.productName || "(untitled)",
            image: x.imageUrl || "",
          };
        });
        data.sort((a, b) => a.name.localeCompare(b.name));
        setListings(data);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return listings;
    return listings.filter((l) => l.name.toLowerCase().includes(q));
  }, [listings, search]);

  const isSelected = (id: string) => selected.some((s) => s.id === id);

  const toggle = (l: Listing) => {
    if (isSelected(l.id)) {
      setSelected((prev) => prev.filter((s) => s.id !== l.id));
    } else if (selected.length < MAX_FEATURED) {
      setSelected((prev) => [...prev, { id: l.id, name: l.name, image: l.image }]);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSave(selected);
    } catch (e) {
      console.error(e);
      alert("Failed to save listings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Listings for ${group.name}`}
      size="md"
      onClose={onClose}
      footer={
        <>
          <Button variant="light" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            {saving ? "Saving…" : "Save listings"}
          </Button>
        </>
      }
    >
      <p className="text-sm text-black/70">
        Pick up to {MAX_FEATURED} listings to feature in this group&apos;s chat.
        Selected:{" "}
        <span className="font-semibold text-black">
          {selected.length}/{MAX_FEATURED}
        </span>
      </p>

      <div className="relative mt-4">
        <Search
          className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-black/40"
          aria-hidden
        />
        <TextInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search listings…"
          className="pl-10"
        />
      </div>

      {loading ? (
        <p className="flex items-center justify-center gap-2 py-6 text-sm text-black/60">
          <Spinner className="h-4 w-4" />
          Loading listings…
        </p>
      ) : (
        <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
          {filtered.map((l) => {
            const sel = isSelected(l.id);
            const disabled = !sel && selected.length >= MAX_FEATURED;
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => toggle(l)}
                disabled={disabled}
                aria-pressed={sel}
                className={cx(
                  "flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition",
                  sel
                    ? "border-[#ff7a59] bg-[#ff7a59]/10"
                    : disabled
                      ? "cursor-not-allowed border-black/10 bg-white/30 opacity-40"
                      : "border-black/10 bg-white/50 hover:border-black/20 hover:bg-white",
                )}
              >
                {l.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={l.image}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded-lg border border-black/10 object-cover"
                  />
                ) : (
                  <div className="h-10 w-10 shrink-0 rounded-lg border border-black/10 bg-black/5" />
                )}
                <span className="min-w-0 flex-1 text-sm font-medium text-black">{l.name}</span>
                {sel && (
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#ff7a59] text-white">
                    <Check className="h-3.5 w-3.5" aria-hidden />
                  </span>
                )}
              </button>
            );
          })}
          {filtered.length === 0 && (
            <p className="py-6 text-center text-sm text-black/50">No listings found.</p>
          )}
        </div>
      )}
    </Modal>
  );
}
