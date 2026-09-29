// Survey (read-only): everything in Firestore / Auth / Storage tied to the
// given uids. Usage: node scripts/surveyUsers.js <uid> [<uid> ...]
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
const uids = process.argv.slice(2);

// Field names the app uses to point at a user, across collections.
const FIELDS = [
  "userId", "user_id", "uid", "senderId", "sender_id", "authorId", "author_id",
  "ownerId", "owner_id", "createdBy", "created_by", "reporterId", "reportedUserId",
  "targetUserId", "fromUserId", "toUserId", "viewerId", "viewedUserId",
  "requesterId", "recipientId", "referrerId", "referredUserId",
];
const ARRAY_FIELDS = ["members", "memberIds", "participants", "participantIds", "targetUserIds", "users", "likedBy"];

(async () => {
  const cols = (await db.listCollections()).map((c) => c.id);
  console.log("collections:", cols.join(", "));
  const groups = new Set();
  for (const uid of uids) {
    let auth = null;
    try { auth = await admin.auth().getUser(uid); } catch (_) {}
    console.log(`\n== ${uid}  auth: ${auth ? auth.email : "NOT FOUND"}`);
    const userDoc = await db.doc(`Users/${uid}`).get();
    console.log(`   Users doc: ${userDoc.exists ? "exists (" + (userDoc.get("email") || "") + ")" : "missing"}`);
    if (userDoc.exists) {
      const subs = await userDoc.ref.listCollections();
      for (const s of subs) {
        const n = (await s.count().get()).data().count;
        console.log(`   Users/${uid}/${s.id}: ${n}`);
      }
    }
    for (const c of cols) {
      if (c === "Users") continue;
      const ref = db.collection(c);
      for (const f of FIELDS) {
        const n = (await ref.where(f, "==", uid).count().get()).data().count;
        if (n) console.log(`   ${c} where ${f}==uid: ${n}`);
      }
      for (const f of ARRAY_FIELDS) {
        const n = (await ref.where(f, "array-contains", uid).count().get()).data().count;
        if (n) console.log(`   ${c} where ${f} contains uid: ${n}`);
      }
      // Doc keyed by uid (e.g. Friends/{uid})
      const keyed = await ref.doc(uid).get();
      if (keyed.exists) console.log(`   ${c}/${uid}: doc exists`);
    }
    // Collection-group queries catch subcollections (group messages, etc.)
    for (const g of ["messages", "comments", "members", "likes", "replies", "views", "friends", "requests"]) {
      for (const f of ["senderId", "userId", "authorId", "uid"]) {
        try {
          const n = (await db.collectionGroup(g).where(f, "==", uid).count().get()).data().count;
          if (n) { console.log(`   collectionGroup ${g} where ${f}==uid: ${n}`); groups.add(g); }
        } catch (_) {}
      }
    }
    const [files] = await admin.storage().bucket().getFiles({ prefix: "" , maxResults: 5000 });
    const mine = files.filter((f) => f.name.includes(uid));
    console.log(`   storage files with uid in path: ${mine.length}${mine.length ? " e.g. " + mine.slice(0, 3).map((f) => f.name).join(", ") : ""}`);
  }
  process.exit(0);
})().catch((e) => { console.error("Failed:", e); process.exit(1); });
