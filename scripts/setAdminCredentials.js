// One-off script to create or update the admin login user in Firebase Auth.
// Run from project root:   node scripts/setAdminCredentials.js
// Requires the same env vars the API routes already use:
//   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
// (loaded from .env.local via dotenv).

require("dotenv").config({ path: ".env.local" });
const admin = require("firebase-admin");

const EMAIL = "theowensboroapp@gmail.com";
const PASSWORD = "JavierAsim!1";

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

(async () => {
  try {
    let user;
    try {
      user = await admin.auth().getUserByEmail(EMAIL);
      await admin.auth().updateUser(user.uid, { password: PASSWORD });
      console.log(`Updated password for existing user: ${EMAIL} (uid=${user.uid})`);
    } catch (err) {
      if (err.code === "auth/user-not-found") {
        user = await admin.auth().createUser({
          email: EMAIL,
          password: PASSWORD,
          emailVerified: true,
        });
        console.log(`Created new user: ${EMAIL} (uid=${user.uid})`);
      } else {
        throw err;
      }
    }
    process.exit(0);
  } catch (err) {
    console.error("Failed:", err);
    process.exit(1);
  }
})();
