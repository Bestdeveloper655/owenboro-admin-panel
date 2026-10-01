"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, Clock, ImageOff, ScanFace, X } from "lucide-react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { deleteObject, ref } from "firebase/storage";
import { auth, db, storage } from "@/lib/firebaseServices";
import { authedFetch } from "@/lib/authedFetch";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  LoadingState,
  Modal,
  PageHeader,
  Segmented,
  TextArea,
  Toolbar,
  cx,
  type BadgeTone,
} from "@/components/ui";

type UserProfile = {
  fullName: string;
  displayName: string;
  username: string;
  gender: string;
  age: number | null;
  bio: string;
  email: string;
  phoneNumber: string;
  dateOfBirth: any;
  isVerified: boolean;
  photoUrls: string[];
};

type Submission = {
  id: string;
  uid: string;
  userDisplayName: string;
  photoUrl: string;
  profilePhotoUrl: string;
  status: "pending" | "approved" | "rejected";
  submittedAt: any;
  reviewedAt?: any;
  reviewedBy?: string;
  rejectionReason?: string;
  profile?: UserProfile | null;
};

type Tab = "pending" | "approved" | "rejected";

export default function Page() {
  const [tab, setTab] = useState<Tab>("pending");
  const [items, setItems] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Submission | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLoading(true);
    const q = query(
      collection(db, "VerificationPhotos"),
      where("status", "==", tab),
      orderBy("submitted_at", "desc"),
    );
    const unsub = onSnapshot(
      q,
      async (snap) => {
        const data: Submission[] = snap.docs.map((d) => {
          const x = d.data() as any;
          return {
            id: d.id,
            uid: x.uid ?? "",
            userDisplayName: x.user_display_name ?? "",
            photoUrl: x.photo_url ?? "",
            profilePhotoUrl: x.profile_photo_url ?? "",
            status: x.status ?? "pending",
            submittedAt: x.submitted_at ?? null,
            reviewedAt: x.reviewed_at ?? null,
            reviewedBy: x.reviewed_by ?? "",
            rejectionReason: x.rejection_reason ?? "",
          };
        });

        // Keep only the most recent submission per user.
        // Query is ordered by submitted_at desc, so the first
        // occurrence of each uid is the newest.
        const seen = new Set<string>();
        const deduped: Submission[] = [];
        for (const s of data) {
          const key = s.uid || s.id;
          if (seen.has(key)) continue;
          seen.add(key);
          deduped.push(s);
        }

        // Fetch each submitting user's full profile so admins can review the
        // complete profile (name, gender, age, bio, …) alongside the photos,
        // and backfill the profile picture for older submissions that didn't
        // snapshot it, so admins can always compare the ID photo against the
        // user's current profile photo.
        await Promise.all(
          deduped.map(async (s) => {
            if (!s.uid) return;
            try {
              const userSnap = await getDoc(doc(db, "Users", s.uid));
              if (!userSnap.exists()) return;
              const u = userSnap.data() as any;
              const photos = Array.isArray(u.photo_urls)
                ? (u.photo_urls as any[]).filter(
                    (p): p is string => typeof p === "string" && !!p,
                  )
                : [];
              const primaryPhoto = u.photo_url || photos[0] || "";
              if (!s.profilePhotoUrl) s.profilePhotoUrl = primaryPhoto;
              if (!s.userDisplayName) {
                s.userDisplayName = u.display_name || u.full_name || "";
              }
              s.profile = {
                fullName: u.full_name || "",
                displayName: u.display_name || "",
                username: u.username || "",
                gender: u.gender || "",
                age: typeof u.age === "number" ? u.age : null,
                bio: u.bio || "",
                email: u.email || "",
                phoneNumber: u.phone_number || "",
                dateOfBirth: u.date_of_birth ?? null,
                isVerified: !!u.is_verified,
                photoUrls: primaryPhoto
                  ? [primaryPhoto, ...photos.filter((p) => p !== primaryPhoto)]
                  : photos,
              };
            } catch (e) {
              console.error(e);
            }
          }),
        );

        setItems(deduped);
        setLoading(false);
      },
      (err) => {
        console.error(err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [tab]);

  // Best-effort delete of a Storage object given its download URL. ID photos
  // must never be retained, so a failure here is logged but not surfaced —
  // the Firestore URL is cleared regardless.
  const safelyDeletePhoto = async (url?: string) => {
    if (!url) return;
    try {
      await deleteObject(ref(storage, url));
    } catch (err) {
      console.error("ID photo delete skipped/failed:", err);
    }
  };

  // Resolve every pending submission for a user in one batch, so older
  // duplicate submissions don't resurface in the pending tab afterwards.
  // The ID photo is deleted from Storage and its URL cleared from Firestore so
  // identity photos are never retained after a decision.
  const resolvePending = async (
    uid: string,
    status: "approved" | "rejected",
    why: string,
    reviewer: string,
  ) => {
    const pendingSnap = await getDocs(
      query(
        collection(db, "VerificationPhotos"),
        where("uid", "==", uid),
        where("status", "==", "pending"),
      ),
    );

    // Delete every ID photo file from Storage before clearing the references.
    await Promise.all(
      pendingSnap.docs.map((d) => safelyDeletePhoto((d.data() as any).photo_url)),
    );

    const batch = writeBatch(db);
    pendingSnap.forEach((d) => {
      batch.update(d.ref, {
        status,
        reviewed_at: serverTimestamp(),
        reviewed_by: reviewer,
        rejection_reason: status === "rejected" ? why : "",
        // Do not store the ID photo once a decision is made.
        photo_url: "",
        photo_deleted_at: serverTimestamp(),
      });
    });
    if (status === "approved") {
      batch.update(doc(db, "Users", uid), { is_verified: true });
    }
    await batch.commit();
  };

  // Notify the user that their verification was decided. Best-effort: the
  // decision is already committed to Firestore, so a failed push must not undo
  // it. The server route writes the in-app notification and sends the FCM push.
  const notifyVerification = async (
    uid: string,
    status: "approved" | "rejected",
    why: string,
  ) => {
    try {
      await authedFetch("/api/admin/verification/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid, status, reason: why }),
      });
    } catch (err) {
      console.error("Verification notification failed:", err);
    }
  };

  const approve = async (s: Submission) => {
    if (!s.uid) return;
    setBusy(true);
    // Optimistically remove the card so it moves out of pending immediately.
    setItems((prev) => prev.filter((i) => i.uid !== s.uid));
    setSelected(null);
    try {
      const reviewer = auth.currentUser?.uid ?? "";
      await resolvePending(s.uid, "approved", "", reviewer);
      await notifyVerification(s.uid, "approved", "");
    } catch (e) {
      console.error(e);
      alert("Approve failed. Check console.");
      setItems((prev) => (prev.some((i) => i.id === s.id) ? prev : [s, ...prev]));
    } finally {
      setBusy(false);
    }
  };

  const reject = async (s: Submission, why: string) => {
    if (!s.uid) return;
    setBusy(true);
    // Optimistically remove the card so it moves out of pending immediately.
    setItems((prev) => prev.filter((i) => i.uid !== s.uid));
    setRejectingId(null);
    setReason("");
    setSelected(null);
    try {
      const reviewer = auth.currentUser?.uid ?? "";
      await resolvePending(s.uid, "rejected", why, reviewer);
      await notifyVerification(s.uid, "rejected", why);
    } catch (e) {
      console.error(e);
      alert("Reject failed. Check console.");
      setItems((prev) => (prev.some((i) => i.id === s.id) ? prev : [s, ...prev]));
    } finally {
      setBusy(false);
    }
  };

  const counts = useMemo(() => items.length, [items]);

  return (
    <div>
      <PageHeader title="Verify Photos" description="Review identity photos submitted by users." />

      {/* TABS */}
      <Toolbar>
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={(["pending", "approved", "rejected"] as Tab[]).map((t) => ({
            value: t,
            label: STATUS_BADGES[t].label,
            count: t === tab && !loading ? counts : undefined,
          }))}
        />
      </Toolbar>

      {loading ? (
        <LoadingState label="Loading submissions…" />
      ) : items.length === 0 ? (
        <EmptyState icon={ScanFace} title={`No ${tab} submissions.`} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((s) => (
            <Card key={s.id} tone="cream" className="flex flex-col">
              <button
                type="button"
                onClick={() => setSelected(s)}
                className="group grid w-full grid-cols-2 gap-2 rounded-xl text-left focus-visible:ring-2 focus-visible:ring-[#ff7a59]/50 focus-visible:outline-none"
              >
                <PhotoTile label="ID photo" url={s.photoUrl} alt="ID photo" />
                <PhotoTile label="Profile pic" url={s.profilePhotoUrl} alt="Profile picture" />
              </button>

              <div className="mt-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">
                    {s.userDisplayName || "Unknown user"}
                  </p>
                  {(s.profile?.gender || s.profile?.age != null) && (
                    <p className="truncate text-xs font-medium text-black/70">
                      {[s.profile?.gender, s.profile?.age != null ? `${s.profile.age} yrs` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                  {s.profile?.username && (
                    <p className="truncate text-xs text-black/60">
                      @{s.profile.username}
                    </p>
                  )}
                </div>
                <StatusBadge status={s.status} />
              </div>

              <p className="mt-2 truncate font-mono text-[11px] text-black/45">{s.uid}</p>
              {s.submittedAt?.toDate && (
                <p className="mt-1 flex items-center gap-1.5 text-xs text-black/60">
                  <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {s.submittedAt.toDate().toLocaleString()}
                </p>
              )}

              {tab === "rejected" && s.rejectionReason && (
                <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs break-words text-red-800">
                  <span className="font-semibold">Reason:</span> {s.rejectionReason}
                </p>
              )}

              {tab === "pending" && (
                <div className="mt-auto flex gap-2 pt-4">
                  <Button
                    variant="success"
                    icon={Check}
                    className="flex-1"
                    disabled={busy}
                    onClick={() => approve(s)}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="danger"
                    icon={X}
                    className="flex-1"
                    disabled={busy}
                    onClick={() => {
                      setRejectingId(s.id);
                      setReason("");
                    }}
                  >
                    Reject
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* PHOTO LIGHTBOX */}
      {selected && (
        <Modal
          title={selected.userDisplayName || "Submission"}
          description="Compare the ID photo against the profile picture to confirm the user's identity."
          size="xl"
          onClose={() => setSelected(null)}
          footer={
            selected.status === "pending" ? (
              <>
                <Button
                  variant="danger"
                  icon={X}
                  disabled={busy}
                  onClick={() => {
                    setRejectingId(selected.id);
                    setReason("");
                  }}
                >
                  Reject
                </Button>
                <Button
                  variant="success"
                  icon={Check}
                  disabled={busy}
                  onClick={() => approve(selected)}
                >
                  Approve
                </Button>
              </>
            ) : undefined
          }
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ComparePhoto label="ID photo" url={selected.photoUrl} alt="ID photo" empty="No image" />
            <ComparePhoto
              label="Profile picture"
              url={selected.profilePhotoUrl}
              alt="Profile picture"
              empty="No profile picture"
            />
          </div>

          {/* COMPLETE PROFILE */}
          <Panel title="User profile" className="mt-5">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <ProfileField
                label="Name"
                value={
                  selected.profile?.fullName ||
                  selected.profile?.displayName ||
                  selected.userDisplayName
                }
              />
              <ProfileField label="Username" value={selected.profile?.username && `@${selected.profile.username}`} />
              <ProfileField label="Gender" value={selected.profile?.gender} />
              <ProfileField
                label="Age"
                value={selected.profile?.age != null ? `${selected.profile.age}` : ""}
              />
              <ProfileField
                label="Date of birth"
                value={
                  selected.profile?.dateOfBirth?.toDate
                    ? selected.profile.dateOfBirth.toDate().toLocaleDateString()
                    : ""
                }
              />
              <ProfileField
                label="Verified"
                value={selected.profile ? (selected.profile.isVerified ? "Yes" : "No") : ""}
              />
              <ProfileField label="Email" value={selected.profile?.email} />
              <ProfileField label="Phone" value={selected.profile?.phoneNumber} />
            </dl>
            {selected.profile?.bio && (
              <div className="mt-3 border-t border-black/10 pt-3">
                <p className="text-xs font-semibold tracking-wide text-black/50 uppercase">
                  Bio
                </p>
                <p className="mt-1 text-sm whitespace-pre-wrap break-words text-black/80">
                  {selected.profile.bio}
                </p>
              </div>
            )}
          </Panel>

          {/* PROFILE PHOTO GALLERY */}
          {selected.profile?.photoUrls && selected.profile.photoUrls.length > 0 && (
            <Panel title={`Profile photos (${selected.profile.photoUrls.length})`} className="mt-4">
              <div className="flex flex-wrap gap-2">
                {selected.profile.photoUrls.map((url, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={`${url}-${i}`}
                    src={url}
                    alt={`Profile photo ${i + 1}`}
                    className="h-24 w-24 rounded-xl border border-black/10 bg-black/5 object-cover"
                  />
                ))}
              </div>
            </Panel>
          )}

          <Panel title="Submission" className="mt-4">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3">
              <ProfileField
                label="UID"
                value={selected.uid && <span className="font-mono text-xs break-all">{selected.uid}</span>}
              />
              <ProfileField label="Status" value={<StatusBadge status={selected.status} />} />
              <ProfileField
                label="Submitted"
                value={
                  selected.submittedAt?.toDate
                    ? selected.submittedAt.toDate().toLocaleString()
                    : "-"
                }
              />
            </dl>
          </Panel>
        </Modal>
      )}

      {/* REJECT MODAL — rendered after the lightbox so it opens on top of it. */}
      {rejectingId && (
        <Modal
          title="Reject submission"
          description="Optionally, give the user a reason. They can resubmit a new photo."
          size="md"
          onClose={() => {
            setRejectingId(null);
            setReason("");
          }}
          footer={
            <>
              <Button
                variant="light"
                onClick={() => {
                  setRejectingId(null);
                  setReason("");
                }}
              >
                Cancel
              </Button>
              <Button
                variant="danger-solid"
                loading={busy}
                onClick={() => {
                  const target = items.find((i) => i.id === rejectingId);
                  if (target) reject(target, reason.trim());
                }}
              >
                {busy ? "Rejecting…" : "Confirm reject"}
              </Button>
            </>
          }
        >
          <Field label="Reason">
            <TextArea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Photo is blurry, please retake."
              rows={4}
            />
          </Field>
        </Modal>
      )}
    </div>
  );
}

const STATUS_BADGES: Record<Submission["status"], { tone: BadgeTone; label: string }> = {
  pending: { tone: "amber", label: "Pending" },
  approved: { tone: "green", label: "Approved" },
  rejected: { tone: "red", label: "Rejected" },
};

function StatusBadge({ status }: { status: Submission["status"] }) {
  const badge: { tone: BadgeTone; label: string } = STATUS_BADGES[status] ?? {
    tone: "neutral",
    label: status,
  };
  return <Badge tone={badge.tone}>{badge.label}</Badge>;
}

/* Square photo inside a submission card, labelled in its corner. */
function PhotoTile({ label, url, alt }: { label: string; url: string; alt: string }) {
  return (
    <span className="relative block aspect-square w-full overflow-hidden rounded-xl border border-black/10 bg-black/5 transition group-hover:border-[#ff7a59]">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full flex-col items-center justify-center gap-1 text-xs text-black/45">
          <ImageOff className="h-5 w-5" aria-hidden />
          No image
        </span>
      )}
      <span className="absolute top-2 left-2 rounded-full bg-black/65 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase">
        {label}
      </span>
    </span>
  );
}

/* Full-size photo in the review modal. */
function ComparePhoto({
  label,
  url,
  alt,
  empty,
}: {
  label: string;
  url: string;
  alt: string;
  empty: string;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold tracking-wide text-black/55 uppercase">{label}</p>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={alt}
          className="max-h-[55vh] w-full rounded-xl border border-black/10 bg-black/5 object-contain"
        />
      ) : (
        <div className="flex h-40 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-black/20 bg-black/5 text-sm text-black/45">
          <ImageOff className="h-5 w-5" aria-hidden />
          {empty}
        </div>
      )}
    </div>
  );
}

/* Bordered group inside the review modal. */
function Panel({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cx("rounded-2xl border border-black/10 bg-white/50 p-4", className)}>
      <p className="mb-3 text-xs font-bold tracking-wide text-black/55 uppercase">{title}</p>
      {children}
    </div>
  );
}

function ProfileField({ label, value }: { label: string; value?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold tracking-wide text-black/50 uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm break-words text-black/90">{value ? value : "—"}</dd>
    </div>
  );
}
