import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";

// Server-side route that notifies a user when an admin approves or rejects their
// profile verification. The verify-photos page runs in the browser with the
// Firebase *client* SDK, which cannot send FCM pushes — only the Admin SDK can,
// so the decision-to-push step has to live here.

function getPrivateKey() {
  const key = process.env.FIREBASE_PRIVATE_KEY;
  if (!key) return undefined;
  return key.replace(/\\n/g, "\n");
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: getPrivateKey(),
    }),
  });
}

const firestore = admin.firestore();

// The app stores device tokens under a handful of historical field names, plus
// an `fcm_tokens` array. Collect every distinct one. (Mirrors the logic in
// app/api/admin/notifications/send/route.ts.)
function extractTokens(userData: any): string[] {
  const raw = [
    userData.fcm_token,
    userData.fcmToken,
    userData.FCMToken,
    userData.token,
    userData.deviceToken,
    userData.notificationToken,
    ...(Array.isArray(userData.fcm_tokens) ? userData.fcm_tokens : []),
  ];

  return [
    ...new Set(
      raw
        .filter((x) => typeof x === "string" && x.trim())
        .map((x) => x.trim()),
    ),
  ];
}

function buildContent(status: "approved" | "rejected", reason: string) {
  if (status === "approved") {
    return {
      title: "Profile verified ✅",
      body: "Your profile has been verified. You now have full access.",
    };
  }
  const trimmed = (reason || "").trim();
  return {
    title: "Verification not approved",
    body: trimmed
      ? `Your verification wasn't approved: ${trimmed} You can submit a new photo.`
      : "Your verification wasn't approved. You can submit a new photo.",
  };
}

export async function POST(req: NextRequest) {
  try {
    const { uid, status, reason = "" } = await req.json();

    if (!uid || typeof uid !== "string") {
      return NextResponse.json({ message: "uid is required." }, { status: 400 });
    }
    if (status !== "approved" && status !== "rejected") {
      return NextResponse.json(
        { message: "status must be 'approved' or 'rejected'." },
        { status: 400 },
      );
    }

    const { title, body } = buildContent(status, reason);

    // 1) Record an in-app notification for the user. type:"admin" + userId is
    // what the Flutter Notifications screen filters for, and it drives the bell
    // badge. Extra bookkeeping fields keep it consistent with the rest of the
    // `notifications` collection.
    const notifRef = await firestore.collection("notifications").add({
      userId: uid,
      type: "admin",
      title,
      body,
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      image: "",
      sent: false,
      sentCount: 0,
      failedCount: 0,
      status: "sending",
      errorMessage: "",
      sentAt: null,
      deliveryMode: "token",
      targetUserIds: [uid],
      source: "verification",
      verificationStatus: status,
    });

    // 2) Look up the user's device token(s).
    const userSnap = await firestore.collection("Users").doc(uid).get();
    if (!userSnap.exists) {
      await notifRef.update({ status: "failed", errorMessage: "User not found." });
      return NextResponse.json(
        { message: "User not found.", sent: false },
        { status: 404 },
      );
    }

    const userData = userSnap.data() || {};
    const tokens = extractTokens(userData);

    if (tokens.length === 0) {
      await notifRef.update({
        status: "failed",
        sent: false,
        errorMessage: "No FCM token for user.",
      });
      // The in-app notification is still saved; there's just no device to push to.
      return NextResponse.json({
        message: "In-app notification saved, but user has no device token.",
        sent: false,
        sentCount: 0,
        failedCount: 0,
      });
    }

    // 3) Push to the device(s).
    const message: admin.messaging.MulticastMessage = {
      tokens,
      notification: { title, body },
      data: {
        notificationId: notifRef.id,
        title,
        body,
        type: "admin",
        verificationStatus: status,
      },
      android: { priority: "high", notification: {} },
      apns: {
        payload: {
          aps: {
            alert: { title, body },
            sound: "default",
            badge: 1,
            "content-available": 1,
          },
        },
        headers: {
          "apns-priority": "10",
          "apns-push-type": "alert",
        },
      },
    };

    const response = await admin.messaging().sendEachForMulticast(message);

    // Prune tokens FCM reports as dead so the Users doc stays clean.
    const deadTokens: string[] = [];
    response.responses.forEach((r, i) => {
      const code =
        (r as any)?.error?.code || (r as any)?.errorInfo?.code || "";
      if (
        !r.success &&
        (code === "messaging/invalid-registration-token" ||
          code === "messaging/registration-token-not-registered")
      ) {
        deadTokens.push(tokens[i]);
      }
    });

    if (deadTokens.length) {
      const update: Record<string, any> = {};
      if (Array.isArray(userData.fcm_tokens)) {
        update.fcm_tokens = userData.fcm_tokens.filter(
          (t: string) => !deadTokens.includes(t),
        );
      }
      for (const field of [
        "fcm_token",
        "fcmToken",
        "FCMToken",
        "token",
        "deviceToken",
        "notificationToken",
      ]) {
        if (deadTokens.includes(userData[field])) update[field] = "";
      }
      if (Object.keys(update).length) await userSnap.ref.update(update);
    }

    await notifRef.update({
      sent: response.successCount > 0,
      sentCount: response.successCount,
      failedCount: response.failureCount,
      status: response.successCount > 0 ? "sent" : "failed",
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      message: "Verification notification processed.",
      sent: response.successCount > 0,
      sentCount: response.successCount,
      failedCount: response.failureCount,
    });
  } catch (error: any) {
    console.error("🔥 Verification notify error:", error);
    return NextResponse.json(
      { message: error?.message || "Failed to send notification." },
      { status: 500 },
    );
  }
}
