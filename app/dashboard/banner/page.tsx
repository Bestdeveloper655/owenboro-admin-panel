"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
} from "firebase/firestore";
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import { serverTimestamp } from "firebase/firestore";
import { db, storage } from "@/lib/firebaseServices";
import { query, orderBy } from "firebase/firestore";

/* TYPES */
type Category = { id: string; name: string };
type SubCategory = { id: string; name: string; categoryId: string };
type Product = { id: string; name: string; subCategoryId: string };

type Banner = {
  id: string;
  title: string;
  categoryId: string;
  subCategoryId: string;
  productId: string;
  category: string;
  subCategory: string;
  product: string;
  image: string;
  path: string;
  createdAt?: any;

};

const buildBannerPath = ({
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
  const [banners, setBanners] = useState<Banner[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subCategories, setSubCategories] = useState<SubCategory[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Banner | null>(null);
  const [deleting, setDeleting] = useState<Banner | null>(null);

  const [loading, setLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  const [form, setForm] = useState({
    title: "",
    categoryId: "",
    subCategoryId: "",
    productId: "",
  });

  const [error, setError] = useState("");

  /* FETCH */
  useEffect(() => {
    const fetchData = async () => {
    const bannerQuery = query(
  collection(db, "Banner"),
  orderBy("createdAt", "desc") // ✅ latest first
);

const bannerSnap = await getDocs(bannerQuery);
      const catSnap = await getDocs(collection(db, "Catagories"));
      const subSnap = await getDocs(collection(db, "SubCatagories"));
      const prodSnap = await getDocs(collection(db, "Products"));

      const cats = catSnap.docs.map((d) => ({
        id: d.id,
        name: d.data().catagoryName || d.data().name,
      }));

      const subs = subSnap.docs.map((d) => ({
        id: d.id,
        name: d.data().name,
        categoryId: d.data().catagoriesRef?.id || "",
      }));

      const prods = prodSnap.docs.map((d) => ({
        id: d.id,
        name: d.data().productName,
        subCategoryId: d.data().subCatagoryRef?.id || "",
      }));

      const data = bannerSnap.docs.map((d) => {
        const x = d.data();

        const cat = cats.find((c) => c.id === x.categoryRef?.id);
        const sub = subs.find((s) => s.id === x.subCategoryRef?.id);
        const prod = prods.find((p) => p.id === x.productRef?.id);

        return {
          id: d.id,
          title: x.bannerName,
          categoryId: x.categoryRef?.id || "",
          subCategoryId: x.subCategoryRef?.id || "",
          productId: x.productRef?.id || "",
          category: cat?.name || "",
          subCategory: sub?.name || "",
          product: prod?.name || "",
          image: x.image,
          path: x.path || "",
        };
      });

      setBanners(data);
      setCategories(cats);
      setSubCategories(subs);
      setProducts(prods);
    };

    fetchData();
  }, []);

  /* FILTERS */
  const filteredSubCategories = useMemo(() => {
    return subCategories.filter((s) => s.categoryId === form.categoryId);
  }, [subCategories, form.categoryId]);

  const filteredProducts = useMemo(() => {
    return products.filter((p) => p.subCategoryId === form.subCategoryId);
  }, [products, form.subCategoryId]);

  /* PREFILL EDIT */
  useEffect(() => {
    if (editing) {
      setForm({
        title: editing.title,
        categoryId: editing.categoryId,
        subCategoryId: editing.subCategoryId,
        productId: editing.productId,
      });
    }
  }, [editing]);

  /* VALIDATION (ONLY CATEGORY IS MANDATORY) */
  const validate = () => {
    if (!form.categoryId) return "Category is required";
    return "";
  };

  /* UPLOAD */
  const uploadImage = async () => {
    if (!file) return "";
    const r = ref(storage, `banners/${Date.now()}-${file.name}`);
    await uploadBytes(r, file);
    return await getDownloadURL(r);
  };

  const deleteImage = async (url: string) => {
    try {
      await deleteObject(ref(storage, url));
    } catch {}
  };

  /* ADD */
  const handleAdd = async () => {
    const err = validate();
    if (err) return setError(err);

    setLoading(true);

    try {
      const imageUrl = await uploadImage();

      const selectedCategory = categories.find((c) => c.id === form.categoryId);
      const selectedSubCategory = subCategories.find(
        (s) => s.id === form.subCategoryId,
      );
      const selectedProduct = products.find((p) => p.id === form.productId);

      const path = buildBannerPath({
        categoryId: form.categoryId,
        subCategoryId: form.subCategoryId,
        productId: form.productId,
      });

      const docRef = await addDoc(collection(db, "Banner"), {
        bannerName: form.title,
        categoryRef: form.categoryId
          ? doc(db, "Catagories", form.categoryId)
          : null,
        subCategoryRef: form.subCategoryId
          ? doc(db, "SubCatagories", form.subCategoryId)
          : null,
        productRef: form.productId ? doc(db, "Products", form.productId) : null,
        image: imageUrl,
        path,
        createdAt: serverTimestamp(),
      });

      setBanners((prev) => [
        {
          id: docRef.id,
          title: form.title,
          categoryId: form.categoryId,
          subCategoryId: form.subCategoryId,
          productId: form.productId,
          category: selectedCategory?.name || "",
          subCategory: selectedSubCategory?.name || "",
          product: selectedProduct?.name || "",
          image: imageUrl,
          path,
          createdAt: new Date(),
        },
        ...prev,
      ]);

      closeModal();
    } catch (e) {
      setError("Failed to add banner");
    } finally {
      setLoading(false);
    }
  };

  /* UPDATE */
  const handleUpdate = async () => {
    if (!editing) return;

    const err = validate();
    if (err) return setError(err);

    setLoading(true);

    try {
      let imageUrl = editing.image;

      if (file) {
        await deleteImage(editing.image);
        imageUrl = await uploadImage();
      }

      const selectedCategory = categories.find((c) => c.id === form.categoryId);
      const selectedSubCategory = subCategories.find(
        (s) => s.id === form.subCategoryId,
      );
      const selectedProduct = products.find((p) => p.id === form.productId);

      const path = buildBannerPath({
        categoryId: form.categoryId,
        subCategoryId: form.subCategoryId,
        productId: form.productId,
      });

      await updateDoc(doc(db, "Banner", editing.id), {
        bannerName: form.title,
        categoryRef: form.categoryId
          ? doc(db, "Catagories", form.categoryId)
          : null,
        subCategoryRef: form.subCategoryId
          ? doc(db, "SubCatagories", form.subCategoryId)
          : null,
        productRef: form.productId ? doc(db, "Products", form.productId) : null,
        image: imageUrl,
        path,
      });

      setBanners((prev) =>
        prev.map((b) =>
          b.id === editing.id
            ? {
                ...b,
                title: form.title,
                categoryId: form.categoryId,
                subCategoryId: form.subCategoryId,
                productId: form.productId,
                category: selectedCategory?.name || "",
                subCategory: selectedSubCategory?.name || "",
                product: selectedProduct?.name || "",
                image: imageUrl,
                path,
              }
            : b,
        ),
      );

      closeModal();
    } catch (e) {
      setError("Failed to update banner");
    } finally {
      setLoading(false);
    }
  };

  /* DELETE */
  const confirmDelete = async () => {
    if (!deleting) return;

    try {
      setDeleteLoading(true);

      await deleteDoc(doc(db, "Banner", deleting.id));
      await deleteImage(deleting.image);

      setBanners((prev) => prev.filter((b) => b.id !== deleting.id));
      setDeleting(null);
    } catch (e) {
      setError("Failed to delete banner");
    } finally {
      setDeleteLoading(false);
    }
  };

  const closeModal = () => {
    setAdding(false);
    setEditing(null);
    setFile(null);
    setError("");
    setForm({
      title: "",
      categoryId: "",
      subCategoryId: "",
      productId: "",
    });
  };

  return (
    <div className="px-4 pt-6 pb-10 md:px-8">
      {/* HEADER */}
      <div className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-3xl font-bold text-[#ff7a59] sm:text-4xl">
          Banner
        </h1>

        <button
          onClick={() => setAdding(true)}
          className="self-start rounded-xl border border-[#ff7a59] px-4 py-2 text-sm text-[#ff7a59] sm:self-auto sm:px-5 sm:text-base"
        >
          Add Banner
        </button>
      </div>

      {/* TABLE */}
      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full min-w-[800px] text-left">
          <thead className="bg-[#ece2cb] text-black">
            <tr>
              <th className="p-3">Image</th>
              <th className="p-3">Title</th>
              <th className="p-3">Category</th>
              <th className="p-3">SubCategory</th>
              <th className="p-3">Listing</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>

          <tbody>
            {banners.map((b) => (
              <tr key={b.id} className="border-b bg-[#ece2cb] text-black">
                <td className="p-3">
                  <img src={b.image} className="h-14 w-20 rounded-lg" />
                </td>
                <td className="p-3 font-semibold">{b.title}</td>
                <td className="p-3">{b.category}</td>
                <td className="p-3">{b.subCategory}</td>
                <td className="p-3">{b.product}</td>

                <td className="p-3 text-right">
                  <button
                    onClick={() => setEditing(b)}
                    className="bg-[#ff7a59] px-3 py-1 text-white rounded mr-2"
                  >
                    Update
                  </button>
                  <button
                    onClick={() => setDeleting(b)}
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

      {/* ADD / EDIT MODAL */}
      {(adding || editing) && (
        <Modal title="Banner" onClose={closeModal}>
          {error && <div className="text-red-500 text-sm">{error}</div>}

          <Input
            label="Title"
            value={form.title}
            onChange={(v: any) => setForm({ ...form, title: v })}
          />

          <Select
            value={form.categoryId}
            onChange={(v: any) =>
              setForm({
                ...form,
                categoryId: v,
                subCategoryId: "",
                productId: "",
              })
            }
            options={categories}
            placeholder="Select Category (required)"
          />

          <Select
            value={form.subCategoryId}
            onChange={(v: any) =>
              setForm({ ...form, subCategoryId: v, productId: "" })
            }
            options={filteredSubCategories}
            placeholder="Select SubCategory (optional)"
          />

          <Select
            value={form.productId}
            onChange={(v: any) => setForm({ ...form, productId: v })}
            options={filteredProducts}
            placeholder="Select Listing (optional)"
          />

          <div className="mt-4 border border-[#ff7a59] rounded-xl p-4">
            <input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </div>

          <button
            onClick={adding ? handleAdd : handleUpdate}
            className="mt-6 w-full bg-[#ff7a59] text-white py-3 rounded-xl"
          >
            {loading ? "Saving..." : "Save"}
          </button>
        </Modal>
      )}

      {/* DELETE MODAL */}
      {deleting && (
        <Modal title="Delete Banner" onClose={() => setDeleting(null)}>
          <div className="space-y-4">
            <p className="text-sm text-gray-700">
              Are you sure you want to delete{" "}
              <span className="font-semibold">
                {deleting.title || "this banner"}
              </span>
              ?
            </p>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleting(null)}
                disabled={deleteLoading}
                className="px-4 py-2 rounded-xl border border-gray-300"
              >
                Cancel
              </button>

              <button
                onClick={confirmDelete}
                disabled={deleteLoading}
                className="px-4 py-2 rounded-xl bg-red-500 text-white disabled:opacity-60"
              >
                {deleteLoading ? "Deleting..." : "Confirm Delete"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

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

function Select({ value, onChange, options, placeholder }: any) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full border border-[#ff7a59] rounded-xl p-3 mt-3"
    >
      <option value="">{placeholder}</option>
      {options.map((o: any) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}