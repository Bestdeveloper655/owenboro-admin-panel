"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Ban,
  Crown,
  Download,
  Eye,
  Images,
  MessageSquareOff,
  UserRound,
  Users as UsersIcon,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  Timestamp,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebaseServices";
import { notifyModeration } from "@/lib/moderationNotify";
import { authedFetch } from "@/lib/authedFetch";
import { setAppBlock } from "@/lib/userBlocks";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  FilterSelect,
  FormSection,
  LoadingState,
  Modal,
  PageHeader,
  Pagination,
  SearchInput,
  Segmented,
  TextArea,
  Toolbar,
  cx,
  table,
} from "@/components/ui";

type User = {
  id: string;
  name: string;
  email: string;
  phone: string;
  uid: string;
  createdAt: any;
  isVerified: boolean;
  timeoutUntil: Date | null;
  timeoutReason: string;
  photoUrl: string;
  photoUrls: string[];
  isVip: boolean;
  subStore: string;
  subProductId: string;
  promoOptIn: boolean | null;
  age: number | null;
  gender: string;
  role: string;
};

/* Same buckets the mobile app uses for its auto-groups, so counts match. */
type AgeBucket = { key: string; label: string; min: number; max: number };
const AGE_BUCKETS: AgeBucket[] = [
  { key: "18-24", label: "18–24", min: 18, max: 24 },
  { key: "25-29", label: "25–29", min: 25, max: 29 },
  { key: "30-39", label: "30–39", min: 30, max: 39 },
  { key: "40-54", label: "40–54", min: 40, max: 54 },
  { key: "55+", label: "55+", min: 55, max: Infinity },
];
type GenderFilter = "all" | "Male" | "Female";

/* `age` is written once at profile creation, so prefer recomputing it from
 * `date_of_birth`; fall back to the stored int. */
function resolveAge(dob: unknown, stored: unknown): number | null {
  const date =
    dob && typeof (dob as { toDate?: unknown }).toDate === "function"
      ? (dob as { toDate: () => Date }).toDate()
      : null;
  if (date && !Number.isNaN(date.getTime())) {
    const now = new Date();
    let age = now.getFullYear() - date.getFullYear();
    const beforeBirthday =
      now.getMonth() < date.getMonth() ||
      (now.getMonth() === date.getMonth() && now.getDate() < date.getDate());
    if (beforeBirthday) age -= 1;
    return age >= 0 && age < 130 ? age : null;
  }
  return typeof stored === "number" && Number.isInteger(stored) ? stored : null;
}

/* An admin-granted "VIP" is a complimentary lifetime subscription: the mobile
 * app reads the `subscription` map (via RevenueCat) to unlock premium features.
 * That entitlement field is locked down by security rules, so the grant/revoke
 * write happens server-side (see /api/admin/users/vip). */

/* Far-future sentinel used to represent a permanent restriction. */
const PERMANENT_YEAR = 9000;
const PERMANENT_DATE = new Date("9999-12-31T23:59:59Z");

type RestrictionOption = {
  label: string;
  ms: number | "permanent" | "remove";
};

const DAY = 24 * 60 * 60 * 1000;
const RESTRICTION_OPTIONS: RestrictionOption[] = [
  { label: "1 day", ms: 1 * DAY },
  { label: "3 days", ms: 3 * DAY },
  { label: "1 week", ms: 7 * DAY },
  { label: "2 weeks", ms: 14 * DAY },
  { label: "1 month", ms: 30 * DAY },
  { label: "Permanent", ms: "permanent" },
];

function isActiveRestriction(until: Date | null): boolean {
  return until != null && until.getTime() > Date.now();
}

function isPermanent(until: Date | null): boolean {
  return until != null && until.getFullYear() >= PERMANENT_YEAR;
}

function restrictionLabel(until: Date | null): string {
  if (!isActiveRestriction(until)) return "Active (no restriction)";
  if (isPermanent(until)) return "Permanently restricted";
  return `Restricted until ${until!.toLocaleString()}`;
}

export default function Page() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<User | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [page, setPage] = useState(1);
  const perPage = 25;

  /* FETCH */
  useEffect(() => {
    const fetchUsers = async () => {
      const snap = await getDocs(collection(db, "Users"));

      const data: User[] = snap.docs.map((d) => {
        const x = d.data();
        const rawTimeout = x.timeout_until;
        const photoUrls: string[] = Array.isArray(x.photo_urls)
          ? x.photo_urls.filter((u: any) => typeof u === "string" && u)
          : [];
        const sub = x.subscription || null;
        return {
          id: d.id,
          name: x.full_name || x.display_name || "No Name",
          email: x.email || "",
          phone: x.phone_number || "",
          uid: x.uid || "",
          createdAt: x.created_time || null,
          isVerified: x.is_verified === true,
          timeoutUntil:
            rawTimeout && rawTimeout.toDate ? rawTimeout.toDate() : null,
          timeoutReason: x.timeout_reason || "",
          photoUrl: x.photo_url || photoUrls[0] || "",
          photoUrls,
          isVip: sub?.isActive === true,
          subStore: sub?.store || "",
          subProductId: sub?.productId || "",
          promoOptIn:
            x.promo_opt_in === true
              ? true
              : x.promo_opt_in === false
                ? false
                : null,
          age: resolveAge(x.date_of_birth, x.age),
          gender: x.gender === "Male" || x.gender === "Female" ? x.gender : "",
          role: typeof x.role === "string" ? x.role : "user",
        };
      });

      data.sort((a, b) => {
        const aTime = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
        const bTime = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
        return bTime - aTime;
      });

      setUsers(data);
      setLoading(false);
    };

    fetchUsers();
  }, []);

  const [genderFilter, setGenderFilter] = useState<GenderFilter>("all");
  const [ageFilter, setAgeFilter] = useState<string>("all");

  /* SEARCH + GENDER + AGE FILTER */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const bucket = AGE_BUCKETS.find((b) => b.key === ageFilter);
    return users.filter((u) => {
      if (genderFilter !== "all" && u.gender !== genderFilter) return false;
      if (ageFilter === "unknown" && u.age !== null) return false;
      if (bucket && (u.age === null || u.age < bucket.min || u.age > bucket.max)) {
        return false;
      }
      if (
        q &&
        ![u.name, u.email, u.phone, u.uid]
          .filter(Boolean)
          .some((field) => field.toLowerCase().includes(q))
      ) {
        return false;
      }
      return true;
    });
  }, [users, search, genderFilter, ageFilter]);

  const isFiltered = Boolean(search) || genderFilter !== "all" || ageFilter !== "all";

  // Reset to first page whenever a filter changes.
  useEffect(() => {
    setPage(1);
  }, [search, genderFilter, ageFilter]);

  /* EXPORT CSV (respects the current search filter) */
  const exportCSV = () => {
    const headers = ["Name", "Email", "Phone", "UID", "Gender", "Age", "Created Time", "Restriction"];

    const rows = filtered.map((u) => [
      u.name,
      u.email,
      u.phone,
      u.uid,
      u.gender,
      u.age ?? "",
      u.createdAt?.toDate ? u.createdAt.toDate().toLocaleString() : "",
      restrictionLabel(u.timeoutUntil),
    ]);

    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `users_${Date.now()}.csv`;
    a.click();
  };

  /* APPLY / REMOVE RESTRICTION */
  const applyRestriction = async (user: User, option: RestrictionOption) => {
    let until: Date | null;
    if (option.ms === "remove") {
      until = null;
    } else if (option.ms === "permanent") {
      until = PERMANENT_DATE;
    } else {
      until = new Date(Date.now() + option.ms);
    }

    const ref = doc(db, "Users", user.id);
    await updateDoc(ref, {
      timeout_until: until ? Timestamp.fromDate(until) : null,
      timeout_reason:
        option.ms === "remove" ? "" : `Restricted by admin (${option.label})`,
      timeout_set_at: serverTimestamp(),
    });

    // Notify the user about the messaging restriction change.
    const targetUid = user.uid || user.id;
    if (option.ms === "remove") {
      await notifyModeration({
        uid: targetUid,
        event: "messaging_restriction_removed",
      });
    } else {
      await notifyModeration({
        uid: targetUid,
        event: "messaging_restricted",
        label: option.label,
        permanent: option.ms === "permanent",
      });
    }

    // Reflect immediately in local state.
    const patch = (u: User): User =>
      u.id === user.id
        ? {
            ...u,
            timeoutUntil: until,
            timeoutReason:
              option.ms === "remove"
                ? ""
                : `Restricted by admin (${option.label})`,
          }
        : u;
    setUsers((prev) => prev.map(patch));
    setSelected((prev) => (prev ? patch(prev) : prev));
  };

  /* QUICK UNBLOCK (table row) — lift a restriction early, before it expires */
  const [unblocking, setUnblocking] = useState<string | null>(null);
  const quickUnblock = async (user: User) => {
    const ok = window.confirm(
      `Remove the restriction on ${user.name} now? They'll be able to send messages again immediately.`,
    );
    if (!ok) return;
    setUnblocking(user.id);
    try {
      await applyRestriction(user, { label: "Remove", ms: "remove" });
    } catch (e) {
      console.error(e);
      alert("Failed to remove restriction. Please try again.");
    } finally {
      setUnblocking(null);
    }
  };

  /* GRANT / REVOKE VIP — write the complimentary subscription map the app reads
     to unlock (or lock) all premium features. */
  const setVip = async (user: User, makeVip: boolean) => {
    const targetUid = user.uid || user.id;
    const res = await authedFetch("/api/admin/users/vip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: targetUid, makeVip }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || "Failed to update VIP.");
    }
    const patch = (u: User): User =>
      u.id === user.id
        ? {
            ...u,
            isVip: makeVip,
            subStore: "complimentary",
            subProductId: "complimentary_lifetime",
          }
        : u;
    setUsers((prev) => prev.map(patch));
    setSelected((prev) => (prev ? patch(prev) : prev));
  };

  /* PAGINATION (over filtered list) */
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));

  const paginated = useMemo(() => {
    const start = (page - 1) * perPage;
    return filtered.slice(start, start + perPage);
  }, [filtered, page]);

  return (
    <div>
      <PageHeader
        title="All Users Info"
        description="All users information is listed here."
        actions={
          <Button variant="outline" icon={Download} onClick={exportCSV}>
            Export CSV
          </Button>
        }
      />

      <Toolbar>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search by name, email, phone, or UID…"
          width="w-full sm:w-96"
        />

        <Segmented<GenderFilter>
          value={genderFilter}
          onChange={setGenderFilter}
          options={(["all", "Male", "Female"] as GenderFilter[]).map((g) => ({
            value: g,
            label: g === "all" ? "All genders" : g,
          }))}
        />

        <FilterSelect
          value={ageFilter}
          onChange={(e) => setAgeFilter(e.target.value)}
          aria-label="Filter by age"
        >
          {[
            { key: "all", label: "All ages" },
            ...AGE_BUCKETS,
            { key: "unknown", label: "Age not set" },
          ].map((b) => (
            <option key={b.key} value={b.key}>
              {b.label}
            </option>
          ))}
        </FilterSelect>

        {(genderFilter !== "all" || ageFilter !== "all") && (
          <Button
            variant="secondary"
            icon={X}
            onClick={() => {
              setGenderFilter("all");
              setAgeFilter("all");
            }}
          >
            Clear filters
          </Button>
        )}
      </Toolbar>

      {/* LIST */}
      {loading ? (
        <LoadingState label="Loading users…" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title={
            search
              ? `No users match “${search}” with these filters.`
              : "No users match these filters."
          }
        />
      ) : (
        <>
          <div className={table.wrap}>
            <table className={`${table.table} min-w-[900px]`}>
              <thead className={table.thead}>
                <tr>
                  <th className={table.th}>Name</th>
                  <th className={table.th}>Email</th>
                  <th className={table.th}>Phone</th>
                  <th className={table.th}>UID</th>
                  <th className={table.th}>Gender</th>
                  <th className={table.th}>Age</th>
                  <th className={table.th}>Created</th>
                  <th className={`${table.th} text-right`}>Manage</th>
                </tr>
              </thead>

              <tbody>
                {paginated.map((u) => {
                  const restricted = isActiveRestriction(u.timeoutUntil);
                  return (
                    <tr key={u.id} className={table.row}>
                      <td className={table.td}>
                        <div className="flex items-center gap-1.5 whitespace-nowrap">
                          <span className="font-semibold">{u.name}</span>
                          {u.isVerified && <VerifiedBadge />}
                          {u.isVip && <VipBadge />}
                          {restricted && (
                            <Badge tone="red">
                              {isPermanent(u.timeoutUntil) ? "Blocked" : "Restricted"}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className={`${table.td} text-black/70`}>
                        <span className="block max-w-[220px] truncate" title={u.email}>{u.email}</span>
                      </td>
                      <td className={`${table.td} whitespace-nowrap`}>{u.phone}</td>
                      <td className={`${table.td} font-mono text-xs text-black/55`}>
                        <span className="block max-w-[120px] truncate" title={u.uid}>{u.uid}</span>
                      </td>
                      <td className={table.td}>{u.gender || "—"}</td>
                      <td className={`${table.td} tabular-nums`}>{u.age ?? "—"}</td>
                      <td className={`${table.td} whitespace-nowrap text-black/60`}>
                        {u.createdAt?.toDate
                          ? u.createdAt.toDate().toLocaleDateString()
                          : "-"}
                      </td>

                      <td className={table.td}>
                        <div className={table.actions}>
                          {restricted && (
                            <Button
                              size="sm"
                              variant="success"
                              loading={unblocking === u.id}
                              onClick={() => quickUnblock(u)}
                            >
                              Unblock
                            </Button>
                          )}
                          <Button size="sm" icon={Eye} onClick={() => setSelected(u)}>
                            View
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            total={filtered.length}
            perPage={perPage}
            extra={
              isFiltered && (
                <span className="text-[#f3ead7]/50"> · {users.length} total</span>
              )
            }
          />
        </>
      )}

      {/* USER DETAILS MODAL */}
      {selected && (
        <Modal
          title="User Details"
          size="xl"
          onClose={() => setSelected(null)}
          footer={
            <Button variant="light" onClick={() => setSelected(null)}>
              Close
            </Button>
          }
        >
          <div className="grid gap-x-6 lg:grid-cols-2">
            <div className="min-w-0">
              <FormSection>Profile</FormSection>

              {/* PROFILE PHOTO + GALLERY */}
              <UserPhotos user={selected} onZoom={(url) => setLightbox(url)} />

              <dl
                className={cx(
                  SUB_PANEL,
                  "mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-sm",
                )}
              >
                <Detail label="Name">
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    {selected.name}
                    {selected.isVerified && <VerifiedBadge />}
                  </span>
                </Detail>
                <Detail label="Verified">
                  <Badge tone={selected.isVerified ? "green" : "neutral"}>
                    {selected.isVerified ? "Yes" : "No"}
                  </Badge>
                </Detail>
                <Detail label="Newsletter">
                  {selected.promoOptIn === true ? (
                    <Badge tone="green">Opted in</Badge>
                  ) : selected.promoOptIn === false ? (
                    <Badge tone="neutral">Opted out</Badge>
                  ) : (
                    <span className="font-normal text-black/50">Not answered</span>
                  )}
                </Detail>
                <Detail label="Email">{selected.email}</Detail>
                <Detail label="Phone">{selected.phone}</Detail>
                <Detail label="UID">
                  <span className="font-mono text-xs break-all">{selected.uid}</span>
                </Detail>
                <Detail label="Gender">{selected.gender || "Not set"}</Detail>
                <Detail label="Age">{selected.age ?? "Not set"}</Detail>
                <Detail label="Created">
                  {selected.createdAt?.toDate
                    ? selected.createdAt.toDate().toLocaleString()
                    : "-"}
                </Detail>
              </dl>
            </div>

            <div className="min-w-0">
              <FormSection>Account controls</FormSection>

              {/* VIP / PREMIUM CONTROLS */}
              <VipPanel user={selected} onSetVip={(v) => setVip(selected, v)} />

              {/* RESTRICTION CONTROLS */}
              <RestrictionPanel
                user={selected}
                onApply={(opt) => applyRestriction(selected, opt)}
              />

              {/* BLOCK FROM APP */}
              <AppBlockPanel
                user={selected}
                onBlocked={() => {
                  setUsers((prev) => prev.filter((u) => u.id !== selected.id));
                  setSelected(null);
                }}
              />
            </div>
          </div>
        </Modal>
      )}

      {/* PHOTO LIGHTBOX — enlarged view of a single profile photo */}
      {lightbox && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox}
            alt="Profile photo"
            className="max-h-[90vh] max-w-full rounded-2xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

/* Cream sub-panel that groups one block of the user details modal. */
const SUB_PANEL = "rounded-2xl border border-black/10 bg-white/50 p-4";

/* One label/value row of the details list. */
function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-black/55">{label}</dt>
      <dd className="min-w-0 font-medium wrap-break-word text-black">{children}</dd>
    </>
  );
}

/* Title row of a sub-panel: icon, heading and a status badge. */
function PanelHeader({
  icon: Icon,
  title,
  badge,
  danger = false,
}: {
  icon: LucideIcon;
  title: string;
  badge?: ReactNode;
  danger?: boolean;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <Icon className={cx("h-4 w-4", danger ? "text-red-700" : "text-black/50")} aria-hidden />
      <h3 className={cx("text-sm font-semibold", danger ? "text-red-800" : "text-black")}>
        {title}
      </h3>
      {badge}
    </div>
  );
}

function VipBadge() {
  return (
    <Badge tone="purple">
      <Crown className="h-3 w-3" aria-hidden />
      VIP
    </Badge>
  );
}

/* USER PHOTOS — profile avatar + grid gallery of all uploaded photos */
function UserPhotos({
  user,
  onZoom,
}: {
  user: User;
  onZoom: (url: string) => void;
}) {
  // Show the main photo first, then the rest, de-duplicated.
  const photos = Array.from(
    new Set([user.photoUrl, ...user.photoUrls].filter(Boolean)),
  );

  if (photos.length === 0) {
    return (
      <div className={cx(SUB_PANEL, "mt-4 flex items-center gap-4")}>
        <div className="flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-full border border-dashed border-black/20 bg-black/5 text-[11px] text-black/45">
          <UserRound className="h-5 w-5" aria-hidden />
          No photo
        </div>
        <p className="text-sm text-black/60">
          This user has not uploaded any profile photos.
        </p>
      </div>
    );
  }

  return (
    <div className={cx(SUB_PANEL, "mt-4")}>
      {/* Main profile photo */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => onZoom(photos[0])}
          className="h-20 w-20 shrink-0 overflow-hidden rounded-full bg-black/10 ring-2 ring-[#ff7a59]/50 transition hover:ring-[#ff7a59]"
          aria-label="View profile photo"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photos[0]}
            alt={user.name}
            className="h-full w-full object-cover"
          />
        </button>
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-black">
            <Images className="h-4 w-4 text-black/50" aria-hidden />
            Profile photos
          </p>
          <p className="mt-0.5 text-xs text-black/60">
            {photos.length} photo{photos.length > 1 ? "s" : ""} · tap to enlarge
          </p>
        </div>
      </div>

      {/* Grid gallery of all photos */}
      <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {photos.map((url, i) => (
          <button
            type="button"
            key={i}
            onClick={() => onZoom(url)}
            className="aspect-square overflow-hidden rounded-xl bg-black/10 ring-1 ring-black/10 transition hover:ring-2 hover:ring-[#ff7a59]"
            aria-label={`View photo ${i + 1}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={`Photo ${i + 1}`}
              className="h-full w-full object-cover"
            />
          </button>
        ))}
      </div>
    </div>
  );
}

/* RESTRICTION PANEL — block a user from messaging for a period or permanently */
function RestrictionPanel({
  user,
  onApply,
}: {
  user: User;
  onApply: (option: RestrictionOption) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const active = isActiveRestriction(user.timeoutUntil);

  const run = async (option: RestrictionOption) => {
    setBusy(option.label);
    try {
      await onApply(option);
    } catch (e) {
      console.error(e);
      alert("Failed to update restriction. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={cx(SUB_PANEL, "mt-4")}>
      <PanelHeader
        icon={MessageSquareOff}
        title="Restrict messaging"
        badge={
          <Badge tone={active ? "red" : "green"}>{active ? "Restricted" : "Active"}</Badge>
        }
      />

      <p className="text-sm font-medium text-black/80">
        {restrictionLabel(user.timeoutUntil)}
      </p>
      <p className="mt-1 text-xs text-black/55">
        A restricted user can still view content but cannot send new messages in
        direct or group chats, or post stories, until the restriction ends.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {RESTRICTION_OPTIONS.map((opt) => (
          <Button
            key={opt.label}
            size="sm"
            variant="warning"
            disabled={busy !== null}
            loading={busy === opt.label}
            onClick={() => run(opt)}
          >
            {busy === opt.label ? "Saving…" : opt.label}
          </Button>
        ))}
        {active && (
          <Button
            size="sm"
            variant="success"
            disabled={busy !== null}
            loading={busy === "Remove"}
            onClick={() => run({ label: "Remove", ms: "remove" })}
          >
            {busy === "Remove" ? "Saving…" : "Remove restriction"}
          </Button>
        )}
      </div>
    </div>
  );
}

/* VIP PANEL — grant or revoke all premium features for a user */
function VipPanel({
  user,
  onSetVip,
}: {
  user: User;
  onSetVip: (makeVip: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  // A real paid subscription (App Store / Play Store) is managed by RevenueCat,
  // not the admin. We only grant/revoke admin "complimentary" VIP here.
  const isPaidSubscriber = user.isVip && user.subStore !== "complimentary";

  const run = async (makeVip: boolean) => {
    if (!makeVip && !confirm(`Remove VIP / premium access from ${user.name}?`))
      return;
    setBusy(true);
    try {
      await onSetVip(makeVip);
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Failed to update VIP status. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cx(SUB_PANEL, "mt-4")}>
      <PanelHeader
        icon={Crown}
        title="VIP / Premium"
        badge={
          user.isVip ? <VipBadge /> : <Badge tone="neutral">Standard</Badge>
        }
      />

      <p className="text-sm text-black/60">
        {user.isVip
          ? isPaidSubscriber
            ? `This user has an active paid subscription (${user.subStore}). It's managed by the store and can't be changed here.`
            : "This user has admin-granted VIP — all premium features are unlocked."
          : "Grant VIP to unlock all premium features for this user, free of charge."}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {isPaidSubscriber ? (
          <span className="text-sm text-black/50">No admin action available.</span>
        ) : user.isVip ? (
          <Button size="sm" variant="danger" loading={busy} onClick={() => run(false)}>
            {busy ? "Saving…" : "Revoke VIP"}
          </Button>
        ) : (
          <Button size="sm" icon={Crown} loading={busy} onClick={() => run(true)}>
            {busy ? "Saving…" : "Make VIP (grant premium)"}
          </Button>
        )}
      </div>
    </div>
  );
}

/* Full app block (docs/user-blocking-contract.md §1): disables the login and
 * hides everything the user created. Reversible from Blocked Users. */
function AppBlockPanel({ user, onBlocked }: { user: User; onBlocked: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (user.role === "admin" || user.role === "moderator") return null;

  const block = async () => {
    if (
      !window.confirm(
        `Block ${user.name} from the app?\n\nThey'll be signed out and can't log back in, and their profile, messages, posts and everything else they created will be hidden from everyone. You can undo this from Blocked Users.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await setAppBlock(user.uid || user.id, true, { reason, source: "users" });
      onBlocked();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 rounded-2xl border border-red-200 bg-red-50/60 p-4">
      <PanelHeader icon={Ban} title="Block from app" danger />
      <p className="text-sm text-black/70">
        Signs them out everywhere, disables their login, and hides their profile
        and everything they&rsquo;ve posted, as if the account never existed.
        Use the restriction above if you only want to stop them messaging.
      </p>
      <TextArea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (only staff can see this)"
        maxLength={500}
        className="mt-3"
      />
      {error && (
        <Alert surface="light" className="mt-3">
          {error}
        </Alert>
      )}
      <div className="mt-3">
        <Button variant="danger-solid" size="sm" icon={Ban} loading={busy} onClick={block}>
          {busy ? "Blocking…" : "Block from app"}
        </Button>
      </div>
    </div>
  );
}

/* VERIFIED BADGE — blue check shown next to verified users */
function VerifiedBadge() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="inline-block h-4 w-4 shrink-0"
      aria-label="Verified"
      role="img"
    >
      <title>Verified</title>
      <path
        fill="#1E88E5"
        d="M12 2l2.39 1.74 2.95-.02 1.06 2.79 2.65 1.31-.55 2.94L23 12l-2.45 1.24.55 2.94-2.65 1.31-1.06 2.79-2.95-.02L12 22l-2.39-1.74-2.95.02-1.06-2.79L2.95 16.18 3.5 13.24 1 12l2.45-1.24-.55-2.94 2.65-1.31L6.61 3.72l2.95.02L12 2z"
      />
      <path fill="#fff" d="M10.6 14.6l-2.3-2.3-1.1 1.1 3.4 3.4 6-6-1.1-1.1z" />
    </svg>
  );
}
