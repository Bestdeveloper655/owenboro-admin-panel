import admin from "firebase-admin";

// Shared server-side helper for sending a user both an in-app notification
// (written to the `notifications` collection the app reads) and an FCM push to
// their device(s). Used by the admin moderation/verification notify routes.
// Server-only — never import from a client component.

function getPrivateKey() {
  const key = process.env.FIREBASE_PRIVATE_KEY;
  if (!key) return undefined;
  return key.replace(/\\n/g, "\n");
}

export function getAdmin() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: getPrivateKey(),
      }),
    });
  }
  return admin;
}

// The app stores device tokens under a handful of historical field names plus
// an `fcm_tokens` array. Collect every distinct one.
export function extractTokens(userData: any): string[] {
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

export type NotifyResult = {
  ok: boolean;
  sent: boolean;
  sentCount: number;
  failedCount: number;
  message: string;
  notificationId?: string;
};

/**
 * Records an in-app notification for `uid` and pushes it to their device(s).
 * Best-effort by nature: if the user has no token the in-app record is still
 * saved. `extra` is merged into the notification doc for bookkeeping/audit.
 */
export async function notifyUser({
  uid,
  title,
  body,
  source,
  data = {},
  extra = {},
}: {
  uid: string;
  title: string;
  body: string;
  source: string;
  data?: Record<string, string>;
  extra?: Record<string, any>;
}): Promise<NotifyResult> {
  const a = getAdmin();
  const firestore = a.firestore();

  // 1) In-app notification. type:"admin" + userId is what the Flutter
  // Notifications screen filters for, and it drives the bell badge.
  const notifRef = await firestore.collection("notifications").add({
    userId: uid,
    type: "admin",
    title,
    body,
    read: false,
    createdAt: a.firestore.FieldValue.serverTimestamp(),
    image: "",
    sent: false,
    sentCount: 0,
    failedCount: 0,
    status: "sending",
    errorMessage: "",
    sentAt: null,
    deliveryMode: "token",
    targetUserIds: [uid],
    source,
    ...extra,
  });

  // 2) Look up the user's device token(s).
  const userSnap = await firestore.collection("Users").doc(uid).get();
  if (!userSnap.exists) {
    await notifRef.update({ status: "failed", errorMessage: "User not found." });
    return {
      ok: false,
      sent: false,
      sentCount: 0,
      failedCount: 0,
      message: "User not found.",
      notificationId: notifRef.id,
    };
  }

  const userData = userSnap.data() || {};
  const tokens = extractTokens(userData);

  if (tokens.length === 0) {
    await notifRef.update({
      status: "failed",
      sent: false,
      errorMessage: "No FCM token for user.",
    });
    return {
      ok: true,
      sent: false,
      sentCount: 0,
      failedCount: 0,
      message: "In-app notification saved, but user has no device token.",
      notificationId: notifRef.id,
    };
  }

  // 3) Push to the device(s).
  const message: admin.messaging.MulticastMessage = {
    tokens,
    notification: { title, body },
    data: { notificationId: notifRef.id, title, body, type: "admin", ...data },
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
      headers: { "apns-priority": "10", "apns-push-type": "alert" },
    },
  };

  const response = await a.messaging().sendEachForMulticast(message);

  // Prune tokens FCM reports as dead so the Users doc stays clean.
  const deadTokens: string[] = [];
  response.responses.forEach((r, i) => {
    const code = (r as any)?.error?.code || (r as any)?.errorInfo?.code || "";
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
    sentAt: a.firestore.FieldValue.serverTimestamp(),
  });

  return {
    ok: true,
    sent: response.successCount > 0,
    sentCount: response.successCount,
    failedCount: response.failureCount,
    message: "Notification processed.",
    notificationId: notifRef.id,
  };
}
