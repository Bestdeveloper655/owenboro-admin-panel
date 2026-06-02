// One-off backfill: add a default user as a member of EVERY existing group.
// New groups created from the admin panel add this user automatically
// (see app/dashboard/groups/page.tsx); this script covers groups that
// already existed before that change.
//
// Run from the admin-panel project root:   node scripts/addDefaultUserToGroups.js
// Requires the same env vars the other scripts use (loaded from .env.local):
//   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY

require("dotenv").config({ path: ".env.local" });
const admin = require("firebase-admin");

// The user to add to every group.
const DEFAULT_MEMBER_UID = "alw3WyINMrYe3njG6H0c7IzSCo52";
const DEFAULT_MEMBER_EMAIL = "jag42303@gmail.com";

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

const db = admin.firestore();

(async () => {
  try {
    // Resolve the member's name/email from their Users profile (best effort).
    let name = "";
    let email = DEFAULT_MEMBER_EMAIL;
    try {
      const userSnap = await db.collection("Users").doc(DEFAULT_MEMBER_UID).get();
      if (userSnap.exists) {
        const u = userSnap.data();
        name = u.display_name || u.full_name || "";
        email = u.email || DEFAULT_MEMBER_EMAIL;
      } else {
        console.warn(`No Users/${DEFAULT_MEMBER_UID} doc found; using email only.`);
      }
    } catch (e) {
      console.warn("Could not load default member profile:", e.message);
    }

    const groupsSnap = await db.collection("Groups").get();
    console.log(`Found ${groupsSnap.size} group(s).`);

    let added = 0;
    let skipped = 0;

    for (const groupDoc of groupsSnap.docs) {
      const memberRef = groupDoc.ref
        .collection("members")
        .doc(DEFAULT_MEMBER_UID);

      const existing = await memberRef.get();
      if (existing.exists && existing.data().status === "active") {
        skipped++;
        continue;
      }

      await memberRef.set(
        {
          userId: DEFAULT_MEMBER_UID,
          name,
          email,
          joinedAt: admin.firestore.FieldValue.serverTimestamp(),
          status: "active",
        },
        { merge: true }
      );
      added++;
      console.log(`  + added to "${groupDoc.data().name || groupDoc.id}"`);
    }

    console.log(`\nDone. Added: ${added}, already a member: ${skipped}.`);
    process.exit(0);
  } catch (err) {
    console.error("Failed:", err);
    process.exit(1);
  }
})();
