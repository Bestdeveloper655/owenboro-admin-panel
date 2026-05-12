"use client";

import { signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebaseServices";
import { LogOut, Loader2, Menu } from "lucide-react";
import { useState } from "react";

type Props = {
  onMenuClick?: () => void;
};

export default function Navbar({ onMenuClick }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleLogout = async () => {
    try {
      setLoading(true);
      await signOut(auth);
      router.push("/login");
    } catch (error) {
      console.error("Logout failed:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <header className="flex items-center justify-between gap-3 px-4 py-4 sm:px-6 sm:py-5 lg:px-10 lg:py-6">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Open menu"
          className="rounded-xl border border-[#ff6b4a]/60 p-2 text-[#ff6b4a] transition hover:bg-[#ff6b4a]/10 lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="truncate text-xl font-bold text-[#f3ead7] sm:text-2xl lg:text-5xl">
          The Owensboro App
        </h1>
      </div>

      <button
        onClick={handleLogout}
        disabled={loading}
        className="flex shrink-0 items-center gap-2 rounded-xl border border-[#ff6b4a] bg-black px-3 py-2 text-sm font-semibold text-[#ff6b4a] transition-all duration-200 hover:bg-[#ff6b4a] hover:text-black active:scale-95 disabled:opacity-60 sm:gap-3 sm:rounded-2xl sm:px-5 sm:py-3 sm:text-base lg:px-6 lg:text-lg"
      >
        {loading ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="hidden sm:inline">Logging out...</span>
          </>
        ) : (
          <>
            <LogOut className="h-5 w-5" />
            <span className="hidden sm:inline">Logout</span>
          </>
        )}
      </button>
    </header>
  );
}
