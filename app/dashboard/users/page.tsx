"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  Timestamp,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebaseServices";

type User = {
  id: string;
  name: string;
  email: string;
  phone: string;
  uid: string;
  createdAt: any;
  isVerified: boolean;
  timeoutUntil: Date | null;
  timeoutReason: string;
};

/* Far-future sentinel used to represent a permanent restriction. */
const PERMANENT_YEAR = 9000;
const PERMANENT_DATE = new Date("9999-12-31T23:59:59Z");

type RestrictionOption = {
  label: string;
  ms: number | "permanent" | "remove";
};

const RESTRICTION_OPTIONS: RestrictionOption[] = [
  { label: "24 hours", ms: 24 * 60 * 60 * 1000 },
  { label: "3 days", ms: 3 * 24 * 60 * 60 * 1000 },
  { label: "7 days", ms: 7 * 24 * 60 * 60 * 1000 },
  { label: "Permanent", ms: "permanent" },
];

function isActiveRestriction(until: Date | null): boolean {
  return until != null && until.getTime() > Date.now();
}

function isPermanent(until: Date | null): boolean {
  return until != null && until.getFullYear() >= PERMANENT_YEAR;
}

function restrictionLabel(until: Date | null): string {
  if (!isActiveRestriction(until)) return "Active (no restriction)";
  if (isPermanent(until)) return "Permanently restricted";
  return `Restricted until ${until!.toLocaleString()}`;
}

export default function Page() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<User | null>(null);
  const [search, setSearch] = useState("");

  const [page, setPage] = useState(1);
  const perPage = 9;

  /* FETCH */
  useEffect(() => {
    const fetchUsers = async () => {
      const snap = await getDocs(collection(db, "Users"));

      const data: User[] = snap.docs.map((d) => {
        const x = d.data();
        const rawTimeout = x.timeout_until;
        return {
          id: d.id,
          name: x.full_name || x.display_name || "No Name",
          email: x.email || "",
          phone: x.phone_number || "",
          uid: x.uid || "",
          createdAt: x.created_time || null,
          isVerified: x.is_verified === true,
          timeoutUntil:
            rawTimeout && rawTimeout.toDate ? rawTimeout.toDate() : null,
          timeoutReason: x.timeout_reason || "",
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

  /* SEARCH FILTER */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      [u.name, u.email, u.phone, u.uid]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(q)),
    );
  }, [users, search]);

  // Reset to first page whenever the search changes.
  useEffect(() => {
    setPage(1);
  }, [search]);

  /* EXPORT CSV (respects the current search filter) */
  const exportCSV = () => {
    const headers = ["Name", "Email", "Phone", "UID", "Created Time", "Restriction"];

    const rows = filtered.map((u) => [
      u.name,
      u.email,
      u.phone,
      u.uid,
      u.createdAt?.toDate ? u.createdAt.toDate().toLocaleString() : "",
      restrictionLabel(u.timeoutUntil),
    ]);

    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `users_${Date.now()}.csv`;
    a.click();
  };

  /* APPLY / REMOVE RESTRICTION */
  const applyRestriction = async (user: User, option: RestrictionOption) => {
    let until: Date | null;
    if (option.ms === "remove") {
      until = null;
    } else if (option.ms === "permanent") {
      until = PERMANENT_DATE;
    } else {
      until = new Date(Date.now() + option.ms);
    }

    const ref = doc(db, "Users", user.id);
    await updateDoc(ref, {
      timeout_until: until ? Timestamp.fromDate(until) : null,
      timeout_reason:
        option.ms === "remove" ? "" : `Restricted by admin (${option.label})`,
      timeout_set_at: serverTimestamp(),
    });

    // Reflect immediately in local state.
    const patch = (u: User): User =>
      u.id === user.id
        ? {
            ...u,
            timeoutUntil: until,
            timeoutReason:
              option.ms === "remove"
                ? ""
                : `Restricted by admin (${option.label})`,
          }
        : u;
    setUsers((prev) => prev.map(patch));
    setSelected((prev) => (prev ? patch(prev) : prev));
  };

  /* QUICK UNBLOCK (table row) — lift a restriction early, before it expires */
  const [unblocking, setUnblocking] = useState<string | null>(null);
  const quickUnblock = async (user: User) => {
    const ok = window.confirm(
      `Remove the restriction on ${user.name} now? They'll be able to send messages again immediately.`,
    );
    if (!ok) return;
    setUnblocking(user.id);
    try {
      await applyRestriction(user, { label: "Remove", ms: "remove" });
    } catch (e) {
      console.error(e);
      alert("Failed to remove restriction. Please try again.");
    } finally {
      setUnblocking(null);
    }
  };

  /* PAGINATION (over filtered list) */
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));

  const paginated = useMemo(() => {
    const start = (page - 1) * perPage;
    return filtered.slice(start, start + perPage);
  }, [filtered, page]);

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

      {/* SEARCH */}
      <div className="mb-6 relative max-w-xl">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#ff7a59]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, phone, or UID…"
          className="w-full rounded-xl border border-white/15 bg-[#0a0a0a] py-3 pl-11 pr-10 text-white outline-none placeholder:text-white/40 focus:border-[#ff7a59]"
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
      <section className="rounded-3xl border border-[#ff7a59]/40 bg-[#0a0a0a] p-6">
        <h2 className="mb-6 text-xl font-bold text-[#ff7a59] sm:text-2xl lg:text-3xl">
          Users ({filtered.length}
          {search ? ` of ${users.length}` : ""})
        </h2>

        {loading ? (
          <p className="text-[#f3ead7]">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="text-[#f3ead7]/70">No users match “{search}”.</p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-2xl border border-white/10">
              <table className="w-full min-w-[760px] text-left">
                <thead className="bg-[#ece2cb] text-black">
                  <tr>
                    <th className="p-3">Name</th>
                    <th className="p-3">Email</th>
                    <th className="p-3">Phone</th>
                    <th className="p-3">UID</th>
                    <th className="p-3">Created</th>
                    <th className="p-3 text-right">Manage</th>
                  </tr>
                </thead>

                <tbody>
                  {paginated.map((u) => {
                    const restricted = isActiveRestriction(u.timeoutUntil);
                    return (
                      <tr
                        key={u.id}
                        className="border-b bg-[#ece2cb] text-black hover:bg-[#f5ecd7]"
                      >
                        <td className="p-3 font-semibold">
                          <span className="inline-flex flex-wrap items-center gap-1.5">
                            {u.name}
                            {u.isVerified && <VerifiedBadge />}
                            {restricted && (
                              <span className="rounded-full bg-red-500/90 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                                {isPermanent(u.timeoutUntil)
                                  ? "Blocked"
                                  : "Restricted"}
                              </span>
                            )}
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

                        <td className="p-3">
                          <div className="flex items-center justify-end gap-2">
                            {restricted && (
                              <button
                                onClick={() => quickUnblock(u)}
                                disabled={unblocking === u.id}
                                className="rounded-lg border border-green-700 px-3 py-1 text-xs font-semibold text-green-800 hover:bg-green-700 hover:text-white disabled:opacity-50"
                              >
                                {unblocking === u.id ? "…" : "Unblock"}
                              </button>
                            )}
                            <button
                              onClick={() => setSelected(u)}
                              className="rounded-lg bg-[#ff7a59] px-3 py-1 text-white text-xs"
                            >
                              View
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* PAGINATION */}
            <div className="mt-8 flex flex-col md:flex-row justify-between items-center gap-4 text-[#f3ead7]">
              <p className="text-sm text-[#f3ead7]/70">
                Showing {(page - 1) * perPage + 1}–
                {Math.min(page * perPage, filtered.length)} of {filtered.length}
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
                  if (p !== 1 && p !== totalPages && Math.abs(p - page) > 1)
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
            <p>
              <b>Email:</b> {selected.email}
            </p>
            <p>
              <b>Phone:</b> {selected.phone}
            </p>
            <p>
              <b>UID:</b> {selected.uid}
            </p>
            <p>
              <b>Created:</b>{" "}
              {selected.createdAt?.toDate
                ? selected.createdAt.toDate().toLocaleString()
                : "-"}
            </p>
          </div>

          {/* RESTRICTION CONTROLS */}
          <RestrictionPanel
            user={selected}
            onApply={(opt) => applyRestriction(selected, opt)}
          />
        </Modal>
      )}
    </div>
  );
}

/* RESTRICTION PANEL — block a user from messaging for a period or permanently */
function RestrictionPanel({
  user,
  onApply,
}: {
  user: User;
  onApply: (option: RestrictionOption) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const active = isActiveRestriction(user.timeoutUntil);

  const run = async (option: RestrictionOption) => {
    setBusy(option.label);
    try {
      await onApply(option);
    } catch (e) {
      console.error(e);
      alert("Failed to update restriction. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-6 rounded-2xl border border-black/15 bg-white/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-base font-bold text-black">Restrict messaging</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
            active ? "bg-red-500 text-white" : "bg-green-600 text-white"
          }`}
        >
          {active ? "Restricted" : "Active"}
        </span>
      </div>

      <p className="mb-3 text-sm text-black/70">
        {restrictionLabel(user.timeoutUntil)}
      </p>
      <p className="mb-4 text-xs text-black/50">
        A restricted user can still view chats but cannot send new messages in
        direct or group chats until the restriction ends.
      </p>

      <div className="flex flex-wrap gap-2">
        {RESTRICTION_OPTIONS.map((opt) => (
          <button
            key={opt.label}
            disabled={busy !== null}
            onClick={() => run(opt)}
            className="rounded-lg bg-[#ff7a59] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {busy === opt.label ? "Saving…" : opt.label}
          </button>
        ))}
        {active && (
          <button
            disabled={busy !== null}
            onClick={() => run({ label: "Remove", ms: "remove" })}
            className="rounded-lg border border-green-700 px-4 py-2 text-sm font-semibold text-green-800 transition hover:bg-green-700 hover:text-white disabled:opacity-50"
          >
            {busy === "Remove" ? "Saving…" : "Remove restriction"}
          </button>
        )}
      </div>
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
      <path fill="#fff" d="M10.6 14.6l-2.3-2.3-1.1 1.1 3.4 3.4 6-6-1.1-1.1z" />
    </svg>
  );
}

/* MODAL */
function Modal({ children, title, onClose }: any) {
  return (
    <div className="fixed inset-0 bg-black/70 flex justify-center items-center p-4">
      <div className="bg-[#e8dcc7] p-6 rounded-3xl w-[90%] max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between mb-4">
          <h2 className="text-xl font-bold text-[#ff7a59]">{title}</h2>
          <button onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
