// Client-safe helper: tells the server route to notify a user about a
// moderation action. Best-effort — the moderation write itself is already
// committed before this is called, so a failed push must never block the UI.

export type ModerationEvent =
  | "banned"
  | "unbanned"
  | "messaging_restricted"
  | "messaging_restriction_removed"
  | "report_reviewed";

export async function notifyModeration(payload: {
  uid: string;
  event: ModerationEvent;
  reason?: string;
  label?: string;
  permanent?: boolean;
}): Promise<void> {
  if (!payload.uid) return;
  try {
    await fetch("/api/admin/moderation/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error("Moderation notification failed:", e);
  }
}
