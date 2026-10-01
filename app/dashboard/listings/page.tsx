"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MapPin, Plus, Store } from "lucide-react";
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
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Field,
  FilterSelect,
  FormSection,
  LoadingState,
  Modal,
  PageHeader,
  Pagination,
  SearchInput,
  Segmented,
  SelectInput,
  Switch,
  SwitchRow,
  TextArea,
  TextInput,
  Toolbar,
  table,
} from "@/components/ui";

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
  /* The saved `catagoryRef` is missing, deleted, or disagrees with the sub
   * category's parent. Saving the listing rewrites it. */
  staleCategory: boolean;
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

  /* Listings per sub category (or category) in the current filter, for the
   * group headings in the table. */
  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    filteredListings.forEach((l) => {
      const key = listingGroupKey(l.categoryId, l.subCategoryId);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return counts;
  }, [filteredListings]);

  const [page, setPage] = useState(1);
  const perPage = 25;

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
      const subParent = new Map(subs.map((s) => [s.id, s.categoryId]));

      const data: Listing[] = productSnap.docs.map((d) => {
        const x = d.data();
        const storedCatId = x.catagoryRef?.id || "";
        const subId = x.subCatagoryRef?.id || "";
        // The app lists a product under its sub category, so the sub's parent
        // is the category it really appears in, even when `catagoryRef` points
        // at a deleted or different category.
        const catId = subParent.get(subId) || storedCatId;
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
          staleCategory: catId !== storedCatId || !catIndex.has(catId),
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
    <div>
      <PageHeader
        title="Listings"
        description="Manage and organize all published platform listings."
        actions={
          <Button variant="outline" icon={Plus} onClick={openAddModal}>
            Add Listing
          </Button>
        }
      >
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
      </PageHeader>

      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search by title…" />

        <FilterSelect value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </FilterSelect>

        <Segmented<RecommendedFilter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "recommended", label: "Recommended" },
            { value: "not", label: "Not Recommended" },
          ]}
        />
      </Toolbar>

      {error && !adding && !editing && (
        <Alert className="mb-6" onDismiss={() => setError("")}>
          {error}
        </Alert>
      )}

      {/* LIST */}
      {loading ? (
        <LoadingState label="Loading listings…" />
      ) : filteredListings.length === 0 ? (
        <EmptyState
          icon={Store}
          title={
            filter === "recommended"
              ? "No recommended listings yet."
              : filter === "not"
                ? "No non-recommended listings."
                : "No listings found."
          }
          description={
            filter === "recommended"
              ? "Toggle the recommended switch on any listing or create a new one."
              : undefined
          }
        />
      ) : (
        <div className={table.wrap}>
          <table className={`${table.table} min-w-[760px]`}>
            <thead className={table.thead}>
              <tr>
                <th className={table.th}>Image</th>
                <th className={table.th}>Title</th>
                <th className={table.th}>Address</th>
                <th className={table.th}>Position</th>
                <th className={table.th}>Recommended</th>
                <th className={`${table.th} text-right`}>Actions</th>
              </tr>
            </thead>

            <tbody>
              {paginatedData.map((l, index) => {
                const groupKey = listingGroupKey(l.categoryId, l.subCategoryId);
                const prev = paginatedData[index - 1];
                const startsGroup =
                  !prev || listingGroupKey(prev.categoryId, prev.subCategoryId) !== groupKey;
                const groupSize = groupCounts.get(groupKey) ?? 0;

                return (
                  <Fragment key={l.id}>
                    {startsGroup && (
                      <tr className={table.groupRow}>
                        <td colSpan={6} className="px-4 py-2">
                          <span className="font-semibold">{l.category || "No category"}</span>
                          {l.subCategory && (
                            <span className="text-black/70"> › {l.subCategory}</span>
                          )}
                          <span className="ml-2 text-xs text-black/50">
                            {groupSize} {groupSize === 1 ? "listing" : "listings"}
                          </span>
                        </td>
                      </tr>
                    )}

                    <tr className={table.row}>
                      <td className={table.td}>
                        {l.image ? (
                          <img
                            src={l.image}
                            alt=""
                            loading="eager"
                            className={table.thumb}
                          />
                        ) : (
                          <div className={table.thumbEmpty}>No Img</div>
                        )}
                      </td>

                      <td className={table.td}>
                        <p className="font-semibold">{l.title || "Untitled listing"}</p>
                        {l.staleCategory && (
                          <Badge
                            tone="amber"
                            className="mt-1"
                            title="The saved category doesn't match this listing's sub category, so category filters in the app miss it. Open it and save to fix."
                          >
                            Category link outdated
                          </Badge>
                        )}
                      </td>

                      <td className={`${table.td} text-black/60`}>
                        {l.location ? (
                          <span className="flex max-w-[280px] items-center gap-1.5">
                            <MapPin className="h-3.5 w-3.5 shrink-0 text-black/40" aria-hidden />
                            <span className="truncate">{l.location}</span>
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>

                      <td className={table.td}>
                        {l.order === null ? (
                          <Badge tone="amber">Hidden in app</Badge>
                        ) : (
                          <span className="font-semibold tabular-nums text-black/70">
                            #{rankById.get(l.id)}
                          </span>
                        )}
                      </td>

                      <td className={table.td}>
                        <Switch
                          checked={l.recommended}
                          onChange={() => toggleRecommended(l)}
                          label={`Recommend ${l.title}`}
                        />
                      </td>

                      <td className={table.td}>
                        <div className={table.actions}>
                          <Button size="sm" onClick={() => openEditModal(l)}>
                            Update
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => setDeleting(l)}>
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && (
        <Pagination
          page={safePage}
          totalPages={totalPages}
          onPageChange={setPage}
          total={filteredListings.length}
          perPage={perPage}
          extra={
            filteredListings.length !== listings.length && (
              <span className="text-[#f3ead7]/50"> · {listings.length} total</span>
            )
          }
        />
      )}

      {/* ADD / EDIT MODAL */}
      {(adding || editing) && (
        <Modal
          title={adding ? "Add New Listing" : "Edit Listing"}
          onClose={closeModal}
          footer={
            <>
              <Button variant="light" onClick={closeModal}>
                Cancel
              </Button>
              <Button onClick={adding ? handleAdd : handleUpdate} loading={saving}>
                {saving
                  ? adding
                    ? "Creating…"
                    : "Saving…"
                  : adding
                    ? "Create Listing"
                    : "Save Listing"}
              </Button>
            </>
          }
        >
          {error && (
            <Alert surface="light" className="mb-4">
              {error}
            </Alert>
          )}

          <FormSection>Where it appears</FormSection>

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
            hint={
              adding && form.categoryId
                ? `New listings are added at the end of the ${
                    categoryHasSubs ? "sub category" : "category"
                  }. Reorder them in Display Order.`
                : undefined
            }
            placeholder={
              !form.categoryId
                ? "Select a category first"
                : categoryHasSubs
                  ? "Please select a sub category"
                  : "This category has no sub categories"
            }
          />

          <SwitchRow
            title="Show in Recommended"
            description="Adds this listing to the end of the app’s Recommended row."
            checked={form.recommended}
            onChange={(checked) => setField("recommended", checked)}
          />

          <FormSection>Details</FormSection>

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

          <FormSection>Location & contact</FormSection>

          <Input label="Address" value={form.location} onChange={(v) => setField("location", v)} />

          <Input
            label="Maps link (optional)"
            hint="Opened when someone taps the address."
            value={form.locationUrl}
            onChange={(v) => setField("locationUrl", v)}
          />

          <div className="grid gap-x-4 sm:grid-cols-2">
            <Input label="Phone" value={form.phone} onChange={(v) => setField("phone", v)} />
            <Input
              label="Email"
              type="email"
              value={form.email}
              onChange={(v) => setField("email", v)}
            />
          </div>

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

          <FormSection>Event time (optional)</FormSection>
          <p className="mt-2 text-xs text-black/55">
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

          <FormSection>Image</FormSection>

          <div className="mt-4 flex flex-col items-center gap-4 rounded-2xl border border-black/10 bg-white/50 px-4 py-5">
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
              <label className="inline-flex cursor-pointer items-center rounded-xl border border-[#ff7a59] px-4 py-2 text-sm font-medium text-[#ff7a59] transition hover:bg-[#ff7a59] hover:text-white">
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
                <Button
                  variant="danger"
                  onClick={() => {
                    setFile(null);
                    if (editing?.image) {
                      setRemoveExistingImage(true);
                    }
                  }}
                >
                  Remove Image
                </Button>
              )}
            </div>

            {editing && removeExistingImage && !file && (
              <p className="text-sm text-red-600">Existing image will be removed when you save.</p>
            )}
          </div>
        </Modal>
      )}

      {/* DELETE */}
      {deleting && (
        <Modal
          title="Delete Listing"
          size="sm"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button variant="light" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button variant="danger-solid" onClick={confirmDelete} loading={deletingBusy}>
                {deletingBusy ? "Deleting…" : "Delete"}
              </Button>
            </>
          }
        >
          <p>
            Delete <span className="font-semibold">{deleting.title}</span>?
          </p>
          <p className="mt-2 text-sm text-black/60">
            The listing, its reviews and its image are removed from the app. This can&rsquo;t be
            undone.
          </p>
        </Modal>
      )}
    </div>
  );
}

/* Form fields bound to a string value. */

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
    <Field label={label} hint={hint}>
      <TextInput type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
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
    <Field label={label} hint={hint}>
      <TextArea value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  placeholder,
  hint,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ id: string; name: string }>;
  placeholder: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <Field label={label} hint={hint}>
      <SelectInput value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </SelectInput>
    </Field>
  );
}
