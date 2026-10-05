import { NextRequest, NextResponse } from "next/server";
import { getAdmin } from "@/lib/serverNotify";
import { CODES_COLLECTION, MAX_ATTEMPTS, PANEL_OTP_CLAIM, codeMatches } from "@/lib/loginCode";

// Step 2 of admin sign-in: redeems the emailed code for a custom token that
// carries PANEL_OTP_CLAIM. Each code works once, for CODE_TTL_MS, and is
// deleted after MAX_ATTEMPTS wrong tries.

type Outcome =
  | { ok: true; uid: string }
  | { ok: false; status: number; message: string };

export async function POST(req: NextRequest) {
  let challengeId: unknown;
  let code: unknown;
  try {
    ({ challengeId, code } = await req.json());
  } catch {
    return NextResponse.json({ message: "Invalid request." }, { status: 400 });
  }
  if (typeof challengeId !== "string" || !/^[0-9a-f]{64}$/.test(challengeId)) {
    return NextResponse.json({ message: "Invalid request." }, { status: 400 });
  }
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ message: "Enter the 6-digit code from the email." }, { status: 400 });
  }

  const adminSdk = getAdmin();
  const firestore = adminSdk.firestore();
  const ref = firestore.collection(CODES_COLLECTION).doc(challengeId);
  const expired: Outcome = {
    ok: false,
    status: 410,
    message: "This code has expired. Sign in again to get a new one.",
  };

  const outcome = await firestore.runTransaction<Outcome>(async (tx) => {
    const snap = await tx.get(ref);
    const c = snap.data();
    if (!c) return expired;
    if (c.expiresAt.toMillis() < Date.now()) {
      tx.delete(ref);
      return expired;
    }
    if (!codeMatches(challengeId as string, code as string, c.codeHash)) {
      const attempts = (c.attempts ?? 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        tx.delete(ref);
        return {
          ok: false,
          status: 429,
          message: "Too many wrong codes. Sign in again to get a new code.",
        };
      }
      tx.update(ref, { attempts });
      const left = MAX_ATTEMPTS - attempts;
      return {
        ok: false,
        status: 401,
        message: `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.`,
      };
    }
    tx.delete(ref);
    return { ok: true, uid: c.uid };
  });

  if (!outcome.ok) {
    return NextResponse.json({ message: outcome.message }, { status: outcome.status });
  }

  // The role may have changed since the code was sent.
  const role = (await firestore.collection("Users").doc(outcome.uid).get()).data()?.role;
  if (role !== "admin") {
    return NextResponse.json(
      { message: "This account doesn't have admin panel access." },
      { status: 403 },
    );
  }

  const token = await adminSdk.auth().createCustomToken(outcome.uid, { [PANEL_OTP_CLAIM]: true });
  return NextResponse.json({ token });
}
