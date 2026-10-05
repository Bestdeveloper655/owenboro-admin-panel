import { NextRequest, NextResponse } from "next/server";
import { getAdmin } from "@/lib/serverNotify";
import {
  CODE_TTL_MS,
  CODES_COLLECTION,
  LOGIN_CODE_RECIPIENTS,
  RESEND_COOLDOWN_MS,
  hashCode,
  maskEmail,
  newChallengeId,
  newCode,
  sendLoginCode,
} from "@/lib/loginCode";

// Step 1 of panel sign-in, called right after the password check with that
// session's ID token. Moderators need no code. For an admin, this emails a
// fresh code (replacing any earlier one) and returns the challenge id that
// step 2 (./verify) redeems. See lib/loginCode.ts.

export async function POST(req: NextRequest) {
  const match = (req.headers.get("authorization") || "").match(/^Bearer (.+)$/i);
  if (!match) {
    return NextResponse.json({ message: "Not signed in." }, { status: 401 });
  }

  const adminSdk = getAdmin();
  let uid: string;
  let email: string;
  try {
    const decoded = await adminSdk.auth().verifyIdToken(match[1]);
    uid = decoded.uid;
    email = decoded.email ?? uid;
  } catch {
    return NextResponse.json({ message: "Session expired. Please sign in again." }, { status: 401 });
  }

  const firestore = adminSdk.firestore();
  const role = (await firestore.collection("Users").doc(uid).get()).data()?.role;
  if (role === "moderator") {
    return NextResponse.json({ needsCode: false });
  }
  if (role !== "admin") {
    return NextResponse.json(
      { message: "This account doesn't have admin panel access." },
      { status: 403 },
    );
  }

  const earlier = await firestore.collection(CODES_COLLECTION).where("uid", "==", uid).get();
  const lastSent = Math.max(0, ...earlier.docs.map((d) => d.data().createdAt?.toMillis() ?? 0));
  const wait = lastSent + RESEND_COOLDOWN_MS - Date.now();
  if (wait > 0) {
    return NextResponse.json(
      { message: `A code was just sent. Wait ${Math.ceil(wait / 1000)} seconds before asking for another.` },
      { status: 429 },
    );
  }

  const challengeId = newChallengeId();
  const code = newCode();
  const now = Date.now();
  const ref = firestore.collection(CODES_COLLECTION).doc(challengeId);
  const batch = firestore.batch();
  earlier.docs.forEach((d) => batch.delete(d.ref));
  batch.set(ref, {
    uid,
    codeHash: hashCode(challengeId, code),
    attempts: 0,
    createdAt: adminSdk.firestore.Timestamp.fromMillis(now),
    expiresAt: adminSdk.firestore.Timestamp.fromMillis(now + CODE_TTL_MS),
  });
  await batch.commit();

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim();
  try {
    await sendLoginCode({ code, account: email, requestedFrom: ip ? `IP ${ip}` : "unknown IP" });
  } catch (err) {
    console.error("login code email failed", err);
    await ref.delete();
    return NextResponse.json(
      { message: "Couldn't send the sign-in code. Try again in a minute." },
      { status: 502 },
    );
  }

  return NextResponse.json({
    needsCode: true,
    challengeId,
    sentTo: LOGIN_CODE_RECIPIENTS.map(maskEmail),
    expiresInMinutes: CODE_TTL_MS / 60_000,
  });
}
