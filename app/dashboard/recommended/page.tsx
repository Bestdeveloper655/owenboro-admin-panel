"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
} from "firebase/firestore";

import { db } from "@/lib/firebaseServices";
import { asOrder, sortByOrder, writeSequence } from "@/lib/adminData";
import SortableList from "@/components/SortableList";

type Item = {
  id: string;
  name: string;
  image: string;
  categoryName: string;
  subCategoryName: string;
  order: number | null;
  recommendedOrder: number | null;
};

/* Recommended row order (A1). The app queries
 * `where('recommended', '==', true).orderBy('recommendedOrder')`, so every
 * recommended product needs an integer `recommendedOrder`; this screen owns it
 * and always writes the whole list as a contiguous 0-based sequence. */
export default function Page() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = async () => {
    try {
      setLoading(true);
      setError("");
      const [productSnap, catSnap, subSnap] = await Promise.all([
        getDocs(query(collection(db, "Products"), where("recommended", "==", true))),
        getDocs(collection(db, "Catagories")),
        getDocs(collection(db, "SubCatagories")),
      ]);

      const catNames = new Map(catSnap.docs.map((d) => [d.id, d.data().catagoryName || ""]));
      const subNames = new Map(subSnap.docs.map((d) => [d.id, d.data().name || ""]));

      const raw: Item[] = productSnap.docs.map((d) => {
        const x = d.data();
        return {
          id: d.id,
          name: x.productName || "Untitled listing",
          image: x.image || x.imageUrl || "",
          categoryName: catNames.get(x.catagoryRef?.id) || "",
          subCategoryName: subNames.get(x.subCatagoryRef?.id) || "",
          order: asOrder(x.order),
          recommendedOrder: asOrder(x.recommendedOrder),
        };
      });

      // Products that already have a position keep it; any without one are
      // seeded from their directory `order` and placed after them (backfill).
      const seeded = sortByOrder(raw, (i) => i.order);
      setItems(sortByOrder(seeded, (i) => i.recommendedOrder));
    } catch (err) {
      console.error(err);
      setError("Failed to load recommended listings.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  /* Out of sync = some product is missing `recommendedOrder`, or the stored
   * values aren't exactly 0..n-1 in the order shown. */
  const missingCount = useMemo(
    () => items.filter((i) => i.recommendedOrder === null).length,
    [items],
  );
  const outOfSync = useMemo(
    () => items.some((item, index) => item.recommendedOrder !== index),
    [items],
  );

  const save = async (next: Item[]) => {
    const previous = items;
    setItems(next.map((item, index) => ({ ...item, recommendedOrder: index })));
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await writeSequence("Products", next.map((i) => i.id), "recommendedOrder");
      setNotice("Recommended order saved.");
    } catch (err) {
      console.error(err);
      setItems(previous);
      setError("Failed to save the order. Nothing was changed in the app.");
    } finally {
      setSaving(false);
    }
  };

  const removeFromRecommended = async (item: Item) => {
    if (!window.confirm(`Remove "${item.name}" from Recommended?`)) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      // `recommendedOrder` is left in place; the app ignores it once
      // `recommended` is false.
      await updateDoc(doc(db, "Products", item.id), { recommended: false });
      const remaining = items.filter((i) => i.id !== item.id);
      await writeSequence("Products", remaining.map((i) => i.id), "recommendedOrder");
      setItems(remaining.map((i, index) => ({ ...i, recommendedOrder: index })));
      setNotice(`"${item.name}" removed from Recommended.`);
    } catch (err) {
      console.error(err);
      setError("Failed to remove the listing from Recommended.");
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-2 pt-4 pb-8 sm:px-6 sm:pt-6 sm:pb-10">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-3xl font-bold text-[#ff7a59] sm:text-4xl">Recommended</h1>
        <p className="mt-2 max-w-3xl text-base text-[#e8dcc7] sm:text-lg">
          Drag listings into the order they should appear in the app&rsquo;s
          Recommended row. Changes save as soon as you drop. To add a listing,
          switch on &ldquo;Recommended&rdquo; in Listings; it joins the end of
          this list.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}
      {notice && !error && (
        <div className="mb-4 rounded-xl border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
          {notice}
        </div>
      )}

      {!loading && outOfSync && items.length > 0 && (
        <div className="mb-4 flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
          <p>
            {missingCount > 0
              ? `${missingCount} recommended listing${missingCount === 1 ? " has" : "s have"} no Recommended position yet and won't appear in the app's Recommended row until this order is saved.`
              : "The saved positions have gaps or duplicates. Save to store the order shown here."}
          </p>
          <button
            type="button"
            disabled={saving}
            onClick={() => save(items)}
            className="shrink-0 rounded-lg bg-[#ff7a59] px-4 py-2 font-semibold text-white disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save this order"}
          </button>
        </div>
      )}

      <section className="rounded-3xl border border-[#ff7a59]/40 bg-[#0a0a0a] p-4 sm:p-6">
        {loading ? (
          <p className="text-[#f3ead7]/70">Loading recommended listings…</p>
        ) : items.length === 0 ? (
          <p className="text-[#f3ead7]/70">
            No listings are recommended yet. Switch on &ldquo;Recommended&rdquo;
            for a listing in Listings to add it here.
          </p>
        ) : (
          <>
            <p className="mb-4 text-sm text-[#f3ead7]/70">
              {items.length} listing{items.length === 1 ? "" : "s"}
              {saving ? " · saving…" : ""}
            </p>
            <SortableList
              items={items}
              getId={(i) => i.id}
              onReorder={save}
              disabled={saving}
              renderItem={(item) => (
                <div className="flex items-center gap-3">
                  {item.image ? (
                    <img
                      src={item.image}
                      alt=""
                      className="h-11 w-11 shrink-0 rounded-lg border border-black/10 object-cover"
                    />
                  ) : (
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-black/5 text-[10px] text-black/40">
                      No img
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{item.name}</p>
                    <p className="truncate text-xs text-black/55">
                      {[item.categoryName, item.subCategoryName].filter(Boolean).join(" • ") ||
                        "No category"}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => removeFromRecommended(item)}
                    className="shrink-0 rounded-lg border border-red-400 px-3 py-1 text-xs text-red-500 hover:bg-red-500 hover:text-white disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              )}
            />
          </>
        )}
      </section>
    </div>
  );
}
