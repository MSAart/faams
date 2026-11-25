"use client";

import { useState } from "react";
import { AppHeader } from "@/components/app-header";
import { DesktopSidebar } from "@/components/app-sidebar";

type AppShellProps = {
  children: React.ReactNode;
  email: string;
  displayName: string;
  isAdmin: boolean;
};

export function AppShell({ children, email, displayName, isAdmin }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="min-h-screen">
      <DesktopSidebar collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} isAdmin={isAdmin} />
      <div className={`min-h-screen transition-[padding] duration-200 ${collapsed ? "lg:pl-[76px]" : "lg:pl-[258px]"}`}>
        <AppHeader email={email} displayName={displayName} isAdmin={isAdmin} />
        <main className="mx-auto w-full min-w-0 max-w-[1440px] px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
