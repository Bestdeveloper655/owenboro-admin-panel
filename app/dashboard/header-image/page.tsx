"use client";

import { useEffect, useMemo, useState } from "react";
import { Images, Plus } from "lucide-react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  updateDoc,
} from "firebase/firestore";
import {
  getDownloadURL,
  ref,
  uploadBytes,
} from "firebase/storage";

import { db, storage } from "@/lib/firebaseServices";
import { deleteStorageFileByUrl } from "@/lib/adminData";
import {
  Alert,
  Button,
  EmptyState,
  Field,
  ImagePicker,
  LoadingState,
  Modal,
  PageHeader,
  SelectInput,
  TextInput,
  cx,
  table,
  useObjectUrl,
} from "@/components/ui";

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

  /* Preview of the picked image file. */
  const fileUrl = useObjectUrl(file);

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

  const deleteImageByUrl = (url?: string) => deleteStorageFileByUrl(url);

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
    <div>
      <PageHeader
        title="Header Images"
        actions={
          <Button
            variant="outline"
            icon={Plus}
            onClick={() => {
              setEditing(null);
              setForm(EMPTY_FORM);
              setFile(null);
              setError("");
              setAdding(true);
            }}
          >
            Add Header Image
          </Button>
        }
      />

      {error && !adding && !editing && (
        <Alert className="mb-6" onDismiss={() => setError("")}>
          {error}
        </Alert>
      )}

      {pageLoading ? (
        <LoadingState label="Loading header images…" />
      ) : items.length === 0 ? (
        <EmptyState icon={Images} title="No header images found." />
      ) : (
        <div className={table.wrap}>
          <table className={`${table.table} min-w-[700px]`}>
            <thead className={table.thead}>
              <tr>
                <th className={table.th}>Image</th>
                <th className={table.th}>Title</th>
                <th className={table.th}>Sub Category</th>
                <th className={table.th}>Listing</th>
                <th className={`${table.th} text-right`}>Actions</th>
              </tr>
            </thead>

            <tbody>
              {items.map((item) => (
                <tr key={item.id} className={table.row}>
                  <td className={table.td}>
                    {item.image ? (
                      <img src={item.image} alt={item.title} className={table.thumbWide} />
                    ) : (
                      <div className={table.thumbWideEmpty}>No Img</div>
                    )}
                  </td>

                  <td className={table.td}>
                    <TextCell value={item.title} className="font-semibold" />
                  </td>
                  <td className={table.td}>
                    <TextCell value={item.subCategoryName || ""} />
                  </td>
                  <td className={table.td}>
                    <TextCell value={item.productName || ""} />
                  </td>

                  <td className={table.td}>
                    <div className={table.actions}>
                      <Button size="sm" onClick={() => setEditing(item)}>
                        Update
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => setDeleting(item)}>
                        Delete
                      </Button>
                    </div>
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
          size="md"
          onClose={closeModal}
          footer={
            <>
              <Button variant="light" onClick={closeModal}>
                Cancel
              </Button>
              <Button onClick={adding ? handleAdd : handleUpdate} loading={loading}>
                {loading ? "Saving…" : adding ? "Save Header Image" : "Update Header Image"}
              </Button>
            </>
          }
        >
          {error && (
            <Alert surface="light" className="mb-4">
              {error}
            </Alert>
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
            label="Sub Category"
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

          <ImagePicker
            shape="wide"
            label="Image"
            accept="image/*"
            previewUrl={fileUrl || editing?.image || ""}
            note={file ? file.name : editing?.image ? "Current image" : undefined}
            onFile={(picked) => setFile(picked)}
          />
        </Modal>
      )}

      {deleting && (
        <Modal
          title="Delete"
          size="sm"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button variant="light" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button variant="danger-solid" onClick={confirmDelete}>
                Delete
              </Button>
            </>
          }
        >
          <p>
            Are you sure you want to delete{" "}
            <span className="font-semibold">{deleting.title}</span>?
          </p>
        </Modal>
      )}
    </div>
  );
}

/* UI */

/* Table text that truncates long values and shows a dash when empty. */
function TextCell({ value, className }: { value: string; className?: string }) {
  if (!value) return <span className="text-black/35">—</span>;
  return (
    <span className={cx("block max-w-[240px] truncate", className)} title={value}>
      {value}
    </span>
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
    <Field label={label}>
      <TextInput value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
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
    <Field label={label}>
      <SelectInput value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </SelectInput>
    </Field>
  );
}
