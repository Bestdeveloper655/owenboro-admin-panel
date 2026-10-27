"use client";

import { useEffect, useMemo, useState } from "react";
import { MessageSquareOff, Star, Trash2 } from "lucide-react";
import {
  collection,
  collectionGroup,
  deleteDoc,
  getDocs,
  onSnapshot,
  type DocumentData,
  type DocumentReference,
} from "firebase/firestore";
import { db } from "@/lib/firebaseServices";
import {
  Alert,
  Button,
  EmptyState,
  LoadingState,
  PageHeader,
  Pagination,
  SearchInput,
  Segmented,
  Toolbar,
  table,
} from "@/components/ui";

/*
 * Every listing review in one place (client request, Oct 2026). The app saves
 * reviews under each listing (Products/{id}/Reviews/{id}); this reads them all
 * with one collection-group listener, newest first, and lets staff delete any
 * of them. Sorted here rather than in the query, so no collection-group index
 * is needed.
 */

const PER_PAGE = 25;

type Review = {
  id: string;
  ref: DocumentReference;
  listingId: string;
  userName: string;
  text: string;
  rating: number;
  createdAt: Date | null;
};

type Filter = "all" | "low" | "high";

function readReview(ref: DocumentReference, data: DocumentData): Review {
  return {
    id: ref.path,
    ref,
    listingId: ref.parent.parent?.id ?? "",
    userName: typeof data.userName === "string" ? data.userName : "",
    text: typeof data.review === "string" ? data.review : "",
    rating: Number(data.rating) || 0,
    createdAt: data.createdAt?.toDate?.() ?? null,
  };
}

const formatDate = (d: Date | null) =>
  d
    ? d.toLocaleString("en-US", {
        timeZone: "America/Chicago",
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "";

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={rating ? `${rating} out of 5` : "No rating"}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={n <= Math.round(rating) ? "h-3.5 w-3.5 fill-amber-500 text-amber-500" : "h-3.5 w-3.5 text-black/20"}
          aria-hidden
        />
      ))}
    </span>
  );
}

export default function ReviewsPage() {
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [listingNames, setListingNames] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(
    () =>
      onSnapshot(
        collectionGroup(db, "Reviews"),
        (snap) =>
          setReviews(
            snap.docs
              // Only listing reviews (Products/{id}/Reviews).
              .filter((d) => d.ref.parent.parent?.parent.id === "Products")
              .map((d) => readReview(d.ref, d.data()))
              .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)),
          ),
        () => setError("Couldn't load the reviews."),
      ),
    [],
  );

  // Listing names for the "Listing" column, read once.
  useEffect(() => {
    getDocs(collection(db, "Products"))
      .then((snap) =>
        setListingNames(
          Object.fromEntries(snap.docs.map((d) => [d.id, String(d.data().productName ?? "")])),
        ),
      )
      .catch(() => {});
  }, []);

  const counts = useMemo(() => {
    const list = reviews ?? [];
    return {
      all: list.length,
      low: list.filter((r) => r.rating > 0 && r.rating <= 2).length,
      high: list.filter((r) => r.rating >= 4).length,
    };
  }, [reviews]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (reviews ?? []).filter((r) => {
      if (filter === "low" && !(r.rating > 0 && r.rating <= 2)) return false;
      if (filter === "high" && r.rating < 4) return false;
      if (!q) return true;
      return [r.userName, r.text, listingNames[r.listingId] ?? ""].some((v) => v.toLowerCase().includes(q));
    });
  }, [reviews, filter, search, listingNames]);

  const totalPages = Math.max(1, Math.ceil(visible.length / PER_PAGE));
  const current = Math.min(page, totalPages);
  const shown = visible.slice((current - 1) * PER_PAGE, current * PER_PAGE);

  const remove = async (review: Review) => {
    const listing = listingNames[review.listingId] || "this listing";
    if (!window.confirm(`Delete ${review.userName || "this"}'s review of ${listing}? It is removed from the app straight away.`)) {
      return;
    }
    setBusyId(review.id);
    setError("");
    try {
      await deleteDoc(review.ref);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      setError(code === "permission-denied" ? "Only admins can delete reviews." : "Couldn't delete the review.");
    } finally {
      setBusyId(null);
    }
  };

  if (!reviews) return <LoadingState label="Loading reviews…" />;

  return (
    <div>
      <PageHeader
        title="Reviews"
        description="Every review people have left on listings, newest first. Delete any that are rude, fake or off-topic; they disappear from the app straight away."
      />

      {error && (
        <Alert className="mb-4" onDismiss={() => setError("")}>
          {error}
        </Alert>
      )}

      <Toolbar>
        <Segmented<Filter>
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setPage(1);
          }}
          options={[
            { value: "all", label: "All", count: counts.all },
            { value: "low", label: "1–2 stars", count: counts.low },
            { value: "high", label: "4–5 stars", count: counts.high },
          ]}
        />
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Search name, review or listing…"
        />
      </Toolbar>

      {shown.length === 0 ? (
        <EmptyState
          icon={MessageSquareOff}
          title={reviews.length === 0 ? "No reviews yet" : "No reviews match"}
          description={
            reviews.length === 0
              ? "Reviews appear here as soon as people leave them on a listing."
              : "Try a different search or filter."
          }
        />
      ) : (
        <>
          <div className={table.wrap}>
            <table className={`${table.table} min-w-[820px]`}>
              <thead className={table.thead}>
                <tr>
                  <th className={table.th}>Review</th>
                  <th className={table.th}>Listing</th>
                  <th className={table.th}>By</th>
                  <th className={table.th}>Date</th>
                  <th className={`${table.th} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className={table.row}>
                    <td className={`${table.td} max-w-[420px] py-2.5`}>
                      <Stars rating={r.rating} />
                      <p className="mt-1 text-[13px] leading-snug whitespace-pre-wrap text-black">
                        {r.text || <span className="text-black/40">(no text)</span>}
                      </p>
                    </td>
                    <td className={`${table.td} font-medium`}>
                      {listingNames[r.listingId] || <span className="text-black/40">Deleted listing</span>}
                    </td>
                    <td className={table.td}>{r.userName || "Someone"}</td>
                    <td className={`${table.td} whitespace-nowrap text-black/60`}>{formatDate(r.createdAt)}</td>
                    <td className={table.td}>
                      <div className={table.actions}>
                        <Button
                          size="sm"
                          variant="danger"
                          icon={Trash2}
                          loading={busyId === r.id}
                          onClick={() => remove(r)}
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
          <Pagination
            className="mt-4"
            page={current}
            totalPages={totalPages}
            onPageChange={setPage}
            total={visible.length}
            perPage={PER_PAGE}
          />
        </>
      )}
    </div>
  );
}
