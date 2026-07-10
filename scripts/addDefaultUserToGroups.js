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

// The user to add (as admin) to every group.
const DEFAULT_MEMBER_UID = "KBXvaPEvJ0UL6rm8A7hwzAHqzV92";
const DEFAULT_MEMBER_EMAIL = "info@theowensboroapp.com";

// The previous default member ("Javier") to remove from every group.
const REMOVE_MEMBER_UID = "alw3WyINMrYe3njG6H0c7IzSCo52";

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
    let updated = 0;
    let removed = 0;

    for (const groupDoc of groupsSnap.docs) {
      const groupName = groupDoc.data().name || groupDoc.id;

      // 1) Ensure the default user is an active admin member.
      const memberRef = groupDoc.ref
        .collection("members")
        .doc(DEFAULT_MEMBER_UID);

      const existing = await memberRef.get();
      const wasActiveAdmin =
        existing.exists &&
        existing.data().status === "active" &&
        existing.data().role === "admin";

      await memberRef.set(
        {
          userId: DEFAULT_MEMBER_UID,
          name,
          email,
          joinedAt: admin.firestore.FieldValue.serverTimestamp(),
          status: "active",
          role: "admin",
        },
        { merge: true }
      );
      if (existing.exists) {
        if (!wasActiveAdmin) {
          updated++;
          console.log(`  ~ updated admin membership in "${groupName}"`);
        }
      } else {
        added++;
        console.log(`  + added to "${groupName}"`);
      }

      // 2) Remove the previous default member ("Javier"), if present.
      const removeRef = groupDoc.ref
        .collection("members")
        .doc(REMOVE_MEMBER_UID);
      const removeSnap = await removeRef.get();
      if (removeSnap.exists) {
        await removeRef.delete();
        removed++;
        console.log(`  - removed previous default member from "${groupName}"`);
      }
    }

    console.log(
      `\nDone. Added: ${added}, updated: ${updated}, removed previous member: ${removed}.`
    );
    process.exit(0);
  } catch (err) {
    console.error("Failed:", err);
    process.exit(1);
  }
})();
