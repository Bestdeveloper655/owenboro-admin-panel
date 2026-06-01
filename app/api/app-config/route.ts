import { NextResponse } from "next/server";
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

export async function GET() {
  try {
    const snap = await firestore.collection("app_config").doc("mobile").get();

    if (!snap.exists) {
      return NextResponse.json({
        latest_version: "1.0.0",
        min_supported_version: "1.0.0",
        force_update: false,
        messaging_paused: false,
        play_store_url:
          "https://play.google.com/store/apps/details?id=com.techorphic.TheOwensboroApp",
        app_store_url:
          "https://apps.apple.com/us/app/the-owensboro-app/id6753979431",
        message: "No config found.",
      });
    }

    const data = snap.data() || {};

    return NextResponse.json({
      latest_version: String(data.latest_version || "1.0.0"),
      min_supported_version: String(
        data.min_supported_version || data.latest_version || "1.0.0"
      ),
      force_update: Boolean(data.force_update),
      messaging_paused: Boolean(data.messaging_paused),
      play_store_url: String(
        data.play_store_url ||
          "https://play.google.com/store/apps/details?id=com.techorphic.TheOwensboroApp"
      ),
      app_store_url: String(
        data.app_store_url ||
          "https://apps.apple.com/us/app/the-owensboro-app/id6753979431"
      ),
      message: String(
        data.message || "A new version is available. Please update the app."
      ),
    });
  } catch (error: any) {
    console.error("app-config error:", error);

    return NextResponse.json(
      { message: error?.message || "Failed to load app config." },
      { status: 500 }
    );
  }
}