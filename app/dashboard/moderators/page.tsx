"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Lock, SearchX, ShieldCheck, UserMinus, UserPlus, UserSearch } from "lucide-react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebaseServices";
import { useUserRole } from "@/lib/useUserRole";
import {
  Badge,
  Button,
  EmptyState,
  LoadingState,
  PageHeader,
  SearchInput,
  SectionHeading,
  Toolbar,
  table,
} from "@/components/ui";

type DirUser = {
  id: string;
  name: string;
  email: string;
  uid: string;
  role: "admin" | "moderator" | "user";
  photoUrl: string;
};

function mapUser(id: string, x: any): DirUser {
  return {
    id,
    name: x?.full_name || x?.display_name || "No Name",
    email: x?.email ?? "",
    uid: x?.uid ?? id,
    role: (x?.role as DirUser["role"]) ?? "user",
    photoUrl: x?.photo_url ?? "",
  };
}

export default function Page() {
  const { role: currentRole, loading: roleLoading } = useUserRole();
  const isAdmin = currentRole === "admin";

  const [moderators, setModerators] = useState<DirUser[]>([]);
  const [modsLoading, setModsLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [allUsers, setAllUsers] = useState<DirUser[]>([]);
  const [allLoading, setAllLoading] = useState(true);

  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) {
      setModsLoading(false);
      setAllLoading(false);
      return;
    }

    const modsQ = query(
      collection(db, "Users"),
      where("role", "==", "moderator"),
    );
    const unsubMods = onSnapshot(
      modsQ,
      (snap) => {
        const data = snap.docs.map((d) => mapUser(d.id, d.data()));
        data.sort((a, b) => a.name.localeCompare(b.name));
        setModerators(data);
        setModsLoading(false);
      },
      (err) => {
        console.error(err);
        setModsLoading(false);
      },
    );

    const usersQ = collection(db, "Users");
    const unsubUsers = onSnapshot(
      usersQ,
      (snap) => {
        const data = snap.docs.map((d) => mapUser(d.id, d.data()));
        data.sort((a, b) => a.name.localeCompare(b.name));
        setAllUsers(data);
        setAllLoading(false);
      },
      (err) => {
        console.error(err);
        setAllLoading(false);
      },
    );

    return () => {
      unsubMods();
      unsubUsers();
    };
  }, [isAdmin]);

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [] as DirUser[];
    return allUsers
      .filter((u) => u.role !== "admin" && u.role !== "moderator")
      .filter(
        (u) =>
          u.name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          u.uid.toLowerCase().includes(q),
      )
      .slice(0, 15);
  }, [allUsers, search]);

  const promote = async (u: DirUser) => {
    if (!isAdmin) return;
    setBusyId(u.id);
    try {
      const adminUid = auth.currentUser?.uid ?? "";
      await updateDoc(doc(db, "Users", u.id), {
        role: "moderator",
        moderator_since: serverTimestamp(),
        moderator_granted_by: adminUid,
      });
      setSearch("");
    } catch (e) {
      console.error(e);
      alert("Promote failed. Check console.");
    } finally {
      setBusyId(null);
    }
  };

  const demote = async (u: DirUser) => {
    if (!isAdmin) return;
    if (!confirm(`Remove ${u.name} as moderator?`)) return;
    setBusyId(u.id);
    try {
      const adminUid = auth.currentUser?.uid ?? "";
      await updateDoc(doc(db, "Users", u.id), {
        role: "user",
        moderator_removed_at: serverTimestamp(),
        moderator_removed_by: adminUid,
      });
    } catch (e) {
      console.error(e);
      alert("Remove failed. Check console.");
    } finally {
      setBusyId(null);
    }
  };

  if (roleLoading) {
    return <LoadingState label="Checking access…" />;
  }

  if (!isAdmin) {
    return (
      <div>
        <PageHeader title="Moderators" />
        <EmptyState
          icon={Lock}
          title="Admins only"
          description="Only admins can manage moderators. Ask an admin if you need access."
          className="mx-auto max-w-xl"
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Moderators"
        description="Promote trusted users to moderators so they can help review reports. Only admins can add or remove moderators."
      />

      <section className="mb-10">
        <SectionHeading title="Add a moderator" />

        <Toolbar>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search users by name, email, or UID…"
          />
        </Toolbar>

        {allLoading ? (
          <LoadingState label="Loading users…" />
        ) : search.trim() === "" ? (
          <EmptyState icon={UserSearch} title="Start typing to find a user to promote." />
        ) : candidates.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="No matching users found (admins and existing moderators are hidden)."
          />
        ) : (
          <UserTable
            users={candidates}
            action={(u) => (
              <Button
                size="sm"
                variant="success"
                icon={UserPlus}
                loading={busyId === u.id}
                onClick={() => promote(u)}
              >
                {busyId === u.id ? "Promoting…" : "Promote"}
              </Button>
            )}
          />
        )}
      </section>

      <section>
        <SectionHeading
          title={
            <span className="inline-flex items-center gap-2">
              Current moderators
              <Badge tone="dark">{moderators.length}</Badge>
            </span>
          }
        />

        {modsLoading ? (
          <LoadingState label="Loading…" />
        ) : moderators.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="No moderators yet." />
        ) : (
          <UserTable
            users={moderators}
            action={(u) => (
              <Button
                size="sm"
                variant="danger"
                icon={UserMinus}
                loading={busyId === u.id}
                onClick={() => demote(u)}
              >
                {busyId === u.id ? "Removing…" : "Remove"}
              </Button>
            )}
          />
        )}
      </section>
    </div>
  );
}

/* Name / Email / UID table shared by the search results and the current
 * moderators list; `action` renders the row's button. */
function UserTable({
  users,
  action,
}: {
  users: DirUser[];
  action: (u: DirUser) => ReactNode;
}) {
  return (
    <div className={table.wrap}>
      <table className={`${table.table} min-w-[600px]`}>
        <thead className={table.thead}>
          <tr>
            <th className={table.th}>Name</th>
            <th className={table.th}>Email</th>
            <th className={table.th}>UID</th>
            <th className={`${table.th} text-right`}>Action</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className={table.row}>
              <td className={`${table.td} font-semibold`}>{u.name}</td>
              <td className={`${table.td} text-black/70`}>{u.email || "-"}</td>
              <td className={`${table.td} font-mono text-xs text-black/55`}>{u.uid}</td>
              <td className={table.td}>
                <div className={table.actions}>{action(u)}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
