"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query, Timestamp } from "firebase/firestore";

import { db } from "@/lib/firebaseServices";
import {
  ACTIVE_BLOCK_STATUSES,
  APP_BLOCK_LABEL,
  setAppBlock,
  type AppBlockStatus,
} from "@/lib/userBlocks";

type Block = {
  uid: string;
  status: AppBlockStatus;
  name: string;
  email: string;
  photo: string;
  reason: string;
  source: string;
  blockedAt: Date | null;
  blockedByName: string;
  purgeAfter: Date | null;
  unblockRequestedAt: Date | null;
  archivedCount: number;
  restoredCount: number;
  error: string;
};

const toDate = (v: unknown) => (v instanceof Timestamp ? v.toDate() : null);
const fmt = (d: Date | null) => (d ? d.toLocaleString() : "—");

const STATUS_STYLE: Record<AppBlockStatus, string> = {
  blocking: "bg-amber-400 text-black",
  blocked: "bg-red-600 text-white",
  restoring: "bg-amber-400 text-black",
  unblocked: "bg-green-600 text-white",
  purged: "bg-black text-white",
  failed: "bg-red-100 text-red-800 border border-red-400",
};

/* App-level blocks (docs/user-blocking-contract.md §1). A blocked user's
 * profile is archived, so they no longer appear in User Info; this page is
 * where they're found and unblocked. */
export default function Page() {
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [tab, setTab] = useState<"active" | "history">("active");
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    return onSnapshot(
      query(collection(db, "user_blocks"), orderBy("blockedAt", "desc")),
      (snap) =>
        setBlocks(
          snap.docs.map((d) => {
            const x = d.data();
            return {
              uid: d.id,
              status: (x.status as AppBlockStatus) || "blocked",
              name: x.name || "",
              email: x.email || "",
              photo: x.photo || "",
              reason: x.reason || "",
              source: x.source || "users",
              blockedAt: toDate(x.blockedAt),
              blockedByName: x.blockedByName || "",
              purgeAfter: toDate(x.purgeAfter),
              unblockRequestedAt: toDate(x.unblockRequestedAt),
              archivedCount: typeof x.archivedCount === "number" ? x.archivedCount : 0,
              restoredCount: typeof x.restoredCount === "number" ? x.restoredCount : 0,
              error: x.error || "",
            };
          }),
        ),
      (err) => {
        console.error(err);
        setError("Failed to load blocked users.");
        setBlocks([]);
      },
    );
  }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (blocks ?? []).filter((b) => {
      const active = ACTIVE_BLOCK_STATUSES.includes(b.status);
      if (tab === "active" ? !active : active) return false;
      return !q || [b.name, b.email, b.uid].some((f) => f.toLowerCase().includes(q));
    });
  }, [blocks, tab, search]);

  /* A failed run is retried in the direction it was going: an unblock that
   * was requested after the block retries the restore, otherwise the block. */
  const retryIsUnblock = (b: Block) =>
    !!b.unblockRequestedAt && (!b.blockedAt || b.unblockRequestedAt > b.blockedAt);

  const act = async (b: Block, block: boolean) => {
    const who = b.name || b.email || b.uid;
    const msg = block
      ? `Retry blocking ${who}?`
      : `Unblock ${who}? Their login is re-enabled and everything that was hidden is restored.`;
    if (!window.confirm(msg)) return;
    setBusyUid(b.uid);
    setError("");
    try {
      await setAppBlock(b.uid, block, { reason: b.reason });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyUid(null);
    }
  };

  const counts = useMemo(() => {
    const all = blocks ?? [];
    const active = all.filter((b) => ACTIVE_BLOCK_STATUSES.includes(b.status)).length;
    return { active, history: all.length - active };
  }, [blocks]);

  return (
    <div className="px-2 pt-4 pb-8 sm:px-6 sm:pt-6 sm:pb-10">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-3xl font-bold text-[#ff7a59] sm:text-4xl">Blocked Users</h1>
        <p className="mt-2 max-w-3xl text-base text-[#e8dcc7] sm:text-lg">
          People blocked from the app. Their login is disabled and everything they
          posted is hidden. Unblocking restores it all. Blocks are made permanent
          automatically after 6 months.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl border border-[#ff7a59]/50 bg-[#0a0a0a] p-1 text-sm">
          {(["active", "history"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-lg px-4 py-1.5 transition ${
                tab === t ? "bg-[#ff7a59] text-white" : "text-[#f3ead7]/80 hover:text-[#ff7a59]"
              }`}
            >
              {t === "active" ? `Blocked (${counts.active})` : `History (${counts.history})`}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email or UID…"
          className="w-full rounded-xl border border-white/15 bg-[#0a0a0a] px-4 py-2 text-sm text-white outline-none placeholder:text-white/40 focus:border-[#ff7a59] sm:w-72"
        />
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {blocks === null ? (
        <p className="text-[#f3ead7]/70">Loading…</p>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-[#ff7a59]/40 bg-[#0a0a0a] px-5 py-10 text-center text-[#f3ead7]/70">
          {tab === "active" ? "Nobody is blocked from the app." : "No past blocks."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[980px] text-left">
            <thead className="bg-[#ece2cb] text-black">
              <tr>
                <th className="p-3">User</th>
                <th className="p-3">Reason</th>
                <th className="p-3">Blocked</th>
                <th className="p-3">Status</th>
                <th className="p-3">{tab === "active" ? "Permanent on" : "Items"}</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((b) => (
                <tr key={b.uid} className="border-b border-white/10 bg-[#ece2cb] align-top text-black">
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      {b.photo ? (
                        <img src={b.photo} alt="" className="h-9 w-9 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-black/10 text-sm font-semibold">
                          {(b.name || b.email || "?").charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{b.name || "No name"}</p>
                        <p className="truncate text-xs text-black/60">{b.email || b.uid}</p>
                      </div>
                    </div>
                  </td>
                  <td className="max-w-[240px] p-3 text-sm">
                    {b.reason || <span className="text-black/40">—</span>}
                    {b.source === "report" && (
                      <span className="ml-1 rounded-full bg-black/10 px-2 py-0.5 text-[10px]">from report</span>
                    )}
                  </td>
                  <td className="p-3 text-sm">
                    {fmt(b.blockedAt)}
                    {b.blockedByName && <p className="text-xs text-black/55">by {b.blockedByName}</p>}
                  </td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[b.status]}`}>
                      {APP_BLOCK_LABEL[b.status]}
                    </span>
                    {b.status === "blocked" && b.archivedCount > 0 && (
                      <p className="mt-1 text-xs text-black/55">{b.archivedCount} items hidden</p>
                    )}
                    {b.error && <p className="mt-1 max-w-[220px] text-xs text-red-700">{b.error}</p>}
                  </td>
                  <td className="p-3 text-sm">
                    {tab === "active"
                      ? b.purgeAfter
                        ? b.purgeAfter.toLocaleDateString()
                        : "—"
                      : b.status === "unblocked"
                        ? `${b.restoredCount} restored`
                        : "—"}
                  </td>
                  <td className="p-3 text-right">
                    {b.status === "blocked" && (
                      <button
                        onClick={() => act(b, false)}
                        disabled={busyUid === b.uid}
                        className="rounded-lg border border-green-700 px-3 py-1 text-xs font-semibold text-green-800 hover:bg-green-700 hover:text-white disabled:opacity-50"
                      >
                        {busyUid === b.uid ? "…" : "Unblock"}
                      </button>
                    )}
                    {b.status === "failed" && (
                      <button
                        onClick={() => act(b, !retryIsUnblock(b))}
                        disabled={busyUid === b.uid}
                        className="rounded-lg bg-[#ff7a59] px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        {busyUid === b.uid ? "…" : retryIsUnblock(b) ? "Retry unblock" : "Retry block"}
                      </button>
                    )}
                    {(b.status === "blocking" || b.status === "restoring") && (
                      <span className="text-xs text-black/55">In progress…</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
