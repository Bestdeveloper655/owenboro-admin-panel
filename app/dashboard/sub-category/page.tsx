"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Layers, Plus } from "lucide-react";
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
  SelectInput,
  TextInput,
  table,
} from "@/components/ui";

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
  const perPage = 25;

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

  const totalPages = Math.ceil(subCategories.length / perPage);

  /* Sub categories per category, for the group headings in the table. */
  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    subCategories.forEach((s) => counts.set(s.categoryId, (counts.get(s.categoryId) ?? 0) + 1));
    return counts;
  }, [subCategories]);

  return (
    <div>
      <PageHeader
        title="Sub Categories"
        actions={
          <Button
            variant="outline"
            icon={Plus}
            onClick={() => {
              setAdding(true);
              setEditing(null);
              resetFormState();
            }}
          >
            Add Sub Category
          </Button>
        }
      >
        <p className="mt-1 text-sm text-[#e8dcc7]/70">
          Change the order sub categories appear in the app in{" "}
          <Link href="/dashboard/display-order" className="text-[#ff7a59] underline">
            Display Order
          </Link>
          .
        </p>
      </PageHeader>

      {loading ? (
        <LoadingState label="Loading sub categories…" />
      ) : (
        <>
          {subCategories.length === 0 ? (
            <EmptyState icon={Layers} title="No sub categories found." />
          ) : (
            <div className={table.wrap}>
              <table className={`${table.table} min-w-[600px]`}>
                <thead className={table.thead}>
                  <tr>
                    <th className={table.th}>Image</th>
                    <th className={table.th}>Name</th>
                    <th className={table.th}>Position</th>
                    <th className={`${table.th} text-right`}>Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {paginatedData.map((item, index) => {
                    const prev = paginatedData[index - 1];
                    const startsGroup = !prev || prev.categoryId !== item.categoryId;
                    const groupSize = groupCounts.get(item.categoryId) ?? 0;

                    return (
                      <Fragment key={item.id}>
                        {startsGroup && (
                          <tr className={table.groupRow}>
                            <td colSpan={4} className="px-3 py-1.5">
                              <span className="font-semibold">{item.category || "No category"}</span>
                              <span className="ml-2 text-xs text-black/50">
                                {groupSize} {groupSize === 1 ? "sub category" : "sub categories"}
                              </span>
                            </td>
                          </tr>
                        )}

                        <tr className={table.row}>
                          <td className={table.td}>
                            {item.image ? (
                              <img src={item.image} alt={item.name} className={table.thumb} />
                            ) : (
                              <div className={table.thumbEmpty}>No Img</div>
                            )}
                          </td>

                          <td className={`${table.td} font-semibold`}>{item.name}</td>

                          <td className={table.td}>
                            {item.order === null ? (
                              <Badge tone="amber">Hidden in app</Badge>
                            ) : (
                              <span className="font-semibold tabular-nums text-black/70">
                                #{rankById.get(item.id)}
                              </span>
                            )}
                          </td>

                          <td className={table.td}>
                            <div className={table.actions}>
                              <Button
                                size="sm"
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
                              >
                                Update
                              </Button>

                              <Button
                                size="sm"
                                variant="danger"
                                onClick={() => handleDelete(item.id)}
                              >
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

          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            total={subCategories.length}
            perPage={perPage}
          />
        </>
      )}

      {(adding || editing) && (
        <Modal
          title={adding ? "Add Sub Category" : "Update Sub Category"}
          size="md"
          onClose={closeModal}
          footer={
            <>
              <Button variant="light" onClick={closeModal}>
                Cancel
              </Button>
              <Button onClick={adding ? handleAdd : handleUpdate} loading={btnLoading}>
                {adding ? "Create" : "Update"}
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
            label="Sub Category Name"
            value={form.name}
            onChange={(v: string) => {
              setForm({ ...form, name: v });
              setFormError("");
            }}
          />

          <Field label="Category">
            <SelectInput
              value={form.categoryId}
              onChange={(e) => {
                setForm({ ...form, categoryId: e.target.value });
                setFormError("");
              }}
            >
              <option value="">Select Category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </SelectInput>
          </Field>

          <Input
            label="Slug"
            value={form.slug}
            placeholder={slugify(form.name) || "generated from the name"}
            onChange={(v: string) => {
              setForm({ ...form, slug: v });
              setFormError("");
            }}
          />

          <p className="mt-3 text-sm text-black/60">
            {adding
              ? "New sub categories are added at the end of their category. Reorder them in Display Order."
              : "Moving to another category places it at the end of that category."}
          </p>

          <ImagePicker
            label="Image"
            accept="image/*"
            previewUrl={previewUrl}
            note={
              file
                ? file.name
                : editing?.image
                  ? "Current image will stay unless you choose a new one."
                  : "Upload an image for this sub category."
            }
            onFile={(picked) => {
              setFile(picked);
              setFormError("");
            }}
          />
        </Modal>
      )}
    </div>
  );
}

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
