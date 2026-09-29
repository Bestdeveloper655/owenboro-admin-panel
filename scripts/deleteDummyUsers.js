// One-off script to delete dummy test accounts (Auth user + Users doc).
// Dry run:   node scripts/deleteDummyUsers.js
// Delete:    node scripts/deleteDummyUsers.js --delete
// Requires FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
// (loaded from .env.local via dotenv).

require("dotenv").config({ path: ".env.local" });
const admin = require("firebase-admin");

const EMAILS = [
  "adam2@gmail.com",
  "adam@gmail.com",
  "danial@gmail.com",
];

const DO_DELETE = process.argv.includes("--delete");

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

(async () => {
  for (const email of EMAILS) {
    let authUser = null;
    try {
      authUser = await admin.auth().getUserByEmail(email);
    } catch (e) {
      if (e.code !== "auth/user-not-found") throw e;
    }

    // Users docs may store the email with different casing, so match case-insensitively
    // via the auth uid first, then fall back to an email query.
    let docs = [];
    if (authUser) {
      const byUid = await firestore.collection("Users").doc(authUser.uid).get();
      if (byUid.exists) docs.push(byUid);
    }
    if (docs.length === 0) {
      for (const candidate of [email, email.charAt(0).toUpperCase() + email.slice(1)]) {
        const snap = await firestore.collection("Users").where("email", "==", candidate).get();
        docs.push(...snap.docs);
      }
    }

    const label = `${email}  auth:${authUser ? authUser.uid : "NOT FOUND"}  docs:[${docs.map((d) => `${d.id} name="${(d.data() || {}).name || (d.data() || {}).full_name || ""}"`).join(", ")}]`;

    if (!DO_DELETE) {
      console.log("DRY RUN →", label);
      continue;
    }

    if (authUser) await admin.auth().deleteUser(authUser.uid);
    for (const d of docs) await d.ref.delete();
    console.log("DELETED →", label);
  }
  process.exit(0);
})().catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});
