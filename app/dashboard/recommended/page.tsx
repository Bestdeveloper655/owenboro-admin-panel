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
import { Star } from "lucide-react";

import { db } from "@/lib/firebaseServices";
import { asOrder, sortByOrder, writeSequence } from "@/lib/adminData";
import SortableList from "@/components/SortableList";
import { Alert, Button, Card, EmptyState, LoadingState, PageHeader } from "@/components/ui";

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
    <div>
      <PageHeader
        title="Recommended"
        description={
          <>
            Drag listings into the order they should appear in the app&rsquo;s
            Recommended row. Changes save as soon as you drop. To add a listing,
            switch on &ldquo;Recommended&rdquo; in Listings; it joins the end of
            this list.
          </>
        }
      />

      {error && (
        <Alert className="mb-4" onDismiss={() => setError("")}>
          {error}
        </Alert>
      )}
      {notice && !error && (
        <Alert tone="success" className="mb-4" onDismiss={() => setNotice("")}>
          {notice}
        </Alert>
      )}

      {!loading && outOfSync && items.length > 0 && (
        <Alert tone="warning" className="mb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p>
              {missingCount > 0
                ? `${missingCount} recommended listing${missingCount === 1 ? " has" : "s have"} no Recommended position yet and won't appear in the app's Recommended row until this order is saved.`
                : "The saved positions have gaps or duplicates. Save to store the order shown here."}
            </p>
            <Button
              size="sm"
              className="self-start sm:self-auto"
              loading={saving}
              onClick={() => save(items)}
            >
              {saving ? "Saving…" : "Save this order"}
            </Button>
          </div>
        </Alert>
      )}

      {loading ? (
        <LoadingState label="Loading recommended listings…" />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Star}
          title="No listings are recommended yet."
          description={
            <>
              Switch on &ldquo;Recommended&rdquo; for a listing in Listings to add it
              here.
            </>
          }
        />
      ) : (
        <Card
          description={
            <>
              {items.length} listing{items.length === 1 ? "" : "s"}
              {saving ? " · saving…" : ""}
            </>
          }
        >
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
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-black/10 bg-black/5 text-[10px] text-black/40">
                    No img
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{item.name}</p>
                  <p className="truncate text-xs text-black/55">
                    {[item.categoryName, item.subCategoryName].filter(Boolean).join(" • ") ||
                      "No category"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={saving}
                  onClick={() => removeFromRecommended(item)}
                >
                  Remove
                </Button>
              </div>
            )}
          />
        </Card>
      )}
    </div>
  );
}
