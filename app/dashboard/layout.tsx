"use client";

import Sidebar from "@/components/Sidebar";
import Navbar from "@/components/Navbar";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  // ✅ Sparkles state (FIXED - no random in render)
  const [dots, setDots] = useState<
    { top: string; left: string; delay: string }[]
  >([]);

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
        setLoading(false);
      } catch {
        setDenied(true);
        await signOut(auth);
        setTimeout(() => router.replace("/login"), 1500);
      }
    });

    return () => unsubscribe();
  }, []);

  // ✅ Generate random dots ONLY on client (after mount)
  useEffect(() => {
    const generated = [...Array(6)].map(() => ({
      top: `${Math.random() * 100}%`,
      left: `${Math.random() * 100}%`,
      delay: `${Math.random()}s`,
    }));
    setDots(generated);
  }, []);

  // 🚫 Access denied
  if (denied) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black px-6">
        <div className="max-w-md rounded-3xl border border-red-500/40 bg-[#0a0a0a] p-10 text-center">
          <h1 className="text-3xl font-bold text-red-400">Access denied</h1>
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
      <div className="flex flex-col items-center justify-center h-screen bg-black relative overflow-hidden">
        {/* Spinner */}
        <div className="relative flex items-center justify-center w-28 h-28">
          <div className="absolute w-28 h-28 rounded-full border-4 border-[#f4ead7]/20 border-t-[#ff6b4a] animate-spin shadow-[0_0_20px_#ff6b4a]"></div>
          <div className="absolute w-20 h-20 rounded-full bg-black shadow-inner"></div>
        </div>

        {/* Text */}
        <p className="mt-6 text-2xl font-bold text-[#f4ead7] tracking-wider animate-pulse drop-shadow-[0_0_10px_#ff6b4a]">
          Loading Dashboard...
        </p>

        {/* Glow Bar */}
        <div className="mt-5 h-1 w-36 rounded-full bg-gradient-to-r from-[#ff6b4a]/60 via-[#f4ead7]/40 to-[#ff6b4a]/60 animate-pulse shadow-[0_0_10px_#ff6b4a]"></div>

        {/* ✅ Sparkles (SAFE) */}
        <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
          {dots.map((dot, i) => (
            <div
              key={i}
              className="absolute w-2 h-2 bg-[#ff6b4a] rounded-full animate-ping"
              style={{
                top: dot.top,
                left: dot.left,
                animationDelay: dot.delay,
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  // ✅ Main Layout
  return (
    <div className="flex min-h-screen bg-black text-white">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <Navbar />
        <main className="flex-1 pt-4 pb-4 px-8">{children}</main>
      </div>
    </div>
  );
}