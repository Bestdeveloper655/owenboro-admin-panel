"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  collection,
  getDocs,
  deleteDoc,
  doc,
  addDoc,
  updateDoc,
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

/* TYPES */
type SubCategory = {
  id: string;
  name: string;
  category: string;
  categoryId: string;
  slug: string;
  order: number | null;
  image?: string;
};

type Category = {
  id: string;
  name: string;
  order: number | null;
};

export default function Page() {
  const [subCategories, setSubCategories] = useState<SubCategory[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<SubCategory | null>(null);

  const [btnLoading, setBtnLoading] = useState(false);
  const [formError, setFormError] = useState("");

  const [form, setForm] = useState({
    name: "",
    slug: "",
    categoryId: "",
  });

  const [file, setFile] = useState<File | null>(null);

  const [page, setPage] = useState(1);
  const perPage = 12;

  /* FETCH */
  const fetchData = async () => {
    const catSnap = await getDocs(collection(db, "Catagories"));
    const subSnap = await getDocs(collection(db, "SubCatagories"));

    const cats = sortByOrder(
      catSnap.docs.map((d) => ({
        id: d.id,
        name: d.data().catagoryName,
        order: asOrder(d.data().order),
      })),
      (c) => c.order,
    );
    const catIndex = new Map(cats.map((c, i) => [c.id, i]));

    const subs = subSnap.docs.map((d) => {
      const data = d.data();
      const refId = data.catagoriesRef?.id;
      const cat = cats.find((c) => c.id === refId);

      return {
        id: d.id,
        name: data.name || "Untitled",
        category: cat?.name || "",
        categoryId: refId || "",
        slug: data.slug || "",
        order: asOrder(data.order),
        image: data.image || "",
      };
    });

    // Grouped by category (in category order), then by position inside it.
    setCategories(cats);
    setSubCategories(
      sortByOrder(subs, (s) => s.order).sort(
        (a, b) => (catIndex.get(a.categoryId) ?? 1e9) - (catIndex.get(b.categoryId) ?? 1e9),
      ),
    );
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

  /* `order` is the position among the sub categories of one category. */
  const siblingsOf = (categoryId: string, excludeId?: string) =>
    sortByOrder(
      subCategories.filter((s) => s.categoryId === categoryId && s.id !== excludeId),
      (s) => s.order,
    );

  const validateForm = (isAdding: boolean) => {
    if (!form.name.trim()) return "Sub category name is required.";
    if (!form.categoryId) return "Please select a category.";
    if (!slugify(form.slug || form.name)) return "Please enter a slug using letters or numbers.";
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

  const resetFormState = () => {
    setForm({ name: "", slug: "", categoryId: "" });
    setFile(null);
    setFormError("");
  };

  const closeModal = () => {
    setAdding(false);
    setEditing(null);
    resetFormState();
  };

  /* ADD — appended to the end of its category; reorder in Display Order. */
  const handleAdd = async () => {
    const validationError = validateForm(true);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setBtnLoading(true);

    try {
      setFormError("");

      const imageUrl = await uploadImage();

      await addDoc(collection(db, "SubCatagories"), {
        name: form.name.trim(),
        slug: slugify(form.slug || form.name),
        catagoriesRef: doc(db, "Catagories", form.categoryId),
        order: nextOrder(siblingsOf(form.categoryId).map((s) => s.order)),
        image: imageUrl,
        createdAt: serverTimestamp(),
      });

      await fetchData();
      closeModal();
    } catch (error) {
      console.error(error);
      setFormError("Unable to create the sub category right now. Please try again.");
    } finally {
      setBtnLoading(false);
    }
  };

  /* UPDATE — moving to another category appends it there and closes the gap
   * it leaves behind. */
  const handleUpdate = async () => {
    if (!editing) return;

    const validationError = validateForm(false);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setBtnLoading(true);

    try {
      setFormError("");

      const imageUrl = await uploadImage();
      const movedCategory = editing.categoryId !== form.categoryId;

      let order = editing.order;
      if (movedCategory || order === null) {
        order = nextOrder(siblingsOf(form.categoryId, editing.id).map((s) => s.order));
      }

      await updateDoc(doc(db, "SubCatagories", editing.id), {
        name: form.name.trim(),
        slug: slugify(form.slug || form.name),
        catagoriesRef: doc(db, "Catagories", form.categoryId),
        order,
        image: imageUrl,
      });

      if (editing.image && file && editing.image !== imageUrl) {
        await deleteStorageFileByUrl(editing.image);
      }

      if (movedCategory && editing.categoryId) {
        await writeSequence(
          "SubCatagories",
          siblingsOf(editing.categoryId, editing.id).map((s) => s.id),
        );
      }

      await fetchData();
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

    if (
      !confirm(
        `Delete "${itemToDelete.name}"? Its listings are not deleted, but they will no longer be reachable from this sub category in the app.`,
      )
    )
      return;

    try {
      await deleteDoc(doc(db, "SubCatagories", id));
      await deleteStorageFileByUrl(itemToDelete.image);
      if (itemToDelete.categoryId) {
        await writeSequence(
          "SubCatagories",
          siblingsOf(itemToDelete.categoryId, id).map((s) => s.id),
        );
      }
      await fetchData();
    } catch (error) {
      console.error(error);
      alert("Failed to delete the sub category.");
    }
  };

  /* Rank within the parent category (list is already grouped and sorted). */
  const rankById = useMemo(() => {
    const seen = new Map<string, number>();
    const ranks = new Map<string, number>();
    subCategories.forEach((s) => {
      const n = (seen.get(s.categoryId) ?? 0) + 1;
      seen.set(s.categoryId, n);
      ranks.set(s.id, n);
    });
    return ranks;
  }, [subCategories]);

  const paginatedData = subCategories.slice(
    (page - 1) * perPage,
    page * perPage,
  );

  return (
    <div className="px-2 pt-4 pb-8 sm:px-4 sm:pt-6 sm:pb-10 md:px-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[#ff7a59] sm:text-4xl">
            Sub Categories
          </h1>
          <p className="mt-1 text-sm text-[#e8dcc7]/70">
            Change the order sub categories appear in the app in{" "}
            <Link href="/dashboard/display-order" className="text-[#ff7a59] underline">
              Display Order
            </Link>
            .
          </p>
        </div>

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
                    <th className="p-3">Position</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {paginatedData.map((item) => (
                    <tr
                      key={item.id}
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
                      <td className="p-3">
                        {item.order === null ? (
                          <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                            Hidden in app
                          </span>
                        ) : (
                          rankById.get(item.id)
                        )}
                      </td>

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
                                slug: item.slug,
                                categoryId: item.categoryId,
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
            label="Slug"
            value={form.slug}
            placeholder={slugify(form.name) || "generated from the name"}
            onChange={(v: string) => {
              setForm({ ...form, slug: v });
              setFormError("");
            }}
          />

          <p className="mt-2 text-sm text-[#5f5542]">
            {adding
              ? "New sub categories are added at the end of their category. Reorder them in Display Order."
              : "Moving to another category places it at the end of that category."}
          </p>

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

function Input({ label, value, onChange, placeholder }: any) {
  return (
    <div className="mt-3">
      <label className="text-black font-semibold">{label}</label>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-[#ff7a59] bg-white px-4 py-3 text-black"
      />
    </div>
  );
}