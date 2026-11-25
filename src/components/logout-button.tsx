"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleLogout() {
    if (!isSupabaseConfigured()) {
      toast.error("Supabase belum dikonfigurasi.");
      return;
    }

    setPending(true);
    const { error } = await createSupabaseBrowserClient().auth.signOut();
    setPending(false);

    if (error) {
      toast.error("Gagal keluar", { description: error.message });
      return;
    }

    router.replace("/login");
    router.refresh();
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={handleLogout}
      className="text-slate-600"
    >
      <LogOut aria-hidden="true" />
      <span className="hidden sm:inline">{pending ? "Keluar..." : "Keluar"}</span>
    </Button>
  );
}
