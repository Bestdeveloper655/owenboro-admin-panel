import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { getAuth, connectAuthEmulator } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyD1Htx96q128uUbP4Q90P8nsFdEHkxCbTM",
  authDomain: "the-owensboro-app.firebaseapp.com",
  projectId: "the-owensboro-app",
  storageBucket: "the-owensboro-app.firebasestorage.app",
  messagingSenderId: "98602473214",
  appId: "1:98602473214:web:43b833f1b76d4ba92237af",
};

// ✅ prevent re-initialization (important in Next.js)
const isFirstInit = !getApps().length;
const app = isFirstInit ? initializeApp(firebaseConfig) : getApp();

// Local testing only: `NEXT_PUBLIC_USE_EMULATORS=1 npm run dev` points the
// panel at the Firebase Emulator Suite (auth 9099, firestore 8080, storage
// 9199) so write flows and security rules can be exercised without touching
// production. Never set this in a deployed environment.
if (isFirstInit && process.env.NEXT_PUBLIC_USE_EMULATORS === "1") {
  connectAuthEmulator(getAuth(app), "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(getFirestore(app), "127.0.0.1", 8080);
  connectStorageEmulator(getStorage(app), "127.0.0.1", 9199);
}

// ✅ EXPORT THESE
export const db = getFirestore(app);
export const storage = getStorage(app);

export default app;