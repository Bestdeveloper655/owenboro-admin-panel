import { NextRequest, NextResponse } from "next/server";
import { notifyUser } from "@/lib/serverNotify";

// Notifies a user when an admin takes a moderation action against them
// (ban / unban / messaging restriction / report reviewed). The admin pages run
// the Firebase *client* SDK, which can't send FCM pushes, so this server route
// does it via the Admin SDK.

type ModerationEvent =
  | "banned"
  | "unbanned"
  | "messaging_restricted"
  | "messaging_restriction_removed"
  | "report_reviewed";

const EVENTS: ModerationEvent[] = [
  "banned",
  "unbanned",
  "messaging_restricted",
  "messaging_restriction_removed",
  "report_reviewed",
];

function buildContent(
  event: ModerationEvent,
  opts: { reason?: string; label?: string; permanent?: boolean },
): { title: string; body: string } {
  const reason = (opts.reason || "").trim();

  switch (event) {
    case "banned":
      return {
        title: "Account banned",
        body: reason
          ? `Your account has been banned. Reason: ${reason}`
          : "Your account has been banned for violating our community guidelines.",
      };
    case "unbanned":
      return {
        title: "Account restored",
        body: "Good news — your account has been restored. Welcome back!",
      };
    case "messaging_restricted":
      return opts.permanent
        ? {
            title: "Messaging restricted",
            body: "You can no longer send messages in direct or group chats. You can still read your chats.",
          }
        : {
            title: "Messaging restricted",
            body: `You've been restricted from sending messages${
              opts.label ? ` for ${opts.label}` : ""
            }. You can still read your chats.`,
          };
    case "messaging_restriction_removed":
      return {
        title: "Messaging restored",
        body: "Your messaging restriction has been lifted. You can send messages again.",
      };
    case "report_reviewed":
      return {
        title: "Report reviewed",
        body: "A report involving your account has been reviewed by our moderation team.",
      };
  }
}

export async function POST(req: NextRequest) {
  try {
    const {
      uid,
      event,
      reason = "",
      label = "",
      permanent = false,
    } = await req.json();

    if (!uid || typeof uid !== "string") {
      return NextResponse.json({ message: "uid is required." }, { status: 400 });
    }
    if (!EVENTS.includes(event)) {
      return NextResponse.json(
        { message: `event must be one of: ${EVENTS.join(", ")}.` },
        { status: 400 },
      );
    }

    const { title, body } = buildContent(event, { reason, label, permanent });

    const result = await notifyUser({
      uid,
      title,
      body,
      source: "moderation",
      data: { event },
      extra: { moderationEvent: event },
    });

    return NextResponse.json(result, {
      status: result.message === "User not found." ? 404 : 200,
    });
  } catch (error: any) {
    console.error("🔥 Moderation notify error:", error);
    return NextResponse.json(
      { message: error?.message || "Failed to send notification." },
      { status: 500 },
    );
  }
}
