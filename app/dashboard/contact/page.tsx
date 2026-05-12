"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebaseServices";

/* TYPES */
type Request = {
  id: string;
  name: string;
  email: string;
  message: string;
  timestamp: any;
};

export default function Page() {
  const [requests, setRequests] = useState<Request[]>([]);
  const [selected, setSelected] = useState<Request | null>(null);

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
      };
    });

    setRequests(data);
  };

  fetchData();
}, []);

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
  const totalPages = Math.ceil(requests.length / perPage);

  const paginated = requests.slice(
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
          </h2>

          <p className="mt-2 text-[#f3ead7]">
            Manage incoming support messages efficiently.
          </p>
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
                  <td className="p-3 font-semibold">{r.name}</td>

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
                    <div className="flex justify-end">
                      <button
                        onClick={() => setSelected(r)}
                        className="rounded-lg bg-[#ff7a59] px-3 py-1 text-xs text-white"
                      >
                        View
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
    Showing {(page - 1) * perPage + 1}–{Math.min(page * perPage, requests.length)} of {requests.length}
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

            <div className="p-3 bg-white rounded-lg border">
              {selected.message}
            </div>

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