"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebaseServices";

type User = {
  id: string;
  name: string;
  email: string;
  phone: string;
  uid: string;
  createdAt: any;
  isVerified: boolean;
};

export default function Page() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<User | null>(null);

  const [page, setPage] = useState(1);
  const perPage = 9;

  /* FETCH */
useEffect(() => {
  const fetchUsers = async () => {
    const snap = await getDocs(collection(db, "Users"));

    const data = snap.docs.map((d) => {
      const x = d.data();

      return {
        id: d.id,
        name: x.full_name || x.display_name || "No Name",
        email: x.email || "",
        phone: x.phone_number || "",
        uid: x.uid || "",
        createdAt: x.created_time || null,
        isVerified: x.is_verified === true,
      };
    });

    data.sort((a, b) => {
      const aTime = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
      const bTime = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
      return bTime - aTime;
    });

    setUsers(data);
    setLoading(false);
  };

  fetchUsers();
}, []);

  /* EXPORT CSV */
  const exportCSV = () => {
    const headers = ["Name", "Email", "Phone", "UID", "Created Time"];

    const rows = users.map((u) => [
      u.name,
      u.email,
      u.phone,
      u.uid,
      u.createdAt?.toDate
        ? u.createdAt.toDate().toLocaleString()
        : "",
    ]);

    const csv = [headers, ...rows]
      .map((r) =>
        r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")
      )
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `users_${Date.now()}.csv`;
    a.click();
  };

  /* PAGINATION */
  const totalPages = Math.max(1, Math.ceil(users.length / perPage));

  const paginated = useMemo(() => {
    const start = (page - 1) * perPage;
    return users.slice(start, start + perPage);
  }, [users, page]);

  return (
    <div className="px-2 pt-4 pb-8 sm:px-6 sm:pt-6 sm:pb-10">
      {/* HEADER */}
      <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[#ff7a59] sm:text-4xl lg:text-5xl">
            All Users Info
          </h1>
          <p className="mt-2 text-base text-[#e8dcc7] sm:text-lg">
            All users information is listed here.
          </p>
        </div>

        <button
          onClick={exportCSV}
          className="self-start rounded-xl border border-[#ff7a59] px-4 py-2 text-sm text-[#ff7a59] hover:bg-[#ff7a59] hover:text-white sm:self-auto sm:px-5 sm:text-base"
        >
          Export CSV
        </button>
      </div>

      {/* TABLE */}
      <section className="rounded-3xl border border-[#ff7a59]/40 bg-[#0a0a0a] p-6">

        <h2 className="mb-6 text-xl font-bold text-[#ff7a59] sm:text-2xl lg:text-3xl">
          Users ({users.length})
        </h2>

        {loading ? (
          <p className="text-[#f3ead7]">Loading...</p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-2xl border border-white/10">
              <table className="w-full min-w-[700px] text-left">
                <thead className="bg-[#ece2cb] text-black">
                  <tr>
                    <th className="p-3">Name</th>
                    <th className="p-3">Email</th>
                    <th className="p-3">Phone</th>
                    <th className="p-3">UID</th>
                    <th className="p-3">Created</th>
                    <th className="p-3 text-right">View</th>
                  </tr>
                </thead>

                <tbody>
                  {paginated.map((u) => (
                    <tr
                      key={u.id}
                      className="border-b bg-[#ece2cb] text-black hover:bg-[#f5ecd7]"
                    >
                      <td className="p-3 font-semibold">
                        <span className="inline-flex items-center gap-1.5">
                          {u.name}
                          {u.isVerified && <VerifiedBadge />}
                        </span>
                      </td>
                      <td className="p-3 text-[#ff7a59]">{u.email}</td>
                      <td className="p-3">{u.phone}</td>
                      <td className="p-3 text-xs">{u.uid}</td>
                      <td className="p-3 text-black/60">
                        {u.createdAt?.toDate
                          ? u.createdAt.toDate().toLocaleDateString()
                          : "-"}
                      </td>

                      <td className="p-3 text-right">
                        <button
                          onClick={() => setSelected(u)}
                          className="rounded-lg bg-[#ff7a59] px-3 py-1 text-white text-xs"
                        >
                          View
                        </button>
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
                {Math.min(page * perPage, users.length)} of {users.length}
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
                  ) return null;

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

      {/* USER DETAILS MODAL */}
      {selected && (
        <Modal title="User Details" onClose={() => setSelected(null)}>
          <div className="space-y-3 text-black">
            <p className="flex items-center gap-2">
              <b>Name:</b> {selected.name}
              {selected.isVerified && <VerifiedBadge />}
            </p>
            <p>
              <b>Verified:</b> {selected.isVerified ? "Yes" : "No"}
            </p>
            <p><b>Email:</b> {selected.email}</p>
            <p><b>Phone:</b> {selected.phone}</p>
            <p><b>UID:</b> {selected.uid}</p>
            <p>
              <b>Created:</b>{" "}
              {selected.createdAt?.toDate
                ? selected.createdAt.toDate().toLocaleString()
                : "-"}
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* VERIFIED BADGE — blue check shown next to verified users */
function VerifiedBadge() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="inline-block h-4 w-4 shrink-0"
      aria-label="Verified"
      role="img"
    >
      <title>Verified</title>
      <path
        fill="#1E88E5"
        d="M12 2l2.39 1.74 2.95-.02 1.06 2.79 2.65 1.31-.55 2.94L23 12l-2.45 1.24.55 2.94-2.65 1.31-1.06 2.79-2.95-.02L12 22l-2.39-1.74-2.95.02-1.06-2.79L2.95 16.18 3.5 13.24 1 12l2.45-1.24-.55-2.94 2.65-1.31L6.61 3.72l2.95.02L12 2z"
      />
      <path
        fill="#fff"
        d="M10.6 14.6l-2.3-2.3-1.1 1.1 3.4 3.4 6-6-1.1-1.1z"
      />
    </svg>
  );
}

/* MODAL */
function Modal({ children, title, onClose }: any) {
  return (
    <div className="fixed inset-0 bg-black/70 flex justify-center items-center">
      <div className="bg-[#e8dcc7] p-6 rounded-3xl w-[90%] max-w-lg">
        <div className="flex justify-between mb-4">
          <h2 className="text-xl font-bold text-[#ff7a59]">{title}</h2>
          <button onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}