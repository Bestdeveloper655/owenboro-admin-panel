"use client";

import { useEffect, useMemo, useState } from "react";
import { GalleryHorizontalEnd, Plus } from "lucide-react";
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
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
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");

  /* Preview of the picked image file. */
  const fileUrl = useObjectUrl(file);

  /* FETCH */
  useEffect(() => {
    const fetchData = async () => {
      try {
        // No orderBy: it would hide banners without `createdAt`, and those
        // could then never be edited or deleted. Sorted newest-first below.
        const bannerSnap = await getDocs(collection(db, "Banner"));
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
          // The app reads `CatagoryRef` / `SubCatagoryRef`; older panel builds
          // wrote `categoryRef` / `subCategoryRef`.
          const catId = (x.CatagoryRef ?? x.categoryRef)?.id || "";
          const subId = (x.SubCatagoryRef ?? x.subCategoryRef)?.id || "";

          const cat = cats.find((c) => c.id === catId);
          const sub = subs.find((s) => s.id === subId);
          const prod = prods.find((p) => p.id === x.productRef?.id);

          return {
            id: d.id,
            title: x.bannerName || "",
            categoryId: catId,
            subCategoryId: subId,
            productId: x.productRef?.id || "",
            category: cat?.name || "",
            subCategory: sub?.name || "",
            product: prod?.name || "",
            image: x.image || "",
            path: x.path || "",
            createdAt: x.createdAt?.toDate ? x.createdAt.toDate() : null,
          };
        });

        data.sort(
          (a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
        );
        setBanners(data);
        setCategories(cats);
        setSubCategories(subs);
        setProducts(prods);
      } catch (err) {
        console.error(err);
        setListError("Failed to load banners.");
      } finally {
        setListLoading(false);
      }
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

  const deleteImage = (url: string) => deleteStorageFileByUrl(url);

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
        CatagoryRef: form.categoryId
          ? doc(db, "Catagories", form.categoryId)
          : null,
        SubCatagoryRef: form.subCategoryId
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
        CatagoryRef: form.categoryId
          ? doc(db, "Catagories", form.categoryId)
          : null,
        SubCatagoryRef: form.subCategoryId
          ? doc(db, "SubCatagories", form.subCategoryId)
          : null,
        productRef: form.productId ? doc(db, "Products", form.productId) : null,
        image: imageUrl,
        path,
        categoryRef: deleteField(),
        subCategoryRef: deleteField(),
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
    <div>
      <PageHeader
        title="Banner"
        actions={
          <Button variant="outline" icon={Plus} onClick={() => setAdding(true)}>
            Add Banner
          </Button>
        }
      />

      {listError && (
        <Alert className="mb-6" onDismiss={() => setListError("")}>
          {listError}
        </Alert>
      )}

      {/* TABLE */}
      {listLoading ? (
        <LoadingState label="Loading banners…" />
      ) : banners.length === 0 ? (
        <EmptyState icon={GalleryHorizontalEnd} title="No banners yet." />
      ) : (
        <div className={table.wrap}>
          <table className={`${table.table} min-w-[800px]`}>
            <thead className={table.thead}>
              <tr>
                <th className={table.th}>Image</th>
                <th className={table.th}>Title</th>
                <th className={table.th}>Category</th>
                <th className={table.th}>Sub Category</th>
                <th className={table.th}>Listing</th>
                <th className={`${table.th} text-right`}>Actions</th>
              </tr>
            </thead>

            <tbody>
              {banners.map((b) => (
                <tr key={b.id} className={table.row}>
                  <td className={table.td}>
                    {b.image ? (
                      <img src={b.image} alt="" className={table.thumbWide} />
                    ) : (
                      <div className={table.thumbWideEmpty}>No Img</div>
                    )}
                  </td>
                  <td className={table.td}>
                    <TextCell value={b.title} className="font-semibold" />
                  </td>
                  <td className={table.td}>
                    <TextCell value={b.category} />
                  </td>
                  <td className={table.td}>
                    <TextCell value={b.subCategory} />
                  </td>
                  <td className={table.td}>
                    <TextCell value={b.product} />
                  </td>

                  <td className={table.td}>
                    <div className={table.actions}>
                      <Button size="sm" onClick={() => setEditing(b)}>
                        Update
                      </Button>
                      <Button
                          size="sm"
                          variant="danger"
                          onClick={() => {
                            setError("");
                            setDeleting(b);
                          }}
                        >
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

      {/* ADD / EDIT MODAL */}
      {(adding || editing) && (
        <Modal
          title="Banner"
          size="md"
          onClose={closeModal}
          footer={
            <>
              <Button variant="light" onClick={closeModal}>
                Cancel
              </Button>
              <Button onClick={adding ? handleAdd : handleUpdate} loading={loading}>
                {loading ? "Saving…" : "Save"}
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
            onChange={(v: string) => setForm({ ...form, title: v })}
          />

          <Select
            label="Category"
            value={form.categoryId}
            onChange={(v: string) =>
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
            label="Sub Category"
            value={form.subCategoryId}
            onChange={(v: string) =>
              setForm({ ...form, subCategoryId: v, productId: "" })
            }
            options={filteredSubCategories}
            placeholder="Select Sub Category (optional)"
          />

          <Select
            label="Listing"
            value={form.productId}
            onChange={(v: string) => setForm({ ...form, productId: v })}
            options={filteredProducts}
            placeholder="Select Listing (optional)"
          />

          <ImagePicker
            shape="wide"
            label="Image"
            previewUrl={fileUrl || editing?.image || ""}
            note={file?.name}
            onFile={(picked) => setFile(picked)}
          />
        </Modal>
      )}

      {/* DELETE MODAL */}
      {deleting && (
        <Modal
          title="Delete Banner"
          size="sm"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button variant="light" onClick={() => setDeleting(null)} disabled={deleteLoading}>
                Cancel
              </Button>
              <Button variant="danger-solid" onClick={confirmDelete} loading={deleteLoading}>
                {deleteLoading ? "Deleting…" : "Confirm Delete"}
              </Button>
            </>
          }
        >
          {error && (
            <Alert surface="light" className="mb-4">
              {error}
            </Alert>
          )}
          <p>
            Are you sure you want to delete{" "}
            <span className="font-semibold">{deleting.title || "this banner"}</span>?
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
    <span className={cx("block max-w-[220px] truncate", className)} title={value}>
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
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ id: string; name: string }>;
  placeholder: string;
}) {
  return (
    <Field label={label}>
      <SelectInput value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </SelectInput>
    </Field>
  );
}
