"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
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
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);

  const [form, setForm] = useState({ name: "", slug: "" });
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
        order: asOrder(x.order),
      };
    });

    data.forEach((item) => {
      if (item.image) preloadImage(item.image);
    });

    setCategories(sortByOrder(data, (c) => c.order));
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
    <div className="px-2 pt-4 pb-8 sm:px-6 sm:pt-6 sm:pb-10">
      <div className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[#ff7a59] sm:text-4xl">
            Categories
          </h1>
          <p className="mt-1 text-sm text-[#e8dcc7]/70">
            Change the order categories appear in the app in{" "}
            <Link href="/dashboard/display-order" className="text-[#ff7a59] underline">
              Display Order
            </Link>
            .
          </p>
        </div>

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
              <th className="p-3">Position</th>
              <th className="p-3 text-right min-w-[170px]">Actions</th>
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
            placeholder={slugify(form.name) || "generated from the name"}
            onChange={(v: string) => {
              setForm({ ...form, slug: v });
              setFormError("");
            }}
          />

          {adding && (
            <p className="mt-2 text-sm text-[#5f5542]">
              New categories are added at the end. Reorder them in Display Order.
            </p>
          )}

          <label className="mt-4 block font-semibold">Icon image (SVG or PNG)</label>
          <input
            type="file"
            accept="image/*"
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
        <Modal title="Delete category" onClose={() => setDeleting(null)}>
          <p>
            Delete <b>{deleting.name}</b>? Its sub categories and listings are
            not deleted, but they will no longer be reachable from this category
            in the app.
          </p>
          <div className="mt-6 flex justify-end gap-3">
            <button
              onClick={() => setDeleting(null)}
              className="rounded-xl border border-black/15 px-4 py-2"
            >
              Cancel
            </button>
            <button
              onClick={confirmDelete}
              disabled={saving}
              className="rounded-xl bg-red-500 px-4 py-2 text-white disabled:opacity-60"
            >
              {saving ? "Deleting…" : "Delete"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* 🔥 MEMO ROW */
const CategoryRow = React.memo(function CategoryRow({
  c,
  rank,
  setEditing,
  setDeleting,
}: any) {
  return (
    <tr className="border-b bg-[#ece2cb] text-black hover:bg-[#f5ecd7]">
      <td className="p-3">
        <img
          src={imageCache.get(c.image) || c.image}
          alt={c.name}
          className="h-12 w-12 rounded-lg object-cover"
        />
      </td>

      <td className="p-3 font-semibold">{c.name}</td>
      <td className="p-3">{c.slug}</td>
      <td className="p-3">
        {c.order === null ? (
          <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
            Hidden in app
          </span>
        ) : (
          rank
        )}
      </td>

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

function Input({ label, value, onChange, placeholder }: any) {
  return (
    <div className="mt-3">
      <label className="font-semibold">{label}</label>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-[#ff7a59] rounded-xl p-3 mt-1"
      />
    </div>
  );
}

