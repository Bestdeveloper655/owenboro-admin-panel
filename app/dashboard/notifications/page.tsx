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
  serverTimestamp,
} from "firebase/firestore";
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import { db, storage } from "@/lib/firebaseServices";

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

      const response = await fetch("/api/admin/notifications/send", {
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

  const getStatusBadge = (item: NotificationItem) => {
    const status = item.status || (item.sent ? "sent" : "draft");
    switch (status) {
      case "sent":     return "bg-green-100 text-green-700";
      case "partial":  return "bg-orange-100 text-orange-700";
      case "failed":   return "bg-red-100 text-red-700";
      case "sending":  return "bg-blue-100 text-blue-700";
      case "queued":   return "bg-purple-100 text-purple-700";
      default:         return "bg-yellow-100 text-yellow-700";
    }
  };

  const getDeliveryBadge = (item: NotificationItem) => {
    if (item.deliveryMode === "token")
      return "bg-indigo-100 text-indigo-700";
    return "bg-teal-100 text-teal-700";
  };

  const getDeliveryLabel = (item: NotificationItem) => {
    if (item.deliveryMode === "token") return "👤 Targeted";
    return "📡 All Users";
  };

const selectedUsers = users.filter((u) =>
  form.targetUserIds.includes(u.id)
);

  // ═══════════════════════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="px-4 pt-6 pb-10 md:px-8">
      {/* Header */}
      <div className="mb-8 flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-[#ff7a59] md:text-5xl">
            Notifications
          </h1>
          <p className="mt-2 text-lg font-medium text-[#e8dcc7] md:text-xl">
            Broadcast to all users via topic or target a specific user.
          </p>
        </div>
        <button
          onClick={openAddModal}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[#ff7a59] px-5 text-sm font-semibold text-[#ff7a59] transition hover:bg-[#ff7a59] hover:text-white"
        >
          <span>＋</span> Create Notification
        </button>
      </div>

      {/* Global error */}
      {error && !adding && !editing && (
        <div className="mb-6 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Bulk toolbar */}
      {!loading && notifications.length > 0 && (
        <div className="mb-6 rounded-2xl border border-white/10 bg-[#0a0a0a] p-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-[#f3ead7]">
                <input
                  type="checkbox"
                  checked={isAllCurrentPageSelected}
                  onChange={toggleSelectCurrentPage}
                  className="h-4 w-4 accent-[#ff7a59]"
                />
                Select all on this page
              </label>
              <span className="text-sm text-[#f3ead7]/70">
                Selected: {selectedCount}
              </span>
              {selectedCount > 0 && (
                <button
                  onClick={clearSelection}
                  className="rounded-lg border border-white/10 px-3 py-1 text-sm text-[#f3ead7] transition hover:bg-white/10"
                >
                  Clear Selection
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setBulkDeleteMode("selected")}
                disabled={selectedCount === 0}
                className="rounded-lg border border-red-400/40 px-4 py-2 text-sm font-semibold text-red-500 transition hover:bg-red-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Delete Selected
              </button>
              <button
                onClick={() => setBulkDeleteMode("all")}
                disabled={notifications.length === 0}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Delete All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="rounded-2xl border border-[#ff7a59]/40 bg-[#0a0a0a] px-5 py-10 text-center text-[#f3ead7]/70">
          Loading notifications...
        </div>
      ) : notifications.length === 0 ? (
        <div className="rounded-2xl border border-[#ff7a59]/40 bg-[#0a0a0a] px-5 py-10 text-center text-[#f3ead7]/70">
          No notifications found.
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {paginatedData.map((n) => {
            const checked = selectedIds.includes(n.id);
            return (
              <div
                key={n.id}
                className={`group flex flex-col justify-between rounded-2xl bg-[#ece2cb] p-4 text-black shadow-sm ring-1 ring-black/10 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/10 ${
                  checked ? "ring-2 ring-[#ff7a59]" : ""
                }`}
              >
                <div>
                  {/* Top row: checkbox + badges */}
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-xs font-semibold text-black/70">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelectOne(n.id)}
                        className="h-4 w-4 accent-[#ff7a59]"
                      />
                      Select
                    </label>
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${getDeliveryBadge(n)}`}
                      >
                        {getDeliveryLabel(n)}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${getStatusBadge(n)}`}
                      >
                        {n.status || (n.sent ? "sent" : "draft")}
                      </span>
                    </div>
                  </div>

                  {/* Image */}
                  {n.image ? (
                    <div className="overflow-hidden rounded-xl">
                      <img
                        src={n.image}
                        alt={n.title}
                        className="mb-3 h-36 w-full border border-black/10 object-cover transition duration-300 group-hover:scale-105"
                      />
                    </div>
                  ) : (
                    <div className="mb-3 flex h-36 w-full items-center justify-center rounded-xl border border-dashed border-black/15 bg-white/50 text-sm text-black/40">
                      No image
                    </div>
                  )}

                  {/* Title */}
                  <h3 className="truncate text-base font-semibold transition group-hover:text-[#ff7a59] md:text-lg">
                    {n.title}
                  </h3>

                  {/* Body */}
                  <p className="mt-2 line-clamp-3 text-sm text-black/65">
                    {n.body}
                  </p>

                  {/* Stats */}
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-black/5 px-2 py-1">
                      ✅ Success: {n.sentCount || 0}
                    </span>
                    <span className="rounded-full bg-black/5 px-2 py-1">
                      ❌ Failed: {n.failedCount || 0}
                    </span>
                  </div>

                  {/* Error */}
                  {n.errorMessage ? (
                    <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
                      {n.errorMessage}
                    </div>
                  ) : null}
                </div>

                {/* Action buttons */}
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => setSelected(n)}
                    className="inline-flex w-full items-center justify-center rounded-lg border border-black/10 px-3 py-2 text-xs font-semibold text-black transition-all duration-200 hover:bg-black hover:text-white md:text-sm"
                  >
                    View
                  </button>
                  <button
                    onClick={() => openEditModal(n)}
                    className="inline-flex w-full items-center justify-center rounded-lg bg-[#ff7a59] px-3 py-2 text-xs font-semibold text-white shadow-sm transition-all duration-200 hover:scale-[1.03] hover:shadow-md md:text-sm"
                  >
                    Update
                  </button>
                  <button
                    onClick={() => setDeleting(n)}
                    className="inline-flex w-full items-center justify-center rounded-lg border border-red-400/40 px-3 py-2 text-xs font-semibold text-red-500 transition-all duration-200 hover:scale-[1.03] hover:bg-red-500 hover:text-white hover:shadow-md md:text-sm"
                  >
                    Delete
                  </button>
                </div>

                <button
                  onClick={() =>
                    sendNotificationNow(n.id, {
                      mode: n.deliveryMode ?? "topic",
                      targetUserIds: n.targetUserIds || undefined,
                    })
                  }
                  disabled={sendingId === n.id}
                  className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-black px-3 py-2 text-xs font-semibold text-white transition-all duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
                >
                  {sendingId === n.id ? (
                    <>
                      <span className="animate-spin">⏳</span> Sending...
                    </>
                  ) : (
                    <>
                      <span>🚀</span> Send Now
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {notifications.length > perPage && (
        <div className="mt-8 flex items-center justify-between text-sm text-[#f3ead7]/70">
          <p>
            Showing {(safePage - 1) * perPage + 1}–
            {Math.min(safePage * perPage, notifications.length)} of{" "}
            {notifications.length} notifications
          </p>
          <div className="flex gap-2">
            <button
              disabled={safePage === 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-lg border border-white/10 px-3 py-1 disabled:opacity-40"
            >
              Previous
            </button>
            <button className="rounded-lg bg-[#ff7a59] px-3 py-1 text-white">
              {safePage}
            </button>
            <button
              disabled={safePage === totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-white/10 px-3 py-1 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* ── Create / Edit Modal ── */}
      {(adding || editing) && (
        <Modal
          title={adding ? "Create Notification" : "Edit Notification"}
          onClose={closeModal}
        >
          {error && (
            <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
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
          <div className="mt-5">
            <label className="text-sm font-semibold text-black">
              Send To
            </label>

            {/* Toggle pills */}
            <div className="mt-3 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() =>
                  setForm((p) => ({ ...p, deliveryMode: "topic", targetUserIds:  [] }))
                }
                className={`flex flex-col items-center gap-1.5 rounded-2xl border-2 px-4 py-4 text-sm font-semibold transition-all duration-200 ${
                  form.deliveryMode === "topic"
                    ? "border-[#ff7a59] bg-[#ff7a59]/10 text-[#ff7a59]"
                    : "border-black/10 bg-white/60 text-black/60 hover:border-black/25"
                }`}
              >
                <span className="text-2xl">📡</span>
                <span>All Users</span>
                <span className="text-[10px] font-normal opacity-70">
                  via topic: all_users
                </span>
              </button>

              <button
                type="button"
                onClick={() =>
                  setForm((p) => ({ ...p, deliveryMode: "token" }))
                }
                className={`flex flex-col items-center gap-1.5 rounded-2xl border-2 px-4 py-4 text-sm font-semibold transition-all duration-200 ${
                  form.deliveryMode === "token"
                    ? "border-[#ff7a59] bg-[#ff7a59]/10 text-[#ff7a59]"
                    : "border-black/10 bg-white/60 text-black/60 hover:border-black/25"
                }`}
              >
                <span className="text-2xl">👤</span>
                <span>Specific User</span>
                <span className="text-[10px] font-normal opacity-70">
                  via device token
                </span>
              </button>
            </div>

            {/* User picker */}
            {form.deliveryMode === "token" && (
              
              <div className="mt-4 rounded-2xl border border-[#ff7a59]/25 bg-white/40 p-4">
                <p className="mb-3 text-xs font-semibold text-black/60 uppercase tracking-wide">
                  Select Target User
                </p>

                {/* Search */}
                <input
                  type="text"
                  placeholder="Search by name, email or ID…"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  className="mb-3 w-full rounded-xl border border-[#ff7a59]/40 bg-white px-3 py-2.5 text-sm text-black placeholder:text-black/35 focus:outline-none focus:ring-2 focus:ring-[#ff7a59]"
                />

                {usersLoading ? (
                  <p className="py-4 text-center text-sm text-black/40">
                    Loading users…
                  </p>
                ) : filteredUsers.length === 0 ? (
                  <p className="py-4 text-center text-sm text-black/40">
                    No users found.
                  </p>
                ) : (
                  <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
                    {filteredUsers.map((u) => {
                     const isActive = form.targetUserIds.includes(u.id);
                      return (
                        <button
                          key={u.id}
                          type="button"
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
                          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-all duration-150 ${
                            isActive
                              ? "bg-[#ff7a59] text-white"
                              : "bg-white/70 text-black hover:bg-white"
                          }`}
                        >
                          {/* Avatar placeholder */}
                          <div
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                              isActive
                                ? "bg-white/25 text-white"
                                : "bg-[#ff7a59]/15 text-[#ff7a59]"
                            }`}
                          >
                            {(u.displayName || u.email || "?")
                              .charAt(0)
                              .toUpperCase()}
                          </div>

                          <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold">
                              {u.displayName || "(no name)"}
                            </p>
                            <p
                              className={`truncate text-xs ${
                                isActive ? "text-white/75" : "text-black/50"
                              }`}
                            >
                              {u.email || u.id}
                            </p>
                          </div>

                          {/* Token indicator */}
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              u.hasToken
                                ? isActive
                                  ? "bg-white/20 text-white"
                                  : "bg-green-100 text-green-700"
                                : isActive
                                  ? "bg-white/20 text-white/70"
                                  : "bg-red-100 text-red-500"
                            }`}
                          >
                            {u.hasToken ? "● Token" : "No token"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Selected user summary */}
            {selectedUsers.length > 0 && (
                 <div className="mt-3 flex flex-wrap gap-2">
  {selectedUsers.map((u) => (
    <div
      key={u.id}
      className="flex items-center gap-2 rounded-xl border border-[#ff7a59]/30 bg-[#ff7a59]/5 px-3 py-2 text-sm"
    >
      <span className="text-[#ff7a59]">✓</span>
      <span className="font-semibold text-black">
        {u.displayName || u.email || u.id}
      </span>

      {!u.hasToken && (
        <span className="text-xs text-red-500">⚠ No token</span>
      )}
    </div>
  ))}
</div>
                )}
              </div>
            )}
          </div>

          {/* ── Image Upload ── */}
          <div className="mt-5">
            <label className="text-sm font-semibold text-black">
              Image (optional)
            </label>
            <div className="mt-3 flex flex-col items-center gap-4 rounded-2xl border border-[#ff7a59]/25 bg-white/35 px-4 py-5">
              {currentImagePreview ? (
                <img
                  src={currentImagePreview}
                  alt="Notification preview"
                  className="h-32 w-full rounded-2xl border border-black/10 object-cover shadow-sm"
                />
              ) : (
                <div className="flex h-32 w-full items-center justify-center rounded-2xl border border-dashed border-black/20 bg-black/5 text-sm text-black/40">
                  No image
                </div>
              )}
              <div className="flex flex-wrap items-center justify-center gap-3">
                <label className="cursor-pointer rounded-xl border border-[#ff7a59] px-4 py-2 text-sm font-semibold text-[#ff7a59] transition hover:bg-[#ff7a59] hover:text-white">
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
                  <button
                    type="button"
                    onClick={() => {
                      setFile(null);
                      if (editing?.image) setRemoveExistingImage(true);
                    }}
                    className="rounded-xl border border-red-400 px-4 py-2 text-sm font-semibold text-red-500 transition hover:bg-red-500 hover:text-white"
                  >
                    Remove Image
                  </button>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={adding ? handleAdd : handleUpdate}
            disabled={saving}
            className="mt-6 w-full rounded-xl bg-[#ff7a59] py-3 text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving
              ? adding
                ? "Creating…"
                : "Saving…"
              : adding
                ? form.deliveryMode === "topic"
                  ? "🚀 Create & Send to All Users"
                  : "🚀 Create & Send to User"
                : "Save Changes"}
          </button>
        </Modal>
      )}

      {/* ── View Modal ── */}
      {selected && (
        <Modal title="Notification Details" onClose={() => setSelected(null)}>
          <div className="space-y-4 text-black">
            {selected.image ? (
              <img
                src={selected.image}
                alt={selected.title}
                className="h-40 w-full rounded-2xl border border-black/10 object-cover"
              />
            ) : null}

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-black/50">
                Title
              </p>
              <p className="mt-1 text-base font-semibold">{selected.title}</p>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-black/50">
                Message
              </p>
              <div className="mt-1 rounded-xl border border-black/10 bg-white p-4 text-sm">
                {selected.body}
              </div>
            </div>

            {/* Delivery info */}
            <div className="rounded-xl border border-black/10 bg-white/60 p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-black/50">
                Delivery Details
              </p>
              <div className="flex flex-wrap gap-2 text-sm">
                <span
                  className={`rounded-full px-3 py-1 font-semibold ${getDeliveryBadge(selected)}`}
                >
                  {getDeliveryLabel(selected)}
                </span>
                {selected.deliveryMode === "topic" && selected.targetTopic && (
                  <span className="rounded-full bg-black/5 px-3 py-1">
                    Topic: {selected.targetTopic}
                  </span>
                )}
              {selected.deliveryMode === "token" &&
  Array.isArray(selected.targetUserIds) &&
  selected.targetUserIds.length > 0 && (
    <span className="rounded-full bg-black/5 px-3 py-1 font-mono text-xs">
      Users: {selected.targetUserIds.join(", ")}
    </span>
)}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 text-sm">
              <span
                className={`rounded-full px-3 py-1 font-semibold ${getStatusBadge(selected)}`}
              >
                {selected.status || (selected.sent ? "sent" : "draft")}
              </span>
              <span className="rounded-full bg-black/5 px-3 py-1">
                ✅ Success: {selected.sentCount || 0}
              </span>
              <span className="rounded-full bg-black/5 px-3 py-1">
                ❌ Failed: {selected.failedCount || 0}
              </span>
            </div>

            {selected.errorMessage ? (
              <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-600">
                {selected.errorMessage}
              </div>
            ) : null}
          </div>
        </Modal>
      )}

      {/* ── Delete Modal ── */}
      {deleting && (
        <Modal title="Delete Notification" onClose={() => setDeleting(null)}>
          <p className="text-black">
            Delete{" "}
            <span className="font-semibold">"{deleting.title}"</span>?
          </p>
          <p className="mt-2 text-sm text-black/60">
            This will permanently remove the notification and its image from storage.
          </p>
          <div className="mt-6 flex justify-end gap-3">
            <button
              onClick={() => setDeleting(null)}
              className="rounded-xl border border-black/15 px-4 py-2 text-black"
            >
              Cancel
            </button>
            <button
              onClick={confirmDelete}
              className="rounded-xl bg-red-500 px-4 py-2 font-semibold text-white"
            >
              Delete
            </button>
          </div>
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
          onClose={() => {
            if (!bulkDeleting) setBulkDeleteMode(null);
          }}
        >
          <p className="text-black">
            {bulkDeleteMode === "all"
              ? "Are you sure you want to delete all notifications?"
              : `Are you sure you want to delete ${selectedCount} selected notification${selectedCount > 1 ? "s" : ""}?`}
          </p>
          <p className="mt-2 text-sm text-black/60">
            This action cannot be undone and will also remove related images from storage.
          </p>
          <div className="mt-6 flex justify-end gap-3">
            <button
              onClick={() => setBulkDeleteMode(null)}
              disabled={bulkDeleting}
              className="rounded-xl border border-black/15 px-4 py-2 text-black disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
              className="rounded-xl bg-red-500 px-4 py-2 font-semibold text-white disabled:opacity-50"
            >
              {bulkDeleting
                ? bulkDeleteMode === "all"
                  ? "Deleting All…"
                  : "Deleting…"
                : bulkDeleteMode === "all"
                  ? "Delete All"
                  : "Delete Selected"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Shared UI components
// ─────────────────────────────────────────────────────────────────────────────

function Modal({
  children,
  title,
  onClose,
}: {
  children: React.ReactNode;
  title: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-[#e8dcc7] p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-[#ff7a59]">{title}</h2>
          <button
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-black/10 text-black transition hover:bg-black/20"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

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
    <div className="mt-4">
      <label className="text-sm font-semibold text-black">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 w-full rounded-xl border border-[#ff7a59] bg-white px-4 py-3 text-black placeholder:text-black/35 focus:outline-none focus:ring-2 focus:ring-[#ff7a59]"
      />
    </div>
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
    <div className="mt-4">
      <label className="text-sm font-semibold text-black">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 h-28 w-full rounded-xl border border-[#ff7a59] bg-white px-4 py-3 text-black placeholder:text-black/35 focus:outline-none focus:ring-2 focus:ring-[#ff7a59]"
      />
    </div>
  );
}