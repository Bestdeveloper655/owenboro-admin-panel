"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebaseServices";

/* TYPES */
type Request = {
  id: string;
  name: string;
  email: string;
  message: string;
  timestamp: any;
  read: boolean;
};

export default function Page() {
  const [requests, setRequests] = useState<Request[]>([]);
  const [selected, setSelected] = useState<Request | null>(null);
  const [deleting, setDeleting] = useState<Request | null>(null);
  const [busy, setBusy] = useState(false);
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);

  const [page, setPage] = useState(1);
  const perPage = 8;

  /* FETCH */
useEffect(() => {
  const fetchData = async () => {

    const q = query(
      collection(db, "ContactUs"),
      orderBy("timestamp", "desc")
    );

    // ✅ YOU MISSED THIS LINE
    const snap = await getDocs(q);

    const data = snap.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id,
        name: x.name,
        email: x.email,
        message: x.message,
        timestamp: x.timestamp,
        read: x.read === true,
      };
    });

    setRequests(data);
  };

  fetchData();
}, []);

  const unreadCount = requests.filter((r) => !r.read).length;
  const visible = useMemo(
    () => (showUnreadOnly ? requests.filter((r) => !r.read) : requests),
    [requests, showUnreadOnly],
  );

  /* READ STATE */
  const setRead = async (request: Request, read: boolean) => {
    setRequests((prev) => prev.map((r) => (r.id === request.id ? { ...r, read } : r)));
    try {
      await updateDoc(doc(db, "ContactUs", request.id), {
        read,
        readAt: read ? serverTimestamp() : null,
      });
    } catch (err) {
      console.error(err);
      setRequests((prev) =>
        prev.map((r) => (r.id === request.id ? { ...r, read: request.read } : r)),
      );
    }
  };

  const openRequest = (request: Request) => {
    setSelected(request);
    if (!request.read) setRead(request, true);
  };

  const markAllRead = async () => {
    const unread = requests.filter((r) => !r.read);
    if (unread.length === 0) return;
    if (!window.confirm(`Mark all ${unread.length} unread messages as read?`)) return;
    try {
      setBusy(true);
      for (let i = 0; i < unread.length; i += 450) {
        const batch = writeBatch(db);
        unread.slice(i, i + 450).forEach((r) =>
          batch.update(doc(db, "ContactUs", r.id), { read: true, readAt: serverTimestamp() }),
        );
        await batch.commit();
      }
      setRequests((prev) => prev.map((r) => ({ ...r, read: true })));
    } catch (err) {
      console.error(err);
      alert("Failed to mark all messages as read.");
    } finally {
      setBusy(false);
    }
  };

  /* DELETE */
  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      setBusy(true);
      await deleteDoc(doc(db, "ContactUs", deleting.id));
      setRequests((prev) => prev.filter((r) => r.id !== deleting.id));
      if (selected?.id === deleting.id) setSelected(null);
      setDeleting(null);
    } catch (err) {
      console.error(err);
      alert("Failed to delete the message.");
    } finally {
      setBusy(false);
    }
  };

  /* EXPORT CSV */
  const exportToCSV = () => {
    if (requests.length === 0) return;

    const headers = ["Name", "Email", "Message", "Date"];

    const rows = requests.map((r) => [
      r.name,
      r.email,
      r.message?.replace(/\n/g, " "),
      r.timestamp?.toDate
        ? r.timestamp.toDate().toLocaleString()
        : "",
    ]);

    const csvContent = [headers, ...rows]
      .map((row) =>
        row
          .map((cell) => `"${String(cell || "").replace(/"/g, '""')}"`)
          .join(",")
      )
      .join("\n");

    const blob = new Blob([csvContent], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `support_requests_${Date.now()}.csv`;
    link.click();
  };

  /* PAGINATION */
  const totalPages = Math.ceil(visible.length / perPage);

  const paginated = visible.slice(
    (page - 1) * perPage,
    page * perPage
  );

  return (
    <div className="px-4 pt-6 pb-10 md:px-8">

      {/* HEADER */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[#ff7a59] sm:text-4xl md:text-5xl">
            All Support Requests
          </h1>

          <p className="mt-2 text-base font-medium text-[#e8dcc7] sm:text-lg md:text-xl">
            General questions or requests for information.
          </p>
        </div>

        <button
          onClick={exportToCSV}
          className="self-start rounded-xl border border-[#ff7a59] px-4 py-2 text-sm text-[#ff7a59] transition hover:bg-[#ff7a59] hover:text-white sm:self-auto sm:px-5 sm:text-base"
        >
          Export CSV
        </button>
      </div>

      {/* MAIN */}
      <section className="mt-8 rounded-[28px] border border-[#ff7a59]/70 bg-[#0a0a0a] p-5 md:p-6">

        <div className="mb-6">
          <h2 className="text-2xl font-bold text-[#ff7a59] md:text-4xl">
            Requests ({requests.length})
            {unreadCount > 0 && (
              <span className="ml-3 align-middle rounded-full bg-[#ff7a59] px-3 py-1 text-sm font-semibold text-white">
                {unreadCount} unread
              </span>
            )}
          </h2>

          <p className="mt-2 text-[#f3ead7]">
            Manage incoming support messages efficiently.
          </p>

          <div className="mt-4 inline-flex rounded-xl border border-[#ff7a59]/50 bg-black p-1 text-sm">
            {[false, true].map((unread) => (
              <button
                key={String(unread)}
                type="button"
                onClick={() => {
                  setShowUnreadOnly(unread);
                  setPage(1);
                }}
                className={`rounded-lg px-4 py-1.5 transition ${
                  showUnreadOnly === unread
                    ? "bg-[#ff7a59] text-white"
                    : "text-[#f3ead7]/80 hover:text-[#ff7a59]"
                }`}
              >
                {unread ? "Unread" : "All"}
              </button>
            ))}
          </div>

          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              disabled={busy}
              className="ml-3 rounded-xl border border-white/20 px-4 py-2 text-sm text-[#f3ead7] hover:border-[#ff7a59] hover:text-[#ff7a59] disabled:opacity-50"
            >
              Mark all read
            </button>
          )}
        </div>

        {/* TABLE */}
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[700px] text-left">
            <thead className="bg-[#ece2cb] text-black">
              <tr>
                <th className="p-3">Name</th>
                <th className="p-3">Email</th>
                <th className="p-3">Message</th>
                <th className="p-3">Date</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>

            <tbody>
              {paginated.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-white/10 bg-[#ece2cb] text-black hover:bg-[#f5ecd7]"
                >
                  <td className="p-3 font-semibold">
                    <span className="inline-flex items-center gap-2">
                      {!r.read && (
                        <span className="h-2.5 w-2.5 rounded-full bg-[#ff7a59]" aria-label="Unread" />
                      )}
                      <span className={r.read ? "font-normal" : ""}>{r.name}</span>
                    </span>
                  </td>

                  <td className="p-3 text-[#ff7a59] truncate">
                    {r.email}
                  </td>

                  <td className="p-3 text-black/70 max-w-[300px] truncate">
                    {r.message}
                  </td>

                  <td className="p-3 text-black/60">
                    {r.timestamp?.toDate
                      ? r.timestamp.toDate().toLocaleDateString()
                      : "-"}
                  </td>

                  <td className="p-3">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => openRequest(r)}
                        className="rounded-lg bg-[#ff7a59] px-3 py-1 text-xs text-white"
                      >
                        View
                      </button>
                      <button
                        onClick={() => setRead(r, !r.read)}
                        className="rounded-lg border border-black/20 px-3 py-1 text-xs"
                      >
                        {r.read ? "Mark unread" : "Mark read"}
                      </button>
                      <button
                        onClick={() => setDeleting(r)}
                        className="rounded-lg border border-red-400 px-3 py-1 text-xs text-red-500 hover:bg-red-500 hover:text-white"
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
        {totalPages > 1 && (
         <div className="mt-8 flex flex-col md:flex-row items-center justify-between gap-4 text-[#f3ead7]">

  {/* INFO */}
  <p className="text-sm text-[#f3ead7]/70">
    Showing {(page - 1) * perPage + 1}–{Math.min(page * perPage, visible.length)} of {visible.length}
  </p>

  {/* CONTROLS */}
  <div className="flex items-center gap-2">

    {/* PREV */}
    <button
      disabled={page === 1}
      onClick={() => setPage(page - 1)}
      className="px-3 py-1 rounded-lg border border-white/10 disabled:opacity-30 hover:bg-white/10 transition"
    >
      Prev
    </button>

    {/* PAGE NUMBERS */}
    {Array.from({ length: totalPages }).map((_, i) => {
      const p = i + 1;

      // limit visible pages (nice UX)
      if (
        p !== 1 &&
        p !== totalPages &&
        Math.abs(p - page) > 1
      ) return null;

      return (
        <button
          key={p}
          onClick={() => setPage(p)}
          className={`px-3 py-1 rounded-lg text-sm transition
            ${page === p
              ? "bg-[#ff7a59] text-white"
              : "border border-white/10 hover:bg-white/10"
            }`}
        >
          {p}
        </button>
      );
    })}

    {/* NEXT */}
    <button
      disabled={page === totalPages}
      onClick={() => setPage(page + 1)}
      className="px-3 py-1 rounded-lg border border-white/10 disabled:opacity-30 hover:bg-white/10 transition"
    >
      Next
    </button>

  </div>
</div>
        )}
      </section>

      {/* VIEW MODAL */}
      {selected && (
        <Modal title="Support Request" onClose={() => setSelected(null)}>
          <div className="space-y-3 text-black">

            <p><b>Name:</b> {selected.name}</p>
            <p><b>Email:</b> {selected.email}</p>

            <p><b>Message:</b></p>

            <div className="p-3 bg-white rounded-lg border whitespace-pre-wrap">
              {selected.message}
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => {
                  setRead(selected, false);
                  setSelected(null);
                }}
                className="rounded-xl border border-black/20 px-4 py-2 text-sm"
              >
                Mark unread
              </button>
              <button
                onClick={() => setDeleting(selected)}
                className="rounded-xl bg-red-500 px-4 py-2 text-sm text-white"
              >
                Delete
              </button>
            </div>

          </div>
        </Modal>
      )}

      {/* DELETE CONFIRM */}
      {deleting && (
        <Modal title="Delete message" onClose={() => setDeleting(null)}>
          <p className="text-black">
            Delete the message from <b>{deleting.name || deleting.email}</b>? This
            can&rsquo;t be undone.
          </p>
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

/* MODAL */
function Modal({ children, title, onClose }: any) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6">
      
      <div className="w-full max-w-2xl max-h-[90vh] rounded-3xl bg-[#e8dcc7] shadow-2xl flex flex-col overflow-hidden">
        
        {/* HEADER (STICKY) */}
        <div className="flex items-center justify-between p-5 border-b border-black/10 bg-[#e8dcc7] sticky top-0 z-10">
          <h2 className="text-xl font-bold text-[#ff7a59]">{title}</h2>

          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-black/10 text-black hover:bg-black/20 transition"
          >
            ✕
          </button>
        </div>

        {/* CONTENT (SCROLLABLE) */}
        <div className="p-5 overflow-y-auto text-black">
          {children}
        </div>

      </div>
    </div>
  );
}