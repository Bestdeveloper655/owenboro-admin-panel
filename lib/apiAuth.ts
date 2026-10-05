import { NextRequest, NextResponse } from "next/server";
import { getAdmin } from "@/lib/serverNotify";
import { PANEL_OTP_CLAIM } from "@/lib/loginCode";

// Server-only guard for /api/admin/* routes. These routes use the Admin SDK and
// bypass Firestore rules, so each one must prove the caller is panel staff:
// a valid Firebase ID token (sent by `authedFetch`) whose Users/{uid}.role is
// one of the allowed roles — the same role check the dashboard layout uses.

export type StaffRole = "admin" | "moderator";

export type StaffCaller = { uid: string; role: StaffRole };

export async function requireStaff(
  req: NextRequest,
  allowed: StaffRole[] = ["admin", "moderator"],
): Promise<StaffCaller | NextResponse> {
  const header = req.headers.get("authorization") || "";
  const match = header.match(/^Bearer (.+)$/i);
  if (!match) {
    return NextResponse.json({ message: "Not signed in." }, { status: 401 });
  }

  const adminSdk = getAdmin();
  const expired = NextResponse.json(
    { message: "Session expired. Please sign in again." },
    { status: 401 },
  );
  let uid: string;
  let passedCode: boolean;
  try {
    const decoded = await adminSdk.auth().verifyIdToken(match[1]);
    uid = decoded.uid;
    passedCode = decoded[PANEL_OTP_CLAIM] === true;
  } catch {
    return expired;
  }

  const snap = await adminSdk.firestore().collection("Users").doc(uid).get();
  const role = snap.data()?.role;
  // Admins only get a panel session through the emailed code
  // (lib/loginCode.ts); a password-only admin session is refused.
  if (role === "admin" && !passedCode) return expired;
  if (!allowed.includes(role)) {
    return NextResponse.json({ message: "You don't have access to this action." }, { status: 403 });
  }

  return { uid, role };
}
