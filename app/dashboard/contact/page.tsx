"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCheck, Download, Inbox, Mail, Trash2 } from "lucide-react";
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
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  LoadingState,
  Modal,
  PageHeader,
  Pagination,
  Segmented,
  Toolbar,
  cx,
  table,
} from "@/components/ui";

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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [page, setPage] = useState(1);
  const perPage = 8;

    /* FETCH */
  useEffect(() => {
    const fetchData = async () => {
      try {
        const q = query(collection(db, "ContactUs"), orderBy("timestamp", "desc"));
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
      } catch (err) {
        console.error(err);
        setLoadError("Failed to load support requests.");
      } finally {
        setLoading(false);
      }
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
    <div>
      <PageHeader
        title="All Support Requests"
        description="General questions or requests for information."
        actions={
          <Button variant="outline" icon={Download} onClick={exportToCSV}>
            Export CSV
          </Button>
        }
      >
        <p className="mt-1 text-sm text-[#e8dcc7]/70">
          Manage incoming support messages efficiently.
        </p>
      </PageHeader>

      <Toolbar>
        <Segmented<"all" | "unread">
          value={showUnreadOnly ? "unread" : "all"}
          onChange={(value) => {
            setShowUnreadOnly(value === "unread");
            setPage(1);
          }}
          options={[
            { value: "all", label: "All", count: requests.length },
            { value: "unread", label: "Unread", count: unreadCount },
          ]}
        />

        {unreadCount > 0 && (
          <Button variant="secondary" icon={CheckCheck} onClick={markAllRead} disabled={busy}>
            Mark all read
          </Button>
        )}
      </Toolbar>

      {loadError && (
        <Alert className="mb-6" onDismiss={() => setLoadError("")}>
          {loadError}
        </Alert>
      )}

      {/* TABLE */}
      {loading ? (
        <LoadingState label="Loading support requests…" />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={showUnreadOnly ? "No unread messages." : "No support requests yet."}
        />
      ) : (
        <div className={table.wrap}>
          <table className={`${table.table} min-w-[860px]`}>
            <thead className={table.thead}>
              <tr>
                <th className={table.th}>Name</th>
                <th className={table.th}>Email</th>
                <th className={table.th}>Message</th>
                <th className={table.th}>Date</th>
                <th className={`${table.th} text-right`}>Action</th>
              </tr>
            </thead>

            <tbody>
              {paginated.map((r) => {
                /* Unread rows are lighter, bold and marked with an orange edge. */
                const cell = cx(table.td, !r.read && "bg-white/45");
                return (
                  <tr key={r.id} className={table.row}>
                    <td className={cx(cell, !r.read && "shadow-[inset_3px_0_0_0_#ff7a59]")}>
                      <span className="flex flex-wrap items-center gap-2">
                        <span className={r.read ? "text-black/75" : "font-semibold"}>{r.name}</span>
                        {!r.read && <Badge tone="orange">Unread</Badge>}
                      </span>
                    </td>

                    <td className={cx(cell, "text-black/70")}>
                      <span className="block max-w-[220px] truncate" title={r.email}>
                        {r.email}
                      </span>
                    </td>

                    <td className={cx(cell, r.read ? "text-black/55" : "text-black/80")}>
                      <span className="block max-w-[320px] truncate">{r.message}</span>
                    </td>

                    <td className={cx(cell, "whitespace-nowrap text-black/60")}>
                      {r.timestamp?.toDate ? r.timestamp.toDate().toLocaleDateString() : "-"}
                    </td>

                    <td className={cell}>
                      <div className={table.actions}>
                        <Button size="sm" onClick={() => openRequest(r)}>
                          View
                        </Button>
                        <Button size="sm" variant="light" onClick={() => setRead(r, !r.read)}>
                          {r.read ? "Mark unread" : "Mark read"}
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => setDeleting(r)}>
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

      {/* PAGINATION */}
      {visible.length > 0 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          total={visible.length}
          perPage={perPage}
        />
      )}

      {/* VIEW MODAL */}
      {selected && (
        <Modal
          title="Support Request"
          onClose={() => setSelected(null)}
          footer={
            <>
              <Button
                variant="light"
                icon={Mail}
                onClick={() => {
                  setRead(selected, false);
                  setSelected(null);
                }}
              >
                Mark unread
              </Button>
              <Button variant="danger" icon={Trash2} onClick={() => setDeleting(selected)}>
                Delete
              </Button>
            </>
          }
        >
          <dl className="grid gap-4 rounded-2xl border border-black/10 bg-white/50 p-4 text-sm sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-xs font-semibold tracking-wide text-black/50 uppercase">Name</dt>
              <dd className="mt-0.5 font-medium wrap-break-word">{selected.name}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs font-semibold tracking-wide text-black/50 uppercase">Email</dt>
              <dd className="mt-0.5 break-all">{selected.email}</dd>
            </div>
          </dl>

          <p className="mt-5 mb-2 text-xs font-semibold tracking-wide text-black/50 uppercase">
            Message
          </p>
          <div className="rounded-2xl border border-black/10 bg-white p-4 text-sm wrap-break-word whitespace-pre-wrap">
            {selected.message}
          </div>
        </Modal>
      )}

      {/* DELETE CONFIRM */}
      {deleting && (
        <Modal
          title="Delete message"
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
            Delete the message from{" "}
            <span className="font-semibold">{deleting.name || deleting.email}</span>? This
            can&rsquo;t be undone.
          </p>
        </Modal>
      )}
    </div>
  );
}
