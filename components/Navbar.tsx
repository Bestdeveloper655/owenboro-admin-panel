"use client";

import { signOut } from "firebase/auth";
import { usePathname, useRouter } from "next/navigation";
import { auth } from "@/lib/firebaseServices";
import { findMenuEntry } from "@/components/Sidebar";
import { ChevronRight, LogOut, Loader2, Menu } from "lucide-react";
import { useState } from "react";

type Props = {
  onMenuClick?: () => void;
  role?: string | null;
  email?: string | null;
};

export default function Navbar({ onMenuClick, role, email }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(false);

  const entry = findMenuEntry(pathname);

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
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-black/85 px-4 backdrop-blur sm:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Open menu"
          className="rounded-lg border border-white/15 p-2 text-[#f4ead7] transition hover:border-[#ff6b4a] hover:text-[#ff6b4a] lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>

        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
          {entry && entry.section !== "Overview" && (
            <>
              <span className="hidden text-[#f4ead7]/45 sm:inline">{entry.section}</span>
              <ChevronRight className="hidden h-4 w-4 shrink-0 text-[#f4ead7]/30 sm:inline" aria-hidden />
            </>
          )}
          <span className="truncate font-semibold text-[#f4ead7]">
            {entry?.item.name ?? "Dashboard"}
          </span>
        </nav>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {(email || role) && (
          <div className="hidden min-w-0 text-right leading-tight md:block">
            {email && (
              <p className="max-w-55 truncate text-sm text-[#f4ead7]">{email}</p>
            )}
            {role && (
              <p className="text-xs capitalize text-[#f4ead7]/50">{role}</p>
            )}
          </div>
        )}

        <button
          onClick={handleLogout}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-sm font-medium text-[#f4ead7] transition hover:border-[#ff6b4a] hover:text-[#ff6b4a] disabled:opacity-60"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <LogOut className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">{loading ? "Logging out…" : "Log out"}</span>
        </button>
      </div>
    </header>
  );
}
