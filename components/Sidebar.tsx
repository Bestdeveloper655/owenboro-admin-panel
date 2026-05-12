"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUserRole } from "@/lib/useUserRole";
import { X } from "lucide-react";

type MenuItem = {
  name: string;
  path: string;
  adminOnly?: boolean;
};

const menuItems: MenuItem[] = [
  { name: "Dashboard", path: "/dashboard" },
  { name: "Category", path: "/dashboard/category" },
  { name: "Sub Category", path: "/dashboard/sub-category" },
  { name: "Listings", path: "/dashboard/listings" },
  { name: "Banner", path: "/dashboard/banner" },
  { name: "Header Image", path: "/dashboard/header-image" },
  { name: "Challenge", path: "/dashboard/challenge" },
  { name: "Vote for Favourite", path: "/dashboard/vote" },
  { name: "Contact Support", path: "/dashboard/contact" },
  { name: "User Info", path: "/dashboard/users" },
  { name: "Verify Photos", path: "/dashboard/verify-photos" },
  { name: "Notifications", path: "/dashboard/notifications" },
  { name: "App Config", path: "/dashboard/app-config" },
  { name: "Groups", path: "/dashboard/groups" },
  { name: "Reports", path: "/dashboard/reports" },
  { name: "Moderators", path: "/dashboard/moderators", adminOnly: true },
];

type Props = {
  open?: boolean;
  onClose?: () => void;
};

export default function Sidebar({ open = false, onClose }: Props) {
  const pathname = usePathname();
  const { role } = useUserRole();
  const isAdmin = role === "admin";

  const visibleItems = menuItems.filter(
    (item) => !item.adminOnly || isAdmin,
  );

  return (
    <>
      {/* Backdrop for mobile drawer */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-30 bg-black/60 transition-opacity lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-hidden="true"
      />

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col overflow-y-auto bg-[#efe5cf] p-4 text-black transition-transform duration-300 sm:w-[290px] lg:static lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
        aria-label="Sidebar"
      >
        {/* Close button on mobile */}
        <div className="mb-2 flex justify-end lg:hidden">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-black/70 hover:bg-black/5"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-2 space-y-2 lg:mt-32">
          {visibleItems.map((item) => {
            const isActive = pathname === item.path;

            return (
              <Link
                key={item.path}
                href={item.path}
                onClick={onClose}
                className={`block rounded-lg px-4 py-3 text-lg transition lg:text-2xl ${
                  isActive
                    ? "bg-[#ff6b4a] text-white"
                    : "text-black hover:bg-[#ff6b4a] hover:text-white"
                }`}
              >
                {item.name}
              </Link>
            );
          })}
        </div>
      </aside>
    </>
  );
}
