"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, PanelLeftClose, PanelLeftOpen, Wallet } from "lucide-react";
import { AppLogo } from "@/components/app-logo";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { navigationItems } from "@/lib/navigation";
import { cn } from "@/lib/utils";

function NavigationLinks({
  onNavigate,
  collapsed = false,
  isAdmin,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const groups = ["Utama", "Keuangan", "Kontrol & Laporan"] as const;

  return (
    <nav aria-label="Navigasi utama" className="space-y-4 px-2.5 py-4">
      {groups.map((group) => (
        <section key={group} aria-label={group}>
          {!collapsed && <h2 className="mb-1.5 px-3 text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-400">{group}</h2>}
          <ul className="space-y-0.5">
            {navigationItems
              .filter((item) => item.group === group && (!item.adminOnly || isAdmin))
              .map((item) => {
                const active =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname === item.href ||
                      pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-9 items-center gap-2.5 rounded-lg px-3 text-[12px] font-medium transition-colors",
                        active
                          ? "bg-[#edf4ff] text-[#17365D] ring-1 ring-blue-100/80"
                          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                        collapsed && "justify-center px-0",
                      )}
                      title={collapsed ? item.label : undefined}
                    >
                      <Icon aria-hidden="true" className="size-[17px] shrink-0" />
                      {!collapsed && <span>{item.label}</span>}
                    </Link>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </nav>
  );
}

function Brand({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <Link href="/" aria-label="FAAMS — Beranda" className={`flex items-center py-4 ${collapsed ? "justify-center px-3" : "px-5"}`}>
      {collapsed ? (
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-white">
          <Wallet aria-hidden="true" className="size-5" />
        </span>
      ) : (
        <AppLogo className="h-auto w-[208px] object-contain" />
      )}
    </Link>
  );
}

export function DesktopSidebar({
  collapsed,
  onToggle,
  isAdmin,
}: {
  collapsed: boolean;
  onToggle: () => void;
  isAdmin: boolean;
}) {
  return (
    <aside className={`fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-slate-200 bg-white transition-[width] duration-200 lg:flex ${collapsed ? "w-[76px]" : "w-[258px]"}`}>
      <div className={`flex items-center ${collapsed ? "justify-center" : "justify-between pr-3"}`}>
        <Brand collapsed={collapsed} />
        {!collapsed && (
          <button
            type="button"
            onClick={onToggle}
            aria-label="Ciutkan sidebar"
            title="Ciutkan sidebar"
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          >
            <PanelLeftClose aria-hidden="true" className="size-4" />
          </button>
        )}
      </div>
      {collapsed && (
        <button
          type="button"
          onClick={onToggle}
          aria-label="Perluas sidebar"
          title="Perluas sidebar"
          className="mx-auto mb-2 flex size-8 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
        >
          <PanelLeftOpen aria-hidden="true" className="size-4" />
        </button>
      )}
      <div className="mx-4 border-t border-slate-100" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <NavigationLinks collapsed={collapsed} isAdmin={isAdmin} />
      </div>
      {!collapsed && <div className="border-t border-slate-100 px-5 py-4">
        <p className="text-xs font-medium text-slate-600">FAAMS Foundation</p>
        <p className="mt-1 text-[11px] text-slate-400">Personal workspace</p>
      </div>}
    </aside>
  );
}

export function MobileSidebar({ isAdmin }: { isAdmin: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="lg:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          aria-label="Buka navigasi"
          className="inline-flex size-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
        >
          <Menu aria-hidden="true" className="size-5" />
        </SheetTrigger>
        <SheetContent side="left" className="w-[290px] p-0">
          <SheetHeader className="p-0">
            <SheetTitle className="sr-only">Navigasi FAAMS</SheetTitle>
            <Brand />
          </SheetHeader>
          <div className="mx-5 border-t border-slate-100" />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <NavigationLinks onNavigate={() => setOpen(false)} isAdmin={isAdmin} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
