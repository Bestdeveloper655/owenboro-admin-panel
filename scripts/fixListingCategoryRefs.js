// Repair listings whose `catagoryRef` points at a deleted category.
//   Dry run:  node scripts/fixListingCategoryRefs.js
//   Write:    node scripts/fixListingCategoryRefs.js --apply
// A listing with a sub category is shown under that sub category, so its
// category is the sub category's parent. When the stored `catagoryRef` is
// missing or names a category that no longer exists, it is rewritten to that
// parent. Category filters in the app (wheel filter, listing dropdown) query
// `catagoryRef`, so a stale ref hides the listing there. `order` is per sub
// category and is not touched. Listings whose ref names a real but different
// category are only reported: which one is intended needs a human.
// Requires FIREBASE_* in .env.local.
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
const APPLY = process.argv.includes("--apply");
const log = (s) => console.log(`${APPLY ? "WRITE" : "DRY  "} ${s}`);

(async () => {
  const [catSnap, subSnap, productSnap] = await Promise.all([
    db.collection("Catagories").get(),
    db.collection("SubCatagories").get(),
    db.collection("Products").get(),
  ]);

  const categoryName = new Map(catSnap.docs.map((d) => [d.id, d.data().catagoryName]));
  const subs = new Map(
    subSnap.docs.map((d) => [d.id, { name: d.data().name, parentId: d.data().catagoriesRef?.id }]),
  );

  const fixes = [];
  const conflicts = [];
  for (const d of productSnap.docs) {
    const x = d.data();
    const sub = x.subCatagoryRef ? subs.get(x.subCatagoryRef.id) : undefined;
    if (!sub || !categoryName.has(sub.parentId)) continue;

    const storedId = x.catagoryRef?.id;
    if (storedId === sub.parentId) continue;

    const label = `${d.id} "${x.productName}" (${sub.name})`;
    if (storedId && categoryName.has(storedId)) {
      conflicts.push(`${label}: catagoryRef=${categoryName.get(storedId)}, sub belongs to ${categoryName.get(sub.parentId)}`);
    } else {
      fixes.push({ ref: d.ref, parentId: sub.parentId, label, from: x.catagoryRef?.path ?? "none" });
    }
  }

  for (const f of fixes) log(`${f.label}: ${f.from} -> Catagories/${f.parentId} (${categoryName.get(f.parentId)})`);
  console.log(`\n${fixes.length} listing(s) with a dead catagoryRef.`);

  if (conflicts.length) {
    console.log(`\n${conflicts.length} listing(s) need a human decision (left unchanged):`);
    conflicts.forEach((c) => console.log(`  ${c}`));
  }

  if (APPLY && fixes.length) {
    for (let i = 0; i < fixes.length; i += 450) {
      const batch = db.batch();
      fixes.slice(i, i + 450).forEach((f) =>
        batch.update(f.ref, { catagoryRef: db.collection("Catagories").doc(f.parentId) }),
      );
      await batch.commit();
    }
    console.log(`\nUpdated ${fixes.length} listing(s).`);
  } else if (fixes.length) {
    console.log("\nDry run. Re-run with --apply to write.");
  }
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
