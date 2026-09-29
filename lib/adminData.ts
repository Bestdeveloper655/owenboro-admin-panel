"use client";

import {
  collection,
  doc,
  getDocs,
  writeBatch,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
} from "firebase/firestore";
import { deleteObject, ref } from "firebase/storage";

import { db, storage } from "@/lib/firebaseServices";

/* Firestore caps a batch at 500 writes; stay under it. */
const BATCH_LIMIT = 450;

/* The mobile app casts `order` / `recommendedOrder` with `as int?` and drops the
 * document from `orderBy` queries when the field is missing, so anything that is
 * not a finite integer is treated as "no order". */
export function asOrder(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/* Sort by an integer order field; items without one go last, keeping their
 * relative position. */
export function sortByOrder<T>(items: T[], getOrder: (item: T) => number | null): T[] {
  return items
    .map((item, index) => ({ item, index, order: getOrder(item) }))
    .sort((a, b) => {
      if (a.order === null && b.order === null) return a.index - b.index;
      if (a.order === null) return 1;
      if (b.order === null) return -1;
      return a.order - b.order || a.index - b.index;
    })
    .map((entry) => entry.item);
}

/* Next free slot at the end of a contiguous 0-based sequence. */
export function nextOrder(orders: Array<number | null>): number {
  const valid = orders.filter((o): o is number => o !== null);
  return valid.length === 0 ? 0 : Math.max(...valid) + 1;
}

/* Write `field = index` (0-based, contiguous) for every id, in list order. */
export async function writeSequence(
  collectionName: string,
  ids: string[],
  field: "order" | "recommendedOrder" = "order",
): Promise<void> {
  for (let start = 0; start < ids.length; start += BATCH_LIMIT) {
    const batch = writeBatch(db);
    ids.slice(start, start + BATCH_LIMIT).forEach((id, offset) => {
      batch.update(doc(db, collectionName, id), { [field]: start + offset });
    });
    await batch.commit();
  }
}

/* Delete every document in a collection (subcollection), recursing into the
 * named child subcollections of each document first. The client SDK cannot
 * list subcollections, so the children have to be named. */
export async function deleteCollection(
  colRef: CollectionReference<DocumentData>,
  childSubcollections: string[] = [],
): Promise<void> {
  const snap = await getDocs(colRef);
  if (snap.empty) return;

  for (const child of childSubcollections) {
    for (const d of snap.docs) {
      await deleteCollection(collection(d.ref, child));
    }
  }

  for (let start = 0; start < snap.docs.length; start += BATCH_LIMIT) {
    const batch = writeBatch(db);
    snap.docs.slice(start, start + BATCH_LIMIT).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

/* Delete a document after deleting the named subcollections under it. */
export async function deleteDocDeep(
  docRef: DocumentReference<DocumentData>,
  subcollections: Record<string, string[]> = {},
): Promise<void> {
  for (const [name, children] of Object.entries(subcollections)) {
    await deleteCollection(collection(docRef, name), children);
  }
  const batch = writeBatch(db);
  batch.delete(docRef);
  await batch.commit();
}

/* Best-effort removal of the Storage object behind a download URL. URLs that
 * don't point at this project's bucket (YouTube links, external images) and
 * objects that are already gone are skipped rather than treated as errors. */
export async function deleteStorageFileByUrl(url?: string | null): Promise<void> {
  if (!url || typeof url !== "string") return;
  const isFirebaseUrl =
    url.startsWith("gs://") ||
    url.includes("firebasestorage.googleapis.com") ||
    url.includes(".firebasestorage.app");
  if (!isFirebaseUrl) return;

  try {
    await deleteObject(ref(storage, url));
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code !== "storage/object-not-found") {
      console.error("Storage delete failed:", url, err);
    }
  }
}

/* URL-safe slug from a display name. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/* Downscale an image to at most `maxWidth` px wide and re-encode as JPEG.
 * Images already narrower than that are still re-encoded so the upload is
 * always a .jpg, matching the `posts/{uid}/{ts}.jpg` contract. */
export async function resizeImageToJpeg(
  file: File,
  maxWidth = 1080,
  quality = 0.85,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Image encoding failed."))),
      "image/jpeg",
      quality,
    );
  });
}
