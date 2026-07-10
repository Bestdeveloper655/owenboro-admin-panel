"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebaseServices";

// Users pick a "newsletter / promotional messages" checkbox when creating their
// account on the mobile app. That choice is stored on the Users doc as
// `promo_opt_in` (boolean). This page lets admins see who opted in/out so they
// can build a newsletter list. Accounts created before the checkbox shipped
// have no value — shown under "Not answered".

type OptStatus = "in" | "out" | "unknown";

type Subscriber = {
  id: string;
  name: string;
  email: string;
  phone: string;
  uid: string;
  createdAt: any;
  status: OptStatus;
};

type Tab = "in" | "out" | "unknown";

const TABS: { value: Tab; label: string }[] = [
  { value: "in", label: "Opted In" },
  { value: "out", label: "Opted Out" },
  { value: "unknown", label: "Not answered" },
];

function fmtDate(ts: any): string {
  return ts?.toDate ? ts.toDate().toLocaleDateString() : "-";
}

export default function Page() {
  const [subs, setSubs] = useState<Subscriber[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("in");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const perPage = 12;

  useEffect(() => {
    const fetchSubs = async () => {
      try {
        const snap = await getDocs(collection(db, "Users"));
        const data: Subscriber[] = snap.docs.map((d) => {
          const x = d.data();
          const raw = x.promo_opt_in;
          const status: OptStatus =
            raw === true ? "in" : raw === false ? "out" : "unknown";
          return {
            id: d.id,
            name: x.full_name || x.display_name || "No Name",
            email: x.email || "",
            phone: x.phone_number || "",
            uid: x.uid || d.id,
            createdAt: x.created_time || null,
            status,
          };
        });
        data.sort((a, b) => {
          const at = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
          const bt = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
          return bt - at;
        });
        setSubs(data);
      } catch (e) {
        console.error("Failed to load subscribers:", e);
      } finally {
        setLoading(false);
      }
    };
    fetchSubs();
  }, []);

  const counts = useMemo(
    () => ({
      in: subs.filter((s) => s.status === "in").length,
      out: subs.filter((s) => s.status === "out").length,
      unknown: subs.filter((s) => s.status === "unknown").length,
    }),
    [subs],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return subs
      .filter((s) => s.status === tab)
      .filter((s) =>
        !q
          ? true
          : [s.name, s.email, s.phone, s.uid]
              .filter(Boolean)
              .some((f) => f.toLowerCase().includes(q)),
      );
  }, [subs, tab, search]);

  useEffect(() => setPage(1), [tab, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const paginated = useMemo(
    () => filtered.slice((page - 1) * perPage, page * perPage),
    [filtered, page],
  );

  const exportCSV = () => {
    const headers = ["Name", "Email", "Phone", "UID", "Signed up", "Newsletter"];
    const label = TABS.find((t) => t.value === tab)?.label ?? tab;
    const rows = filtered.map((s) => [
      s.name,
      s.email,
      s.phone,
      s.uid,
      s.createdAt?.toDate ? s.createdAt.toDate().toLocaleString() : "",
      label,
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `newsletter_${tab}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="px-2 pt-4 pb-8 sm:px-6 sm:pt-6 sm:pb-10">
      {/* HEADER */}
      <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[#ff7a59] sm:text-4xl lg:text-5xl">
            Newsletter Opt-ins
          </h1>
          <p className="mt-2 text-base text-[#e8dcc7] sm:text-lg">
            Users who accepted the newsletter / promotional messages checkbox
            when creating their account.
          </p>
        </div>
        <button
          onClick={exportCSV}
          disabled={filtered.length === 0}
          className="self-start rounded-xl border border-[#ff7a59] px-5 py-2 text-sm font-semibold text-[#ff7a59] transition hover:bg-[#ff7a59] hover:text-white disabled:opacity-40"
        >
          Export CSV
        </button>
      </div>

      {/* SUMMARY CARDS */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`rounded-2xl border p-4 text-left transition ${
              tab === t.value
                ? "border-[#ff7a59] bg-[#ff7a59]/15"
                : "border-white/10 bg-[#0a0a0a] hover:border-[#ff7a59]/50"
            }`}
          >
            <p className="text-sm text-[#e8dcc7]/80">{t.label}</p>
            <p className="mt-1 text-3xl font-bold text-[#ff7a59]">
              {counts[t.value]}
            </p>
          </button>
        ))}
      </div>

      {/* SEARCH */}
      <div className="relative mb-6 max-w-xl">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, phone or UID…"
          className="w-full rounded-xl border border-white/15 bg-[#0a0a0a] py-3 pl-4 pr-10 text-white outline-none placeholder:text-white/40 focus:border-[#ff7a59]"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50 hover:text-white"
            aria-label="Clear search"
          >
            ✕
          </button>
        )}
      </div>

      {/* TABLE */}
      <section className="rounded-3xl border border-[#ff7a59]/40 bg-[#0a0a0a] p-4 sm:p-6">
        <h2 className="mb-6 text-xl font-bold text-[#ff7a59] sm:text-2xl">
          {TABS.find((t) => t.value === tab)?.label} ({filtered.length}
          {search ? ` of ${counts[tab]}` : ""})
        </h2>

        {loading ? (
          <p className="text-[#f3ead7]">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="text-[#f3ead7]/70">
            {search
              ? `No users match “${search.trim()}”.`
              : "No users in this category."}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-2xl border border-white/10">
              <table className="w-full min-w-[720px] text-left">
                <thead className="bg-[#ece2cb] text-black">
                  <tr>
                    <th className="p-3">Name</th>
                    <th className="p-3">Email</th>
                    <th className="p-3">Phone</th>
                    <th className="p-3">UID</th>
                    <th className="p-3">Signed up</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((s) => (
                    <tr
                      key={s.id}
                      className="border-b bg-[#ece2cb] text-black hover:bg-[#f5ecd7]"
                    >
                      <td className="p-3 font-semibold">{s.name}</td>
                      <td className="p-3 text-[#ff7a59]">{s.email || "-"}</td>
                      <td className="p-3">{s.phone || "-"}</td>
                      <td className="p-3 text-xs">{s.uid}</td>
                      <td className="p-3 text-black/60">
                        {fmtDate(s.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* PAGINATION */}
            {totalPages > 1 && (
              <div className="mt-8 flex flex-col items-center justify-between gap-4 text-[#f3ead7] md:flex-row">
                <p className="text-sm text-[#f3ead7]/70">
                  Showing {(page - 1) * perPage + 1}–
                  {Math.min(page * perPage, filtered.length)} of{" "}
                  {filtered.length}
                </p>
                <div className="flex gap-2">
                  <button
                    disabled={page === 1}
                    onClick={() => setPage(page - 1)}
                    className="rounded-lg border border-white/10 px-3 py-1 disabled:opacity-30"
                  >
                    Prev
                  </button>
                  <span className="px-3 py-1">
                    {page} / {totalPages}
                  </span>
                  <button
                    disabled={page === totalPages}
                    onClick={() => setPage(page + 1)}
                    className="rounded-lg border border-white/10 px-3 py-1 disabled:opacity-30"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
