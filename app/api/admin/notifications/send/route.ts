import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/apiAuth";
import admin from "firebase-admin";

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
const GLOBAL_TOPIC = "all_users";

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

  return [...new Set(raw.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()))];
}

export async function POST(req: NextRequest) {
  const caller = await requireStaff(req);
  if (caller instanceof NextResponse) return caller;

  try {
    const body = await req.json();
    console.log("📥 Incoming request body:", body);

    const {
      notificationId,
      mode = "topic",
      targetUserIds = [],
    } = body;

    if (!notificationId || typeof notificationId !== "string") {
      return NextResponse.json(
        { message: "notificationId is required." },
        { status: 400 }
      );
    }

    if (!["topic", "token"].includes(mode)) {
      return NextResponse.json(
        { message: "mode must be 'topic' or 'token'." },
        { status: 400 }
      );
    }

    if (mode === "token" && (!Array.isArray(targetUserIds) || targetUserIds.length === 0)) {
      return NextResponse.json(
        { message: "targetUserIds is required when mode is 'token'." },
        { status: 400 }
      );
    }

    const notificationRef = firestore.collection("notifications").doc(notificationId);
    const notificationSnap = await notificationRef.get();

    if (!notificationSnap.exists) {
      return NextResponse.json(
        { message: "Notification not found." },
        { status: 404 }
      );
    }

    const notification = notificationSnap.data() || {};

    await notificationRef.update({
      status: "sending",
      errorMessage: "",
    });

    if (mode === "topic") {
      const message: admin.messaging.Message = {
        topic: GLOBAL_TOPIC,
        notification: {
          title: String(notification.title || ""),
          body: String(notification.body || ""),
        },
        data: {
          notificationId,
          title: String(notification.title || ""),
          body: String(notification.body || ""),
          image: String(notification.image || ""),
          mode: "topic",
        },
        android: {
          priority: "high",
          notification: notification.image
            ? { imageUrl: String(notification.image) }
            : {},
        },
        apns: {
          payload: {
            aps: {
              alert: {
                title: String(notification.title || ""),
                body: String(notification.body || ""),
              },
              sound: "default",
              badge: 1,
              "content-available": 1,
            },
          },
          headers: {
            "apns-priority": "10",
            "apns-push-type": "alert",
          },
          fcmOptions: notification.image
            ? { imageUrl: String(notification.image) }
            : undefined,
        },
        webpush: {
          notification: {
            title: String(notification.title || ""),
            body: String(notification.body || ""),
            ...(notification.image ? { image: String(notification.image) } : {}),
          },
        },
      };

      await admin.messaging().send(message);

      const usersSnap = await firestore.collection("Users").get();
      const subscriberCount = usersSnap.size;

      await notificationRef.update({
        sent: true,
        sentCount: subscriberCount,
        failedCount: 0,
        status: "sent",
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        errorMessage: "",
        deliveryMode: "topic",
        targetTopic: GLOBAL_TOPIC,
      });

      return NextResponse.json({
        message: "Notification sent to all_users topic.",
        sent: true,
        sentCount: subscriberCount,
        failedCount: 0,
        status: "sent",
        deliveryMode: "topic",
        targetTopic: GLOBAL_TOPIC,
        sentAt: new Date().toISOString(),
      });
    }

    // token mode: multiple users
    const usersSnap = await Promise.all(
      targetUserIds.map((userId: string) => firestore.collection("Users").doc(userId).get())
    );

    const tokens: string[] = [];
    const invalidUsers: string[] = [];

    for (let i = 0; i < usersSnap.length; i++) {
      const userId = targetUserIds[i];
      const userSnap = usersSnap[i];

      if (!userSnap.exists) {
        invalidUsers.push(userId);
        continue;
      }

      const userData = userSnap.data() || {};
      const userTokens = extractTokens(userData);

      if (userTokens.length === 0) {
        invalidUsers.push(userId);
        continue;
      }

      tokens.push(...userTokens);
    }

    const uniqueTokens = [...new Set(tokens)];

    if (uniqueTokens.length === 0) {
      await notificationRef.update({
        sent: false,
        sentCount: 0,
        failedCount: targetUserIds.length,
        status: "failed",
        errorMessage: "No valid FCM tokens found for selected users.",
        deliveryMode: "token",
        targetUserIds,
      });

      return NextResponse.json(
        {
          message: "No valid FCM tokens found for selected users.",
          sent: false,
          sentCount: 0,
          failedCount: targetUserIds.length,
          status: "failed",
        },
        { status: 400 }
      );
    }

    const multicastMessage: admin.messaging.MulticastMessage = {
      tokens: uniqueTokens,
      notification: {
        title: String(notification.title || ""),
        body: String(notification.body || ""),
      },
      data: {
        notificationId,
        title: String(notification.title || ""),
        body: String(notification.body || ""),
        image: String(notification.image || ""),
        mode: "token",
      },
      android: {
        priority: "high",
        notification: notification.image
          ? { imageUrl: String(notification.image) }
          : {},
      },
      apns: {
        payload: {
          aps: {
            alert: {
              title: String(notification.title || ""),
              body: String(notification.body || ""),
            },
            sound: "default",
            badge: 1,
            "content-available": 1,
          },
        },
        headers: {
          "apns-priority": "10",
          "apns-push-type": "alert",
        },
        fcmOptions: notification.image
          ? { imageUrl: String(notification.image) }
          : undefined,
      },
      webpush: {
        notification: {
          title: String(notification.title || ""),
          body: String(notification.body || ""),
          ...(notification.image ? { image: String(notification.image) } : {}),
        },
      },
    };

 const response = await admin.messaging().sendEachForMulticast(multicastMessage);

const failedDetails = response.responses
  .map((r, index) => ({
    success: r.success,
    token: uniqueTokens[index],
    code: (r as any)?.error?.code || (r as any)?.errorInfo?.code || "",
    message: r.error?.message || "",
  }))
  .filter((x) => !x.success);

console.log("📬 Multicast send result:", {
  successCount: response.successCount,
  failureCount: response.failureCount,
  failedDetails,
});

// clean invalid tokens from Users collection
for (const failed of failedDetails) {
  if (
    failed.code === "messaging/invalid-registration-token" ||
    failed.code === "messaging/registration-token-not-registered"
  ) {
    const affectedUsersSnap = await firestore.collection("Users").get();

    for (const userDoc of affectedUsersSnap.docs) {
      const userData = userDoc.data() || {};
      const tokens = [
        userData.fcm_token,
        userData.fcmToken,
        userData.FCMToken,
        userData.token,
        userData.deviceToken,
        userData.notificationToken,
        ...(Array.isArray(userData.fcm_tokens) ? userData.fcm_tokens : []),
      ].filter((x) => typeof x === "string" && x.trim());

      if (tokens.includes(failed.token)) {
        const nextFcmTokens = Array.isArray(userData.fcm_tokens)
          ? userData.fcm_tokens.filter((t: string) => t !== failed.token)
          : [];

        const updatePayload: Record<string, any> = {};
        if (userData.fcm_token === failed.token) updatePayload.fcm_token = "";
        if (userData.fcmToken === failed.token) updatePayload.fcmToken = "";
        if (userData.FCMToken === failed.token) updatePayload.FCMToken = "";
        if (userData.token === failed.token) updatePayload.token = "";
        if (userData.deviceToken === failed.token) updatePayload.deviceToken = "";
        if (userData.notificationToken === failed.token) updatePayload.notificationToken = "";
        if (Array.isArray(userData.fcm_tokens)) updatePayload.fcm_tokens = nextFcmTokens;

        await userDoc.ref.update(updatePayload);
      }
    }
  }
}

const combinedErrors = [
  ...failedDetails.map((x) => `${x.code || "unknown"}: ${x.message}`),
  ...(invalidUsers.length ? [`No valid token for users: ${invalidUsers.join(", ")}`] : []),
];

await notificationRef.update({
  sent: response.successCount > 0,
  sentCount: response.successCount,
  failedCount: response.failureCount + invalidUsers.length,
  status:
    response.successCount > 0 && (response.failureCount > 0 || invalidUsers.length > 0)
      ? "partial"
      : response.successCount > 0
      ? "sent"
      : "failed",
  sentAt: admin.firestore.FieldValue.serverTimestamp(),
  errorMessage: combinedErrors.join(" | "),
  deliveryMode: "token",
  targetUserIds,
});

return NextResponse.json({
  message: "Notification processed for selected users.",
  sent: response.successCount > 0,
  sentCount: response.successCount,
  failedCount: response.failureCount + invalidUsers.length,
  status:
    response.successCount > 0 && (response.failureCount > 0 || invalidUsers.length > 0)
      ? "partial"
      : response.successCount > 0
      ? "sent"
      : "failed",
  errorMessage: combinedErrors.join(" | "),
  failedDetails,
  deliveryMode: "token",
  targetUserIds,
  sentAt: new Date().toISOString(),
});

    return NextResponse.json({
      message: "Notification processed for selected users.",
      sent: response.successCount > 0,
      sentCount: response.successCount,
      failedCount: response.failureCount + invalidUsers.length,
      status:
        response.successCount > 0 && (response.failureCount > 0 || invalidUsers.length > 0)
          ? "partial"
          : response.successCount > 0
          ? "sent"
          : "failed",
      deliveryMode: "token",
      targetUserIds,
      sentAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("🔥 FCM send error:", error);
    return NextResponse.json(
      { message: error?.message || "Failed to send notification." },
      { status: 500 }
    );
  }
}