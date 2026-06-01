import { NextResponse } from "next/server";
import admin from "firebase-admin";

/* ---------------- Firebase Init ---------------- */
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

/* ---------------- POST: UPDATE APP CONFIG ---------------- */
export async function POST(req: Request) {
  try {
    const body = await req.json();

    // validation (basic but important)
    if (!body.latest_version || !body.min_supported_version) {
      return NextResponse.json(
        { message: "latest_version and min_supported_version required" },
        { status: 400 }
      );
    }

    await firestore.collection("app_config").doc("mobile").set(
      {
        latest_version: body.latest_version,
        min_supported_version: body.min_supported_version,
        force_update: Boolean(body.force_update),
        messaging_paused: Boolean(body.messaging_paused),
        play_store_url: body.play_store_url || "",
        app_store_url: body.app_store_url || "",
        message: body.message || "",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return NextResponse.json({
      message: "Config updated successfully",
    });
  } catch (error: any) {
    console.error("POST app-config error:", error);

    return NextResponse.json(
      { message: error?.message || "Update failed" },
      { status: 500 }
    );
  }
}