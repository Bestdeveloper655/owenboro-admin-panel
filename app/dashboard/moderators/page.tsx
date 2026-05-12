"use client";

import { useEffect, useMemo, useState } from "react";
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
    return (
      <div className="px-6 pt-6 pb-10 text-[#e8dcc7]">Checking access…</div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="px-6 pt-6 pb-10">
        <div className="mx-auto max-w-xl rounded-3xl border border-red-500/40 bg-[#0a0a0a] p-10 text-center">
          <h1 className="text-3xl font-bold text-red-400">Admins only</h1>
          <p className="mt-3 text-[#e8dcc7]">
            Only admins can manage moderators. Ask an admin if you need access.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 pt-6 pb-10">
      <div className="mb-8">
        <h1 className="text-5xl font-bold text-[#ff7a59]">Moderators</h1>
        <p className="mt-2 text-lg text-[#e8dcc7]">
          Promote trusted users to moderators so they can help review reports.
          Only admins can add or remove moderators.
        </p>
      </div>

      <section className="mb-8 rounded-3xl border border-[#ff7a59]/40 bg-[#0a0a0a] p-6">
        <h2 className="mb-4 text-3xl font-bold text-[#ff7a59]">
          Add a moderator
        </h2>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search users by name, email, or UID…"
          className="w-full rounded-xl border border-[#ff7a59]/40 bg-[#1a1a1a] p-3 text-[#f3ead7] placeholder:text-[#f3ead7]/50 outline-none focus:border-[#ff7a59]"
        />

        {allLoading ? (
          <p className="mt-4 text-[#f3ead7]/70">Loading users…</p>
        ) : search.trim() === "" ? (
          <p className="mt-4 text-[#f3ead7]/70">
            Start typing to find a user to promote.
          </p>
        ) : candidates.length === 0 ? (
          <p className="mt-4 text-[#f3ead7]/70">
            No matching users found (admins and existing moderators are hidden).
          </p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
            <table className="w-full text-left">
              <thead className="bg-[#ece2cb] text-black">
                <tr>
                  <th className="p-3">Name</th>
                  <th className="p-3">Email</th>
                  <th className="p-3">UID</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((u) => (
                  <tr
                    key={u.id}
                    className="border-b bg-[#ece2cb] text-black hover:bg-[#f5ecd7]"
                  >
                    <td className="p-3 font-semibold">{u.name}</td>
                    <td className="p-3 text-[#ff7a59]">{u.email || "-"}</td>
                    <td className="p-3 text-xs">{u.uid}</td>
                    <td className="p-3 text-right">
                      <button
                        disabled={busyId === u.id}
                        onClick={() => promote(u)}
                        className="rounded-lg bg-green-600 px-3 py-1 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                      >
                        {busyId === u.id ? "Promoting…" : "Promote"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-[#ff7a59]/40 bg-[#0a0a0a] p-6">
        <h2 className="mb-6 text-3xl font-bold text-[#ff7a59]">
          Current moderators ({moderators.length})
        </h2>

        {modsLoading ? (
          <p className="text-[#f3ead7]">Loading…</p>
        ) : moderators.length === 0 ? (
          <p className="text-[#f3ead7]/70">No moderators yet.</p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-white/10">
            <table className="w-full text-left">
              <thead className="bg-[#ece2cb] text-black">
                <tr>
                  <th className="p-3">Name</th>
                  <th className="p-3">Email</th>
                  <th className="p-3">UID</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {moderators.map((u) => (
                  <tr
                    key={u.id}
                    className="border-b bg-[#ece2cb] text-black hover:bg-[#f5ecd7]"
                  >
                    <td className="p-3 font-semibold">{u.name}</td>
                    <td className="p-3 text-[#ff7a59]">{u.email || "-"}</td>
                    <td className="p-3 text-xs">{u.uid}</td>
                    <td className="p-3 text-right">
                      <button
                        disabled={busyId === u.id}
                        onClick={() => demote(u)}
                        className="rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        {busyId === u.id ? "Removing…" : "Remove"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
