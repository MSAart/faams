"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { ChevronRight, CircleUserRound } from "lucide-react";
import { MobileSidebar } from "@/components/app-sidebar";
import { LogoutButton } from "@/components/logout-button";
import { navigationItems } from "@/lib/navigation";

type AppHeaderProps = {
  email: string;
  displayName: string;
  isAdmin: boolean;
};

export function AppHeader({ email, displayName, isAdmin }: AppHeaderProps) {
  const pathname = usePathname();
  const currentItem = navigationItems.find(
    (item) =>
      item.href === pathname ||
      (item.href !== "/" && pathname.startsWith(`${item.href}/`)),
  );

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
      <div className="flex min-h-[62px] items-center justify-between gap-4 px-4 sm:px-7">
        <div className="flex min-w-0 items-center gap-3">
          <MobileSidebar isAdmin={isAdmin} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              <span className="hidden sm:inline">FAAMS</span>
              <ChevronRight className="hidden size-3 sm:block" />
              <span className="truncate font-medium text-slate-500">
                {currentItem?.label ?? "Dashboard"}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[13px] font-semibold text-[#172B4D]">
              {currentItem?.label ?? "Dashboard"}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <Link
            href="/onboarding"
            aria-label="Lihat atau ubah profil"
            className="flex items-center gap-2.5 border-r border-slate-200 pr-3 sm:pr-4"
          >
            <span className="flex size-8 items-center justify-center rounded-full bg-blue-50 text-blue-700 ring-1 ring-blue-100">
              <CircleUserRound aria-hidden="true" className="size-[17px]" />
            </span>
            <span className="hidden max-w-40 sm:block">
              <span className="block truncate text-[11px] font-semibold text-[#172B4D]">
                {displayName}
              </span>
              <span className="block truncate text-[10px] text-slate-500">
                {email}
              </span>
            </span>
          </Link>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
