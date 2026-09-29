// Read-only: list the members of a group with their account details.
// Usage: node scripts/groupMembers.js "25-29"
require("dotenv").config({ path: ".env.local" });
const admin = require("firebase-admin");

function getPrivateKey() {
  const key = process.env.FIREBASE_PRIVATE_KEY;
  return key ? key.replace(/\\n/g, "\n") : undefined;
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
const db = admin.firestore();
const wanted = process.argv[2] || "25-29";

(async () => {
  const groups = await db.collection("Groups").get();
  const matches = groups.docs.filter((g) => {
    const n = g.get("name") || g.get("title") || "";
    return String(n).trim() === wanted;
  });
  if (!matches.length) {
    console.log("No group named", wanted, "— names:", groups.docs.map((g) => g.get("name")).join(" | "));
    process.exit(0);
  }

  for (const g of matches) {
    console.log(`\n== Group "${g.get("name")}" (${g.id}) category=${g.get("category") || "-"}`);
    const members = await g.ref.collection("members").get();
    const rows = [];
    for (const m of members.docs) {
      const uid = m.get("userId") || m.get("uid") || m.id;
      const u = await db.doc(`Users/${uid}`).get();
      let auth = null;
      try { auth = await admin.auth().getUser(uid); } catch (_) {}
      rows.push({
        uid,
        shown: u.get("display_name") || u.get("full_name") || "User",
        display_name: u.get("display_name") || "",
        full_name: u.get("full_name") || "",
        email: u.get("email") || (auth ? auth.email : "") || "(none)",
        phone: auth && auth.phoneNumber ? auth.phoneNumber : "",
        provider: auth ? auth.providerData.map((p) => p.providerId).join(",") : "(no auth user)",
        score: u.get("social_score") || 0,
        created: auth ? auth.metadata.creationTime : (u.get("created_time") ? u.get("created_time").toDate().toISOString() : ""),
        lastSignIn: auth ? auth.metadata.lastSignInTime : "",
        userDoc: u.exists,
      });
    }
    rows.sort((a, b) => b.score - a.score);
    for (const r of rows) {
      console.log(
        `  ${String(r.score).padStart(4)} pts  ${r.shown.padEnd(18)} ${r.email.padEnd(32)} ${r.provider.padEnd(22)} uid=${r.uid}` +
        `${r.userDoc ? "" : "  [no Users doc]"}${r.phone ? "  phone=" + r.phone : ""}\n         created=${r.created}  lastSignIn=${r.lastSignIn}`
      );
    }
  }
  process.exit(0);
})().catch((e) => { console.error("Failed:", e.message); process.exit(1); });
