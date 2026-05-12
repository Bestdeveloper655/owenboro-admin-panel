"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  getDocs,
  deleteDoc,
  doc,
  updateDoc,
  setDoc,
  query,
  orderBy,
  limit,
} from "firebase/firestore";
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";

import { db, storage } from "@/lib/firebaseServices";

/* TYPES */
type Category = { id: string; name: string };
type SubCategory = { id: string; name: string; categoryId: string };

type Listing = {
  id: string;
  title: string;
  category: string;
  subCategory: string;
  categoryId: string;
  subCategoryId: string;
  location: string;
  about: string;
  shortDescription: string;
  time: string;
  contact: string;
  image?: string;
  websiteUrl?: string;
  facebookUrl?: string;
  locationUrl?: string;
  order?: number;
};

type ListingForm = {
  title: string;
  categoryId: string;
  subCategoryId: string;
  location: string;
  about: string;
  shortDescription: string;
  time: string;
  contact: string;
  websiteUrl: string;
  facebookUrl: string;
  locationUrl: string;
  order: number | "";
};

const EMPTY_FORM: ListingForm = {
  title: "",
  categoryId: "",
  subCategoryId: "",
  location: "",
  about: "",
  shortDescription: "",
  time: "",
  contact: "",
  websiteUrl: "",
  facebookUrl: "",
  locationUrl: "",
  order: "",
};

export default function Page() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subCategories, setSubCategories] = useState<SubCategory[]>([]);

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Listing | null>(null);
  const [deleting, setDeleting] = useState<Listing | null>(null);
  const [dragged, setDragged] = useState<Listing | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [removeExistingImage, setRemoveExistingImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [form, setForm] = useState<ListingForm>(EMPTY_FORM);

  const imageCacheRef = useRef<Map<string, string>>(new Map());

  /* PAGINATION */
  const [page, setPage] = useState(1);
  const perPage = 12;

  const totalPages = Math.max(1, Math.ceil(listings.length / perPage));
  const safePage = Math.min(page, totalPages);

  const paginatedData = useMemo(() => {
    const start = (safePage - 1) * perPage;
    return listings.slice(start, start + perPage);
  }, [listings, safePage]);

  /* FETCH */
  const fetchData = async () => {
    try {
      setLoading(true);
      setError("");

      const [productSnap, catSnap, subSnap] = await Promise.all([
        getDocs(collection(db, "Products")),
        getDocs(collection(db, "Catagories")),
        getDocs(collection(db, "SubCatagories")),
      ]);

      const cats: Category[] = catSnap.docs.map((d) => ({
        id: d.id,
        name: d.data().catagoryName || "Untitled Category",
      }));

      const subs: SubCategory[] = subSnap.docs.map((d) => ({
        id: d.id,
        name:
          d.data().name || d.data().subCategoryName || "Untitled Sub Category",
        categoryId: d.data().catagoriesRef?.id || "",
      }));

      const data: Listing[] = productSnap.docs.map((d) => {
        const x = d.data();

        const catId = x.catagoryRef?.id || "";
        const subId = x.subCatagoryRef?.id || "";

        const cat = cats.find((c) => c.id === catId);
        const sub = subs.find((s) => s.id === subId);

        return {
          id: d.id,
          title: x.productName || "",
          category: cat?.name || "",
          subCategory: sub?.name || "",
          categoryId: catId,
          subCategoryId: subId,
          location: x.productLocation || "",
          about: x.about || "",
          shortDescription: x.shortDescription || "",
          time: x.time || "",
          contact: x.contactInfo || "",
          image: x.imageUrl || "",
          websiteUrl: x.websiteUrl || "",
          facebookUrl: x.facebookUrl || "",
          locationUrl: x.locationUrl || "",
          order: x.order ?? 999,
        };
      });

      const sorted = data.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

      setListings(sorted);
      setCategories(cats);
      setSubCategories(subs);

      sorted.forEach((item) => {
        if (item.image && !imageCacheRef.current.has(item.image)) {
          const img = new Image();
          img.src = item.image;
          imageCacheRef.current.set(item.image, item.image);
        }
      });
    } catch (err) {
      console.error(err);
      setError("Failed to load listings.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  /* HELPERS */
  const filteredSubs = useMemo(
    () => subCategories.filter((s) => s.categoryId === form.categoryId),
    [subCategories, form.categoryId],
  );

  const closeModal = () => {
    setAdding(false);
    setEditing(null);
    setForm(EMPTY_FORM);
    setFile(null);
    setRemoveExistingImage(false);
    setSaving(false);
    setError("");
  };

  const openAddModal = () => {
    setForm(EMPTY_FORM);
    setFile(null);
    setRemoveExistingImage(false);
    setAdding(true);
    setEditing(null);
    setError("");
  };

  const openEditModal = (listing: Listing) => {
    setEditing(listing);
    setAdding(false);
    setFile(null);
    setRemoveExistingImage(false);
    setForm({
      title: listing.title || "",
      categoryId: listing.categoryId || "",
      subCategoryId: listing.subCategoryId || "",
      location: listing.location || "",
      about: listing.about || "",
      shortDescription: listing.shortDescription || "",
      time: listing.time || "",
      contact: listing.contact || "",
      websiteUrl: listing.websiteUrl || "",
      facebookUrl: listing.facebookUrl || "",
      locationUrl: listing.locationUrl || "",
      order: listing.order ?? "",
    });
    setError("");
  };

  const validateForm = () => {
    if (!form.categoryId) return "Please select a category.";
    // if (!form.subCategoryId) return "Please select a sub category.";
    if (!form.title.trim()) return "Title is required.";

    // ✅ IMAGE MANDATORY FIX
    if (adding && !file) {
      return "Image is required.";
    }

    if (editing) {
      if (removeExistingImage && !file) {
        return "Image is required.";
      }
    }

    if (form.order !== "" && Number(form.order) < 1) {
      return "Order must be greater than 0.";
    }

    return "";
  };

  const uploadImage = async () => {
    if (!file) return "";
    const storageRef = ref(storage, `listings/${Date.now()}-${file.name}`);
    await uploadBytes(storageRef, file);
    return await getDownloadURL(storageRef);
  };

  const safelyDeleteImageByUrl = async (url?: string) => {
    if (!url) return;
    try {
      const imageRef = ref(storage, url);
      await deleteObject(imageRef);
    } catch (err) {
      console.error("Image delete skipped/failed:", err);
    }
  };

  const getNextOrder = async () => {
    const q = query(
      collection(db, "Products"),
      orderBy("order", "desc"),
      limit(1),
    );

    const snap = await getDocs(q);
    if (snap.empty) return 1;

    const lastOrder = snap.docs[0].data().order || 0;
    return lastOrder + 1;
  };

  const normalizeOrders = (items: Listing[]) =>
    items
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
      .map((item, index) => ({
        ...item,
        order: index + 1,
      }));

  const insertListingAtOrder = (
    currentListings: Listing[],
    item: Listing,
    targetOrder: number,
  ) => {
    const withoutItem = currentListings.filter((l) => l.id !== item.id);
    const normalized = normalizeOrders(withoutItem);

    const insertIndex = Math.min(
      Math.max(targetOrder - 1, 0),
      normalized.length,
    );

    normalized.splice(insertIndex, 0, {
      ...item,
      order: targetOrder,
    });

    return normalized.map((entry, index) => ({
      ...entry,
      order: index + 1,
    }));
  };

  /* ADD */
  const handleAdd = async () => {
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      setSaving(true);
      setError("");

      const imageUrl = await uploadImage();
      const catRef = doc(db, "Catagories", form.categoryId);
const subRef = form.subCategoryId
  ? doc(db, "SubCatagories", form.subCategoryId)
  : null;      const newDocRef = doc(collection(db, "Products"));

      const autoNextOrder = await getNextOrder();
      const desiredOrder =
        form.order !== "" ? Number(form.order) : autoNextOrder;

      const cat = categories.find((c) => c.id === form.categoryId);
      const sub = subCategories.find((s) => s.id === form.subCategoryId);

      const newListing: Listing = {
        id: newDocRef.id,
        title: form.title,
        category: cat?.name || "",
        subCategory: sub?.name || "",
        categoryId: form.categoryId,
        subCategoryId: form.subCategoryId,
        location: form.location,
        about: form.about,
        shortDescription: form.shortDescription,
        time: form.time,
        contact: form.contact,
        image: imageUrl,
        websiteUrl: form.websiteUrl,
        facebookUrl: form.facebookUrl,
        locationUrl: form.locationUrl,
        order: desiredOrder,
      };

      const reordered = insertListingAtOrder(
        listings,
        newListing,
        desiredOrder,
      );
      const finalOrder =
        reordered.find((entry) => entry.id === newListing.id)?.order ??
        desiredOrder;

      await Promise.all(
        reordered
          .filter((entry) => entry.id !== newListing.id)
          .map((entry) =>
            updateDoc(doc(db, "Products", entry.id), {
              order: entry.order,
            }),
          ),
      );

      await setDoc(newDocRef, {
        productName: form.title,
        catagoryRef: catRef,
        subCatagoryRef: subRef,
        productLocation: form.location,
        about: form.about,
        shortDescription: form.shortDescription,
        time: form.time,
        contactInfo: form.contact,
        imageUrl,
        websiteUrl: form.websiteUrl,
        facebookUrl: form.facebookUrl,
        locationUrl: form.locationUrl,
        createdAt: new Date(),
        productRef: newDocRef,
        order: finalOrder,
      });

      await fetchData();
      setPage(1);
      closeModal();
    } catch (err) {
      console.error(err);
      setError("Failed to create listing.");
    } finally {
      setSaving(false);
    }
  };

  /* UPDATE */
  const handleUpdate = async () => {
    if (!editing) return;

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      setSaving(true);
      setError("");

      const catRef = doc(db, "Catagories", form.categoryId);
const subRef = form.subCategoryId
  ? doc(db, "SubCatagories", form.subCategoryId)
  : null;
      let nextImageUrl = editing.image || "";

      if (file) {
        if (editing.image) {
          await safelyDeleteImageByUrl(editing.image);
        }
        nextImageUrl = await uploadImage();
      } else if (removeExistingImage) {
        await safelyDeleteImageByUrl(editing.image);
        nextImageUrl = "";
      }

      const cat = categories.find((c) => c.id === form.categoryId);
      const sub = subCategories.find((s) => s.id === form.subCategoryId);

      const desiredOrder =
        form.order !== "" ? Number(form.order) : (editing.order ?? 999);

      const updatedListing: Listing = {
        ...editing,
        title: form.title,
        category: cat?.name || "",
        subCategory: sub?.name || "",
        categoryId: form.categoryId,
        subCategoryId: form.subCategoryId,
        location: form.location,
        about: form.about,
        shortDescription: form.shortDescription,
        time: form.time,
        contact: form.contact,
        image: nextImageUrl,
        websiteUrl: form.websiteUrl,
        facebookUrl: form.facebookUrl,
        locationUrl: form.locationUrl,
        order: desiredOrder,
      };

      const updatedListings = listings.map((item) =>
        item.id === editing.id ? updatedListing : item,
      );

      const reordered = insertListingAtOrder(
        updatedListings,
        updatedListing,
        desiredOrder,
      );

      const finalOrder =
        reordered.find((entry) => entry.id === editing.id)?.order ??
        desiredOrder;

      await Promise.all(
        reordered
          .filter((entry) => entry.id !== editing.id)
          .map((entry) =>
            updateDoc(doc(db, "Products", entry.id), {
              order: entry.order,
            }),
          ),
      );

      await updateDoc(doc(db, "Products", editing.id), {
        productName: form.title,
        catagoryRef: catRef,
        subCatagoryRef: subRef,
        productLocation: form.location,
        about: form.about,
        shortDescription: form.shortDescription,
        time: form.time,
        contactInfo: form.contact,
        imageUrl: nextImageUrl,
        websiteUrl: form.websiteUrl,
        facebookUrl: form.facebookUrl,
        locationUrl: form.locationUrl,
        order: finalOrder,
      });

      await fetchData();
      closeModal();
    } catch (err) {
      console.error(err);
      setError("Failed to update listing.");
    } finally {
      setSaving(false);
    }
  };

  /* DRAG DROP - AUTO SAVE */
  const handleDropRow = async (target: Listing) => {
    if (!dragged || dragged.id === target.id) return;

    try {
      const updated = [...listings];
      const from = updated.findIndex((i) => i.id === dragged.id);
      const to = updated.findIndex((i) => i.id === target.id);
      if (from === -1 || to === -1) return;

      const [moved] = updated.splice(from, 1);
      updated.splice(to, 0, moved);

      const reordered = updated.map((item, index) => ({
        ...item,
        order: index + 1,
      }));

      setListings(reordered);
      setDragged(null);

      await Promise.all(
        reordered.map((item) =>
          updateDoc(doc(db, "Products", item.id), {
            order: item.order ?? 999,
          }),
        ),
      );
    } catch (err) {
      console.error(err);
      setError("Failed to reorder listings.");
    }
  };

  /* DELETE */
  const confirmDelete = async () => {
    if (!deleting) return;

    try {
      await deleteDoc(doc(db, "Products", deleting.id));
      await safelyDeleteImageByUrl(deleting.image);

      const remaining = listings.filter((l) => l.id !== deleting.id);
      const reorderedRemaining = remaining.map((item, index) => ({
        ...item,
        order: index + 1,
      }));

      setListings(reorderedRemaining);
      setDeleting(null);

      await Promise.all(
        reorderedRemaining.map((item) =>
          updateDoc(doc(db, "Products", item.id), {
            order: item.order ?? 999,
          }),
        ),
      );

      const nextTotalPages = Math.max(1, Math.ceil(remaining.length / perPage));
      if (page > nextTotalPages) {
        setPage(nextTotalPages);
      }
    } catch (err) {
      console.error(err);
      setError("Failed to delete listing.");
      setDeleting(null);
    }
  };

  const currentImagePreview = file
    ? URL.createObjectURL(file)
    : editing && !removeExistingImage
      ? editing.image || ""
      : "";

  return (
    <div className="px-2 pt-4 pb-8 sm:px-6 sm:pt-6 sm:pb-10">
      {/* HEADER */}
      <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[#ff7a59] sm:text-4xl">
            Listings
          </h1>
          <p className="mt-2 text-base font-medium text-[#e8dcc7] sm:text-lg md:text-xl">
            Manage and organize all published platform listings.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={openAddModal}
            className="rounded-xl border border-[#ff7a59] px-4 py-2 text-sm text-[#ff7a59] transition hover:bg-[#ff7a59] hover:text-white sm:px-5 sm:text-base"
          >
            Add Listing
          </button>
        </div>
      </div>

      {error && !adding && !editing && (
        <div className="mb-6 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* LIST */}
      {loading ? (
        <div className="rounded-2xl border border-[#ff7a59]/40 bg-[#0a0a0a] px-5 py-10 text-center text-[#f3ead7]/70">
          Loading listings...
        </div>
      ) : listings.length === 0 ? (
        <div className="rounded-2xl border border-[#ff7a59]/40 bg-[#0a0a0a] px-5 py-10 text-center text-[#f3ead7]/70">
          No listings found.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[800px] text-left">
            <thead className="bg-[#ece2cb] text-black">
              <tr>
                <th className="p-3">Image</th>
                <th className="p-3">Title</th>
                <th className="p-3">Category</th>
                <th className="p-3">Address</th>
                <th className="p-3">Order</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>

            <tbody>
              {paginatedData.map((l) => (
                <tr
                  key={l.id}
                  draggable
                  onDragStart={() => setDragged(l)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDropRow(l)}
                  className="border-b border-white/10 bg-[#ece2cb] text-black transition hover:bg-[#f5ecd7]"
                >
                  <td className="p-3">
                    {l.image ? (
                      <img
                        src={imageCacheRef.current.get(l.image) || l.image}
                        loading="eager"
                        className="h-12 w-12 rounded-lg border object-cover"
                      />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-black/10 bg-black/5 text-[10px] text-black/35">
                        No Img
                      </div>
                    )}
                  </td>

                  <td className="p-3 font-semibold">{l.title}</td>

                  <td className="p-3 text-black/60">
                    {l.category} • {l.subCategory}
                  </td>

                  <td className="max-w-[260px] truncate p-3 text-black/50">
                    📍 {l.location}
                  </td>

                  <td className="p-3">{l.order ?? "-"}</td>

                  <td className="p-3">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => openEditModal(l)}
                        className="rounded-lg bg-[#ff7a59] px-3 py-1 text-xs text-white"
                      >
                        Update
                      </button>

                      <button
                        onClick={() => setDeleting(l)}
                        className="rounded-lg border border-red-400 px-3 py-1 text-xs text-red-500 transition hover:bg-red-500 hover:text-white"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* PAGINATION */}
    {/* PAGINATION */}
<div className="mt-6 flex items-center justify-between text-[#f3ead7]">
  <p>
    Showing {(safePage - 1) * perPage + 1}–
    {Math.min(safePage * perPage, listings.length)} of {listings.length}
  </p>

  <div className="flex items-center gap-2 flex-wrap">
    <button
      disabled={safePage === 1}
      onClick={() => setPage((p) => p - 1)}
      className="rounded-xl border border-white/10 px-4 py-2 disabled:opacity-40"
    >
      Previous
    </button>

    {Array.from({ length: totalPages }, (_, i) => i + 1)
      .filter((pageNumber) => {
        return (
          pageNumber === 1 ||
          pageNumber === totalPages ||
          Math.abs(pageNumber - safePage) <= 1
        );
      })
      .map((pageNumber, index, arr) => {
        const prevPage = arr[index - 1];
        const showDots = prevPage && pageNumber - prevPage > 1;

        return (
          <div key={pageNumber} className="flex items-center gap-2">
            {showDots && <span className="px-2">...</span>}

            <button
              onClick={() => setPage(pageNumber)}
              className={`rounded-xl px-4 py-2 ${
                safePage === pageNumber
                  ? "bg-[#ff7a59] text-white"
                  : "border border-white/10 text-[#f3ead7]"
              }`}
            >
              {pageNumber}
            </button>
          </div>
        );
      })}

    <button
      disabled={safePage === totalPages}
      onClick={() => setPage((p) => p + 1)}
      className="rounded-xl border border-white/10 px-4 py-2 disabled:opacity-40"
    >
      Next
    </button>
  </div>
</div>
      {/* ADD / EDIT MODAL */}
      {(adding || editing) && (
        <Modal
          title={adding ? "Add New Listing" : "Edit Listing"}
          onClose={closeModal}
        >
          {error && (
            <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <Select
            label="Category"
            value={form.categoryId}
            onChange={(v: string) =>
              setForm((prev) => ({
                ...prev,
                categoryId: v,
                subCategoryId: "",
              }))
            }
            options={categories}
            placeholder="Please select a category"
          />

          <Select
            label="Sub Category"
            value={form.subCategoryId}
            onChange={(v: string) =>
              setForm((prev) => ({ ...prev, subCategoryId: v }))
            }
            options={filteredSubs}
            placeholder="Please select a sub category"
          />

          <Input
            label="Title"
            value={form.title}
            onChange={(v: string) => setForm((prev) => ({ ...prev, title: v }))}
          />

          <Input
            label="Order"
            value={form.order === "" ? "" : String(form.order)}
            onChange={(v: string) =>
              setForm((prev) => ({
                ...prev,
                order: v === "" ? "" : Number(v),
              }))
            }
          />

          <Input
            label="Short Description"
            value={form.shortDescription}
            onChange={(v: string) =>
              setForm((prev) => ({ ...prev, shortDescription: v }))
            }
          />

          <Textarea
            label="About"
            value={form.about}
            onChange={(v: string) => setForm((prev) => ({ ...prev, about: v }))}
          />

          <Input
            label="Address"
            value={form.location}
            onChange={(v: string) =>
              setForm((prev) => ({ ...prev, location: v }))
            }
          />

          <Input
            label="Time"
            value={form.time}
            onChange={(v: string) => setForm((prev) => ({ ...prev, time: v }))}
          />

          <Input
            label="Contact"
            value={form.contact}
            onChange={(v: string) =>
              setForm((prev) => ({ ...prev, contact: v }))
            }
          />

          <Input
            label="Website URL"
            value={form.websiteUrl}
            onChange={(v: string) =>
              setForm((prev) => ({ ...prev, websiteUrl: v }))
            }
          />

          <Input
            label="Facebook URL"
            value={form.facebookUrl}
            onChange={(v: string) =>
              setForm((prev) => ({ ...prev, facebookUrl: v }))
            }
          />

          {/* <Input
            label="Location URL (Google Maps)"
            value={form.locationUrl}
            onChange={(v: string) =>
              setForm((prev) => ({ ...prev, locationUrl: v }))
            }
          /> */}

          <div className="mt-5">
            <label className="text-black text-sm font-semibold">Image</label>

            <div className="mt-3 flex flex-col items-center gap-4 rounded-2xl border border-[#ff7a59]/25 bg-white/35 px-4 py-5">
              {currentImagePreview ? (
                <img
                  src={currentImagePreview}
                  alt="Listing preview"
                  className="h-32 w-32 rounded-2xl border border-black/10 object-cover shadow-sm"
                />
              ) : (
                <div className="flex h-32 w-32 items-center justify-center rounded-2xl border border-dashed border-black/20 bg-black/5 text-sm text-black/40">
                  No image
                </div>
              )}

              <div className="flex flex-wrap items-center justify-center gap-3">
                <label className="cursor-pointer rounded-xl border border-[#ff7a59] px-4 py-2 text-sm font-semibold text-[#ff7a59] transition hover:bg-[#ff7a59] hover:text-white">
                  {editing ? "Change Image" : "Upload Image"}
                  <input
                    type="file"
                    hidden
                    accept="image/*"
                    onChange={(e) => {
                      setRemoveExistingImage(false);
                      setFile(e.target.files?.[0] || null);
                    }}
                  />
                </label>

                {(file || editing?.image) && (
                  <button
                    type="button"
                    onClick={() => {
                      setFile(null);
                      if (editing?.image) {
                        setRemoveExistingImage(true);
                      }
                    }}
                    className="rounded-xl border border-red-400 px-4 py-2 text-sm font-semibold text-red-500 transition hover:bg-red-500 hover:text-white"
                  >
                    Remove Image
                  </button>
                )}
              </div>

              {editing && removeExistingImage && !file && (
                <p className="text-sm text-red-500">
                  Existing image will be removed when you save.
                </p>
              )}
            </div>
          </div>

          <button
            onClick={adding ? handleAdd : handleUpdate}
            disabled={saving}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#ff7a59] py-3 text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving && (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            )}
            {saving
              ? adding
                ? "Creating..."
                : "Saving..."
              : adding
                ? "Create Listing"
                : "Save Listing"}
          </button>
        </Modal>
      )}

      {/* DELETE */}
      {deleting && (
        <Modal title="Delete Listing" onClose={() => setDeleting(null)}>
          <p className="text-black">
            Delete <span className="font-semibold">{deleting.title}</span>?
          </p>

          <p className="mt-2 text-sm text-black/60">
            This action will remove the listing from your dashboard.
          </p>

          <div className="mt-6 flex justify-end gap-3">
            <button
              onClick={() => setDeleting(null)}
              className="rounded-xl border border-black/15 px-4 py-2 text-black"
            >
              Cancel
            </button>
            <button
              onClick={confirmDelete}
              className="rounded-xl bg-red-500 px-4 py-2 text-white"
            >
              Delete
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* UI */

function Modal({
  children,
  title,
  onClose,
}: {
  children: React.ReactNode;
  title: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-[#e8dcc7] p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-[#ff7a59]">{title}</h2>
          <button
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-black/10 text-black transition hover:bg-black/20"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="mt-4">
      <label className="text-black text-sm font-semibold">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 w-full rounded-xl border border-[#ff7a59] bg-white px-4 py-3 text-black placeholder:text-black/35 focus:outline-none focus:ring-2 focus:ring-[#ff7a59]"
      />
    </div>
  );
}

function Textarea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="mt-4">
      <label className="text-black text-sm font-semibold">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 h-28 w-full rounded-xl border border-[#ff7a59] bg-white px-4 py-3 text-black placeholder:text-black/35 focus:outline-none focus:ring-2 focus:ring-[#ff7a59]"
      />
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ id: string; name: string }>;
  placeholder: string;
}) {
  return (
    <div className="mt-4">
      <label className="text-black text-sm font-semibold">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 w-full rounded-xl border border-[#ff7a59] bg-white px-4 py-3 text-black focus:outline-none focus:ring-2 focus:ring-[#ff7a59]"
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );
}
