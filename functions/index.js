const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();

/**
 * Callable: hard-delete a reported chat message.
 *
 * Enforcement lives here (server-side) — the caller MUST be signed in and have
 * role "admin" or "moderator" on their Users doc. A normal user calling this
 * directly is rejected, so the UI role check in the admin panel can't be
 * bypassed. Mirrors the app's existing trusted-reporter delete + audit log.
 *
 * Expected data: {
 *   reportId, source ("direct_message" | "group_chat"),
 *   conversationId, groupId, messageId,
 *   offenderUid, offenderName, messageText
 * }
 */
exports.deleteMessage = onCall(async (request) => {
  const authCtx = request.auth;
  if (!authCtx) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const db = admin.firestore();
  const callerUid = authCtx.uid;

  // 1. Verify the caller is an admin or moderator.
  const callerSnap = await db.collection("Users").doc(callerUid).get();
  const role = callerSnap.get("role");
  if (role !== "admin" && role !== "moderator") {
    throw new HttpsError(
      "permission-denied",
      "Only admins or moderators can delete messages.",
    );
  }

  const {
    reportId,
    source,
    conversationId,
    groupId,
    messageId,
    offenderUid,
    offenderName,
    messageText,
  } = request.data || {};

  if (!messageId) {
    throw new HttpsError("invalid-argument", "messageId is required.");
  }

  // 2. Resolve the message path from the report source.
  let messageRef;
  if (source === "direct_message") {
    if (!conversationId) {
      throw new HttpsError(
        "invalid-argument",
        "conversationId is required for a direct message.",
      );
    }
    messageRef = db
      .collection("DirectMessages")
      .doc(conversationId)
      .collection("messages")
      .doc(messageId);
  } else if (source === "group_chat") {
    if (!groupId) {
      throw new HttpsError(
        "invalid-argument",
        "groupId is required for a group message.",
      );
    }
    messageRef = db
      .collection("Groups")
      .doc(groupId)
      .collection("messages")
      .doc(messageId);
  } else {
    throw new HttpsError(
      "invalid-argument",
      `Unsupported report source: ${source}`,
    );
  }

  // 3. Hard-delete the message.
  await messageRef.delete();

  // 4. Audit log — reuses the app's trusted_actions collection.
  await db.collection("trusted_actions").add({
    trusted_uid: callerUid,
    trusted_name:
      callerSnap.get("full_name") || callerSnap.get("display_name") || "",
    offender_uid: offenderUid || "",
    offender_name: offenderName || "",
    action: "delete_message",
    source: source || "",
    message_text: messageText || "",
    via: "admin_panel",
    created_at: admin.firestore.FieldValue.serverTimestamp(),
  });

  // 5. Mark the originating report as actioned.
  if (reportId) {
    await db.collection("reports").doc(reportId).set(
      {
        status: "action_taken",
        reviewed_at: admin.firestore.FieldValue.serverTimestamp(),
        reviewed_by: callerUid,
        message_deleted: true,
      },
      { merge: true },
    );
  }

  return { ok: true };
});

exports.sendNotification = onDocumentCreated(
  "Notifications/{id}",
  async (event) => {
    const snap = event.data;

    if (!snap) {
      console.log("No data");
      return;
    }

    const data = snap.data();

    const title = data.title;
    const body = data.body;

    try {
      // 🔥 Get all users
      const usersSnap = await admin.firestore().collection("Users").get();

      const tokens = [];

      usersSnap.forEach((doc) => {
        const user = doc.data();
        if (user.fcmToken) {
          tokens.push(user.fcmToken);
        }
      });

      if (tokens.length === 0) {
        console.log("No tokens found");
        return;
      }

      // 🔥 Send notification
      const response = await admin.messaging().sendEachForMulticast({
        tokens,
        notification: {
          title,
          body,
        },
      });

      console.log("Notifications sent:", response.successCount);
    } catch (error) {
      console.error("Error sending notification:", error);
    }
  }
);