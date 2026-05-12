"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  collection,
  getDocs,
  updateDoc,
  deleteDoc,
  doc,
  setDoc,
} from "firebase/firestore";
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";

import { db, storage } from "@/lib/firebaseServices";

/* GLOBAL IMAGE CACHE */
const imageCache = new Map<string, string>();

/* TYPES */
type Category = {
  id: string;
  name: string;
  slug: string;
  image: string;
  order?: number;
};

export default function Page() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);

  const [dragged, setDragged] = useState<Category | null>(null);

  const [form, setForm] = useState({ name: "", slug: "", order: "" });
  const [file, setFile] = useState<File | null>(null);
  const [formError, setFormError] = useState("");

  const [saving, setSaving] = useState(false);

  const preloadingRef = useRef<Set<string>>(new Set());

  /* 🔥 PAGINATION */
  const [page, setPage] = useState(1);
  const perPage = 8;

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
    const snap = await getDocs(collection(db, "Catagories"));

    const data: Category[] = snap.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id,
        name: x.catagoryName,
        slug: x.slug || "",
        image: x.image || "",
        order: x.order ?? 999,
      };
    });

    data.forEach((item) => {
      if (item.image) preloadImage(item.image);
    });

    setCategories(data.sort((a, b) => (a.order ?? 999) - (b.order ?? 999)));
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
    if (!file) return "";

    const r = ref(storage, `categories/${Date.now()}-${file.name}`);
    await uploadBytes(r, file);

    const url = await getDownloadURL(r);
    preloadImage(url);

    return url;
  };

  const normalizeOrders = (items: Category[]) =>
    [...items]
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
      .map((item, index) => ({
        ...item,
        order: index + 1,
      }));

  const insertCategoryAtOrder = (
    currentCategories: Category[],
    item: Category,
    targetOrder: number,
  ) => {
    const withoutItem = currentCategories.filter((c) => c.id !== item.id);
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

  const resetFormState = () => {
    setForm({ name: "", slug: "", order: "" });
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
    setForm({
      name: category.name,
      slug: category.slug,
      order: category.order ? String(category.order) : "",
    });
    setFile(null);
    setFormError("");
  };

  const validateAddOrder = (order: number) => {
    if (!Number.isInteger(order) || order < 1) {
      return "Display order must be a positive whole number.";
    }

    if (order > categories.length + 1) {
      return `Display order must be between 1 and ${categories.length + 1}.`;
    }

    const existingCategory = categories.find((category) => category.order === order);

    if (existingCategory) {
      return `Display order ${order} already exists for "${existingCategory.name}". Please choose a different order number.`;
    }

    return "";
  };

  const validateUpdateOrder = (order: number) => {
    if (!Number.isInteger(order) || order < 1) {
      return "Display order must be a positive whole number.";
    }

    if (order > categories.length) {
      return `Display order must be between 1 and ${categories.length}.`;
    }

    return "";
  };

  /* ADD */
  const handleAdd = async () => {
    const desiredOrder =
      form.order !== "" ? Number(form.order) : categories.length + 1;

    const validationMessage = validateAddOrder(desiredOrder);
    if (validationMessage) {
      setFormError(validationMessage);
      return;
    }

    try {
      setFormError("");
      setSaving(true);

      const imageUrl = await uploadImage();
      const newDocRef = doc(collection(db, "Catagories"));

      const newCategory: Category = {
        id: newDocRef.id,
        name: form.name,
        slug: form.slug,
        image: imageUrl,
        order: desiredOrder,
      };

      const reordered = insertCategoryAtOrder(
        categories,
        newCategory,
        desiredOrder,
      );

      const finalOrder =
        reordered.find((entry) => entry.id === newCategory.id)?.order ??
        desiredOrder;

      await Promise.all(
        reordered
          .filter((entry) => entry.id !== newCategory.id)
          .map((entry) =>
            updateDoc(doc(db, "Catagories", entry.id), {
              order: entry.order,
            }),
          ),
      );

      await setDoc(newDocRef, {
        id: newDocRef.id,
        catagoryName: form.name,
        slug: form.slug,
        image: imageUrl,
        order: finalOrder,
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

  /* UPDATE */
  const handleUpdate = async () => {
    if (!editing) return;

    const desiredOrder =
      form.order !== "" ? Number(form.order) : (editing.order ?? 999);

    const validationMessage = validateUpdateOrder(desiredOrder);
    if (validationMessage) {
      setFormError(validationMessage);
      return;
    }

    try {
      setFormError("");
      setSaving(true);

      let imageUrl = editing.image;

      if (file) {
        if (editing.image) {
          await deleteObject(ref(storage, editing.image));
        }
        imageUrl = await uploadImage();
      }

      const updatedCategory: Category = {
        ...editing,
        name: form.name,
        slug: form.slug,
        image: imageUrl,
        order: desiredOrder,
      };

      const reordered = insertCategoryAtOrder(
        categories,
        updatedCategory,
        desiredOrder,
      );

      const finalOrder =
        reordered.find((entry) => entry.id === editing.id)?.order ??
        desiredOrder;

      await Promise.all(
        reordered
          .filter((entry) => entry.id !== editing.id)
          .map((entry) =>
            updateDoc(doc(db, "Catagories", entry.id), {
              order: entry.order,
            }),
          ),
      );

      await updateDoc(doc(db, "Catagories", editing.id), {
        catagoryName: form.name,
        slug: form.slug,
        image: imageUrl,
        order: finalOrder,
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
      await deleteDoc(doc(db, "Catagories", deleting.id));

      if (deleting.image) {
        await deleteObject(ref(storage, deleting.image));
      }

      const remaining = categories.filter((c) => c.id !== deleting.id);
      const reorderedRemaining = remaining.map((item, index) => ({
        ...item,
        order: index + 1,
      }));

      setCategories(reorderedRemaining);

      await Promise.all(
        reorderedRemaining.map((item) =>
          updateDoc(doc(db, "Catagories", item.id), {
            order: item.order,
          }),
        ),
      );

      setDeleting(null);
    } catch (error) {
      console.error(error);
    }
  };

  /* DRAG DROP */
  const handleDrop = async (target: Category) => {
    if (!dragged || dragged.id === target.id) return;

    try {
      const updated = [...categories];
      const from = updated.findIndex((i) => i.id === dragged.id);
      const to = updated.findIndex((i) => i.id === target.id);

      if (from === -1 || to === -1) return;

      const [moved] = updated.splice(from, 1);
      updated.splice(to, 0, moved);

      const reordered = updated.map((item, index) => ({
        ...item,
        order: index + 1,
      }));

      setCategories(reordered);
      setDragged(null);

      await Promise.all(
        reordered.map((item) =>
          updateDoc(doc(db, "Catagories", item.id), {
            order: item.order,
          }),
        ),
      );
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <div className="px-2 pt-4 pb-8 sm:px-6 sm:pt-6 sm:pb-10">
      <div className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-3xl font-bold text-[#ff7a59] sm:text-4xl">
          Categories
        </h1>

        <button
          onClick={openAddModal}
          className="self-start rounded-xl border border-[#ff7a59] px-4 py-2 text-sm text-[#ff7a59] sm:self-auto sm:px-5 sm:text-base"
        >
          Add Category
        </button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full min-w-[700px] text-left">
          <thead className="bg-[#ece2cb] text-black">
            <tr>
              <th className="p-3">Image</th>
              <th className="p-3">Name</th>
              <th className="p-3">Slug</th>
              <th className="p-3">Order</th>
              <th className="p-3 text-right min-w-[170px]">Actions</th>
            </tr>
          </thead>

          <tbody>
            {paginatedData.map((c) => (
              <CategoryRow
                key={c.id}
                c={c}
                setDragged={setDragged}
                handleDrop={handleDrop}
                setEditing={openEditModal}
                setDeleting={setDeleting}
              />
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-8 flex flex-col md:flex-row items-center justify-between gap-4 text-[#f3ead7]">
          <p className="text-sm text-[#f3ead7]/70">
            Showing {(page - 1) * perPage + 1}–
            {Math.min(page * perPage, categories.length)} of {categories.length}
          </p>

          <div className="flex gap-2">
            <button
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
              className="px-3 py-1 border border-white/10 rounded-lg disabled:opacity-30"
            >
              Prev
            </button>

            {Array.from({ length: totalPages }).map((_, i) => {
              const p = i + 1;

              if (p !== 1 && p !== totalPages && Math.abs(p - page) > 1) {
                return null;
              }

              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`px-3 py-1 rounded-lg ${
                    page === p
                      ? "bg-[#ff7a59] text-white"
                      : "border border-white/10"
                  }`}
                >
                  {p}
                </button>
              );
            })}

            <button
              disabled={page === totalPages}
              onClick={() => setPage(page + 1)}
              className="px-3 py-1 border border-white/10 rounded-lg disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {(adding || editing) && (
        <Modal title={adding ? "Add Category" : "Update Category"} onClose={closeModal}>
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
            onChange={(v: string) => {
              setForm({ ...form, slug: v });
              setFormError("");
            }}
          />
          <Input
            label="Order"
            value={form.order}
            onChange={(v: string) => {
              setForm({ ...form, order: v });
              setFormError("");
            }}
          />

          {editing && !formError && (
            <p className="mt-2 text-sm text-[#5f5542]">
              Changing the display order will automatically shift the other categories.
            </p>
          )}

          <input
            type="file"
            onChange={(e) => {
              setFile(e.target.files?.[0] || null);
              setFormError("");
            }}
            className="mt-4"
          />

          {formError && (
            <div className="mt-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
              {formError}
            </div>
          )}

          <button
            onClick={adding ? handleAdd : handleUpdate}
            disabled={saving}
            className="mt-6 w-full bg-[#ff7a59] text-white py-3 rounded-xl flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {saving && (
              <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
            )}
            {saving ? "Saving..." : adding ? "Save Category" : "Update Category"}
          </button>
        </Modal>
      )}

      {deleting && (
        <Modal title="Delete" onClose={() => setDeleting(null)}>
          <button
            onClick={confirmDelete}
            className="bg-red-500 text-white px-4 py-2 rounded"
          >
            Confirm Delete
          </button>
        </Modal>
      )}
    </div>
  );
}

/* 🔥 MEMO ROW */
const CategoryRow = React.memo(function CategoryRow({
  c,
  setDragged,
  handleDrop,
  setEditing,
  setDeleting,
}: any) {
  return (
    <tr
      draggable
      onDragStart={() => setDragged(c)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={() => handleDrop(c)}
      className="border-b bg-[#ece2cb] text-black hover:bg-[#f5ecd7]"
    >
      <td className="p-3">
        <img
          src={imageCache.get(c.image) || c.image}
          alt={c.name}
          className="h-12 w-12 rounded-lg object-cover"
        />
      </td>

      <td className="p-3 font-semibold">{c.name}</td>
      <td className="p-3">{c.slug}</td>
      <td className="p-3">{c.order}</td>

      <td className="p-3 min-w-[170px]">
        <div className="flex justify-end items-center gap-2 whitespace-nowrap">
          <button
            onClick={() => setEditing(c)}
            className="bg-[#ff7a59] px-3 py-1 text-white rounded"
          >
            Update
          </button>

          <button
            onClick={() => setDeleting(c)}
            className="border border-red-400 px-3 py-1 text-red-500"
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
});

/* UI */
function Modal({ children, title, onClose }: any) {
  return (
    <div className="fixed inset-0 bg-black/70 flex justify-center items-center">
      <div className="bg-[#e8dcc7] p-6 rounded-3xl w-[90%] max-w-lg text-black">
        <div className="flex justify-between mb-4">
          <h2 className="text-xl font-bold text-[#ff7a59]">{title}</h2>
          <button onClick={onClose}>✖</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Input({ label, value, onChange }: any) {
  return (
    <div className="mt-3">
      <label className="font-semibold">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-[#ff7a59] rounded-xl p-3 mt-1"
      />
    </div>
  );
}