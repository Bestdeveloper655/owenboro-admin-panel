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

/* adminOnly: screens that write collections whose Firestore rules allow
 * `role == 'admin'` only (directory content, ContactUs, posts). Moderators
 * would only hit permission errors there, so they don't see them. */
export const menuItems: MenuItem[] = [
  { name: "Dashboard", path: "/dashboard" },
  { name: "Category", path: "/dashboard/category", adminOnly: true },
  { name: "Sub Category", path: "/dashboard/sub-category", adminOnly: true },
  { name: "Listings", path: "/dashboard/listings", adminOnly: true },
  { name: "Recommended", path: "/dashboard/recommended", adminOnly: true },
  { name: "Display Order", path: "/dashboard/display-order", adminOnly: true },
  { name: "Banner", path: "/dashboard/banner", adminOnly: true },
  { name: "Header Image", path: "/dashboard/header-image", adminOnly: true },
  { name: "Challenge", path: "/dashboard/challenge", adminOnly: true },
  { name: "Vote for Favourite", path: "/dashboard/vote", adminOnly: true },
  { name: "Feed Posts", path: "/dashboard/feed-posts", adminOnly: true },
  { name: "Contact Support", path: "/dashboard/contact", adminOnly: true },
  { name: "User Info", path: "/dashboard/users" },
  { name: "Blocked Users", path: "/dashboard/blocked-users" },
  { name: "Newsletter", path: "/dashboard/newsletter" },
  { name: "Verify Photos", path: "/dashboard/verify-photos" },
  { name: "Notifications", path: "/dashboard/notifications" },
  { name: "App Config", path: "/dashboard/app-config" },
  { name: "Groups", path: "/dashboard/groups" },
  { name: "Meetups", path: "/dashboard/meetups" },
  { name: "Polls & Questions", path: "/dashboard/polls" },
  { name: "Reports", path: "/dashboard/reports" },
  { name: "Moderators", path: "/dashboard/moderators", adminOnly: true },
];

export function isAdminOnlyPath(pathname: string): boolean {
  return menuItems.some(
    (item) =>
      item.adminOnly &&
      (pathname === item.path || pathname.startsWith(`${item.path}/`)),
  );
}

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
