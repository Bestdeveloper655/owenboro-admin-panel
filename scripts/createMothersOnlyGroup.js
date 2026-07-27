// One-off: create the "Mothers Only" community group, restricted to female
// members via `allowedGender: "Female"` (enforced in the app UI and in
// firestore.rules). Idempotent — if a group with this name already exists it
// just sets the restriction on it instead of creating a duplicate.
//
// Run from the admin-panel project root:   node scripts/createMothersOnlyGroup.js
// Requires the same env vars the other scripts use (loaded from .env.local):
//   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY

require("dotenv").config({ path: ".env.local" });
const admin = require("firebase-admin");

const GROUP_NAME = "Mothers Only";
const GROUP_DESCRIPTION =
  "A private space for moms to connect, share, and support each other.";
const ALLOWED_GENDER = "Female";

// Default admin member added to every group (matches the admin panel).
const DEFAULT_MEMBER_UID = "KBXvaPEvJ0UL6rm8A7hwzAHqzV92";
const DEFAULT_MEMBER_EMAIL = "info@theowensboroapp.com";

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
    const existing = await db
      .collection("Groups")
      .where("name", "==", GROUP_NAME)
      .limit(1)
      .get();

    let groupRef;
    if (!existing.empty) {
      groupRef = existing.docs[0].ref;
      console.log(`Group "${GROUP_NAME}" already exists (${groupRef.id}).`);
      await groupRef.set({ allowedGender: ALLOWED_GENDER }, { merge: true });
      console.log(`Set allowedGender = "${ALLOWED_GENDER}" on it.`);
    } else {
      groupRef = await db.collection("Groups").add({
        name: GROUP_NAME,
        description: GROUP_DESCRIPTION,
        image: "",
        imagePath: "",
        status: "active",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        allowedGender: ALLOWED_GENDER,
      });
      console.log(`Created group "${GROUP_NAME}" (${groupRef.id}).`);
    }

    // Add the default admin member, same as the admin panel does on create.
    let name = "";
    let email = DEFAULT_MEMBER_EMAIL;
    try {
      const userSnap = await db
        .collection("Users")
        .doc(DEFAULT_MEMBER_UID)
        .get();
      if (userSnap.exists) {
        const u = userSnap.data();
        name = u.display_name || u.full_name || "";
        email = u.email || DEFAULT_MEMBER_EMAIL;
      }
    } catch (e) {
      console.warn("Could not load default member profile:", e.message);
    }

    await groupRef
      .collection("members")
      .doc(DEFAULT_MEMBER_UID)
      .set(
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
    console.log("Ensured default admin member.");

    const snap = await groupRef.get();
    console.log("Final group doc:", JSON.stringify(snap.data(), null, 2));
    process.exit(0);
  } catch (err) {
    console.error("Failed:", err);
    process.exit(1);
  }
})();
