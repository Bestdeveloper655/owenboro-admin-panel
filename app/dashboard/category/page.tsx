"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FolderTree, Plus } from "lucide-react";
import {
  collection,
  getDocs,
  updateDoc,
  deleteDoc,
  doc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

import { db, storage } from "@/lib/firebaseServices";
import {
  asOrder,
  deleteStorageFileByUrl,
  nextOrder,
  slugify,
  sortByOrder,
  writeSequence,
} from "@/lib/adminData";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Field,
  ImagePicker,
  LoadingState,
  Modal,
  PageHeader,
  Pagination,
  TextInput,
  table,
  useObjectUrl,
} from "@/components/ui";

/* GLOBAL IMAGE CACHE */
const imageCache = new Map<string, string>();

/* TYPES */
type Category = {
  id: string;
  name: string;
  slug: string;
  image: string;
  order: number | null;
};

export default function Page() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);

  const [form, setForm] = useState({ name: "", slug: "" });
  const [file, setFile] = useState<File | null>(null);
  const [formError, setFormError] = useState("");

  const [saving, setSaving] = useState(false);

  /* Preview of the picked icon file. */
  const fileUrl = useObjectUrl(file);

  const preloadingRef = useRef<Set<string>>(new Set());

  /* 🔥 PAGINATION */
  const [page, setPage] = useState(1);
  const perPage = 25;

  const totalPages = Math.ceil(categories.length / perPage);

  const paginatedData = categories.slice((page - 1) * perPage, page * perPage);

  /* 🔥 PRELOAD IMAGE */
  const preloadImage = (src: string) => {
    if (!src) return;
    if (imageCache.has(src)) return;
    if (preloadingRef.current.has(src)) return;

    preloadingRef.current.add(src);

    const img = new Image();
    img.src = src;

    img.onload = () => {
      imageCache.set(src, src);
      preloadingRef.current.delete(src);
    };

    img.onerror = () => {
      preloadingRef.current.delete(src);
    };
  };

  /* FETCH */
  const fetchData = async () => {
    try {
      const snap = await getDocs(collection(db, "Catagories"));

      const data: Category[] = snap.docs.map((d) => {
        const x = d.data();
        return {
          id: d.id,
          name: x.catagoryName,
          slug: x.slug || "",
          image: x.image || "",
          order: asOrder(x.order),
        };
      });

      data.forEach((item) => {
        if (item.image) preloadImage(item.image);
      });

      setCategories(sortByOrder(data, (c) => c.order));
      setListError("");
    } catch (err) {
      console.error(err);
      setListError("Failed to load categories.");
    } finally {
      setListLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  /* RESET PAGE ON DATA CHANGE */
  useEffect(() => {
    setPage(1);
  }, [categories.length]);

  /* IMAGE UPLOAD */
  const uploadImage = async () => {
    if (!file) return { url: "", path: "" };

    const r = ref(storage, `categories/${Date.now()}-${file.name}`);
    await uploadBytes(r, file);

    const url = await getDownloadURL(r);
    preloadImage(url);

    return { url, path: r.fullPath };
  };

  const resetFormState = () => {
    setForm({ name: "", slug: "" });
    setFile(null);
    setFormError("");
  };

  const closeModal = () => {
    setAdding(false);
    setEditing(null);
    resetFormState();
  };

  const openAddModal = () => {
    setEditing(null);
    setAdding(true);
    resetFormState();
  };

  const openEditModal = (category: Category) => {
    setAdding(false);
    setEditing(category);
    setForm({ name: category.name, slug: category.slug });
    setFile(null);
    setFormError("");
  };

  const validate = () => {
    if (!form.name.trim()) return "Category name is required.";
    if (!slugify(form.slug || form.name)) return "Please enter a slug using letters or numbers.";
    if (adding && !file) return "Please upload an icon image for the category.";
    return "";
  };

  /* ADD — new categories go to the end; reorder them in Display Order. */
  const handleAdd = async () => {
    const validationMessage = validate();
    if (validationMessage) {
      setFormError(validationMessage);
      return;
    }

    try {
      setFormError("");
      setSaving(true);

      const { url, path } = await uploadImage();
      const newDocRef = doc(collection(db, "Catagories"));

      await setDoc(newDocRef, {
        id: newDocRef.id,
        catagoryName: form.name.trim(),
        slug: slugify(form.slug || form.name),
        image: url,
        imagePath: path,
        order: nextOrder(categories.map((c) => c.order)),
        recommended: false,
        createdAt: serverTimestamp(),
      });

      await fetchData();
      closeModal();
    } catch (error) {
      console.error(error);
      setFormError("Unable to save the category right now. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  /* UPDATE — position is left alone; it's managed in Display Order. */
  const handleUpdate = async () => {
    if (!editing) return;

    const validationMessage = validate();
    if (validationMessage) {
      setFormError(validationMessage);
      return;
    }

    try {
      setFormError("");
      setSaving(true);

      const imageFields: { image?: string; imagePath?: string } = {};
      if (file) {
        const { url, path } = await uploadImage();
        await deleteStorageFileByUrl(editing.image);
        imageFields.image = url;
        imageFields.imagePath = path;
      }

      await updateDoc(doc(db, "Catagories", editing.id), {
        catagoryName: form.name.trim(),
        slug: slugify(form.slug || form.name),
        ...imageFields,
        // Categories created before this round may be missing an order and
        // would be hidden in the app; give them the next slot.
        ...(editing.order === null
          ? { order: nextOrder(categories.map((c) => c.order)) }
          : {}),
      });

      await fetchData();
      closeModal();
    } catch (error) {
      console.error(error);
      setFormError("Unable to update the category right now. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  /* DELETE */
  const confirmDelete = async () => {
    if (!deleting) return;

    try {
      setSaving(true);
      await deleteDoc(doc(db, "Catagories", deleting.id));
      await deleteStorageFileByUrl(deleting.image);

      const remaining = categories.filter((c) => c.id !== deleting.id);
      await writeSequence("Catagories", remaining.map((c) => c.id));

      setDeleting(null);
      await fetchData();
    } catch (error) {
      console.error(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Categories"
        actions={
          <Button variant="outline" icon={Plus} onClick={openAddModal}>
            Add Category
          </Button>
        }
      >
        <p className="mt-1 text-sm text-[#e8dcc7]/70">
          Change the order categories appear in the app in{" "}
          <Link href="/dashboard/display-order" className="text-[#ff7a59] underline">
            Display Order
          </Link>
          .
        </p>
      </PageHeader>

      {listError && (
        <Alert className="mb-6" onDismiss={() => setListError("")}>
          {listError}
        </Alert>
      )}

      {listLoading ? (
        <LoadingState label="Loading categories…" />
      ) : categories.length === 0 ? (
        <EmptyState icon={FolderTree} title="No categories yet." />
      ) : (
        <div className={table.wrap}>
          <table className={`${table.table} min-w-[700px]`}>
            <thead className={table.thead}>
              <tr>
                <th className={table.th}>Image</th>
                <th className={table.th}>Name</th>
                <th className={table.th}>Slug</th>
                <th className={table.th}>Position</th>
                <th className={`${table.th} text-right`}>Actions</th>
              </tr>
            </thead>

            <tbody>
              {paginatedData.map((c) => (
                <CategoryRow
                  key={c.id}
                  c={c}
                  rank={categories.indexOf(c) + 1}
                  setEditing={openEditModal}
                  setDeleting={setDeleting}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {categories.length > 0 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          total={categories.length}
          perPage={perPage}
        />
      )}

      {(adding || editing) && (
        <Modal
          title={adding ? "Add Category" : "Update Category"}
          size="md"
          onClose={closeModal}
          footer={
            <>
              <Button variant="light" onClick={closeModal}>
                Cancel
              </Button>
              <Button onClick={adding ? handleAdd : handleUpdate} loading={saving}>
                {saving ? "Saving…" : adding ? "Save Category" : "Update Category"}
              </Button>
            </>
          }
        >
          {formError && (
            <Alert surface="light" className="mb-4">
              {formError}
            </Alert>
          )}

          <Input
            label="Name"
            value={form.name}
            onChange={(v: string) => {
              setForm({ ...form, name: v });
              setFormError("");
            }}
          />
          <Input
            label="Slug"
            value={form.slug}
            placeholder={slugify(form.name) || "generated from the name"}
            onChange={(v: string) => {
              setForm({ ...form, slug: v });
              setFormError("");
            }}
          />

          {adding && (
            <p className="mt-3 text-sm text-black/60">
              New categories are added at the end. Reorder them in Display Order.
            </p>
          )}

          <ImagePicker
            label="Icon image (SVG or PNG)"
            accept="image/*"
            previewUrl={fileUrl || editing?.image || ""}
            note={file?.name}
            onFile={(picked) => {
              setFile(picked);
              setFormError("");
            }}
          />
        </Modal>
      )}

      {deleting && (
        <Modal
          title="Delete Category"
          size="sm"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button variant="light" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button variant="danger-solid" onClick={confirmDelete} loading={saving}>
                {saving ? "Deleting…" : "Delete"}
              </Button>
            </>
          }
        >
          <p>
            Delete <span className="font-semibold">{deleting.name}</span>?
          </p>
          <p className="mt-2 text-sm text-black/60">
            Its sub categories and listings are not deleted, but they will no longer be
            reachable from this category in the app.
          </p>
        </Modal>
      )}
    </div>
  );
}

/* MEMO ROW */
const CategoryRow = React.memo(function CategoryRow({
  c,
  rank,
  setEditing,
  setDeleting,
}: {
  c: Category;
  rank: number;
  setEditing: (category: Category) => void;
  setDeleting: (category: Category) => void;
}) {
  return (
    <tr className={table.row}>
      <td className={table.td}>
        {c.image ? (
          <img src={imageCache.get(c.image) || c.image} alt={c.name} className={table.thumb} />
        ) : (
          <div className={table.thumbEmpty}>No Img</div>
        )}
      </td>

      <td className={`${table.td} font-semibold`}>{c.name}</td>

      <td className={`${table.td} text-black/60`}>
        {c.slug ? (
          <span className="block max-w-[280px] truncate" title={c.slug}>
            {c.slug}
          </span>
        ) : (
          "—"
        )}
      </td>

      <td className={table.td}>
        {c.order === null ? (
          <Badge tone="amber">Hidden in app</Badge>
        ) : (
          <span className="font-semibold tabular-nums text-black/70">#{rank}</span>
        )}
      </td>

      <td className={table.td}>
        <div className={table.actions}>
          <Button size="sm" onClick={() => setEditing(c)}>
            Update
          </Button>
          <Button size="sm" variant="danger" onClick={() => setDeleting(c)}>
            Delete
          </Button>
        </div>
      </td>
    </tr>
  );
});

/* UI */

function Input({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <Field label={label}>
      <TextInput value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}
