"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const menuItems = [
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

];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="min-h-screen w-[290px] bg-[#efe5cf] p-4 text-black">
      <div className="mt-32 space-y-2">
        {menuItems.map((item) => {
          const isActive = pathname === item.path;

          return (
            <Link
              key={item.path}
              href={item.path}
              className={`block rounded-lg px-4 py-3 text-2xl transition ${
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
  );
}