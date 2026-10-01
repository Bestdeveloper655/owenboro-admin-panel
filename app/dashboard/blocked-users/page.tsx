"use client";

import { useEffect, useMemo, useState } from "react";
import { History, Loader2, RotateCcw, ShieldCheck } from "lucide-react";
import { collection, onSnapshot, orderBy, query, Timestamp } from "firebase/firestore";

import { db } from "@/lib/firebaseServices";
import {
  ACTIVE_BLOCK_STATUSES,
  APP_BLOCK_LABEL,
  setAppBlock,
  type AppBlockStatus,
} from "@/lib/userBlocks";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  LoadingState,
  Modal,
  PageHeader,
  SearchInput,
  Segmented,
  Toolbar,
  table,
  type BadgeTone,
} from "@/components/ui";

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

/* In-flight runs are amber, a live block red, a failed run orange so the
 * Retry stands out, a final purge muted. */
const STATUS_TONE: Record<AppBlockStatus, BadgeTone> = {
  blocking: "amber",
  blocked: "red",
  restoring: "amber",
  unblocked: "green",
  purged: "neutral",
  failed: "orange",
};

/* Dialog title for an unblock: a retry when the last run failed. */
function retryTitle(b: { status: AppBlockStatus }): string {
  return b.status === "failed" ? "Retry unblock" : "Unblock user";
}

/* App-level blocks (docs/user-blocking-contract.md §1). A blocked user's
 * profile is archived, so they no longer appear in User Info; this page is
 * where they're found and unblocked. */
export default function Page() {
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [tab, setTab] = useState<"active" | "history">("active");
  const [busyUid, setBusyUid] = useState<string | null>(null);
  /* The action waiting for confirmation in the dialog. */
  const [confirming, setConfirming] = useState<{ block: Block; doBlock: boolean } | null>(null);
  const [confirmError, setConfirmError] = useState("");
  /* Status each row had when its request was accepted. Until the live data
   * moves on from it, the row shows "In progress…" instead of its buttons, so
   * a second click can't send the same request again. */
  const [sent, setSent] = useState<Record<string, AppBlockStatus>>({});
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

  const act = (b: Block, block: boolean) => {
    setConfirmError("");
    setConfirming({ block: b, doBlock: block });
  };

  const confirmAction = async () => {
    if (!confirming) return;
    const { block: b, doBlock } = confirming;
    setBusyUid(b.uid);
    setConfirmError("");
    setError("");
    try {
      await setAppBlock(b.uid, doBlock, { reason: b.reason });
      setSent((prev) => ({ ...prev, [b.uid]: b.status }));
      setConfirming(null);
    } catch (err) {
      setConfirmError((err as Error).message);
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
    <div>
      <PageHeader
        title="Blocked Users"
        description="People blocked from the app. Their login is disabled and everything they posted is hidden. Unblocking restores it all. Blocks are made permanent automatically after 6 months."
      />

      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search name, email or UID…" />

        <Segmented<"active" | "history">
          value={tab}
          onChange={setTab}
          options={[
            { value: "active", label: "Blocked", count: counts.active },
            { value: "history", label: "History", count: counts.history },
          ]}
        />
      </Toolbar>

      {error && (
        <Alert className="mb-6" onDismiss={() => setError("")}>
          {error}
        </Alert>
      )}

      {blocks === null ? (
        <LoadingState label="Loading blocked users…" />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={tab === "active" ? ShieldCheck : History}
          title={tab === "active" ? "Nobody is blocked from the app." : "No past blocks."}
        />
      ) : (
        <div className={table.wrap}>
          <table className={`${table.table} min-w-[980px]`}>
            <thead className={table.thead}>
              <tr>
                <th className={table.th}>User</th>
                <th className={table.th}>Reason</th>
                <th className={table.th}>Blocked</th>
                <th className={table.th}>Status</th>
                <th className={table.th}>{tab === "active" ? "Permanent on" : "Items"}</th>
                <th className={`${table.th} text-right`}>Action</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((b) => (
                <tr key={b.uid} className={`${table.row} align-top`}>
                  <td className={table.td}>
                    <div className="flex max-w-[260px] items-center gap-3">
                      {b.photo ? (
                        <img
                          src={b.photo}
                          alt=""
                          className="h-10 w-10 shrink-0 rounded-full border border-black/10 object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-black/10 bg-black/5 text-sm font-semibold text-black/60">
                          {(b.name || b.email || "?").charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{b.name || "No name"}</p>
                        <p className="truncate text-xs text-black/60">{b.email || b.uid}</p>
                      </div>
                    </div>
                  </td>
                  <td className={table.td}>
                    <div className="max-w-[300px] min-w-[180px]">
                      {b.reason || <span className="text-black/40">—</span>}
                      {b.source === "report" && (
                        <Badge tone="blue" className="ml-1.5">
                          from report
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className={`${table.td} whitespace-nowrap`}>
                    {fmt(b.blockedAt)}
                    {b.blockedByName && (
                      <p className="mt-0.5 text-xs text-black/55">by {b.blockedByName}</p>
                    )}
                  </td>
                  <td className={table.td}>
                    <Badge tone={STATUS_TONE[b.status]}>{APP_BLOCK_LABEL[b.status]}</Badge>
                    {b.status === "blocked" && b.archivedCount > 0 && (
                      <p className="mt-1 text-xs text-black/55">{b.archivedCount} items hidden</p>
                    )}
                    {b.error && <p className="mt-1 max-w-[220px] text-xs text-red-700">{b.error}</p>}
                  </td>
                  <td className={`${table.td} whitespace-nowrap text-black/70`}>
                    {tab === "active"
                      ? b.purgeAfter
                        ? b.purgeAfter.toLocaleDateString()
                        : "—"
                      : b.status === "unblocked"
                        ? `${b.restoredCount} restored`
                        : "—"}
                  </td>
                  <td className={table.td}>
                    <div className={table.actions}>
                      {sent[b.uid] === b.status ? (
                        <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-black/55">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                          In progress…
                        </span>
                      ) : (
                        <>
                          {b.status === "blocked" && (
                            <Button
                              size="sm"
                              variant="success"
                              loading={busyUid === b.uid}
                              onClick={() => act(b, false)}
                            >
                              Unblock
                            </Button>
                          )}
                          {b.status === "failed" && (
                            <Button
                              size="sm"
                              icon={RotateCcw}
                              loading={busyUid === b.uid}
                              onClick={() => act(b, !retryIsUnblock(b))}
                            >
                              {retryIsUnblock(b) ? "Retry unblock" : "Retry block"}
                            </Button>
                          )}
                          {(b.status === "blocking" || b.status === "restoring") && (
                            <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-black/55">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                              In progress…
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirming && (
        <Modal
          size="sm"
          title={confirming.doBlock ? "Retry block" : retryTitle(confirming.block)}
          onClose={() => busyUid === null && setConfirming(null)}
          footer={
            <>
              <Button
                variant="light"
                onClick={() => setConfirming(null)}
                disabled={busyUid !== null}
              >
                Cancel
              </Button>
              <Button
                variant={confirming.doBlock ? "danger-solid" : "success"}
                onClick={confirmAction}
                loading={busyUid !== null}
              >
                {confirming.doBlock ? "Block again" : "Unblock"}
              </Button>
            </>
          }
        >
          {confirmError && (
            <Alert surface="light" className="mb-4">
              {confirmError}
            </Alert>
          )}
          <p>
            {confirming.doBlock ? "Retry blocking " : "Unblock "}
            <span className="font-semibold">
              {confirming.block.name || confirming.block.email || confirming.block.uid}
            </span>
            ?
          </p>
          <p className="mt-2 text-sm text-black/60">
            {confirming.doBlock
              ? "Their login stays disabled and the rest of their content is hidden."
              : "Their login is re-enabled and everything that was hidden is restored."}
          </p>
        </Modal>
      )}
    </div>
  );
}
