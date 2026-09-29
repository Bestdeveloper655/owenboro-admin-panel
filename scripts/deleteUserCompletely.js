// Deletes one user and every record of them: Auth account, Users doc, username
// reservation, group memberships, notifications sent by or to them, profile
// views, reports about them, and their Storage files.
//
// Dry run:  node scripts/deleteUserCompletely.js <uid>
// Delete:   node scripts/deleteUserCompletely.js <uid> --delete
//
// Before deleting it writes a JSON record of everything to
// deleted-user-<uid>-<date>.json so there is proof of what was removed and why.
// Keep that file somewhere safe; it is the compliance record, and it contains
// personal data, so do not commit it.

require("dotenv").config({ path: ".env.local" });
const admin = require("firebase-admin");
const fs = require("fs");

const UID = process.argv[2];
const DO_DELETE = process.argv.includes("--delete");

if (!UID || UID.startsWith("--")) {
  console.error("Usage: node scripts/deleteUserCompletely.js <uid> [--delete]");
  process.exit(1);
}

function getPrivateKey() {
  const key = process.env.FIREBASE_PRIVATE_KEY;
  return key ? key.replace(/\\n/g, "\n") : undefined;
}

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: getPrivateKey(),
  }),
  storageBucket: "the-owensboro-app.firebasestorage.app",
});

const db = admin.firestore();
const mentionsUid = (data) => JSON.stringify(data || {}).includes(UID);

// Subcollections are only scanned under parents that actually have them.
const PARENTS_WITH_SUBCOLLECTIONS = ["DirectMessages", "Groups", "Products"];

(async () => {
  const targets = [];   // Firestore doc refs to delete
  const record = { uid: UID, scanned_at: new Date().toISOString(), documents: [] };

  for (const col of await db.listCollections()) {
    for (const doc of (await col.get()).docs) {
      if (doc.id === UID || mentionsUid(doc.data())) {
        targets.push(doc.ref);
        record.documents.push({ path: doc.ref.path, data: doc.data() });
      }
      if (!PARENTS_WITH_SUBCOLLECTIONS.includes(col.id)) continue;
      for (const sub of await doc.ref.listCollections()) {
        for (const subDoc of (await sub.get()).docs) {
          if (subDoc.id === UID || mentionsUid(subDoc.data())) {
            targets.push(subDoc.ref);
            record.documents.push({ path: subDoc.ref.path, data: subDoc.data() });
          }
        }
      }
    }
  }

  // Their username reservation is keyed by username, not uid, so it may not
  // mention the uid at all — catch it by its stored uid field.
  const userDoc = await db.collection("Users").doc(UID).get();
  const username = userDoc.data()?.username;
  if (username) {
    const ref = db.collection("usernames").doc(username);
    if ((await ref.get()).exists && !targets.some((t) => t.path === ref.path)) {
      targets.push(ref);
      record.documents.push({ path: ref.path, data: (await ref.get()).data() });
    }
  }

  let authUser = null;
  try {
    authUser = await admin.auth().getUser(UID);
    record.auth = { email: authUser.email, created: authUser.metadata.creationTime };
  } catch (e) {
    if (e.code !== "auth/user-not-found") throw e;
  }

  const [allFiles] = await admin.storage().bucket().getFiles();
  const files = allFiles.filter((f) => f.name.includes(UID));
  record.storage = files.map((f) => f.name);

  const byCollection = {};
  for (const ref of targets) {
    const key = ref.path.split("/").filter((_, i) => i % 2 === 0).join("/");
    byCollection[key] = (byCollection[key] || 0) + 1;
  }

  console.log(DO_DELETE ? "DELETING" : "DRY RUN", "for uid", UID);
  console.log("  auth account :", authUser ? authUser.email : "none");
  console.log("  storage files:", files.length);
  for (const [key, count] of Object.entries(byCollection)) {
    console.log(`  ${String(count).padStart(5)} ${key}`);
  }
  console.log("  total documents:", targets.length);

  if (!DO_DELETE) {
    console.log("\nNothing deleted. Re-run with --delete to apply.");
    process.exit(0);
  }

  const recordPath = `deleted-user-${UID}-${new Date().toISOString().slice(0, 10)}.json`;
  fs.writeFileSync(recordPath, JSON.stringify(record, null, 2));
  console.log("\nWrote record to", recordPath);

  // Firestore caps a batch at 500 writes.
  for (let i = 0; i < targets.length; i += 400) {
    const batch = db.batch();
    targets.slice(i, i + 400).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
  console.log("Deleted", targets.length, "documents");

  for (const file of files) await file.delete();
  console.log("Deleted", files.length, "storage files");

  if (authUser) {
    await admin.auth().deleteUser(UID);
    console.log("Deleted auth account");
  }

  // Verify nothing survived.
  const leftovers = [];
  for (const ref of targets) if ((await ref.get()).exists) leftovers.push(ref.path);
  const [remaining] = await admin.storage().bucket().getFiles();
  const fileLeftovers = remaining.filter((f) => f.name.includes(UID)).map((f) => f.name);
  let authGone = true;
  try { await admin.auth().getUser(UID); authGone = false; } catch {}

  console.log("\nVERIFY → documents left:", leftovers.length,
    "| storage left:", fileLeftovers.length,
    "| auth gone:", authGone);
  [...leftovers, ...fileLeftovers].forEach((p) => console.log("  STILL THERE:", p));
  process.exit(0);
})().catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});
