"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  setDoc,
  query,
  where,
  serverTimestamp,
  Timestamp,
  type DocumentReference,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

import { db, storage } from "@/lib/firebaseServices";
import {
  asOrder,
  deleteDocDeep,
  deleteStorageFileByUrl,
  nextOrder,
  sortByOrder,
  writeSequence,
} from "@/lib/adminData";
import { listingGroupKey, nextRecommendedOrder } from "@/lib/products";

/* TYPES */
type Category = { id: string; name: string; order: number | null };
type SubCategory = { id: string; name: string; categoryId: string; order: number | null };

type Listing = {
  id: string;
  title: string;
  category: string;
  subCategory: string;
  categoryId: string;
  subCategoryId: string;
  location: string;
  locationUrl: string;
  about: string;
  shortDescription: string;
  time: string;
  startTimeString: string;
  endTimeString: string;
  startTime: Date | null;
  lastTime: Date | null;
  phone: string;
  email: string;
  websiteUrl: string;
  facebookUrl: string;
  /* Raw stored URLs; the app reads `image` first and falls back to `imageUrl`. */
  imageField: string;
  imageUrlField: string;
  image: string;
  order: number | null;
  recommended: boolean;
  recommendedOrder: number | null;
};

type ListingForm = {
  title: string;
  categoryId: string;
  subCategoryId: string;
  location: string;
  locationUrl: string;
  about: string;
  shortDescription: string;
  time: string;
  startTimeString: string;
  endTimeString: string;
  startTime: string;
  lastTime: string;
  phone: string;
  email: string;
  websiteUrl: string;
  facebookUrl: string;
  recommended: boolean;
};

const EMPTY_FORM: ListingForm = {
  title: "",
  categoryId: "",
  subCategoryId: "",
  location: "",
  locationUrl: "",
  about: "",
  shortDescription: "",
  time: "",
  startTimeString: "",
  endTimeString: "",
  startTime: "",
  lastTime: "",
  phone: "",
  email: "",
  websiteUrl: "",
  facebookUrl: "",
  recommended: false,
};

type RecommendedFilter = "all" | "recommended" | "not";

const toDate = (value: unknown): Date | null =>
  value instanceof Timestamp ? value.toDate() : null;

/* <input type="datetime-local"> works in local time without a zone suffix. */
const toLocalInput = (date: Date | null) => {
  if (!date) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
};

const fromLocalInput = (value: string) => (value ? Timestamp.fromDate(new Date(value)) : null);

export default function Page() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subCategories, setSubCategories] = useState<SubCategory[]>([]);

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Listing | null>(null);
  const [deleting, setDeleting] = useState<Listing | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [removeExistingImage, setRemoveExistingImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [form, setForm] = useState<ListingForm>(EMPTY_FORM);

  const [filter, setFilter] = useState<RecommendedFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [search, setSearch] = useState("");

  const imageCacheRef = useRef<Map<string, string>>(new Map());

  /* FILTERED + PAGINATION */
  const filteredListings = useMemo(() => {
    const q = search.trim().toLowerCase();
    return listings.filter((l) => {
      if (filter === "recommended" && !l.recommended) return false;
      if (filter === "not" && l.recommended) return false;
      if (categoryFilter && l.categoryId !== categoryFilter) return false;
      if (q && !l.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [listings, filter, categoryFilter, search]);

  /* Rank within its sub category (or category), matching the app's order. */
  const rankById = useMemo(() => {
    const seen = new Map<string, number>();
    const ranks = new Map<string, number>();
    sortByOrder(listings, (l) => l.order).forEach((l) => {
      if (l.order === null) return;
      const key = listingGroupKey(l.categoryId, l.subCategoryId);
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      ranks.set(l.id, n);
    });
    return ranks;
  }, [listings]);

  const [page, setPage] = useState(1);
  const perPage = 12;

  const totalPages = Math.max(1, Math.ceil(filteredListings.length / perPage));
  const safePage = Math.min(page, totalPages);

  const paginatedData = useMemo(() => {
    const start = (safePage - 1) * perPage;
    return filteredListings.slice(start, start + perPage);
  }, [filteredListings, safePage]);

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

      const cats: Category[] = sortByOrder(
        catSnap.docs.map((d) => ({
          id: d.id,
          name: d.data().catagoryName || "Untitled Category",
          order: asOrder(d.data().order),
        })),
        (c) => c.order,
      );

      const subs: SubCategory[] = sortByOrder(
        subSnap.docs.map((d) => ({
          id: d.id,
          name: d.data().name || d.data().subCategoryName || "Untitled Sub Category",
          categoryId: d.data().catagoriesRef?.id || "",
          order: asOrder(d.data().order),
        })),
        (s) => s.order,
      );

      const catIndex = new Map(cats.map((c, i) => [c.id, i]));
      const subIndex = new Map(subs.map((s, i) => [s.id, i]));

      const data: Listing[] = productSnap.docs.map((d) => {
        const x = d.data();
        const catId = x.catagoryRef?.id || "";
        const subId = x.subCatagoryRef?.id || "";
        const imageField = typeof x.image === "string" ? x.image : "";
        const imageUrlField = typeof x.imageUrl === "string" ? x.imageUrl : "";

        return {
          id: d.id,
          title: x.productName || "",
          category: cats.find((c) => c.id === catId)?.name || "",
          subCategory: subs.find((s) => s.id === subId)?.name || "",
          categoryId: catId,
          subCategoryId: subId,
          location: x.productLocation || "",
          locationUrl: x.locationUrl || "",
          about: x.about || "",
          shortDescription: x.shortDescription || "",
          time: x.time || "",
          startTimeString: x.startTimeString || "",
          endTimeString: x.endTimeString || "",
          startTime: toDate(x.startTime),
          lastTime: toDate(x.lastTime),
          phone: x.phone_number || x.contactInfo || "",
          email: x.email || "",
          websiteUrl: x.websiteUrl || "",
          facebookUrl: x.facebookUrl || "",
          imageField,
          imageUrlField,
          image: imageField || imageUrlField,
          order: asOrder(x.order),
          recommended: x.recommended === true,
          recommendedOrder: asOrder(x.recommendedOrder),
        };
      });

      // Directory order: category, then sub category, then position within it.
      const sorted = sortByOrder(data, (l) => l.order).sort(
        (a, b) =>
          (catIndex.get(a.categoryId) ?? 1e9) - (catIndex.get(b.categoryId) ?? 1e9) ||
          (subIndex.get(a.subCategoryId) ?? -1) - (subIndex.get(b.subCategoryId) ?? -1),
      );

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

  useEffect(() => {
    setPage(1);
  }, [filter, categoryFilter, search]);

  /* HELPERS */
  const filteredSubs = useMemo(
    () => subCategories.filter((s) => s.categoryId === form.categoryId),
    [subCategories, form.categoryId],
  );
  const categoryHasSubs = filteredSubs.length > 0;

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
      title: listing.title,
      categoryId: listing.categoryId,
      subCategoryId: listing.subCategoryId,
      location: listing.location,
      locationUrl: listing.locationUrl,
      about: listing.about,
      shortDescription: listing.shortDescription,
      time: listing.time,
      startTimeString: listing.startTimeString,
      endTimeString: listing.endTimeString,
      startTime: toLocalInput(listing.startTime),
      lastTime: toLocalInput(listing.lastTime),
      phone: listing.phone,
      email: listing.email,
      websiteUrl: listing.websiteUrl,
      facebookUrl: listing.facebookUrl,
      recommended: listing.recommended,
    });
    setError("");
  };

  const validateForm = () => {
    if (!form.categoryId) return "Please select a category.";
    if (categoryHasSubs && !form.subCategoryId) {
      return "Please select a sub category. This category has sub categories, so the app only lists listings inside one.";
    }
    if (!form.title.trim()) return "Title is required.";
    if (adding && !file) return "Image is required.";
    if (editing && removeExistingImage && !file) return "Image is required.";
    if (form.startTime && form.lastTime && new Date(form.lastTime) < new Date(form.startTime)) {
      return "End date/time must be after the start date/time.";
    }
    return "";
  };

  const uploadImage = async () => {
    if (!file) return "";
    const storageRef = ref(storage, `listings/${Date.now()}-${file.name}`);
    await uploadBytes(storageRef, file);
    return await getDownloadURL(storageRef);
  };

  const deleteListingImages = async (listing: Listing) => {
    await deleteStorageFileByUrl(listing.imageField);
    if (listing.imageUrlField && listing.imageUrlField !== listing.imageField) {
      await deleteStorageFileByUrl(listing.imageUrlField);
    }
  };

  /* Current members of a listing's order group, read fresh from Firestore so
   * two admins adding listings at once don't both take the same slot. */
  const fetchGroup = async (categoryId: string, subCategoryId: string) => {
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
  };

  /* Re-number a group 0..n-1 after a listing leaves it. */
  const compactGroup = async (categoryId: string, subCategoryId: string, leavingId: string) => {
    if (!categoryId && !subCategoryId) return;
    const members = sortByOrder(
      (await fetchGroup(categoryId, subCategoryId)).filter((m) => m.id !== leavingId),
      (m) => m.order,
    );
    await writeSequence("Products", members.map((m) => m.id));
  };

  /* Every field the mobile app reads, with the exact type it casts to. */
  const buildPayload = (
    imageUrl: string,
    order: number,
    recommendedOrder: number | null,
  ) => {
    const catRef: DocumentReference = doc(db, "Catagories", form.categoryId);
    const subRef: DocumentReference | null = form.subCategoryId
      ? doc(db, "SubCatagories", form.subCategoryId)
      : null;
    const phone = form.phone.trim();

    return {
      productName: form.title.trim(),
      shortDescription: form.shortDescription.trim(),
      about: form.about.trim(),
      productLocation: form.location.trim(),
      locationUrl: form.locationUrl.trim(),
      image: imageUrl,
      imageUrl,
      phone_number: phone,
      contactInfo: phone,
      email: form.email.trim(),
      websiteUrl: form.websiteUrl.trim(),
      facebookUrl: form.facebookUrl.trim(),
      time: form.time.trim(),
      startTimeString: form.startTimeString.trim(),
      endTimeString: form.endTimeString.trim(),
      startTime: fromLocalInput(form.startTime),
      lastTime: fromLocalInput(form.lastTime),
      catagoryRef: catRef,
      subCatagoryRef: subRef,
      order,
      recommended: form.recommended,
      ...(recommendedOrder !== null ? { recommendedOrder } : {}),
    };
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

      const newDocRef = doc(collection(db, "Products"));
      const [imageUrl, group, recommendedOrder] = await Promise.all([
        uploadImage(),
        fetchGroup(form.categoryId, form.subCategoryId),
        form.recommended ? nextRecommendedOrder() : Promise.resolve(null),
      ]);

      await setDoc(newDocRef, {
        ...buildPayload(imageUrl, nextOrder(group.map((g) => g.order)), recommendedOrder),
        created_time: serverTimestamp(),
        productRef: newDocRef,
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

      let nextImageUrl = editing.image;
      if (file) {
        await deleteListingImages(editing);
        nextImageUrl = await uploadImage();
      } else if (removeExistingImage) {
        await deleteListingImages(editing);
        nextImageUrl = "";
      }

      const oldGroup = listingGroupKey(editing.categoryId, editing.subCategoryId);
      const newGroup = listingGroupKey(form.categoryId, form.subCategoryId);
      const movedGroup = oldGroup !== newGroup;

      // Moving to another sub category appends to the end of it; staying put
      // keeps the current position (or takes the next slot if it had none).
      let order = editing.order;
      if (movedGroup || order === null) {
        const group = await fetchGroup(form.categoryId, form.subCategoryId);
        order = nextOrder(group.filter((g) => g.id !== editing.id).map((g) => g.order));
      }

      let recommendedOrder: number | null = null;
      if (form.recommended && (!editing.recommended || editing.recommendedOrder === null)) {
        recommendedOrder = await nextRecommendedOrder(editing.id);
      }

      await updateDoc(
        doc(db, "Products", editing.id),
        buildPayload(nextImageUrl, order, recommendedOrder),
      );

      if (movedGroup) {
        await compactGroup(editing.categoryId, editing.subCategoryId, editing.id);
      }

      await fetchData();
      closeModal();
    } catch (err) {
      console.error(err);
      setError("Failed to update listing.");
    } finally {
      setSaving(false);
    }
  };

  /* TOGGLE RECOMMENDED — switching on appends to the end of the Recommended
   * row; switching off leaves `recommendedOrder` in place (A1). */
  const toggleRecommended = async (item: Listing) => {
    const next = !item.recommended;

    setListings((prev) =>
      prev.map((l) => (l.id === item.id ? { ...l, recommended: next } : l)),
    );

    try {
      const recommendedOrder = next ? await nextRecommendedOrder(item.id) : null;
      await updateDoc(doc(db, "Products", item.id), {
        recommended: next,
        ...(recommendedOrder !== null ? { recommendedOrder } : {}),
      });
      if (recommendedOrder !== null) {
        setListings((prev) =>
          prev.map((l) => (l.id === item.id ? { ...l, recommendedOrder } : l)),
        );
      }
    } catch (err) {
      console.error(err);
      setError("Failed to update recommended state.");
      setListings((prev) =>
        prev.map((l) =>
          l.id === item.id ? { ...l, recommended: item.recommended } : l,
        ),
      );
    }
  };

  /* DELETE */
  const confirmDelete = async () => {
    if (!deleting) return;

    try {
      setDeletingBusy(true);
      await deleteDocDeep(doc(db, "Products", deleting.id), { Reviews: [] });
      await deleteListingImages(deleting);
      await compactGroup(deleting.categoryId, deleting.subCategoryId, deleting.id);

      setDeleting(null);
      await fetchData();
    } catch (err) {
      console.error(err);
      setError("Failed to delete listing.");
      setDeleting(null);
    } finally {
      setDeletingBusy(false);
    }
  };

  const currentImagePreview = useMemo(
    () =>
      file
        ? URL.createObjectURL(file)
        : editing && !removeExistingImage
          ? editing.image
          : "",
    [file, editing, removeExistingImage],
  );

  useEffect(() => {
    return () => {
      if (currentImagePreview.startsWith("blob:")) URL.revokeObjectURL(currentImagePreview);
    };
  }, [currentImagePreview]);

  const setField = <K extends keyof ListingForm>(key: K, value: ListingForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

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
          <p className="mt-1 text-sm text-[#e8dcc7]/70">
            To change the order listings appear in, use{" "}
            <Link href="/dashboard/display-order" className="text-[#ff7a59] underline">
              Display Order
            </Link>{" "}
            or{" "}
            <Link href="/dashboard/recommended" className="text-[#ff7a59] underline">
              Recommended
            </Link>
            .
          </p>
        </div>

        <button
          onClick={openAddModal}
          className="self-start rounded-xl border border-[#ff7a59] px-4 py-2 text-sm text-[#ff7a59] transition hover:bg-[#ff7a59] hover:text-white sm:self-auto sm:px-5 sm:text-base"
        >
          Add Listing
        </button>
      </div>

      {/* FILTERS */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by title…"
          className="w-full rounded-xl border border-white/15 bg-[#0a0a0a] px-4 py-2 text-sm text-white outline-none placeholder:text-white/40 focus:border-[#ff7a59] sm:w-64"
        />

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="rounded-xl border border-white/15 bg-[#0a0a0a] px-3 py-2 text-sm text-white outline-none focus:border-[#ff7a59]"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <div className="inline-flex rounded-xl border border-[#ff7a59]/50 bg-[#0a0a0a] p-1 text-sm">
          {(["all", "recommended", "not"] as RecommendedFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3 py-1.5 transition sm:px-4 ${
                filter === f
                  ? "bg-[#ff7a59] text-white"
                  : "text-[#f3ead7]/80 hover:text-[#ff7a59]"
              }`}
            >
              {f === "all"
                ? "All"
                : f === "recommended"
                  ? "Recommended"
                  : "Not Recommended"}
            </button>
          ))}
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
      ) : filteredListings.length === 0 ? (
        <div className="rounded-2xl border border-[#ff7a59]/40 bg-[#0a0a0a] px-5 py-10 text-center text-[#f3ead7]/70">
          {filter === "recommended"
            ? "No recommended listings yet. Toggle the recommended switch on any listing or create a new one."
            : filter === "not"
              ? "No non-recommended listings."
              : "No listings found."}
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
                <th className="p-3">Position</th>
                <th className="p-3">Recommended</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>

            <tbody>
              {paginatedData.map((l) => (
                <tr
                  key={l.id}
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
                    {l.category || "—"}
                    {l.subCategory ? ` • ${l.subCategory}` : ""}
                  </td>

                  <td className="max-w-[260px] truncate p-3 text-black/50">
                    {l.location ? `📍 ${l.location}` : "—"}
                  </td>

                  <td className="p-3">
                    {l.order === null ? (
                      <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                        Hidden in app
                      </span>
                    ) : (
                      rankById.get(l.id)
                    )}
                  </td>

                  <td className="p-3">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={l.recommended}
                      onClick={() => toggleRecommended(l)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#ff7a59]/40 ${
                        l.recommended ? "bg-[#ff7a59]" : "bg-black/20"
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                          l.recommended ? "translate-x-5" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </td>

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
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-[#f3ead7]">
        <p>
          Showing {filteredListings.length === 0 ? 0 : (safePage - 1) * perPage + 1}–
          {Math.min(safePage * perPage, filteredListings.length)} of {filteredListings.length}
          {filteredListings.length !== listings.length && (
            <span className="text-[#f3ead7]/60"> · {listings.length} total</span>
          )}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <button
            disabled={safePage === 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-xl border border-white/10 px-4 py-2 disabled:opacity-40"
          >
            Previous
          </button>

          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter(
              (pageNumber) =>
                pageNumber === 1 ||
                pageNumber === totalPages ||
                Math.abs(pageNumber - safePage) <= 1,
            )
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

          <SectionTitle>Where it appears</SectionTitle>

          <Select
            label="Category"
            value={form.categoryId}
            onChange={(v: string) =>
              setForm((prev) => ({ ...prev, categoryId: v, subCategoryId: "" }))
            }
            options={categories}
            placeholder="Please select a category"
          />

          <Select
            label="Sub Category"
            value={form.subCategoryId}
            onChange={(v: string) => setField("subCategoryId", v)}
            options={filteredSubs}
            disabled={!form.categoryId || !categoryHasSubs}
            placeholder={
              !form.categoryId
                ? "Select a category first"
                : categoryHasSubs
                  ? "Please select a sub category"
                  : "This category has no sub categories"
            }
          />
          {adding && form.categoryId && (
            <p className="mt-1 text-xs text-black/55">
              New listings are added at the end of the{" "}
              {categoryHasSubs ? "sub category" : "category"}. Reorder them in Display Order.
            </p>
          )}

          <div className="mt-4 flex items-center justify-between rounded-xl border border-[#ff7a59]/40 bg-white/40 px-4 py-3">
            <div>
              <p className="text-black font-semibold">Show in Recommended</p>
              <p className="text-xs text-black/60">
                Adds this listing to the end of the app&rsquo;s Recommended row.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={form.recommended}
              onClick={() => setField("recommended", !form.recommended)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#ff7a59]/40 ${
                form.recommended ? "bg-[#ff7a59]" : "bg-black/20"
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  form.recommended ? "translate-x-5" : "translate-x-1"
                }`}
              />
            </button>
          </div>

          <SectionTitle>Details</SectionTitle>

          <Input label="Title" value={form.title} onChange={(v) => setField("title", v)} />

          <Input
            label="Short Description"
            hint="Shown as the bio on home cards."
            value={form.shortDescription}
            onChange={(v) => setField("shortDescription", v)}
          />

          <Textarea
            label="About"
            hint="Shown on the listing's detail page."
            value={form.about}
            onChange={(v) => setField("about", v)}
          />

          <Input
            label="Hours / Time"
            hint='Free text, e.g. "Mon–Fri 9am–5pm".'
            value={form.time}
            onChange={(v) => setField("time", v)}
          />

          <SectionTitle>Location & contact</SectionTitle>

          <Input label="Address" value={form.location} onChange={(v) => setField("location", v)} />

          <Input
            label="Maps link (optional)"
            hint="Opened when someone taps the address."
            value={form.locationUrl}
            onChange={(v) => setField("locationUrl", v)}
          />

          <Input label="Phone" value={form.phone} onChange={(v) => setField("phone", v)} />

          <Input label="Email" type="email" value={form.email} onChange={(v) => setField("email", v)} />

          <Input
            label="Website URL"
            value={form.websiteUrl}
            onChange={(v) => setField("websiteUrl", v)}
          />

          <Input
            label="Facebook URL"
            value={form.facebookUrl}
            onChange={(v) => setField("facebookUrl", v)}
          />

          <SectionTitle>Event time (optional)</SectionTitle>
          <p className="text-xs text-black/55">
            Shown on cards in pop-up, live music, culture and art sub categories.
          </p>

          <div className="grid gap-x-4 sm:grid-cols-2">
            <Input
              label="Start time text"
              hint='e.g. "7:00 PM"'
              value={form.startTimeString}
              onChange={(v) => setField("startTimeString", v)}
            />
            <Input
              label="End time text"
              hint='e.g. "10:00 PM"'
              value={form.endTimeString}
              onChange={(v) => setField("endTimeString", v)}
            />
            <Input
              label="Start date & time"
              type="datetime-local"
              value={form.startTime}
              onChange={(v) => setField("startTime", v)}
            />
            <Input
              label="End date & time"
              type="datetime-local"
              value={form.lastTime}
              onChange={(v) => setField("lastTime", v)}
            />
          </div>

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
            The listing, its reviews and its image are removed from the app. This
            can&rsquo;t be undone.
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
              disabled={deletingBusy}
              className="rounded-xl bg-red-500 px-4 py-2 text-white disabled:opacity-60"
            >
              {deletingBusy ? "Deleting…" : "Delete"}
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

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mt-6 border-b border-black/10 pb-1 text-sm font-bold uppercase tracking-wide text-black/60">
      {children}
    </h3>
  );
}

function Input({
  label,
  value,
  onChange,
  hint,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  type?: string;
}) {
  return (
    <div className="mt-4">
      <label className="text-black text-sm font-semibold">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 w-full rounded-xl border border-[#ff7a59] bg-white px-4 py-3 text-black placeholder:text-black/35 focus:outline-none focus:ring-2 focus:ring-[#ff7a59]"
      />
      {hint && <p className="mt-1 text-xs text-black/55">{hint}</p>}
    </div>
  );
}

function Textarea({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <div className="mt-4">
      <label className="text-black text-sm font-semibold">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 h-28 w-full rounded-xl border border-[#ff7a59] bg-white px-4 py-3 text-black placeholder:text-black/35 focus:outline-none focus:ring-2 focus:ring-[#ff7a59]"
      />
      {hint && <p className="mt-1 text-xs text-black/55">{hint}</p>}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ id: string; name: string }>;
  placeholder: string;
  disabled?: boolean;
}) {
  return (
    <div className="mt-4">
      <label className="text-black text-sm font-semibold">{label}</label>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 w-full rounded-xl border border-[#ff7a59] bg-white px-4 py-3 text-black focus:outline-none focus:ring-2 focus:ring-[#ff7a59] disabled:cursor-not-allowed disabled:opacity-60"
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
