"use client";

import {
  collection,
  doc,
  getDocs,
  query,
  where,
  type DocumentReference,
  type Timestamp,
} from "firebase/firestore";

import { db } from "@/lib/firebaseServices";
import { asOrder, nextOrder, sortByOrder, writeSequence } from "@/lib/adminData";
import { hasHours, summary, type OpeningHours } from "@/lib/openingHours";

/* A listing holds up to this many photos in `images`. */
export const MAX_LISTING_IMAGES = 10;

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

/* Current members of a listing's order group, read fresh from Firestore so
 * two admins adding listings at once don't both take the same slot. */
export async function fetchListingGroup(
  categoryId: string,
  subCategoryId: string,
): Promise<Array<{ id: string; order: number | null }>> {
  const snap = subCategoryId
    ? await getDocs(
        query(
          collection(db, "Products"),
          where("subCatagoryRef", "==", doc(db, "SubCatagories", subCategoryId)),
        ),
      )
    : await getDocs(
        query(
          collection(db, "Products"),
          where("catagoryRef", "==", doc(db, "Catagories", categoryId)),
        ),
      );
  return snap.docs
    .filter((d) => subCategoryId || !d.data().subCatagoryRef)
    .map((d) => ({ id: d.id, order: asOrder(d.data().order) }));
}

/* Re-number a group 0..n-1 after a listing leaves it. */
export async function compactListingGroup(
  categoryId: string,
  subCategoryId: string,
  leavingId: string,
): Promise<void> {
  if (!categoryId && !subCategoryId) return;
  const members = sortByOrder(
    (await fetchListingGroup(categoryId, subCategoryId)).filter((m) => m.id !== leavingId),
    (m) => m.order,
  );
  await writeSequence("Products", members.map((m) => m.id));
}

/* A Products doc's photos, cover first: `images` when it has them, else the
 * single `image` / `imageUrl` older listings were saved with. */
export function listingImages(data: { images?: unknown; image?: unknown; imageUrl?: unknown }): string[] {
  const images = Array.isArray(data.images)
    ? data.images.filter((u): u is string => typeof u === "string" && u !== "")
    : [];
  if (images.length > 0) return images;
  const single =
    (typeof data.image === "string" && data.image) ||
    (typeof data.imageUrl === "string" && data.imageUrl) ||
    "";
  return single ? [single] : [];
}

/* What a listing is made of, whoever wrote it: the Listings page's form or a
 * user's listing request (Listing Requests page). */
export type ListingFields = {
  title: string;
  categoryId: string;
  subCategoryId: string;
  shortDescription: string;
  about: string;
  /* Free text, written as-is only when there are no `openingHours`. */
  time: string;
  openingHours: OpeningHours | null;
  location: string;
  locationUrl: string;
  phone: string;
  email: string;
  websiteUrl: string;
  facebookUrl: string;
  startTimeString: string;
  endTimeString: string;
  startTime: Timestamp | null;
  lastTime: Timestamp | null;
  recommended: boolean;
};

/* The listing's content: every field the mobile app reads, with the exact
 * type it casts to, but not its place in the app (`order`, `recommended`). An
 * update from a listing request writes only this. `images` is cover first;
 * `image` / `imageUrl` repeat the cover for app builds older than `images`,
 * and `time` repeats the hours as one line for builds older than
 * `openingHours`. */
export function listingContent(f: Omit<ListingFields, "recommended">, images: string[]) {
  const catRef: DocumentReference = doc(db, "Catagories", f.categoryId);
  const subRef: DocumentReference | null = f.subCategoryId
    ? doc(db, "SubCatagories", f.subCategoryId)
    : null;
  const phone = f.phone.trim();
  const photos = images.filter(Boolean).slice(0, MAX_LISTING_IMAGES);
  const cover = photos[0] ?? "";
  const hours = hasHours(f.openingHours) ? f.openingHours : null;

  return {
    productName: f.title.trim(),
    shortDescription: f.shortDescription.trim(),
    about: f.about.trim(),
    productLocation: f.location.trim(),
    locationUrl: f.locationUrl.trim(),
    images: photos,
    image: cover,
    imageUrl: cover,
    phone_number: phone,
    contactInfo: phone,
    email: f.email.trim(),
    websiteUrl: f.websiteUrl.trim(),
    facebookUrl: f.facebookUrl.trim(),
    openingHours: hours,
    time: hours ? summary(hours) : f.time.trim(),
    startTimeString: f.startTimeString.trim(),
    endTimeString: f.endTimeString.trim(),
    startTime: f.startTime,
    lastTime: f.lastTime,
    catagoryRef: catRef,
    subCatagoryRef: subRef,
  };
}

/* The full listing, with its place in the app. */
export function listingPayload(
  f: ListingFields,
  images: string[],
  order: number,
  recommendedOrder: number | null,
) {
  return {
    ...listingContent(f, images),
    order,
    recommended: f.recommended,
    ...(recommendedOrder !== null ? { recommendedOrder } : {}),
  };
}
