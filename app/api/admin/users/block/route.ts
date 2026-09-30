import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/apiAuth";
import { getAdmin } from "@/lib/serverNotify";

// Block or unblock a user from the whole app (docs/user-blocking-contract.md §1).
// Needs the Admin SDK: it disables the Firebase Auth login and signs the user
// out everywhere, and writes user_blocks/{uid}, which clients can't write.
// A Cloud Function in the mobile repo reacts to user_blocks and archives (or
// restores) everything the user created.

const PURGE_AFTER_DAYS = 180;

export async function POST(req: NextRequest) {
  const caller = await requireStaff(req);
  if (caller instanceof NextResponse) return caller;

  try {
    const body = await req.json();
    const uid = typeof body.uid === "string" ? body.uid.trim() : "";
    const block = body.block;
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    const source = body.source === "report" ? "report" : "users";
    const reportId = typeof body.reportId === "string" ? body.reportId : "";

    if (!uid) return NextResponse.json({ message: "uid is required." }, { status: 400 });
    if (typeof block !== "boolean") {
      return NextResponse.json({ message: "block must be a boolean." }, { status: 400 });
    }
    if (uid === caller.uid) {
      return NextResponse.json({ message: "You can't block your own account." }, { status: 400 });
    }

    const adminSdk = getAdmin();
    const firestore = adminSdk.firestore();
    const { FieldValue, Timestamp } = adminSdk.firestore;
    const blockRef = firestore.collection("user_blocks").doc(uid);
    const existing = (await blockRef.get()).data();

    const callerDoc = (await firestore.collection("Users").doc(caller.uid).get()).data() || {};
    const callerName = callerDoc.display_name || callerDoc.full_name || callerDoc.email || "";

    if (block) {
      if (existing && ["blocking", "blocked", "restoring"].includes(existing.status)) {
        return NextResponse.json(
          { message: `This user is already ${existing.status}.` },
          { status: 409 },
        );
      }

      const userDoc = (await firestore.collection("Users").doc(uid).get()).data();
      let authUser: import("firebase-admin").auth.UserRecord | null = null;
      try {
        authUser = await adminSdk.auth().getUser(uid);
      } catch {
        authUser = null;
      }
      if (!userDoc && !authUser && !existing) {
        return NextResponse.json({ message: "User not found." }, { status: 404 });
      }
      if (userDoc && ["admin", "moderator"].includes(userDoc.role)) {
        return NextResponse.json(
          { message: "Staff accounts can't be blocked. Remove their role first." },
          { status: 403 },
        );
      }

      const now = Timestamp.now();
      // merge: the Cloud Function keeps its own lease fields (leaseId,
      // leaseUntil, pass) on this doc; a retry must not clear them.
      await blockRef.set({
        uid,
        status: "blocking",
        // Snapshot: Users/{uid} is archived by the function, so the panel's
        // Blocked users list reads identity from here. On a retry after a
        // failed run the profile may already be gone; keep the earlier snapshot.
        name: userDoc?.display_name || userDoc?.full_name || existing?.name || authUser?.displayName || "",
        email: userDoc?.email || existing?.email || authUser?.email || "",
        photo: userDoc?.photo_url || existing?.photo || "",
        reason,
        source,
        reportId,
        blockedAt: existing?.status === "failed" && existing.blockedAt ? existing.blockedAt : now,
        blockedBy: caller.uid,
        blockedByName: callerName,
        purgeAfter:
          existing?.status === "failed" && existing.purgeAfter
            ? existing.purgeAfter
            : Timestamp.fromMillis(now.toMillis() + PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000),
        archivedCount: existing?.status === "failed" ? existing.archivedCount ?? 0 : 0,
        error: "",
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      if (authUser) {
        await adminSdk.auth().updateUser(uid, { disabled: true });
        await adminSdk.auth().revokeRefreshTokens(uid);
      }

      return NextResponse.json({ ok: true, status: "blocking" });
    }

    // Unblock
    if (!existing || !["blocked", "failed"].includes(existing.status)) {
      return NextResponse.json(
        { message: existing ? `Can't unblock while ${existing.status}.` : "This user isn't blocked." },
        { status: 409 },
      );
    }

    try {
      await adminSdk.auth().updateUser(uid, { disabled: false });
    } catch (err) {
      console.error("Re-enable login failed (user may have been purged):", err);
    }
    await blockRef.update({
      status: "restoring",
      unblockRequestedAt: FieldValue.serverTimestamp(),
      unblockedBy: caller.uid,
      error: "",
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true, status: "restoring" });
  } catch (error: unknown) {
    console.error("Block/unblock error:", error);
    return NextResponse.json(
      { message: (error as Error)?.message || "Failed to update the block." },
      { status: 500 },
    );
  }
}
