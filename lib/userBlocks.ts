"use client";

import { authedFetch } from "@/lib/authedFetch";

// App-level blocks (docs/user-blocking-contract.md §1). The route disables the
// login and writes user_blocks/{uid}; a Cloud Function archives or restores
// the user's content and advances `status`.

export type AppBlockStatus = "blocking" | "blocked" | "restoring" | "unblocked" | "purged" | "failed";

/* Statuses where the user is currently kept out of the app. */
export const ACTIVE_BLOCK_STATUSES: AppBlockStatus[] = ["blocking", "blocked", "restoring", "failed"];

export const APP_BLOCK_LABEL: Record<AppBlockStatus, string> = {
  blocking: "Hiding content…",
  blocked: "Blocked",
  restoring: "Restoring…",
  unblocked: "Unblocked",
  purged: "Permanently removed",
  failed: "Needs retry",
};

export async function setAppBlock(
  uid: string,
  block: boolean,
  opts: { reason?: string; source?: "users" | "report"; reportId?: string } = {},
): Promise<void> {
  const res = await authedFetch("/api/admin/users/block", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uid, block, ...opts }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || `Failed to ${block ? "block" : "unblock"} the user.`);
  }
}
