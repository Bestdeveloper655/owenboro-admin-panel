"use client";

import { collection, getDocs, query, where } from "firebase/firestore";

import { db } from "@/lib/firebaseServices";
import { asOrder, nextOrder } from "@/lib/adminData";

/* `recommendedOrder` for a listing being switched on: one past the current
 * maximum across every recommended product (A1 contract). The product itself
 * is excluded so re-saving an already recommended listing doesn't bump it. */
export async function nextRecommendedOrder(excludeProductId?: string): Promise<number> {
  const snap = await getDocs(
    query(collection(db, "Products"), where("recommended", "==", true)),
  );
  return nextOrder(
    snap.docs
      .filter((d) => d.id !== excludeProductId)
      .map((d) => asOrder(d.data().recommendedOrder)),
  );
}

/* A listing's `order` is its position inside its subcategory, or inside its
 * category when it has no subcategory. This key identifies that group. */
export function listingGroupKey(categoryId: string, subCategoryId: string): string {
  return subCategoryId ? `sub:${subCategoryId}` : `cat:${categoryId}`;
}
