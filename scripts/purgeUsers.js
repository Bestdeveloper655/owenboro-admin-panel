// Permanently remove test accounts and everything tied to them.
//   Dry run:  node scripts/purgeUsers.js <uid> [...]
//   Delete:   node scripts/purgeUsers.js --delete <uid> [...]
// Removes: Auth user, Users/{uid} (+ subcollections), VerificationPhotos,
// notifications sent to / by the user, username reservation, group
// memberships, docs whose id embeds the uid (DM threads, friend links), and
// Storage files under the uid. Requires FIREBASE_* in .env.local.
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
    storageBucket: "the-owensboro-app.firebasestorage.app",
  });
}
const db = admin.firestore();
const DO_DELETE = process.argv.includes("--delete");
const uids = process.argv.slice(2).filter((a) => a !== "--delete");
const log = (s) => console.log(`${DO_DELETE ? "DELETE" : "DRY   "} ${s}`);

async function deleteDocDeep(ref) {
  for (const sub of await ref.listCollections()) {
    const snap = await sub.get();
    for (const d of snap.docs) await deleteDocDeep(d.ref);
  }
  if (DO_DELETE) await ref.delete();
}

async function purge(uid) {
  console.log(`\n== ${uid}`);
  let auth = null;
  try { auth = await admin.auth().getUser(uid); } catch (_) {}
  log(`auth user: ${auth ? auth.email : "(already gone)"}`);

  const userRef = db.doc(`Users/${uid}`);
  const userDoc = await userRef.get();
  log(`Users/${uid}: ${userDoc.exists ? "exists" : "(already gone)"}`);
  if (userDoc.exists) await deleteDocDeep(userRef);

  // Docs pointing at the user by field.
  const byField = [
    ["VerificationPhotos", "uid"],
    ["notifications", "userId"],
    ["notifications", "senderId"],
    ["usernames", "uid"],
    ["friend_requests", "fromUserId"], ["friend_requests", "toUserId"],
    ["friend_requests", "senderId"], ["friend_requests", "receiverId"],
    ["profile_views", "viewerId"], ["profile_views", "viewedUserId"],
    ["reports", "reporterId"], ["reports", "reportedUserId"],
    ["posts", "userId"], ["posts", "authorId"], ["stories", "userId"],
  ];
  for (const [col, field] of byField) {
    const snap = await db.collection(col).where(field, "==", uid).get();
    if (snap.empty) continue;
    log(`${col} where ${field}==uid: ${snap.size} doc(s)`);
    for (const d of snap.docs) await deleteDocDeep(d.ref);
  }

  // Admin notifications targeted at several users: drop just this uid.
  const targeted = await db.collection("notifications").where("targetUserIds", "array-contains", uid).get();
  for (const d of targeted.docs) {
    const ids = d.get("targetUserIds") || [];
    if (ids.length <= 1) {
      log(`notifications/${d.id} (only target): delete`);
      if (DO_DELETE) await d.ref.delete();
    } else {
      log(`notifications/${d.id}: remove uid from targetUserIds`);
      if (DO_DELETE) await d.ref.update({ targetUserIds: admin.firestore.FieldValue.arrayRemove(uid) });
    }
  }

  // Group memberships (Groups/{id}/members/{uid}) + keep member counts honest.
  const members = await db.collectionGroup("members").where("userId", "==", uid).get();
  for (const m of members.docs) {
    const group = m.ref.parent.parent;
    log(`${m.ref.path}: delete`);
    if (DO_DELETE) {
      await m.ref.delete();
      const g = await group.get();
      const upd = {};
      for (const k of ["memberCount", "member_count", "membersCount"]) {
        if (typeof g.get(k) === "number" && g.get(k) > 0) upd[k] = admin.firestore.FieldValue.increment(-1);
      }
      for (const k of ["members", "memberIds", "member_ids"]) {
        if (Array.isArray(g.get(k)) && g.get(k).includes(uid)) upd[k] = admin.firestore.FieldValue.arrayRemove(uid);
      }
      if (Object.keys(upd).length) await group.update(upd);
    }
  }
  // Same membership stored under a different field name (needs an index that
  // may not exist; skip if so — the userId form above is what the app writes).
  try {
    const members2 = await db.collectionGroup("members").where("uid", "==", uid).get();
    for (const m of members2.docs) { log(`${m.ref.path}: delete`); if (DO_DELETE) await m.ref.delete(); }
  } catch (_) {}

  // Docs whose id embeds the uid (DM threads "a_b", friends/{uid}, etc.).
  for (const col of ["DirectMessages", "friends", "friend_requests", "profile_views", "vote", "challenges"]) {
    const snap = await db.collection(col).select().get();
    for (const d of snap.docs) {
      if (!d.id.includes(uid)) continue;
      log(`${col}/${d.id}: delete (id contains uid)`);
      await deleteDocDeep(d.ref);
    }
  }
  // Messages the user sent inside groups / DMs.
  for (const [g, f] of [["messages", "senderId"], ["messages", "userId"], ["comments", "userId"], ["likes", "userId"]]) {
    try {
      const snap = await db.collectionGroup(g).where(f, "==", uid).get();
      for (const d of snap.docs) { log(`${d.ref.path}: delete`); if (DO_DELETE) await d.ref.delete(); }
    } catch (_) {}
  }

  // Storage.
  const [files] = await admin.storage().bucket().getFiles({ maxResults: 10000 });
  const mine = files.filter((f) => f.name.includes(uid));
  log(`storage: ${mine.length} file(s)`);
  if (DO_DELETE) for (const f of mine) await f.delete({ ignoreNotFound: true });

  if (DO_DELETE && auth) await admin.auth().deleteUser(uid);
}

(async () => {
  for (const uid of uids) await purge(uid);
  console.log(DO_DELETE ? "\nDone." : "\nDry run only — nothing deleted.");
  process.exit(0);
})().catch((e) => { console.error("Failed:", e); process.exit(1); });
