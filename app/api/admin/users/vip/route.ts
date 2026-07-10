import { NextRequest, NextResponse } from "next/server";
import { getAdmin } from "@/lib/serverNotify";

// Grant or revoke admin "VIP" (a complimentary lifetime subscription) for a
// user. The `subscription` map is what the mobile app reads (via RevenueCat) to
// unlock premium features. It must be written server-side with the Admin SDK:
// entitlement fields are locked down by Firestore security rules so a client
// can't grant itself premium, so the browser cannot write this directly.

export async function POST(req: NextRequest) {
  try {
    const { uid, makeVip } = await req.json();

    if (!uid || typeof uid !== "string") {
      return NextResponse.json({ message: "uid is required." }, { status: 400 });
    }
    if (typeof makeVip !== "boolean") {
      return NextResponse.json(
        { message: "makeVip must be a boolean." },
        { status: 400 },
      );
    }

    const adminSdk = getAdmin();
    const firestore = adminSdk.firestore();
    const userRef = firestore.collection("Users").doc(uid);
    const snap = await userRef.get();
    if (!snap.exists) {
      return NextResponse.json({ message: "User not found." }, { status: 404 });
    }

    // Never overwrite a real paid store subscription (App Store / Play Store) —
    // those are managed by RevenueCat, not the admin.
    const existing = snap.data()?.subscription;
    if (
      existing &&
      existing.isActive === true &&
      existing.store &&
      existing.store !== "complimentary"
    ) {
      return NextResponse.json(
        {
          message: `User has an active paid subscription (${existing.store}); it can't be changed here.`,
        },
        { status: 409 },
      );
    }

    // Replace the whole `subscription` map (update, not set+merge) so stale
    // fields from any prior paid subscription don't linger.
    await userRef.update({
      subscription: {
        isActive: makeVip,
        productId: "complimentary_lifetime",
        store: "complimentary",
        willRenew: false,
        currentPeriodEnd: null,
        revenueCatUserId: uid,
        grantedByAdmin: true,
        updatedAt: adminSdk.firestore.FieldValue.serverTimestamp(),
      },
    });

    return NextResponse.json({ ok: true, isVip: makeVip });
  } catch (error: any) {
    console.error("🔥 VIP update error:", error);
    return NextResponse.json(
      { message: error?.message || "Failed to update VIP." },
      { status: 500 },
    );
  }
}
