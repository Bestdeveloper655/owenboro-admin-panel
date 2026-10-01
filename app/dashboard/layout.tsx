"use client";

import Sidebar, { isAdminOnlyPath } from "@/components/Sidebar";
import Navbar from "@/components/Navbar";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebaseServices";

const ALLOWED_ROLES = ["admin", "moderator"];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      try {
        const snap = await getDoc(doc(db, "Users", user.uid));
        const role = (snap.data()?.role as string | undefined) ?? "user";
        if (!ALLOWED_ROLES.includes(role)) {
          setDenied(true);
          await signOut(auth);
          setTimeout(() => router.replace("/login"), 1500);
          return;
        }
        setRole(role);
        setEmail(user.email);
        setLoading(false);
      } catch {
        setDenied(true);
        await signOut(auth);
        setTimeout(() => router.replace("/login"), 1500);
      }
    });

    return () => unsubscribe();
  }, []);

  // The open mobile drawer owns scrolling; Escape closes it.
  useEffect(() => {
    if (!sidebarOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [sidebarOpen]);

  // 🚫 Access denied
  if (denied) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-black px-6">
        <div className="max-w-md rounded-2xl border border-red-500/40 bg-[#0d0d0d] p-10 text-center">
          <h1 className="text-2xl font-bold text-red-400">Access denied</h1>
          <p className="mt-3 text-[#e8dcc7]">
            Your account does not have moderator or admin access. Redirecting…
          </p>
        </div>
      </div>
    );
  }

  // ⏳ Loading Screen
  if (loading) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-black">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#ff6b4a] text-base font-bold text-black">
          OA
        </span>
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#f4ead7]/15 border-t-[#ff6b4a]" />
        <p className="text-sm text-[#f4ead7]/60">Loading dashboard…</p>
      </div>
    );
  }

  const blocked = role !== "admin" && isAdminOnlyPath(pathname);

  // ✅ Main Layout — the sidebar sticks to the viewport and scrolls its own
  // menu; the page content scrolls with the window.
  return (
    <div className="min-h-dvh bg-black text-white lg:flex">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Navbar onMenuClick={() => setSidebarOpen(true)} role={role} email={email} />
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-screen-2xl">
            {blocked ? (
              <div className="mx-auto mt-16 max-w-md rounded-2xl border border-[#ff7a59]/40 bg-[#0d0d0d] p-8 text-center">
                <h1 className="text-2xl font-bold text-[#ff7a59]">Admins only</h1>
                <p className="mt-3 text-[#e8dcc7]">
                  This section can only be managed by an admin.
                </p>
              </div>
            ) : (
              children
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
