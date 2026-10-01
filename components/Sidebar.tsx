"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUserRole } from "@/lib/useUserRole";
import {
  BadgeCheck,
  Bell,
  CalendarDays,
  ChartColumn,
  Flag,
  FolderTree,
  GalleryHorizontalEnd,
  Heart,
  Layers,
  LayoutDashboard,
  LifeBuoy,
  ListOrdered,
  Mail,
  Newspaper,
  PanelTop,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Store,
  Trophy,
  Users,
  UsersRound,
  UserX,
  X,
  type LucideIcon,
} from "lucide-react";

type MenuItem = {
  name: string;
  path: string;
  icon: LucideIcon;
  adminOnly?: boolean;
};

type MenuSection = {
  title: string;
  items: MenuItem[];
};

/* adminOnly: screens that write collections whose Firestore rules allow
 * `role == 'admin'` only (directory content, ContactUs, posts). Moderators
 * would only hit permission errors there, so they don't see them. */
export const menuSections: MenuSection[] = [
  {
    title: "Overview",
    items: [{ name: "Dashboard", path: "/dashboard", icon: LayoutDashboard }],
  },
  {
    title: "Directory",
    items: [
      { name: "Category", path: "/dashboard/category", icon: FolderTree, adminOnly: true },
      { name: "Sub Category", path: "/dashboard/sub-category", icon: Layers, adminOnly: true },
      { name: "Listings", path: "/dashboard/listings", icon: Store, adminOnly: true },
      { name: "Recommended", path: "/dashboard/recommended", icon: Star, adminOnly: true },
      { name: "Display Order", path: "/dashboard/display-order", icon: ListOrdered, adminOnly: true },
    ],
  },
  {
    title: "App Content",
    items: [
      { name: "Banner", path: "/dashboard/banner", icon: GalleryHorizontalEnd, adminOnly: true },
      { name: "Header Image", path: "/dashboard/header-image", icon: PanelTop, adminOnly: true },
      { name: "Challenge", path: "/dashboard/challenge", icon: Trophy, adminOnly: true },
      { name: "Vote for Favourite", path: "/dashboard/vote", icon: Heart, adminOnly: true },
      { name: "Feed Posts", path: "/dashboard/feed-posts", icon: Newspaper, adminOnly: true },
    ],
  },
  {
    title: "Community",
    items: [
      { name: "Groups", path: "/dashboard/groups", icon: UsersRound },
      { name: "Meetups", path: "/dashboard/meetups", icon: CalendarDays },
      { name: "Polls & Questions", path: "/dashboard/polls", icon: ChartColumn },
      { name: "Verify Photos", path: "/dashboard/verify-photos", icon: BadgeCheck },
    ],
  },
  {
    title: "Users & Safety",
    items: [
      { name: "User Info", path: "/dashboard/users", icon: Users },
      { name: "Blocked Users", path: "/dashboard/blocked-users", icon: UserX },
      { name: "Reports", path: "/dashboard/reports", icon: Flag },
      { name: "Moderators", path: "/dashboard/moderators", icon: ShieldCheck, adminOnly: true },
    ],
  },
  {
    title: "Messaging",
    items: [
      { name: "Notifications", path: "/dashboard/notifications", icon: Bell },
      { name: "Newsletter", path: "/dashboard/newsletter", icon: Mail },
      { name: "Contact Support", path: "/dashboard/contact", icon: LifeBuoy, adminOnly: true },
    ],
  },
  {
    title: "Settings",
    items: [{ name: "App Config", path: "/dashboard/app-config", icon: SlidersHorizontal }],
  },
];

export const menuItems: MenuItem[] = menuSections.flatMap((section) => section.items);

function matchesPath(pathname: string, itemPath: string): boolean {
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
}

export function isAdminOnlyPath(pathname: string): boolean {
  return menuItems.some((item) => item.adminOnly && matchesPath(pathname, item.path));
}

/* The section and item for the current page, for the header breadcrumb. */
export function findMenuEntry(
  pathname: string,
): { section: string; item: MenuItem } | null {
  for (const section of menuSections) {
    for (const item of section.items) {
      const isRoot = item.path === "/dashboard";
      if (isRoot ? pathname === item.path : matchesPath(pathname, item.path)) {
        return { section: section.title, item };
      }
    }
  }
  return null;
}

type Props = {
  open?: boolean;
  onClose?: () => void;
};

export default function Sidebar({ open = false, onClose }: Props) {
  const pathname = usePathname();
  const { role } = useUserRole();
  const isAdmin = role === "admin";
  const active = findMenuEntry(pathname);
  const navRef = useRef<HTMLElement>(null);

  // Keep the current page's link visible inside the menu's own scroll area.
  useEffect(() => {
    const nav = navRef.current;
    const link = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !link) return;
    const top = link.offsetTop - nav.offsetTop;
    const bottom = top + link.offsetHeight;
    if (top < nav.scrollTop || bottom > nav.scrollTop + nav.clientHeight) {
      nav.scrollTop = top - (nav.clientHeight - link.offsetHeight) / 2;
    }
  }, [pathname, role]);

  const visibleSections = menuSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.adminOnly || isAdmin),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <>
      {/* Backdrop for mobile drawer */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-30 bg-black/70 backdrop-blur-sm transition-opacity lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-hidden="true"
      />

      {/* Fixed drawer on mobile; on desktop it sticks to the viewport and
       * scrolls its own menu, independently of the page content. */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex h-dvh w-72 flex-col border-r border-white/10 bg-[#0d0d0d] transition-transform duration-300 lg:sticky lg:top-0 lg:z-auto lg:w-64 lg:shrink-0 lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Sidebar"
      >
        <div className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-white/10 px-5">
          <Link href="/dashboard" onClick={onClose} className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#ff6b4a] text-sm font-bold text-black">
              OA
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-semibold text-[#f4ead7]">
                The Owensboro App
              </span>
              <span className="block text-xs text-[#f4ead7]/50">Admin panel</span>
            </span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-[#f4ead7]/70 transition hover:bg-white/5 hover:text-[#f4ead7] lg:hidden"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav
          ref={navRef}
          className="sidebar-scroll flex-1 overflow-y-auto overscroll-contain px-3 py-4">
          {visibleSections.map((section) => (
            <div key={section.title} className="mb-5 last:mb-0">
              <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-[#f4ead7]/40">
                {section.title}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive = active?.item.path === item.path;
                  const Icon = item.icon;

                  return (
                    <li key={item.path}>
                      <Link
                        href={item.path}
                        onClick={onClose}
                        aria-current={isActive ? "page" : undefined}
                        className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                          isActive
                            ? "bg-[#ff6b4a] text-black"
                            : "text-[#f4ead7]/75 hover:bg-white/5 hover:text-[#f4ead7]"
                        }`}
                      >
                        <Icon
                          className={`size-4.5 shrink-0 ${
                            isActive
                              ? "text-black"
                              : "text-[#f4ead7]/45 group-hover:text-[#ff6b4a]"
                          }`}
                          aria-hidden
                        />
                        <span className="truncate">{item.name}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}
