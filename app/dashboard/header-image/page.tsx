"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  updateDoc,
} from "firebase/firestore";
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from "firebase/storage";

import { db, storage } from "@/lib/firebaseServices";

/* TYPES */
type Category = {
  id: string;
  name: string;
};

type SubCategory = {
  id: string;
  name: string;
  categoryId: string;
};

type Product = {
  id: string;
  title: string;
  subCategoryId: string;
};

type HeaderImage = {
  id: string;
  title: string;
  image: string;
  categoryId: string;
  subCategoryId: string;
  productId: string;
  categoryName?: string;
  subCategoryName?: string;
  productName?: string;
  createdAt?: any;
  path: string;
};

type FormState = {
  title: string;
  categoryId: string;
  subCategoryId: string;
  productId: string;
};

const EMPTY_FORM: FormState = {
  title: "",
  categoryId: "",
  subCategoryId: "",
  productId: "",
};

const buildPathString = ({
  categoryId,
  subCategoryId,
  productId,
}: {
  categoryId?: string;
  subCategoryId?: string;
  productId?: string;
}) => {
  if (productId && subCategoryId && categoryId) {
    return `/Catagories/${categoryId}/SubCatagories/${subCategoryId}/Products/${productId}`;
  }

  if (subCategoryId && categoryId) {
    return `/Catagories/${categoryId}/SubCatagories/${subCategoryId}`;
  }

  if (categoryId) {
    return `/Catagories/${categoryId}`;
  }

  return "/";
};

export default function Page() {
  const [items, setItems] = useState<HeaderImage[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subCategories, setSubCategories] = useState<SubCategory[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<HeaderImage | null>(null);
  const [deleting, setDeleting] = useState<HeaderImage | null>(null);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [file, setFile] = useState<File | null>(null);

  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState("");

  /* FETCH */
  const fetchData = async () => {
    try {
      setPageLoading(true);

      const [headerSnap, catSnap, subSnap, productSnap] = await Promise.all([
        getDocs(collection(db, "HeaderImages")),
        getDocs(collection(db, "Catagories")),
        getDocs(collection(db, "SubCatagories")),
        getDocs(collection(db, "Products")),
      ]);

      const cats: Category[] = catSnap.docs.map((d) => ({
        id: d.id,
        name: d.data().catagoryName || "",
      }));

      const subs: SubCategory[] = subSnap.docs.map((d) => ({
        id: d.id,
        name: d.data().name || "",
        categoryId: d.data().catagoriesRef?.id || "",
      }));

      const prods: Product[] = productSnap.docs.map((d) => ({
        id: d.id,
        title: d.data().productName || "",
        subCategoryId: d.data().subCatagoryRef?.id || "",
      }));

      const data: HeaderImage[] = headerSnap.docs.map((d) => {
        const x = d.data();

        const categoryId = x.categoryId || x.categoryRef?.id || "";
        const subId = x.subCategoryId || x.subCategoryRef?.id || "";
        const productId = x.productId || x.productRef?.id || "";

        const cat =
          cats.find((c) => c.id === categoryId) ||
          cats.find((c) => c.id === subs.find((s) => s.id === subId)?.categoryId);

        const sub = subs.find((s) => s.id === subId);
        const prod = prods.find((p) => p.id === productId);

        return {
          id: d.id,
          title: x.title || "",
          image: x.image || "",
          categoryId: categoryId || sub?.categoryId || "",
          subCategoryId: subId,
          productId,
          createdAt: x.createdAt,
          categoryName: cat?.name || "",
          subCategoryName: sub?.name || "",
          productName: prod?.title || "",
          path: x.path || "",
        };
      });

      data.sort(
        (a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0),
      );

      setItems(data);
      setCategories(cats);
      setSubCategories(subs);
      setProducts(prods);
    } catch (err) {
      console.error(err);
      setError("Failed to load header images.");
    } finally {
      setPageLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  /* PREFILL FOR EDIT */
  useEffect(() => {
    if (!editing) return;

    const sub = subCategories.find((s) => s.id === editing.subCategoryId);

    setForm({
      title: editing.title || "",
      categoryId: editing.categoryId || sub?.categoryId || "",
      subCategoryId: editing.subCategoryId || "",
      productId: editing.productId || "",
    });
  }, [editing, subCategories]);

  /* FILTERS */
  const filteredSubCategories = useMemo(() => {
    return subCategories.filter((s) => s.categoryId === form.categoryId);
  }, [form.categoryId, subCategories]);

  const filteredProducts = useMemo(() => {
    return products.filter((p) => p.subCategoryId === form.subCategoryId);
  }, [form.subCategoryId, products]);

  /* VALIDATION */
  const validate = () => {
    if (!form.title.trim()) return "Title is required";
    if (!form.categoryId) return "Category is required";
    return "";
  };

  /* HELPERS */
  const closeModal = () => {
    setAdding(false);
    setEditing(null);
    setFile(null);
    setError("");
    setForm(EMPTY_FORM);
  };

  const uploadImage = async () => {
    if (!file) return "";
    const storageRef = ref(storage, `header/${Date.now()}-${file.name}`);
    await uploadBytes(storageRef, file);
    return await getDownloadURL(storageRef);
  };

  const deleteImageByUrl = async (url?: string) => {
    if (!url) return;

    try {
      const decoded = decodeURIComponent(url);
      const path = decoded.split("/o/")[1]?.split("?")[0];
      if (path) {
        await deleteObject(ref(storage, path));
      }
    } catch (err) {
      console.log("Image delete skipped/failed:", err);
    }
  };

  /* ADD */
  const handleAdd = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      setLoading(true);
      setError("");

      const imageUrl = await uploadImage();

      const categoryRef = form.categoryId
        ? doc(db, "Catagories", form.categoryId)
        : null;

      const subRef = form.subCategoryId
        ? doc(db, "SubCatagories", form.subCategoryId)
        : null;

      const prodRef = form.productId
        ? doc(db, "Products", form.productId)
        : null;

      const path = buildPathString({
        categoryId: form.categoryId,
        subCategoryId: form.subCategoryId,
        productId: form.productId,
      });

      const docRef = await addDoc(collection(db, "HeaderImages"), {
        title: form.title,
        image: imageUrl,
        categoryId: form.categoryId,
        subCategoryId: form.subCategoryId,
        productId: form.productId,
        categoryRef,
        subCategoryRef: subRef,
        productRef: prodRef,
        path,
        createdAt: new Date(),
      });

      const selectedCategory = categories.find((c) => c.id === form.categoryId);
      const selectedSub = subCategories.find((s) => s.id === form.subCategoryId);
      const selectedProduct = products.find((p) => p.id === form.productId);

      setItems((prev) => [
        {
          id: docRef.id,
          title: form.title,
          image: imageUrl,
          categoryId: form.categoryId,
          subCategoryId: form.subCategoryId,
          productId: form.productId,
          categoryName: selectedCategory?.name || "",
          subCategoryName: selectedSub?.name || "",
          productName: selectedProduct?.title || "",
          createdAt: { seconds: Math.floor(Date.now() / 1000) },
          path,
        },
        ...prev,
      ]);

      closeModal();
    } catch (err) {
      console.error(err);
      setError("Failed to add header image.");
    } finally {
      setLoading(false);
    }
  };

  /* UPDATE */
  const handleUpdate = async () => {
    if (!editing) return;

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      setLoading(true);
      setError("");

      let imageUrl = editing.image;

      if (file) {
        await deleteImageByUrl(editing.image);
        imageUrl = await uploadImage();
      }

      const categoryRef = form.categoryId
        ? doc(db, "Catagories", form.categoryId)
        : null;

      const subRef = form.subCategoryId
        ? doc(db, "SubCatagories", form.subCategoryId)
        : null;

      const prodRef = form.productId
        ? doc(db, "Products", form.productId)
        : null;

      const path = buildPathString({
        categoryId: form.categoryId,
        subCategoryId: form.subCategoryId,
        productId: form.productId,
      });

      await updateDoc(doc(db, "HeaderImages", editing.id), {
        title: form.title,
        image: imageUrl,
        categoryId: form.categoryId,
        subCategoryId: form.subCategoryId,
        productId: form.productId,
        categoryRef,
        subCategoryRef: subRef,
        productRef: prodRef,
        path,
      });

      setItems((prev) =>
        prev.map((item) =>
          item.id === editing.id
            ? {
                ...item,
                title: form.title,
                image: imageUrl,
                categoryId: form.categoryId,
                subCategoryId: form.subCategoryId,
                productId: form.productId,
                categoryName:
                  categories.find((c) => c.id === form.categoryId)?.name || "",
                subCategoryName:
                  subCategories.find((s) => s.id === form.subCategoryId)?.name || "",
                productName:
                  products.find((p) => p.id === form.productId)?.title || "",
                path,
              }
            : item,
        ),
      );

      closeModal();
    } catch (err) {
      console.error(err);
      setError("Failed to update header image.");
    } finally {
      setLoading(false);
    }
  };

  /* DELETE */
  const confirmDelete = async () => {
    if (!deleting) return;

    try {
      await deleteDoc(doc(db, "HeaderImages", deleting.id));
      await deleteImageByUrl(deleting.image);

      setItems((prev) => prev.filter((item) => item.id !== deleting.id));
      setDeleting(null);
    } catch (err) {
      console.error(err);
      setError("Failed to delete header image.");
    }
  };

  return (
    <div className="px-2 pt-4 pb-8 sm:px-6 sm:pt-6 sm:pb-10">
      <div className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-3xl font-bold text-[#ff7a59] sm:text-4xl">
          Header Images
        </h1>

        <button
          onClick={() => {
            setEditing(null);
            setForm(EMPTY_FORM);
            setFile(null);
            setError("");
            setAdding(true);
          }}
          className="self-start rounded-xl border border-[#ff7a59] px-4 py-2 text-sm text-[#ff7a59] sm:self-auto sm:px-5 sm:text-base"
        >
          Add Header Image
        </button>
      </div>

      {error && !adding && !editing && (
        <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {pageLoading ? (
        <div className="rounded-2xl border border-white/10 bg-[#ece2cb] p-8 text-center text-black">
          Loading header images...
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-[#ece2cb] p-8 text-center text-black">
          No header images found.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[700px] text-left">
            <thead className="bg-[#ece2cb] text-black">
              <tr>
                <th className="p-3">Image</th>
                <th className="p-3">Title</th>
                <th className="p-3">SubCategory</th>
                <th className="p-3">Listing</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>

            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-white/10 bg-[#ece2cb] text-black"
                >
                  <td className="p-3">
                    {item.image ? (
                      <img
                        src={item.image}
                        alt={item.title}
                        className="h-14 w-20 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="flex h-14 w-20 items-center justify-center rounded-lg border border-black/10 bg-black/5 text-[10px] text-black/35">
                        No Img
                      </div>
                    )}
                  </td>

                  <td className="p-3 font-semibold">{item.title}</td>
                  <td className="p-3">{item.subCategoryName || "-"}</td>
                  <td className="p-3">{item.productName || "-"}</td>

                  <td className="p-3 text-right">
                    <button
                      onClick={() => setEditing(item)}
                      className="bg-[#ff7a59] px-3 py-1 text-white rounded mr-2"
                    >
                      Update
                    </button>

                    <button
                      onClick={() => setDeleting(item)}
                      className="border border-red-400 px-3 py-1 text-red-500 rounded"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(adding || editing) && (
        <Modal
          title={adding ? "Add Header Image" : "Update Header Image"}
          onClose={closeModal}
        >
          {error && (
            <div className="text-red-500 mb-3 text-sm">{error}</div>
          )}

          <Input
            label="Title"
            value={form.title}
            onChange={(v: string) => setForm((prev) => ({ ...prev, title: v }))}
          />

          <Select
            label="Category"
            value={form.categoryId}
            onChange={(v: string) =>
              setForm((prev) => ({
                ...prev,
                categoryId: v,
                subCategoryId: "",
                productId: "",
              }))
            }
            options={categories}
          />

          <Select
            label="SubCategory"
            value={form.subCategoryId}
            onChange={(v: string) =>
              setForm((prev) => ({
                ...prev,
                subCategoryId: v,
                productId: "",
              }))
            }
            options={filteredSubCategories}
          />

          <Select
            label="Listing"
            value={form.productId}
            onChange={(v: string) =>
              setForm((prev) => ({ ...prev, productId: v }))
            }
            options={filteredProducts.map((p) => ({
              id: p.id,
              name: p.title,
            }))}
          />

          <div className="mt-4">
            <label className="font-semibold">Image</label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="mt-1 w-full border rounded-xl p-3"
            />
          </div>

          {editing?.image && !file && (
            <div className="mt-4">
              <p className="mb-2 text-sm text-black/70">Current image</p>
              <img
                src={editing.image}
                alt={editing.title}
                className="h-24 w-32 rounded-xl object-cover border"
              />
            </div>
          )}

          <button
            onClick={adding ? handleAdd : handleUpdate}
            disabled={loading}
            className="mt-6 w-full bg-[#ff7a59] text-white py-3 rounded-xl disabled:opacity-60"
          >
            {loading ? "Saving..." : adding ? "Save Header Image" : "Update Header Image"}
          </button>
        </Modal>
      )}

      {deleting && (
        <Modal title="Delete" onClose={() => setDeleting(null)}>
          <p className="mb-4 text-black">
            Are you sure you want to delete <b>{deleting.title}</b>?
          </p>

          <div className="flex gap-2">
            <button
              onClick={() => setDeleting(null)}
              className="w-full border py-2 rounded-xl"
            >
              Cancel
            </button>

            <button
              onClick={confirmDelete}
              className="w-full bg-red-500 text-white py-2 rounded-xl"
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
    <div className="fixed inset-0 z-50 bg-black/70 flex justify-center items-center px-4">
      <div className="bg-[#e8dcc7] p-6 rounded-3xl w-full max-w-lg text-black max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-[#ff7a59]">{title}</h2>
          <button onClick={onClose}>✖</button>
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
    <div className="mt-3">
      <label className="font-semibold">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border rounded-xl p-3 mt-1"
      />
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ id: string; name: string }>;
}) {
  return (
    <div className="mt-3">
      <label className="font-semibold">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border rounded-xl p-3 mt-1"
      >
        <option value="">Select</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );
}