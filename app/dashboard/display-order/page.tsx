"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { ListOrdered, MousePointerClick } from "lucide-react";

import { db } from "@/lib/firebaseServices";
import { asOrder, sortByOrder, writeSequence } from "@/lib/adminData";
import SortableList from "@/components/SortableList";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingState,
  PageHeader,
  Segmented,
  SelectInput,
  Toolbar,
} from "@/components/ui";

type Row = {
  id: string;
  name: string;
  image: string;
  order: number | null;
  categoryId: string;
  subCategoryId: string;
};

type Tab = "categories" | "subcategories" | "listings";

const TABS: { key: Tab; label: string }[] = [
  { key: "categories", label: "Categories" },
  { key: "subcategories", label: "Sub categories" },
  { key: "listings", label: "Listings" },
];

/* Display order for the directory (A4). The app sorts every level with
 * `orderBy('order')` and hides documents without an integer `order`, so each
 * save writes the visible list as a contiguous 0-based sequence. */
export default function Page() {
  const [tab, setTab] = useState<Tab>("categories");
  const [categories, setCategories] = useState<Row[]>([]);
  const [subCategories, setSubCategories] = useState<Row[]>([]);
  const [listings, setListings] = useState<Row[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [subCategoryId, setSubCategoryId] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const [catSnap, subSnap, productSnap] = await Promise.all([
          getDocs(collection(db, "Catagories")),
          getDocs(collection(db, "SubCatagories")),
          getDocs(collection(db, "Products")),
        ]);
        setCategories(
          catSnap.docs.map((d) => ({
            id: d.id,
            name: d.data().catagoryName || "Untitled category",
            image: d.data().image || "",
            order: asOrder(d.data().order),
            categoryId: d.id,
            subCategoryId: "",
          })),
        );
        setSubCategories(
          subSnap.docs.map((d) => ({
            id: d.id,
            name: d.data().name || "Untitled sub category",
            image: d.data().image || "",
            order: asOrder(d.data().order),
            categoryId: d.data().catagoriesRef?.id || "",
            subCategoryId: d.id,
          })),
        );
        setListings(
          productSnap.docs.map((d) => ({
            id: d.id,
            name: d.data().productName || "Untitled listing",
            image: d.data().image || d.data().imageUrl || "",
            order: asOrder(d.data().order),
            categoryId: d.data().catagoryRef?.id || "",
            subCategoryId: d.data().subCatagoryRef?.id || "",
          })),
        );
      } catch (err) {
        console.error(err);
        setError("Failed to load categories and listings.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const sortedCategories = useMemo(
    () => sortByOrder(categories, (c) => c.order),
    [categories],
  );
  const subsOfCategory = useMemo(
    () =>
      sortByOrder(
        subCategories.filter((s) => s.categoryId === categoryId),
        (s) => s.order,
      ),
    [subCategories, categoryId],
  );
  const categoryHasSubs = subsOfCategory.length > 0;

  /* Listings group: the chosen subcategory, or the category itself when it
   * has no subcategories (the app then lists products directly under it). */
  const listingGroup = useMemo(() => {
    if (!categoryId) return [];
    const members = categoryHasSubs
      ? subCategoryId
        ? listings.filter((l) => l.subCategoryId === subCategoryId)
        : []
      : listings.filter((l) => l.categoryId === categoryId && !l.subCategoryId);
    return sortByOrder(members, (l) => l.order);
  }, [listings, categoryId, subCategoryId, categoryHasSubs]);

  const current: { collection: string; rows: Row[]; setAll: (rows: Row[]) => void } =
    tab === "categories"
      ? { collection: "Catagories", rows: sortedCategories, setAll: setCategories }
      : tab === "subcategories"
        ? { collection: "SubCatagories", rows: subsOfCategory, setAll: setSubCategories }
        : { collection: "Products", rows: listingGroup, setAll: setListings };

  const missingCount = current.rows.filter((r) => r.order === null).length;
  const outOfSync = current.rows.some((r, index) => r.order !== index);

  const save = async (next: Row[]) => {
    const target = current;
    const nextOrders = new Map(next.map((r, index) => [r.id, index]));
    const apply = (rows: Row[]) =>
      rows.map((r) => (nextOrders.has(r.id) ? { ...r, order: nextOrders.get(r.id)! } : r));

    const snapshot =
      tab === "categories" ? categories : tab === "subcategories" ? subCategories : listings;
    target.setAll(apply(snapshot));
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await writeSequence(target.collection, next.map((r) => r.id));
      setNotice("Order saved.");
    } catch (err) {
      console.error(err);
      target.setAll(snapshot);
      setError("Failed to save the order. Nothing was changed in the app.");
    } finally {
      setSaving(false);
    }
  };

  const needsCategory = tab !== "categories";
  const needsSubCategory = tab === "listings" && categoryHasSubs;
  const ready =
    !loading && (!needsCategory || categoryId) && (!needsSubCategory || subCategoryId);

  return (
    <div>
      <PageHeader
        title="Display Order"
        description="Drag to set the order categories, sub categories and listings appear in the app. Changes save as soon as you drop. The first category is the one shown in the tab browser at the top of the home page."
      />

      <Toolbar>
        <Segmented<Tab>
          value={tab}
          onChange={(next) => {
            setTab(next);
            setNotice("");
            setError("");
          }}
          options={TABS.map((t) => ({ value: t.key, label: t.label }))}
        />
      </Toolbar>

      {needsCategory && (
        <Card className="mb-6">
          <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
            <PickerSelect
              label="Category"
              value={categoryId}
              onChange={(v) => {
                setCategoryId(v);
                setSubCategoryId("");
                setNotice("");
              }}
              placeholder="Choose a category"
              options={sortedCategories}
            />
            {tab === "listings" && (
              <PickerSelect
                label="Sub category"
                value={subCategoryId}
                onChange={(v) => {
                  setSubCategoryId(v);
                  setNotice("");
                }}
                placeholder={
                  !categoryId
                    ? "Choose a category first"
                    : categoryHasSubs
                      ? "Choose a sub category"
                      : "No sub categories"
                }
                options={subsOfCategory}
                disabled={!categoryId || !categoryHasSubs}
              />
            )}
          </div>
        </Card>
      )}

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

      {ready && outOfSync && current.rows.length > 0 && (
        <Alert tone="warning" className="mb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p>
              {missingCount > 0
                ? `${missingCount} item${missingCount === 1 ? " has" : "s have"} no display order and ${missingCount === 1 ? "is" : "are"} hidden in the app until this order is saved.`
                : "The saved order has gaps or duplicates. Save to store the order shown here."}
            </p>
            <Button
              size="sm"
              className="self-start sm:self-auto"
              loading={saving}
              onClick={() => save(current.rows)}
            >
              {saving ? "Saving…" : "Save this order"}
            </Button>
          </div>
        </Alert>
      )}

      {loading ? (
        <LoadingState />
      ) : !ready ? (
        <EmptyState
          icon={MousePointerClick}
          title={
            needsSubCategory && categoryId
              ? "Choose a sub category to order its listings."
              : "Choose a category to continue."
          }
        />
      ) : current.rows.length === 0 ? (
        <EmptyState icon={ListOrdered} title="Nothing to order here yet." />
      ) : (
        <Card>
          <SortableList
            items={current.rows}
            getId={(r) => r.id}
            onReorder={save}
            disabled={saving}
            renderItem={(row) => (
              <div className="flex items-center gap-3">
                {row.image ? (
                  <img
                    src={row.image}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded-lg border border-black/10 object-cover"
                  />
                ) : (
                  <div className="h-10 w-10 shrink-0 rounded-lg border border-black/10 bg-black/5" />
                )}
                <p className="min-w-0 flex-1 truncate text-sm font-semibold">{row.name}</p>
                {row.order === null && (
                  <Badge tone="amber" className="shrink-0">
                    Hidden in app
                  </Badge>
                )}
              </div>
            )}
          />
        </Card>
      )}
    </div>
  );
}

/* A labelled picker on a dark panel, built on the kit's dark select. */
function PickerSelect({
  label,
  value,
  onChange,
  placeholder,
  options,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: Array<{ id: string; name: string }>;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-semibold text-[#f4ead7]">{label}</span>
      <SelectInput
        tone="dark"
        className="mt-2"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </SelectInput>
    </label>
  );
}
