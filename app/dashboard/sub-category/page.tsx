"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  deleteDoc,
  doc,
  addDoc,
  updateDoc,
} from "firebase/firestore";
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import { db, storage } from "@/lib/firebaseServices";

/* TYPES */
type SubCategory = {
  id: string;
  name: string;
  category: string;
  categoryId: string;
  order?: number;
  image?: string;
};

type Category = {
  id: string;
  name: string;
};

export default function Page() {
  const [subCategories, setSubCategories] = useState<SubCategory[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<SubCategory | null>(null);
  const [dragged, setDragged] = useState<SubCategory | null>(null);

  const [btnLoading, setBtnLoading] = useState(false);
  const [formError, setFormError] = useState("");

  const [form, setForm] = useState({
    name: "",
    categoryId: "",
    order: "",
  });

  const [file, setFile] = useState<File | null>(null);

  const [page, setPage] = useState(1);
  const perPage = 12;

  /* FETCH */
  const fetchData = async () => {
    const catSnap = await getDocs(collection(db, "Catagories"));
    const subSnap = await getDocs(collection(db, "SubCatagories"));

    const cats = catSnap.docs.map((d) => ({
      id: d.id,
      name: d.data().catagoryName,
    }));

    const subs = subSnap.docs.map((d) => {
      const data = d.data();
      const refId = data.catagoriesRef?.id;
      const cat = cats.find((c) => c.id === refId);

      return {
        id: d.id,
        name: data.name || "Untitled",
        category: cat?.name || "",
        categoryId: refId,
        order: data.order ?? 999,
        image: data.image || "",
      };
    });

    setCategories(cats);
    setSubCategories(subs.sort((a, b) => (a.order ?? 999) - (b.order ?? 999)));
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  /* HELPERS */
  const previewUrl = useMemo(() => {
    if (file) {
      return URL.createObjectURL(file);
    }
    if (editing?.image) {
      return editing.image;
    }
    return "";
  }, [file, editing]);

  useEffect(() => {
    return () => {
      if (file && previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [file, previewUrl]);

  const normalizeOrders = (items: SubCategory[]) =>
    [...items]
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
      .map((item, index) => ({
        ...item,
        order: index + 1,
      }));

  const insertSubCategoryAtOrder = (
    currentSubCategories: SubCategory[],
    item: SubCategory,
    targetOrder: number,
  ) => {
    const withoutItem = currentSubCategories.filter((s) => s.id !== item.id);
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

  const validateAddOrder = (order: number) => {
    if (!Number.isInteger(order) || order < 1) {
      return "Display order must be a positive whole number.";
    }

    if (order > subCategories.length + 1) {
      return `Display order must be between 1 and ${subCategories.length + 1}.`;
    }

    const existing = subCategories.find((item) => item.order === order);
    if (existing) {
      return `Display order ${order} is already assigned to "${existing.name}". Please choose a different order number.`;
    }

    return "";
  };

  const validateUpdateOrder = (order: number) => {
    if (!Number.isInteger(order) || order < 1) {
      return "Display order must be a positive whole number.";
    }

    if (order > subCategories.length) {
      return `Display order must be between 1 and ${subCategories.length}.`;
    }

    return "";
  };

  const validateForm = (isAdding: boolean) => {
    if (!form.name.trim()) return "Sub category name is required.";
    if (!form.categoryId) return "Please select a category.";
    if (!form.order) return "Display order is required.";

    const orderNum = Number(form.order);

    const orderError = isAdding
      ? validateAddOrder(orderNum)
      : validateUpdateOrder(orderNum);

    if (orderError) return orderError;

    if (isAdding && !file) {
      return "Please upload an image for the sub category.";
    }

    return "";
  };

  const uploadImage = async () => {
    if (!file) return editing?.image || "";

    const storageRef = ref(storage, `subcategory/${Date.now()}-${file.name}`);
    await uploadBytes(storageRef, file);
    return await getDownloadURL(storageRef);
  };

  const safelyDeleteImageByUrl = async (url?: string) => {
    if (!url) return;
    try {
      const decoded = decodeURIComponent(url);
      const path = decoded.split("/o/")[1]?.split("?")[0];
      if (!path) return;
      await deleteObject(ref(storage, path));
    } catch (error) {
      console.error("Image delete skipped/failed:", error);
    }
  };

  const resetFormState = () => {
    setForm({ name: "", categoryId: "", order: "" });
    setFile(null);
    setFormError("");
  };

  const closeModal = () => {
    setAdding(false);
    setEditing(null);
    resetFormState();
  };

  /* ADD */
  const handleAdd = async () => {
    const validationError = validateForm(true);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    const orderNum = Number(form.order);

    setBtnLoading(true);

    try {
      setFormError("");

      const categoryRef = doc(db, "Catagories", form.categoryId);
      const imageUrl = await uploadImage();

      const newDocRef = await addDoc(collection(db, "SubCatagories"), {
        name: form.name,
        catagoriesRef: categoryRef,
        createdAt: new Date(),
        order: orderNum,
        image: imageUrl,
      });

      const cat = categories.find((c) => c.id === form.categoryId);

      const newItem: SubCategory = {
        id: newDocRef.id,
        name: form.name,
        category: cat?.name || "",
        categoryId: form.categoryId,
        order: orderNum,
        image: imageUrl,
      };

      const reordered = insertSubCategoryAtOrder(
        subCategories,
        newItem,
        orderNum,
      );

      setSubCategories(reordered);

      await Promise.all(
        reordered.map((item) =>
          updateDoc(doc(db, "SubCatagories", item.id), {
            order: item.order,
          }),
        ),
      );

      closeModal();
    } catch (error) {
      console.error(error);
      setFormError("Unable to create the sub category right now. Please try again.");
    } finally {
      setBtnLoading(false);
    }
  };

  /* UPDATE */
  const handleUpdate = async () => {
    if (!editing) return;

    const validationError = validateForm(false);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    const orderNum = Number(form.order);

    setBtnLoading(true);

    try {
      setFormError("");

      const categoryRef = doc(db, "Catagories", form.categoryId);
      const imageUrl = await uploadImage();
      const cat = categories.find((c) => c.id === form.categoryId);

      const updatedItem: SubCategory = {
        ...editing,
        name: form.name,
        category: cat?.name || "",
        categoryId: form.categoryId,
        order: orderNum,
        image: imageUrl,
      };

      const reordered = insertSubCategoryAtOrder(
        subCategories,
        updatedItem,
        orderNum,
      );

      setSubCategories(reordered);

      await Promise.all(
        reordered
          .filter((item) => item.id !== editing.id)
          .map((item) =>
            updateDoc(doc(db, "SubCatagories", item.id), {
              order: item.order,
            }),
          ),
      );

      if (editing.image && file && editing.image !== imageUrl) {
        await safelyDeleteImageByUrl(editing.image);
      }

      await updateDoc(doc(db, "SubCatagories", editing.id), {
        name: form.name,
        catagoriesRef: categoryRef,
        order: orderNum,
        image: imageUrl,
      });

      closeModal();
    } catch (error) {
      console.error(error);
      setFormError("Unable to update the sub category right now. Please try again.");
    } finally {
      setBtnLoading(false);
    }
  };

  /* DELETE */
  const handleDelete = async (id: string) => {
    const itemToDelete = subCategories.find((item) => item.id === id);
    if (!itemToDelete) return;

    if (!confirm("Delete this sub category?")) return;

    await deleteDoc(doc(db, "SubCatagories", id));

    if (itemToDelete.image) {
      await safelyDeleteImageByUrl(itemToDelete.image);
    }

    const remaining = subCategories.filter((item) => item.id !== id);
    const reordered = remaining.map((item, index) => ({
      ...item,
      order: index + 1,
    }));

    setSubCategories(reordered);

    await Promise.all(
      reordered.map((item) =>
        updateDoc(doc(db, "SubCatagories", item.id), {
          order: item.order,
        }),
      ),
    );
  };

  const paginatedData = subCategories.slice(
    (page - 1) * perPage,
    page * perPage,
  );

  return (
    <div className="px-2 pt-4 pb-8 sm:px-4 sm:pt-6 sm:pb-10 md:px-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <h1 className="text-3xl font-bold text-[#ff7a59] sm:text-4xl">
          Sub Categories
        </h1>

        <button
          onClick={() => {
            setAdding(true);
            setEditing(null);
            resetFormState();
          }}
          className="inline-flex h-11 items-center justify-center rounded-xl border border-[#ff7a59] px-5 text-sm font-semibold text-[#ff7a59] hover:bg-[#ff7a59] hover:text-white"
        >
          Add Sub Category
        </button>
      </div>

      <section className="mt-8 rounded-[28px] border border-[#ff7a59]/70 bg-[#0a0a0a] p-5 md:p-6">
        {loading ? (
          <p className="text-[#f3ead7]">Loading...</p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-2xl border border-white/10">
              <table className="w-full min-w-[700px] text-left">
                <thead className="bg-[#ece2cb] text-black">
                  <tr>
                    <th className="p-3">Image</th>
                    <th className="p-3">Name</th>
                    <th className="p-3">Category</th>
                    <th className="p-3">Order</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {paginatedData.map((item) => (
                    <tr
                      key={item.id}
                      draggable
                      onDragStart={() => setDragged(item)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={async () => {
                        if (!dragged || dragged.id === item.id) return;

                        const updated = [...subCategories];
                        const from = updated.findIndex((i) => i.id === dragged.id);
                        const to = updated.findIndex((i) => i.id === item.id);

                        const [moved] = updated.splice(from, 1);
                        updated.splice(to, 0, moved);

                        const reordered = updated.map((it, index) => ({
                          ...it,
                          order: index + 1,
                        }));

                        setSubCategories(reordered);

                        await Promise.all(
                          reordered.map((it) =>
                            updateDoc(doc(db, "SubCatagories", it.id), {
                              order: it.order,
                            }),
                          ),
                        );
                      }}
                      className="border-b border-white/10 bg-[#ece2cb] text-black hover:bg-[#f5ecd7]"
                    >
                      <td className="p-3">
                        {item.image ? (
                          <img
                            src={item.image}
                            alt={item.name}
                            className="h-12 w-12 rounded-lg object-cover"
                          />
                        ) : (
                          <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-black/10 bg-black/5 text-[10px] text-black/35">
                            No Img
                          </div>
                        )}
                      </td>

                      <td className="p-3 font-semibold">{item.name}</td>
                      <td className="p-3 text-black/60">{item.category}</td>
                      <td className="p-3">{item.order}</td>

                      <td className="p-3">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => {
                              setEditing(item);
                              setAdding(false);
                              setFile(null);
                              setFormError("");
                              setForm({
                                name: item.name,
                                categoryId: item.categoryId,
                                order: String(item.order || ""),
                              });
                            }}
                            className="rounded-lg bg-[#ff7a59] px-3 py-1 text-xs text-white"
                          >
                            Update
                          </button>

                          <button
                            onClick={() => handleDelete(item.id)}
                            className="rounded-lg border border-red-400 px-3 py-1 text-xs text-red-500 hover:bg-red-500 hover:text-white"
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

            <Pagination total={subCategories.length} page={page} setPage={setPage} />
          </>
        )}
      </section>

      {(adding || editing) && (
        <Modal
          title={adding ? "Add Sub Category" : "Update Sub Category"}
          onClose={closeModal}
        >
          <Input
            label="Sub Category Name"
            value={form.name}
            onChange={(v: string) => {
              setForm({ ...form, name: v });
              setFormError("");
            }}
          />

          <div className="mt-3">
            <label className="text-black font-semibold">Category</label>
            <select
              value={form.categoryId}
              onChange={(e) => {
                setForm({ ...form, categoryId: e.target.value });
                setFormError("");
              }}
              className="mt-1 w-full rounded-xl border border-[#ff7a59] bg-white px-4 py-3 text-black"
            >
              <option value="">Select Category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

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
              Changing the display order will automatically shift the other sub categories.
            </p>
          )}

          <div className="mt-4">
            <label className="text-black font-semibold">Image</label>

            <div className="mt-2 rounded-xl border border-[#ff7a59] bg-white p-3">
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg border border-[#ff7a59]/30 bg-[#f7f1e4]">
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt="Preview"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-[10px] text-black/40">No image</span>
                  )}
                </div>

                <div className="flex-1">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      setFile(e.target.files?.[0] || null);
                      setFormError("");
                    }}
                    className="w-full text-sm text-black"
                  />
                  <p className="mt-2 text-xs text-black/50">
                    {file
                      ? file.name
                      : editing?.image
                        ? "Current image will stay unless you choose a new one."
                        : "Upload an image for this sub category."}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {formError && (
            <div className="mt-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
              {formError}
            </div>
          )}

          <button
            onClick={adding ? handleAdd : handleUpdate}
            disabled={btnLoading}
            className="mt-6 w-full rounded-xl bg-[#ff7a59] py-3 text-white flex items-center justify-center"
          >
            {btnLoading ? (
              <span className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" />
            ) : adding ? (
              "Create"
            ) : (
              "Update"
            )}
          </button>
        </Modal>
      )}
    </div>
  );
}

function Modal({ children, title, onClose }: any) {
  return (
    <div className="fixed inset-0 bg-black/70 flex justify-center items-center">
      <div className="bg-[#e8dcc7] p-6 rounded-3xl w-[90%] max-w-lg">
        <div className="flex justify-between mb-4">
          <h2 className="text-xl font-bold text-[#ff7a59]">{title}</h2>
          <button onClick={onClose}>✖</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Pagination({ total, page, setPage }: any) {
  const perPage = 12;
  const totalPages = Math.ceil(total / perPage);

  return (
    <div className="mt-6 flex justify-between text-[#f3ead7]">
      <p>
        Showing {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} of {total}
      </p>

      <div className="flex gap-2">
        <button
          disabled={page === 1}
          onClick={() => setPage(page - 1)}
          className="opacity-70 disabled:opacity-30"
        >
          Previous
        </button>

        <button
          disabled={page === totalPages}
          onClick={() => setPage(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

function Input({ label, value, onChange }: any) {
  return (
    <div className="mt-3">
      <label className="text-black font-semibold">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-[#ff7a59] bg-white px-4 py-3 text-black"
      />
    </div>
  );
}