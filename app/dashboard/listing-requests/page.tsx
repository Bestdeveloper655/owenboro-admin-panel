"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PhotoCarousel from "@/components/PhotoCarousel";
import {
  AlertTriangle,
  Check,
  ClipboardList,
  ExternalLink,
  PencilLine,
  RefreshCw,
  X,
} from "lucide-react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type DocumentReference,
  type Timestamp,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebaseServices";
import { authedFetch } from "@/lib/authedFetch";
import { deleteStorageFileByUrl, nextOrder } from "@/lib/adminData";
import {
  compactListingGroup,
  fetchListingGroup,
  listingContent,
  listingGroupKey,
  listingImages,
  listingPayload,
} from "@/lib/products";
import { hasHours, parseOpeningHours, type OpeningHours } from "@/lib/openingHours";
import { OpeningHoursWeek } from "@/components/OpeningHoursEditor";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Field,
  LoadingState,
  Modal,
  PageHeader,
  Segmented,
  TextArea,
  type BadgeTone,
} from "@/components/ui";

/*
 * Listings people suggested from the app's "+" button (Oct 2026). Approving
 * one creates the Products doc exactly like the Listings page's "Add" (same
 * fields, added at the end of its sub category) and marks the request
 * approved in the same batch; rejecting records a reason the user sees. Both
 * notify the user (in-app + push) through /api/admin/listing-requests/notify.
 *
 * Users can edit a request from the app at any stage: it goes back to
 * pending, loses its rejection reason, and keeps its `productRef`. A pending
 * request with a `productRef` is therefore an update to a live listing, and
 * approving it updates that Products doc in place (its position, Recommended
 * state and reviews are kept). The admin's write to the request may only
 * touch status, rejectionReason, reviewedAt, reviewedBy, productRef and
 * updatedAt (Firestore rules).
 */

type Status = "pending" | "approved" | "rejected";

type ListingRequest = {
  id: string;
  status: Status;
  submittedBy: string;
  submitterName: string;
  submitterEmail: string;
  title: string;
  shortDescription: string;
  about: string;
  time: string;
  openingHours: OpeningHours;
  location: string;
  locationUrl: string;
  phone: string;
  email: string;
  websiteUrl: string;
  facebookUrl: string;
  startTimeString: string;
  endTimeString: string;
  startTime: Timestamp | null;
  lastTime: Timestamp | null;
  categoryId: string;
  subCategoryId: string;
  categoryName: string;
  subCategoryName: string;
  /* Cover first; `imageUrl` alone on requests sent before multiple photos. */
  images: string[];
  rejectionReason: string;
  productRef: DocumentReference | null;
  createdAt: Date | null;
  reviewedAt: Date | null;
  /* Set by the user's edits and by the admin's decision. */
  updatedAt: Date | null;
};

const STATUS_TONE: Record<Status, BadgeTone> = {
  pending: "amber",
  approved: "green",
  rejected: "red",
};

const STATUS_LABEL: Record<Status, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

function readRequest(id: string, d: DocumentData): ListingRequest {
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  const ts = (v: unknown) => (v && typeof v === "object" && "toDate" in v ? (v as Timestamp) : null);
  const status: Status =
    d.status === "approved" || d.status === "rejected" ? d.status : "pending";
  return {
    id,
    status,
    submittedBy: text(d.submittedBy),
    submitterName: text(d.submitterName),
    submitterEmail: text(d.submitterEmail),
    title: text(d.title),
    shortDescription: text(d.shortDescription),
    about: text(d.about),
    time: text(d.time),
    openingHours: parseOpeningHours(d.openingHours),
    location: text(d.location),
    locationUrl: text(d.locationUrl),
    phone: text(d.phone),
    email: text(d.email),
    websiteUrl: text(d.websiteUrl),
    facebookUrl: text(d.facebookUrl),
    startTimeString: text(d.startTimeString),
    endTimeString: text(d.endTimeString),
    startTime: ts(d.startTime),
    lastTime: ts(d.lastTime),
    categoryId: (d.categoryRef as DocumentReference | undefined)?.id ?? "",
    subCategoryId: (d.subCategoryRef as DocumentReference | null | undefined)?.id ?? "",
    categoryName: text(d.categoryName),
    subCategoryName: text(d.subCategoryName),
    images: listingImages(d),
    rejectionReason: text(d.rejectionReason),
    productRef: (d.productRef as DocumentReference | undefined) ?? null,
    createdAt: ts(d.createdAt)?.toDate() ?? null,
    reviewedAt: ts(d.reviewedAt)?.toDate() ?? null,
    updatedAt: ts(d.updatedAt)?.toDate() ?? null,
  };
}

/* A pending edit of a request that is already a live listing. */
const isLiveUpdate = (r: ListingRequest) => r.status === "pending" && r.productRef !== null;

/* A pending request the user edited before anyone reviewed it. */
const isEditedPending = (r: ListingRequest) =>
  r.status === "pending" && r.productRef === null && r.updatedAt !== null;

const LIVE_UPDATE_HINT =
  "Was live — the user updated it. Approving updates the live listing; it stays as-is until then.";

const formatDate = (d: Date | null) =>
  d
    ? d.toLocaleString("en-US", {
        timeZone: "America/Chicago",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

const placement = (r: ListingRequest) =>
  r.subCategoryName ? `${r.categoryName} › ${r.subCategoryName}` : r.categoryName;

function describeError(err: unknown, fallback: string) {
  const { code, message } = (err ?? {}) as { code?: string; message?: string };
  if (code === "permission-denied") return "Only admins can review listing requests.";
  return message || fallback;
}

/* Problems that stop a request becoming a listing as submitted. */
async function placementProblem(r: ListingRequest): Promise<string | null> {
  const cat = await getDoc(doc(db, "Catagories", r.categoryId));
  if (!cat.exists()) return "Its category no longer exists. Reject it, or ask the user to send it again.";
  if (r.subCategoryId) {
    const sub = await getDoc(doc(db, "SubCatagories", r.subCategoryId));
    const parent = (sub.data()?.catagoriesRef as DocumentReference | undefined)?.id;
    if (!sub.exists() || parent !== r.categoryId) {
      return "Its sub category no longer exists in that category.";
    }
    return null;
  }
  const subs = await getDocs(
    query(
      collection(db, "SubCatagories"),
      where("catagoriesRef", "==", doc(db, "Catagories", r.categoryId)),
      limit(1),
    ),
  );
  return subs.empty
    ? null
    : "Its category now has sub categories, and the app only lists listings inside one.";
}

/* `update`: the decision was on an edit of a live listing. */
async function notify(requestId: string, update: boolean) {
  try {
    await authedFetch("/api/admin/listing-requests/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, update }),
    });
  } catch (err) {
    // Best effort: the decision itself is already saved.
    console.error("Listing request notification failed:", err);
  }
}

export default function ListingRequestsPage() {
  const [requests, setRequests] = useState<ListingRequest[] | null>(null);
  const [tab, setTab] = useState<Status>("pending");
  const [open, setOpen] = useState<ListingRequest | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  /* Bumped by "Try again" to subscribe afresh after a failed load. */
  const [attempt, setAttempt] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, "listing_requests"), orderBy("createdAt", "desc")),
        (snap) => {
          setLoadFailed(false);
          setRequests(snap.docs.map((d) => readRequest(d.id, d.data())));
        },
        (err) => {
          console.error("Listing requests failed to load:", err);
          setLoadFailed(true);
        },
      ),
    [attempt],
  );

  const counts = useMemo(() => {
    const c: Record<Status, number> = { pending: 0, approved: 0, rejected: 0 };
    for (const r of requests ?? []) c[r.status]++;
    return c;
  }, [requests]);

  const shown = (requests ?? []).filter((r) => r.status === tab);

  const close = () => {
    if (busy) return;
    setOpen(null);
    setRejecting(false);
    setReason("");
    setError("");
  };

  const approve = async (r: ListingRequest) => {
    setBusy(true);
    setError("");
    try {
      const problem = await placementProblem(r);
      if (problem) {
        setError(problem);
        return;
      }

      const requestRef = doc(db, "listing_requests", r.id);
      const decision = {
        status: "approved",
        reviewedAt: serverTimestamp(),
        reviewedBy: auth.currentUser?.uid ?? "",
        updatedAt: serverTimestamp(),
      };
      // An edit of a live listing updates it, unless the listing was deleted
      // since; then the request becomes a new listing like a first one.
      const live = r.productRef ? await getDoc(r.productRef) : null;
      const batch = writeBatch(db);
      let leftGroup: { categoryId: string; subCategoryId: string } | null = null;
      let oldImages: string[] = [];

      if (live?.exists()) {
        const x = live.data();
        const oldCat = (x.catagoryRef as DocumentReference | undefined)?.id ?? "";
        const oldSub = (x.subCatagoryRef as DocumentReference | null | undefined)?.id ?? "";
        oldImages = [...new Set([...listingImages(x), x.image, x.imageUrl])].filter(
          (u): u is string => typeof u === "string" && u !== "",
        );
        // Its position, Recommended state, created_time and reviews stay; only
        // a move to another (sub) category takes the next slot there.
        const extra: { order?: number } = {};
        if (listingGroupKey(oldCat, oldSub) !== listingGroupKey(r.categoryId, r.subCategoryId)) {
          const group = await fetchListingGroup(r.categoryId, r.subCategoryId);
          extra.order = nextOrder(group.filter((g) => g.id !== live.id).map((g) => g.order));
          leftGroup = { categoryId: oldCat, subCategoryId: oldSub };
        }
        batch.update(live.ref, { ...listingContent(r, r.images), ...extra });
        batch.update(requestRef, decision);
      } else {
        const group = await fetchListingGroup(r.categoryId, r.subCategoryId);
        const productRef = doc(collection(db, "Products"));
        batch.set(productRef, {
          ...listingPayload(
            { ...r, recommended: false },
            r.images,
            nextOrder(group.map((g) => g.order)),
            null,
          ),
          created_time: serverTimestamp(),
          productRef,
        });
        batch.update(requestRef, { ...decision, productRef });
      }
      await batch.commit();

      const updated = !!live?.exists();
      if (live && leftGroup) {
        await compactListingGroup(leftGroup.categoryId, leftGroup.subCategoryId, live.id);
      }
      // Photos the user took out stayed while the old version was live.
      await Promise.all(
        oldImages.filter((u) => !r.images.includes(u)).map((u) => deleteStorageFileByUrl(u)),
      );

      await notify(r.id, updated);
      setNotice(
        updated
          ? `"${r.title}" was updated in the app.`
          : `"${r.title}" is now live in ${placement(r)}.`,
      );
      setOpen(null);
    } catch (err) {
      setError(describeError(err, "Couldn't approve this listing."));
    } finally {
      setBusy(false);
    }
  };

  const reject = async (r: ListingRequest) => {
    setBusy(true);
    setError("");
    try {
      await updateDoc(doc(db, "listing_requests", r.id), {
        status: "rejected",
        rejectionReason: reason.trim(),
        reviewedAt: serverTimestamp(),
        reviewedBy: auth.currentUser?.uid ?? "",
        updatedAt: serverTimestamp(),
      });
      await notify(r.id, r.productRef !== null);
      setNotice(
        r.productRef
          ? `The update to "${r.title}" was rejected. The live listing is unchanged and the user has been told.`
          : `"${r.title}" was rejected. The user has been told.`,
      );
      setOpen(null);
      setRejecting(false);
      setReason("");
    } catch (err) {
      setError(describeError(err, "Couldn't reject this listing."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Listing Requests"
        description="Events and businesses people suggested from the app. Approving one adds it to the end of its sub category, just like adding it on Listings; approving a user's update to a live listing changes that listing in place."
      />

      {notice && (
        <Alert tone="success" className="mb-4" onDismiss={() => setNotice("")}>
          {notice}
        </Alert>
      )}
      {error && !open && <Alert className="mb-4">{error}</Alert>}

      <div className="mb-4">
        <Segmented<Status>
          value={tab}
          onChange={setTab}
          options={[
            { value: "pending", label: "Pending", count: counts.pending },
            { value: "approved", label: "Approved", count: counts.approved },
            { value: "rejected", label: "Rejected", count: counts.rejected },
          ]}
        />
      </div>

      {loadFailed ? (
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't load listing requests"
          description="Check your connection, then try again. If it keeps failing, the Firestore rules for listing_requests may not be deployed."
          action={
            <Button
              variant="outline"
              icon={RefreshCw}
              onClick={() => {
                setLoadFailed(false);
                setRequests(null);
                setAttempt((n) => n + 1);
              }}
            >
              Try again
            </Button>
          }
        />
      ) : requests === null ? (
        <LoadingState label="Loading listing requests…" />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={tab === "pending" ? "Nothing to review" : `No ${STATUS_LABEL[tab].toLowerCase()} requests`}
          description={
            tab === "pending"
              ? "New requests from the app appear here."
              : undefined
          }
        />
      ) : (
        <div className="grid gap-3">
          {shown.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setOpen(r)}
              className="flex w-full items-center gap-4 rounded-2xl border border-white/10 bg-[#0d0d0d] p-3 text-left transition hover:border-[#38bdf8]/60"
            >
              <div className="relative shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={r.images[0]}
                  alt=""
                  className="h-16 w-24 rounded-xl bg-white/5 object-cover"
                />
                {r.images.length > 1 && (
                  <span className="absolute right-1 bottom-1 rounded-full bg-black/75 px-1.5 text-[10px] leading-4 font-semibold text-white tabular-nums">
                    {r.images.length} photos
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[#f4ead7]">{r.title}</p>
                <p className="truncate text-xs text-[#f4ead7]/60">{placement(r)}</p>
                <p className="mt-1 truncate text-xs text-[#f4ead7]/45">
                  {r.submitterName || "A user"}
                  {r.submitterEmail ? ` · ${r.submitterEmail}` : ""} · {formatDate(r.createdAt)}
                </p>
                {isLiveUpdate(r) && (
                  <p className="mt-1 truncate text-xs text-sky-200/80" title={LIVE_UPDATE_HINT}>
                    {LIVE_UPDATE_HINT}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                {isLiveUpdate(r) && (
                  <Badge tone="blue" title={LIVE_UPDATE_HINT}>
                    <RefreshCw className="h-3 w-3" aria-hidden />
                    Update to live listing
                  </Badge>
                )}
                {isEditedPending(r) && (
                  <Badge tone="dark" title={`Edited by the user ${formatDate(r.updatedAt)}`}>
                    <PencilLine className="h-3 w-3" aria-hidden />
                    Edited
                  </Badge>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {open && (
        <Modal
          title={open.title}
          description={placement(open)}
          onClose={close}
          footer={
            open.status !== "pending" ? (
              <Button variant="light" onClick={close}>
                Close
              </Button>
            ) : rejecting ? (
              <>
                <Button variant="light" onClick={() => setRejecting(false)} disabled={busy}>
                  Back
                </Button>
                <Button variant="danger-solid" icon={X} loading={busy} onClick={() => reject(open)}>
                  {open.productRef ? "Reject update" : "Reject listing"}
                </Button>
              </>
            ) : (
              <>
                <Button variant="danger" icon={X} onClick={() => setRejecting(true)} disabled={busy}>
                  Reject
                </Button>
                <Button variant="success" icon={Check} loading={busy} onClick={() => approve(open)}>
                  {open.productRef ? "Approve update" : "Approve and publish"}
                </Button>
              </>
            )
          }
        >
          {error && <Alert surface="light" className="mb-4">{error}</Alert>}
          {isLiveUpdate(open) && (
            <Alert tone="info" surface="light" className="mb-4">
              {rejecting
                ? "This is an update to a live listing. Rejecting it leaves the live listing exactly as it is; only the user's changes are turned down."
                : LIVE_UPDATE_HINT}
            </Alert>
          )}
          {isEditedPending(open) && !rejecting && (
            <Alert tone="info" surface="light" className="mb-4">
              Edited by the user {formatDate(open.updatedAt)}, before it was reviewed.
            </Alert>
          )}
          {rejecting ? (
            <Field label="Reason (shown to the user)">
              <TextArea
                rows={3}
                value={reason}
                maxLength={300}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. This event already has a listing."
              />
            </Field>
          ) : (
            <RequestDetails r={open} />
          )}
        </Modal>
      )}
    </div>
  );
}

function RequestDetails({ r }: { r: ListingRequest }) {
  const time = (t: Timestamp | null) => (t ? formatDate(t.toDate()) : "");
  const weekly = hasHours(r.openingHours);
  const rows: Array<[string, string]> = [
    ["Short description", r.shortDescription],
    ["About", r.about],
    // Free text from app builds before weekly hours.
    ["Hours", weekly ? "" : r.time],
    ["Address", r.location],
    ["Maps link", r.locationUrl],
    ["Phone", r.phone],
    ["Email", r.email],
    ["Website", r.websiteUrl],
    ["Facebook", r.facebookUrl],
    ["Starts", time(r.startTime)],
    ["Ends", time(r.lastTime)],
  ];
  return (
    <div className="space-y-4 text-black">
      <PhotoCarousel images={r.images} />

      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[9rem_1fr]">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-xs font-semibold uppercase tracking-wide text-black/50">{k}</dt>
              <dd className="text-sm break-words whitespace-pre-line">{v}</dd>
            </div>
          ))}
      </dl>

      {weekly && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-black/50">Opening hours</p>
          <OpeningHoursWeek
            hours={r.openingHours}
            className="mt-2 rounded-xl border border-black/10 bg-white/50 py-1"
          />
        </div>
      )}

      <div className="rounded-xl bg-black/5 px-4 py-3 text-sm">
        <p>
          Sent by <span className="font-semibold">{r.submitterName || "a user"}</span>
          {r.submitterEmail ? ` (${r.submitterEmail})` : ""} on {formatDate(r.createdAt)}.
        </p>
        {r.status === "approved" && (
          <p className="mt-1">
            Approved {formatDate(r.reviewedAt)}. Edit it on{" "}
            <Link href="/dashboard/listings" className="inline-flex items-center gap-1 text-[#0369a1] underline">
              Listings <ExternalLink className="h-3 w-3" aria-hidden />
            </Link>
            .
          </p>
        )}
        {r.status === "rejected" && (
          <p className="mt-1">
            Rejected {formatDate(r.reviewedAt)}
            {r.rejectionReason ? `: ${r.rejectionReason}` : "."}
          </p>
        )}
      </div>
    </div>
  );
}
