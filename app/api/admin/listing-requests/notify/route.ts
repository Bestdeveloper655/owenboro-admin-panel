import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/apiAuth";
import { getAdmin, notifyUser } from "@/lib/serverNotify";

// Tells a user that their listing request (the app's + button) was approved or
// not. The Listing Requests page records the decision with the client SDK,
// which can't send FCM pushes, so this route does it with the Admin SDK. It
// reads the request itself, so the browser only names which one, plus
// `update: true` when the decision was on the user's edit of a listing that
// was already live (the doc can't tell: it keeps its productRef either way).

function buildContent(status: string, title: string, reason: string, update: boolean) {
  const name = title ? `"${title}"` : "Your listing";
  const why = reason.trim();
  if (update) {
    return status === "approved"
      ? {
          title: "Your listing update is live",
          body: `Your changes to ${name} were approved and are now in the app.`,
        }
      : {
          title: "Listing update not approved",
          body: why
            ? `Your changes to ${name} weren't approved: ${why} The live listing hasn't changed.`
            : `Your changes to ${name} weren't approved. The live listing hasn't changed.`,
        };
  }
  if (status === "approved") {
    return {
      title: "Your listing is live 🎉",
      body: `${name} was approved and is now in the app.`,
    };
  }
  return {
    title: "Listing not approved",
    body: why
      ? `${name} wasn't approved: ${why}`
      : `${name} wasn't approved. You can send an updated listing.`,
  };
}

export async function POST(req: NextRequest) {
  const caller = await requireStaff(req, ["admin"]);
  if (caller instanceof NextResponse) return caller;

  try {
    const { requestId, update } = await req.json();
    if (!requestId || typeof requestId !== "string" || requestId.includes("/")) {
      return NextResponse.json({ message: "requestId is required." }, { status: 400 });
    }

    const snap = await getAdmin()
      .firestore()
      .collection("listing_requests")
      .doc(requestId)
      .get();
    const data = snap.data();
    if (!data) {
      return NextResponse.json({ message: "Request not found." }, { status: 404 });
    }
    if (data.status !== "approved" && data.status !== "rejected") {
      return NextResponse.json({ message: "Request has not been decided." }, { status: 409 });
    }

    const { title, body } = buildContent(
      data.status,
      String(data.title || ""),
      String(data.rejectionReason || ""),
      update === true && !!data.productRef,
    );
    const result = await notifyUser({
      uid: String(data.submittedBy),
      title,
      body,
      source: "listing_request",
      data: { listingRequestId: requestId, status: data.status },
      extra: { listingRequestId: requestId },
    });

    return NextResponse.json(result, {
      status: result.message === "User not found." ? 404 : 200,
    });
  } catch (error: unknown) {
    console.error("Listing request notify error:", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Failed to send notification." },
      { status: 500 },
    );
  }
}
