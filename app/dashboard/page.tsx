"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { collection, getDocs } from "firebase/firestore";
import { ArrowRight, FolderTree, Layers, Store, type LucideIcon } from "lucide-react";
import { db } from "@/lib/firebaseServices";
import { useUserRole } from "@/lib/useUserRole";
import { menuSections } from "@/components/Sidebar";

export default function DashboardPage() {
  const { role } = useUserRole();
  const isAdmin = role === "admin";

  const [stats, setStats] = useState({
    categories: 0,
    listings: 0,
    subCategories: 0,
  });

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true);

        const [catSnap, productSnap, subSnap] = await Promise.all([
          getDocs(collection(db, "Catagories")),
          getDocs(collection(db, "Products")),
          getDocs(collection(db, "SubCatagories")),
        ]);

        setStats({
          categories: catSnap.size,
          listings: productSnap.size,
          subCategories: subSnap.size,
        });
      } catch (err) {
        console.error("Dashboard error:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  const shortcutSections = menuSections
    .filter((section) => section.title !== "Overview")
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.adminOnly || isAdmin),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-[#ff7a59] sm:text-3xl">
          Dashboard
        </h1>
        <p className="mt-1.5 text-sm text-[#e8dcc7]/80 sm:text-base">
          An overview of the directory and shortcuts to every section.
        </p>
      </div>

      {/* STATS */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          icon={FolderTree}
          value={loading ? "…" : stats.categories}
          label="Categories"
          href={isAdmin ? "/dashboard/category" : undefined}
        />
        <StatCard
          icon={Layers}
          value={loading ? "…" : stats.subCategories}
          label="Sub categories"
          href={isAdmin ? "/dashboard/sub-category" : undefined}
        />
        <StatCard
          icon={Store}
          value={loading ? "…" : stats.listings}
          label="Listings"
          href={isAdmin ? "/dashboard/listings" : undefined}
        />
      </div>

      {/* SHORTCUTS */}
      <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {shortcutSections.map((section) => (
          <section
            key={section.title}
            className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-5"
          >
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#f4ead7]/45">
              {section.title}
            </h2>
            <ul className="mt-3 grid grid-cols-1 gap-1 sm:grid-cols-2">
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.path}>
                    <Link
                      href={item.path}
                      className="group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[#f4ead7]/85 transition hover:bg-white/5 hover:text-[#f4ead7]"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-[#ff6b4a]" aria-hidden />
                      <span className="truncate">{item.name}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

/* STAT CARD */
function StatCard({
  icon: Icon,
  value,
  label,
  href,
}: {
  icon: LucideIcon;
  value: number | string;
  label: string;
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#ff6b4a]/15 text-[#ff6b4a]">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        {href && (
          <ArrowRight
            className="h-4 w-4 text-[#f4ead7]/30 transition group-hover:translate-x-0.5 group-hover:text-[#ff6b4a]"
            aria-hidden
          />
        )}
      </div>
      <p className="mt-5 text-3xl font-bold tabular-nums text-[#f4ead7]">{value}</p>
      <p className="mt-1 text-sm text-[#f4ead7]/60">{label}</p>
    </>
  );

  const className =
    "group block rounded-2xl border border-white/10 bg-[#0d0d0d] p-5 transition";

  return href ? (
    <Link href={href} className={`${className} hover:border-[#ff6b4a]/60`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
