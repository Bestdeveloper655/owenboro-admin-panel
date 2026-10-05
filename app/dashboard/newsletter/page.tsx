"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Mail } from "lucide-react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebaseServices";
import {
  Button,
  EmptyState,
  LoadingState,
  PageHeader,
  Pagination,
  SearchInput,
  Segmented,
  Toolbar,
  table,
} from "@/components/ui";

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
  const perPage = 25;

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
    <div>
      <PageHeader
        title="Newsletter Opt-ins"
        description="Users who accepted the newsletter / promotional messages checkbox when creating their account."
        actions={
          <Button
            variant="outline"
            icon={Download}
            onClick={exportCSV}
            disabled={filtered.length === 0}
          >
            Export CSV
          </Button>
        }
      />

      <Toolbar>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search by name, email, phone or UID…"
          width="w-full sm:w-96"
        />

        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={TABS.map((t) => ({ value: t.value, label: t.label, count: counts[t.value] }))}
        />
      </Toolbar>

      {/* LIST */}
      {loading ? (
        <LoadingState label="Loading subscribers…" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Mail}
          title={search ? `No users match “${search.trim()}”.` : "No users in this category."}
        />
      ) : (
        <>
          <div className={table.wrap}>
            <table className={`${table.table} min-w-[720px]`}>
              <thead className={table.thead}>
                <tr>
                  <th className={table.th}>Name</th>
                  <th className={table.th}>Email</th>
                  <th className={table.th}>Phone</th>
                  <th className={table.th}>UID</th>
                  <th className={table.th}>Signed up</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((s) => (
                  <tr key={s.id} className={table.row}>
                    <td className={`${table.td} font-semibold`}>{s.name}</td>
                    <td className={`${table.td} text-black/70`}>{s.email || "-"}</td>
                    <td className={`${table.td} whitespace-nowrap`}>{s.phone || "-"}</td>
                    <td className={`${table.td} font-mono text-xs text-black/55`}>{s.uid}</td>
                    <td className={`${table.td} whitespace-nowrap text-black/60`}>
                      {fmtDate(s.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            total={filtered.length}
            perPage={perPage}
            extra={
              search && (
                <span className="text-[#f3ead7]/50">
                  {" "}
                  · {counts[tab]} {TABS.find((t) => t.value === tab)?.label.toLowerCase()}
                </span>
              )
            }
          />
        </>
      )}
    </div>
  );
}

