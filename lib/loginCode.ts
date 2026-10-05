import { createHash, randomBytes, randomInt, timingSafeEqual } from "crypto";

// Admin sign-in codes (client request, 5 Oct 2026). An admin signs in with
// their password, then enters a 6-digit code emailed to the owners below. Only
// then does the server mint the panel session: a custom token carrying the
// PANEL_OTP_CLAIM claim. Firestore and Storage rules' isAdmin() require that
// claim, so the password alone can't use admin powers. Moderators sign in with
// their password only. Server-only — never import from a client component.

export const LOGIN_CODE_RECIPIENTS = [
  "theowensboroapp@gmail.com",
  "danyalahmed655@gmail.com",
  "developers@techorphic.com",
];

export const PANEL_OTP_CLAIM = "panelOtp";

// Pending codes, one doc per sign-in attempt, keyed by an unguessable id.
// Firestore rules don't match this collection, so only the Admin SDK can read it.
export const CODES_COLLECTION = "panelLoginCodes";

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
export const RESEND_COOLDOWN_MS = 30 * 1000;

export function newChallengeId(): string {
  return randomBytes(32).toString("hex");
}

export function newCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

// Only a hash is stored, salted with the challenge id.
export function hashCode(challengeId: string, code: string): string {
  return createHash("sha256").update(`${challengeId}:${code}`).digest("hex");
}

export function codeMatches(challengeId: string, code: string, storedHash: string): boolean {
  const a = Buffer.from(hashCode(challengeId, code), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

// "theowensboroapp@gmail.com" -> "th•••••••••••••@gmail.com"
export function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 2)}${"•".repeat(Math.max(name.length - 2, 1))}@${domain}`;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Emails the code through Resend (https://resend.com/docs/api-reference/emails/send-email).
// On the local emulators with no API key, the code is printed to the server log
// instead, so sign-in can be tested without sending mail.
export async function sendLoginCode({
  code,
  account,
  requestedFrom,
}: {
  code: string;
  account: string;
  requestedFrom: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    if (process.env.NEXT_PUBLIC_USE_EMULATORS === "1") {
      console.info(`[login code] ${code} for ${account} -> ${LOGIN_CODE_RECIPIENTS.join(", ")}`);
      return;
    }
    throw new Error("RESEND_API_KEY is not set.");
  }
  const from = process.env.LOGIN_CODE_FROM;
  if (!from) throw new Error("LOGIN_CODE_FROM is not set.");

  const minutes = CODE_TTL_MS / 60_000;
  const text = [
    `Your Owensboro App admin panel sign-in code is ${code}.`,
    "",
    `Someone signed in as ${account} (${requestedFrom}). The code expires in ${minutes} minutes and works once.`,
    "",
    "If this wasn't you or your team, someone has the admin password: change it in Firebase Authentication.",
  ].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#111">
<p>Your Owensboro App admin panel sign-in code is:</p>
<p style="font-size:32px;font-weight:bold;letter-spacing:6px;margin:16px 0">${code}</p>
<p>Someone signed in as <b>${escapeHtml(account)}</b> (${escapeHtml(requestedFrom)}). The code expires in ${minutes} minutes and works once.</p>
<p style="color:#666">If this wasn't you or your team, someone has the admin password: change it in Firebase Authentication.</p>
</div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: LOGIN_CODE_RECIPIENTS,
      subject: `${code} is your admin panel sign-in code`,
      text,
      html,
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}
