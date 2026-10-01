"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  Check,
  CircleCheck,
  CircleX,
  ImageOff,
  ImagePlus,
  Plus,
  Radio,
  Send,
  Trash2,
  TriangleAlert,
  Upload,
  User,
  type LucideIcon,
} from "lucide-react";
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
  deleteObject,
} from "firebase/storage";
import { db, storage } from "@/lib/firebaseServices";
import { authedFetch } from "@/lib/authedFetch";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Field,
  LoadingState,
  Modal,
  PageHeader,
  Pagination,
  Spinner,
  TextArea,
  TextInput,
  Toolbar,
  buttonClass,
  cx,
  table,
  type BadgeTone,
} from "@/components/ui";

// ─────────────────────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────────────────────

type NotificationStatus =
  | "draft"
  | "queued"
  | "sending"
  | "sent"
  | "partial"
  | "failed";

type DeliveryMode = "topic" | "token";

type NotificationItem = {
  id: string;
  title: string;
  body: string;
  image?: string;
  sent?: boolean;
  sentCount?: number;
  failedCount?: number;
  createdAt?: any;
  sentAt?: any;
  status?: NotificationStatus;
  errorMessage?: string;
  deliveryMode?: DeliveryMode;
  targetTopic?: string;
 targetUserIds?: string[];
  type?: string;
};

type FormState = {
  title: string;
  body: string;
  deliveryMode: DeliveryMode;
  targetUserIds: string[];
};

type UserOption = {
  id: string;
  displayName: string;
  email: string;
  hasToken: boolean;
};



type BulkDeleteMode = "selected" | "all" | null;

const EMPTY_FORM: FormState = {
  title: "",
  body: "",
  deliveryMode: "topic",
   targetUserIds: [],
};

// ─────────────────────────────────────────────────────────────────────────────
//  Page
// ─────────────────────────────────────────────────────────────────────────────

export default function Page() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [usersLoading, setUsersLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<NotificationItem | null>(null);
  const [deleting, setDeleting] = useState<NotificationItem | null>(null);
  const [selected, setSelected] = useState<NotificationItem | null>(null);

  const [bulkDeleteMode, setBulkDeleteMode] = useState<BulkDeleteMode>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [file, setFile] = useState<File | null>(null);
  const [removeExistingImage, setRemoveExistingImage] = useState(false);
  const [error, setError] = useState("");
  const [userSearch, setUserSearch] = useState("");

  const [page, setPage] = useState(1);
  const perPage = 9;

  // ── Fetch notifications ────────────────────────────────────────────────────
  const fetchData = async () => {
    try {
      setLoading(true);
      setError("");
      const q = query(
        collection(db, "notifications"),
        orderBy("createdAt", "desc"),
      );
      const snap = await getDocs(q);
      const data: NotificationItem[] = snap.docs
        // The `notifications` collection is shared with the mobile app, which
        // also writes per-user chat/social records (group_message,
        // direct_message, group_reply, friend_request, post_like, post_comment,
        // …). The admin notification center is only for general/admin
        // broadcasts, so keep just the admin-generated docs: type "admin" or a
        // legacy broadcast identifiable by its admin-panel `deliveryMode` field.
        .filter((d) => {
          const x = d.data();
          return x.type === "admin" || x.deliveryMode != null;
        })
        .map((d) => {
        const x = d.data();
        return {
          id: d.id,
          title: x.title || "",
          body: x.body || "",
          image: x.image || "",
          sent: x.sent || false,
          sentCount: x.sentCount || 0,
          failedCount: x.failedCount || 0,
          createdAt: x.createdAt || null,
          sentAt: x.sentAt || null,
          status: (x.status || "draft") as NotificationStatus,
          errorMessage: x.errorMessage || "",
          deliveryMode: (x.deliveryMode || "topic") as DeliveryMode,
          targetTopic: x.targetTopic || "",
         targetUserIds: x.targetUserIds || [],
          type: x.type || "",
        };
      });
      setNotifications(data);
    } catch (err) {
      console.error(err);
      setError("Failed to load notifications.");
    } finally {
      setLoading(false);
    }
  };

  // ── Fetch users (lazy — only when modal opens) ─────────────────────────────
  const fetchUsers = async () => {
    if (users.length > 0) return; // already loaded
    try {
      setUsersLoading(true);
      const snap = await getDocs(collection(db, "Users"));
      const list: UserOption[] = snap.docs.map((d) => {
  const x = d.data();

  const token =
    x.fcm_token ||
    x.fcmToken ||
    x.FCMToken ||
    x.token ||
    x.deviceToken ||
    x.notificationToken ||
    (Array.isArray(x.fcm_tokens) ? x.fcm_tokens[0] : "");

  return {
    id: x.uid || d.id,

    displayName:
      x.display_name ||
      x.full_name ||
      x.displayName ||
      x.name ||
      "Unknown User",

    email: x.email || "",
    hasToken: !!token,
  };
});
      setUsers(list);
    } catch (err) {
      console.error("Failed to fetch users:", err);
    } finally {
      setUsersLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // ── Pagination ─────────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(notifications.length / perPage));
  const safePage = Math.min(page, totalPages);

  const paginatedData = useMemo(() => {
    const start = (safePage - 1) * perPage;
    return notifications.slice(start, start + perPage);
  }, [notifications, safePage]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const isAllCurrentPageSelected =
    paginatedData.length > 0 &&
    paginatedData.every((item) => selectedIds.includes(item.id));

  const selectedCount = selectedIds.length;

  // ── Filtered users for search ─────────────────────────────────────────────
  const filteredUsers = useMemo(() => {
    const q = userSearch.toLowerCase().trim();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.displayName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.id.toLowerCase().includes(q),
    );
  }, [users, userSearch]);

  // ── Image helpers ──────────────────────────────────────────────────────────
  const uploadImage = async () => {
    if (!file) return "";
    const storageRef = ref(storage, `notifications/${Date.now()}-${file.name}`);
    await uploadBytes(storageRef, file);
    return await getDownloadURL(storageRef);
  };

  const safelyDeleteImageByUrl = async (url?: string) => {
    if (!url) return;
    try {
      await deleteObject(ref(storage, url));
    } catch (err) {
      console.error("Image delete skipped/failed:", err);
    }
  };

  // ── Modal helpers ─────────────────────────────────────────────────────────
  const closeModal = () => {
    setAdding(false);
    setEditing(null);
    setForm(EMPTY_FORM);
    setFile(null);
    setRemoveExistingImage(false);
    setSaving(false);
    setError("");
    setUserSearch("");
  };

  const openAddModal = () => {
    setForm(EMPTY_FORM);
    setFile(null);
    setRemoveExistingImage(false);
    setAdding(true);
    setEditing(null);
    setError("");
    setUserSearch("");
    fetchUsers();
  };

  const openEditModal = (item: NotificationItem) => {
    setEditing(item);
    setAdding(false);
    setFile(null);
    setRemoveExistingImage(false);
    setForm({
      title: item.title || "",
      body: item.body || "",
      deliveryMode: item.deliveryMode || "topic",
   targetUserIds: Array.isArray(item.targetUserIds)
  ? item.targetUserIds
  : [],
    });
    setError("");
    setUserSearch("");
    fetchUsers();
  };

const validateForm = () => {
  if (!form.title.trim()) return "Title is required.";
  if (!form.body.trim()) return "Message is required.";

  if (
    form.deliveryMode === "token" &&
    form.targetUserIds.length === 0
  ) {
    return "Please select at least one user.";
  }

  return "";
};

  // ── Selection helpers ─────────────────────────────────────────────────────
  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    );
  };

  const toggleSelectCurrentPage = () => {
    if (isAllCurrentPageSelected) {
      setSelectedIds((prev) =>
        prev.filter((id) => !paginatedData.some((item) => item.id === id)),
      );
      return;
    }
    setSelectedIds((prev) => {
      const merged = new Set(prev);
      paginatedData.forEach((item) => merged.add(item.id));
      return Array.from(merged);
    });
  };

  const clearSelection = () => setSelectedIds([]);

  // ── Send ──────────────────────────────────────────────────────────────────
  const sendNotificationNow = async (
    notificationId: string,
    opts?: { mode?: DeliveryMode; targetUserIds?: string[] }
  ) => {
    setSendingId(notificationId);
    setError("");
    try {
      const payload: Record<string, any> = {
        notificationId,
        mode: opts?.mode ?? "topic",
      };
     if (opts?.mode === "token" && opts?.targetUserIds?.length) {
  payload.targetUserIds = opts.targetUserIds;
}

      const response = await authedFetch("/api/admin/notifications/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(result?.message || "Failed to send notification.");

      setNotifications((prev) =>
        prev.map((n) =>
          n.id === notificationId
            ? {
                ...n,
                sent: !!result?.sent,
                sentCount: result?.sentCount ?? n.sentCount ?? 0,
                failedCount: result?.failedCount ?? n.failedCount ?? 0,
                status: result?.status ?? "sent",
                errorMessage: result?.errorMessage ?? "",
                sentAt: result?.sentAt ?? new Date(),
                deliveryMode: result?.deliveryMode ?? opts?.mode ?? "topic",
                targetTopic: result?.targetTopic ?? "",
                targetUserIds: result?.targetUserIds ?? opts?.targetUserIds ?? [],
              }
            : n,
        ),
      );



      await fetchData();
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Failed to send notification.");
      await fetchData();
    } finally {
      setSendingId(null);
    }
  };

  // ── Add ───────────────────────────────────────────────────────────────────
  const handleAdd = async () => {
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }
    try {
      setSaving(true);
      setError("");
      const imageUrl = await uploadImage();

      const docRef = await addDoc(collection(db, "notifications"), {
        title: form.title,
        body: form.body,
        image: imageUrl,
        createdAt: serverTimestamp(),
        sent: false,
        sentCount: 0,
        failedCount: 0,
        status: "queued",
        errorMessage: "",
        sentAt: null,
        deliveryMode: form.deliveryMode,
        targetTopic: form.deliveryMode === "topic" ? "all_users" : "",
        targetUserIds: form.deliveryMode === "token" ? form.targetUserIds :  [],
      });

      setNotifications((prev) => [
        {
          id: docRef.id,
          title: form.title,
          body: form.body,
          image: imageUrl,
          sent: false,
          sentCount: 0,
          failedCount: 0,
          createdAt: new Date(),
          status: "queued",
          errorMessage: "",
          sentAt: null,
          deliveryMode: form.deliveryMode,
          targetTopic: form.deliveryMode === "topic" ? "all_users" : "",
          targetUserIds: form.deliveryMode === "token" ? form.targetUserIds :  [],
        },
        ...prev,
      ]);

      setPage(1);
      const capturedMode = form.deliveryMode;
      const capturedUserId = form.targetUserIds;
      closeModal();

      await sendNotificationNow(docRef.id, {
        mode: capturedMode,
        targetUserIds: capturedUserId || undefined,
      });
    } catch (err) {
      console.error(err);
      setError("Failed to create notification.");
      setSaving(false);
    }
  };

  // ── Update ─────────────────────────────────────────────────────────────────
  const handleUpdate = async () => {
    if (!editing) return;
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }
    try {
      setSaving(true);
      setError("");

      let nextImageUrl = editing.image || "";
      if (file) {
        if (editing.image) await safelyDeleteImageByUrl(editing.image);
        nextImageUrl = await uploadImage();
      } else if (removeExistingImage) {
        await safelyDeleteImageByUrl(editing.image);
        nextImageUrl = "";
      }

      await updateDoc(doc(db, "notifications", editing.id), {
        title: form.title,
        body: form.body,
        image: nextImageUrl,
        sent: false,
        sentCount: 0,
        failedCount: 0,
        status: "draft",
        errorMessage: "",
        sentAt: null,
        deliveryMode: form.deliveryMode,
        targetTopic: form.deliveryMode === "topic" ? "all_users" : "",
        targetUserIds: form.deliveryMode === "token" ? form.targetUserIds : [],
      });

      setNotifications((prev) =>
        prev.map((n) =>
          n.id === editing.id
            ? {
                ...n,
                title: form.title,
                body: form.body,
                image: nextImageUrl,
                sent: false,
                sentCount: 0,
                failedCount: 0,
                status: "draft",
                errorMessage: "",
                sentAt: null,
                deliveryMode: form.deliveryMode,
                targetTopic: form.deliveryMode === "topic" ? "all_users" : "",
                targetUserIds:
                  form.deliveryMode === "token" ? form.targetUserIds : [],
              }
            : n,
        ),
      );
      closeModal();
    } catch (err) {
      console.error(err);
      setError("Failed to update notification.");
      setSaving(false);
    }
  };

  // ── Delete ─────────────────────────────────────────────────────────────────
  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteDoc(doc(db, "notifications", deleting.id));
      await safelyDeleteImageByUrl(deleting.image);
      const remaining = notifications.filter((n) => n.id !== deleting.id);
      setNotifications(remaining);
      setSelectedIds((prev) => prev.filter((id) => id !== deleting.id));
      setDeleting(null);
      const nextTotal = Math.max(1, Math.ceil(remaining.length / perPage));
      if (page > nextTotal) setPage(nextTotal);
    } catch (err) {
      console.error(err);
      setError("Failed to delete notification.");
      setDeleting(null);
    }
  };

  const handleBulkDelete = async () => {
    try {
      setBulkDeleting(true);
      setError("");
      const idsToDelete =
        bulkDeleteMode === "all" ? notifications.map((n) => n.id) : selectedIds;
      const itemsToDelete =
        bulkDeleteMode === "all"
          ? notifications
          : notifications.filter((n) => selectedIds.includes(n.id));

      await Promise.all(
        itemsToDelete.map(async (item) => {
          await deleteDoc(doc(db, "notifications", item.id));
          await safelyDeleteImageByUrl(item.image);
        }),
      );

      const remaining =
        bulkDeleteMode === "all"
          ? []
          : notifications.filter((n) => !idsToDelete.includes(n.id));

      setNotifications(remaining);
      setSelectedIds([]);
      setBulkDeleteMode(null);
      const nextTotal = Math.max(1, Math.ceil(remaining.length / perPage));
      if (page > nextTotal) setPage(nextTotal);
    } catch (err) {
      console.error(err);
      setError(
        bulkDeleteMode === "all"
          ? "Failed to delete all notifications."
          : "Failed to delete selected notifications.",
      );
      setBulkDeleteMode(null);
    } finally {
      setBulkDeleting(false);
    }
  };

  // ── Derived UI helpers ─────────────────────────────────────────────────────
  const currentImagePreview = file
    ? URL.createObjectURL(file)
    : editing && !removeExistingImage
      ? editing.image || ""
      : "";

const selectedUsers = users.filter((u) =>
  form.targetUserIds.includes(u.id)
);

  // ═══════════════════════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Broadcast to all users via topic or target a specific user."
        actions={
          <Button variant="outline" icon={Plus} onClick={openAddModal}>
            Create Notification
          </Button>
        }
      />

      {/* Global error */}
      {error && !adding && !editing && (
        <Alert className="mb-6" onDismiss={() => setError("")}>
          {error}
        </Alert>
      )}

      {/* Bulk toolbar */}
      {!loading && notifications.length > 0 && (
        <Toolbar>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-[#f4ead7]">
            <input
              type="checkbox"
              checked={isAllCurrentPageSelected}
              onChange={toggleSelectCurrentPage}
              className="h-4 w-4 accent-[#ff7a59]"
            />
            Select all on this page
          </label>
          <span className="text-sm text-[#f4ead7]/60">Selected: {selectedCount}</span>
          {selectedCount > 0 && (
            <Button variant="secondary" size="sm" onClick={clearSelection}>
              Clear Selection
            </Button>
          )}
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            <Button
              variant="danger"
              icon={Trash2}
              onClick={() => setBulkDeleteMode("selected")}
              disabled={selectedCount === 0}
            >
              Delete Selected
            </Button>
            <Button
              variant="danger"
              onClick={() => setBulkDeleteMode("all")}
              disabled={notifications.length === 0}
            >
              Delete All
            </Button>
          </div>
        </Toolbar>
      )}

      {/* List */}
      {loading ? (
        <LoadingState label="Loading notifications…" />
      ) : notifications.length === 0 ? (
        <EmptyState icon={Bell} title="No notifications found." />
      ) : (
        <div className={table.wrap}>
          <table className={`${table.table} min-w-[940px]`}>
            <thead className={table.thead}>
              <tr>
                <th className={`${table.th} w-10`}>
                  <input
                    type="checkbox"
                    checked={isAllCurrentPageSelected}
                    onChange={toggleSelectCurrentPage}
                    aria-label="Select all on this page"
                    title="Select all on this page"
                    className="h-4 w-4 align-middle accent-[#ff7a59]"
                  />
                </th>
                <th className={table.th}>Image</th>
                <th className={table.th}>Notification</th>
                <th className={table.th}>Delivery</th>
                <th className={`${table.th} text-right`}>Actions</th>
              </tr>
            </thead>

            <tbody>
              {paginatedData.map((n) => {
                const checked = selectedIds.includes(n.id);
                const status = statusOf(n);
                // Selected rows get a light orange tint and an accent bar.
                const cell = cx(table.td, checked && "bg-[#ff7a59]/10");
                return (
                  <tr key={n.id} className={table.row}>
                    <td className={cx(cell, "w-10", checked && "shadow-[inset_3px_0_0_#ff7a59]")}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelectOne(n.id)}
                        aria-label={`Select ${n.title || "notification"}`}
                        className="h-4 w-4 align-middle accent-[#ff7a59]"
                      />
                    </td>

                    <td className={cell}>
                      {n.image ? (
                        <img src={n.image} alt="" className={table.thumb} />
                      ) : (
                        <div className={table.thumbEmpty} title="No image">
                          <ImageOff className="h-4 w-4" aria-label="No image" />
                        </div>
                      )}
                    </td>

                    <td className={cell}>
                      <p className="max-w-[340px] truncate font-semibold">{n.title}</p>
                      <p className="mt-0.5 line-clamp-2 max-w-[340px] text-xs text-black/60">
                        {n.body}
                      </p>
                      {n.errorMessage ? (
                        <p className="mt-1.5 flex max-w-[340px] items-start gap-1 text-xs text-red-700">
                          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                          <span className="line-clamp-2">{n.errorMessage}</span>
                        </p>
                      ) : null}
                    </td>

                    <td className={cell}>
                      <div className="flex flex-wrap gap-1.5">
                        <AudienceBadge item={n} />
                        <Badge tone={statusTone(status)} className="capitalize">
                          {status}
                        </Badge>
                      </div>
                      <DeliveryCounts item={n} className="mt-1.5" />
                    </td>

                    <td className={cell}>
                      <div className={table.actions}>
                        <Button size="sm" variant="light" onClick={() => setSelected(n)}>
                          View
                        </Button>
                        <Button size="sm" variant="light" onClick={() => openEditModal(n)}>
                          Update
                        </Button>
                        <Button
                          size="sm"
                          icon={Send}
                          loading={sendingId === n.id}
                          onClick={() =>
                            sendNotificationNow(n.id, {
                              mode: n.deliveryMode ?? "topic",
                              targetUserIds: n.targetUserIds || undefined,
                            })
                          }
                        >
                          {sendingId === n.id ? "Sending…" : "Send Now"}
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => setDeleting(n)}>
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {!loading && notifications.length > 0 && (
        <Pagination
          page={safePage}
          totalPages={totalPages}
          onPageChange={setPage}
          total={notifications.length}
          perPage={perPage}
          extra=" notifications"
        />
      )}

      {/* ── Create / Edit Modal ── */}
      {(adding || editing) && (
        <Modal
          title={adding ? "Create Notification" : "Edit Notification"}
          onClose={closeModal}
          footer={
            <>
              <Button variant="light" onClick={closeModal}>
                Cancel
              </Button>
              <Button
                icon={adding ? Send : undefined}
                loading={saving}
                onClick={adding ? handleAdd : handleUpdate}
              >
                {saving
                  ? adding
                    ? "Creating…"
                    : "Saving…"
                  : adding
                    ? form.deliveryMode === "topic"
                      ? "Create & Send to All Users"
                      : "Create & Send to User"
                    : "Save Changes"}
              </Button>
            </>
          }
        >
          {error && (
            <Alert surface="light" className="mb-4">
              {error}
            </Alert>
          )}

          <Input
            label="Title"
            value={form.title}
            onChange={(v) => setForm((p) => ({ ...p, title: v }))}
          />

          <Textarea
            label="Message"
            value={form.body}
            onChange={(v) => setForm((p) => ({ ...p, body: v }))}
          />

          {/* ── Delivery Target ── */}
          <Field label="Send To">
            <div className="grid grid-cols-2 gap-3">
              <AudienceOption
                active={form.deliveryMode === "topic"}
                icon={Radio}
                title="All Users"
                hint="via topic: all_users"
                onClick={() =>
                  setForm((p) => ({ ...p, deliveryMode: "topic", targetUserIds:  [] }))
                }
              />
              <AudienceOption
                active={form.deliveryMode === "token"}
                icon={User}
                title="Specific User"
                hint="via device token"
                onClick={() =>
                  setForm((p) => ({ ...p, deliveryMode: "token" }))
                }
              />
            </div>

            {/* User picker */}
            {form.deliveryMode === "token" && (
              <div className="mt-4 rounded-2xl border border-black/10 bg-white/50 p-4">
                <p className="mb-3 text-xs font-bold tracking-wide text-black/55 uppercase">
                  Select Target User
                </p>

                <TextInput
                  type="text"
                  placeholder="Search by name, email or ID…"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                />

                <div className="mt-3">
                  {usersLoading ? (
                    <p className="flex items-center justify-center gap-2 py-4 text-sm text-black/45">
                      <Spinner className="h-4 w-4" />
                      Loading users…
                    </p>
                  ) : filteredUsers.length === 0 ? (
                    <p className="py-4 text-center text-sm text-black/45">No users found.</p>
                  ) : (
                    <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
                      {filteredUsers.map((u) => {
                        const isActive = form.targetUserIds.includes(u.id);
                        return (
                          <button
                            key={u.id}
                            type="button"
                            aria-pressed={isActive}
                            onClick={() =>
                              setForm((p) => {
                                const exists = p.targetUserIds.includes(u.id);

                                return {
                                  ...p,
                                  targetUserIds: exists
                                    ? p.targetUserIds.filter((id) => id !== u.id)
                                    : [...p.targetUserIds, u.id],
                                };
                              })
                            }
                            className={cx(
                              "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition",
                              isActive
                                ? "border-[#ff7a59] bg-[#ff7a59]/10"
                                : "border-transparent bg-white/70 hover:bg-white",
                            )}
                          >
                            {/* Avatar placeholder */}
                            <span
                              className={cx(
                                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                                isActive
                                  ? "bg-[#ff7a59] text-white"
                                  : "bg-[#ff7a59]/15 text-[#ff7a59]",
                              )}
                            >
                              {(u.displayName || u.email || "?").charAt(0).toUpperCase()}
                            </span>

                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-semibold text-black">
                                {u.displayName || "(no name)"}
                              </span>
                              <span className="block truncate text-xs text-black/50">
                                {u.email || u.id}
                              </span>
                            </span>

                            {/* Token indicator */}
                            <Badge tone={u.hasToken ? "green" : "red"}>
                              {u.hasToken ? "Token" : "No token"}
                            </Badge>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Selected user summary */}
                {selectedUsers.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedUsers.map((u) => (
                      <span
                        key={u.id}
                        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[#ff7a59]/30 bg-[#ff7a59]/10 px-3 py-1 text-xs"
                      >
                        <Check className="h-3.5 w-3.5 shrink-0 text-[#ff7a59]" aria-hidden />
                        <span className="truncate font-semibold text-black">
                          {u.displayName || u.email || u.id}
                        </span>
                        {!u.hasToken && (
                          <span className="inline-flex shrink-0 items-center gap-1 text-red-600">
                            <TriangleAlert className="h-3 w-3" aria-hidden />
                            No token
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Field>

          {/* ── Image Upload ── */}
          <Field label="Image (optional)">
            <div className="flex flex-col items-center gap-4 rounded-2xl border border-black/10 bg-white/50 px-4 py-5">
              {currentImagePreview ? (
                <img
                  src={currentImagePreview}
                  alt="Notification preview"
                  className="h-40 w-full rounded-xl border border-black/10 object-cover shadow-sm"
                />
              ) : (
                <div className="flex h-32 w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-black/20 bg-black/5 text-sm text-black/40">
                  <ImagePlus className="h-5 w-5" aria-hidden />
                  No image
                </div>
              )}
              <div className="flex flex-wrap items-center justify-center gap-3">
                <label className={cx(buttonClass("outline"), "cursor-pointer")}>
                  <Upload className="h-4 w-4" aria-hidden />
                  {editing ? "Change Image" : "Upload Image"}
                  <input
                    type="file"
                    hidden
                    accept="image/*"
                    onChange={(e) => {
                      setRemoveExistingImage(false);
                      setFile(e.target.files?.[0] || null);
                    }}
                  />
                </label>
                {(file || editing?.image) && (
                  <Button
                    type="button"
                    variant="danger"
                    onClick={() => {
                      setFile(null);
                      if (editing?.image) setRemoveExistingImage(true);
                    }}
                  >
                    Remove Image
                  </Button>
                )}
              </div>
            </div>
          </Field>
        </Modal>
      )}

      {/* ── View Modal ── */}
      {selected && (
        <Modal title="Notification Details" onClose={() => setSelected(null)}>
          <div className="space-y-5">
            {selected.image ? (
              <img
                src={selected.image}
                alt={selected.title}
                className="h-48 w-full rounded-2xl border border-black/10 object-cover"
              />
            ) : null}

            <div>
              <DetailLabel>Title</DetailLabel>
              <p className="mt-1 text-base font-semibold break-words">{selected.title}</p>
            </div>

            <div>
              <DetailLabel>Message</DetailLabel>
              <div className="mt-1.5 rounded-xl border border-black/10 bg-white p-4 text-sm whitespace-pre-wrap break-words">
                {selected.body}
              </div>
            </div>

            {/* Delivery info */}
            <div className="rounded-xl border border-black/10 bg-white/50 p-4">
              <DetailLabel>Delivery Details</DetailLabel>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <AudienceBadge item={selected} />
                {selected.deliveryMode === "topic" && selected.targetTopic && (
                  <Badge>Topic: {selected.targetTopic}</Badge>
                )}
                {selected.deliveryMode === "token" &&
                  Array.isArray(selected.targetUserIds) &&
                  selected.targetUserIds.length > 0 && (
                    <span className="rounded-lg bg-black/5 px-2 py-1 font-mono text-xs break-all text-black/70">
                      Users: {selected.targetUserIds.join(", ")}
                    </span>
                  )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-black/10 pt-3">
                <Badge tone={statusTone(statusOf(selected))} className="capitalize">
                  {statusOf(selected)}
                </Badge>
                <DeliveryCounts item={selected} className="text-sm" />
              </div>
            </div>

            {selected.errorMessage ? (
              <Alert surface="light">{selected.errorMessage}</Alert>
            ) : null}
          </div>
        </Modal>
      )}

      {/* ── Delete Modal ── */}
      {deleting && (
        <Modal
          title="Delete Notification"
          size="sm"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button variant="light" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button variant="danger-solid" onClick={confirmDelete}>
                Delete
              </Button>
            </>
          }
        >
          <p>
            Delete &ldquo;<span className="font-semibold">{deleting.title}</span>&rdquo;?
          </p>
          <p className="mt-2 text-sm text-black/60">
            This will permanently remove the notification and its image from storage.
          </p>
        </Modal>
      )}

      {/* ── Bulk Delete Modal ── */}
      {bulkDeleteMode && (
        <Modal
          title={
            bulkDeleteMode === "all"
              ? "Delete All Notifications"
              : "Delete Selected Notifications"
          }
          size="sm"
          onClose={() => {
            if (!bulkDeleting) setBulkDeleteMode(null);
          }}
          footer={
            <>
              <Button
                variant="light"
                onClick={() => setBulkDeleteMode(null)}
                disabled={bulkDeleting}
              >
                Cancel
              </Button>
              <Button variant="danger-solid" onClick={handleBulkDelete} loading={bulkDeleting}>
                {bulkDeleting
                  ? bulkDeleteMode === "all"
                    ? "Deleting All…"
                    : "Deleting…"
                  : bulkDeleteMode === "all"
                    ? "Delete All"
                    : "Delete Selected"}
              </Button>
            </>
          }
        >
          <p>
            {bulkDeleteMode === "all"
              ? "Are you sure you want to delete all notifications?"
              : `Are you sure you want to delete ${selectedCount} selected notification${selectedCount > 1 ? "s" : ""}?`}
          </p>
          <p className="mt-2 text-sm text-black/60">
            This action cannot be undone and will also remove related images from storage.
          </p>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Presentation helpers
// ─────────────────────────────────────────────────────────────────────────────

const statusOf = (item: NotificationItem): NotificationStatus =>
  item.status || (item.sent ? "sent" : "draft");

const STATUS_TONES: Record<NotificationStatus, BadgeTone> = {
  draft: "neutral",
  queued: "purple",
  sending: "blue",
  sent: "green",
  partial: "amber",
  failed: "red",
};

const statusTone = (status: NotificationStatus): BadgeTone =>
  STATUS_TONES[status] ?? "neutral";

function AudienceBadge({ item }: { item: NotificationItem }) {
  const targeted = item.deliveryMode === "token";
  const Icon = targeted ? User : Radio;
  return (
    <Badge>
      <Icon className="h-3 w-3" aria-hidden />
      {targeted ? "Targeted" : "All Users"}
    </Badge>
  );
}

function DeliveryCounts({ item, className }: { item: NotificationItem; className?: string }) {
  return (
    <p
      className={cx(
        "flex flex-wrap items-center gap-x-3 gap-y-1 text-xs whitespace-nowrap text-black/65",
        className,
      )}
    >
      <span className="inline-flex items-center gap-1">
        <CircleCheck className="h-3.5 w-3.5 text-emerald-700" aria-hidden />
        Success: {item.sentCount || 0}
      </span>
      <span className="inline-flex items-center gap-1">
        <CircleX className="h-3.5 w-3.5 text-red-600" aria-hidden />
        Failed: {item.failedCount || 0}
      </span>
    </p>
  );
}

function DetailLabel({ children }: { children: string }) {
  return (
    <p className="text-xs font-semibold tracking-wide text-black/50 uppercase">{children}</p>
  );
}

/* One of the two "Send To" choices in the create / edit modal. */
function AudienceOption({
  active,
  icon: Icon,
  title,
  hint,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        "flex flex-col items-center gap-1.5 rounded-2xl border-2 px-3 py-4 text-center text-sm font-semibold transition focus-visible:ring-2 focus-visible:ring-[#ff7a59]/40 focus-visible:outline-none",
        active
          ? "border-[#ff7a59] bg-[#ff7a59]/10 text-[#ff7a59]"
          : "border-black/10 bg-white/60 text-black/65 hover:border-black/25",
      )}
    >
      <Icon className="h-6 w-6" aria-hidden />
      <span>{title}</span>
      <span className="text-[11px] font-normal opacity-70">{hint}</span>
    </button>
  );
}

/* Form fields bound to a string value. */

function Input({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={label}>
      <TextInput value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

function Textarea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={label}>
      <TextArea value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}
