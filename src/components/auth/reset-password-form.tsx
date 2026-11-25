"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { KeyRound, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

const passwordSchema = z
  .object({
    password: z.string().min(8, "Password minimal 8 karakter."),
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Konfirmasi password tidak sama.",
    path: ["confirmPassword"],
  });

export function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");

    const result = passwordSchema.safeParse({ password, confirmPassword });
    if (!result.success) {
      setErrorMessage(result.error.issues[0]?.message ?? "Periksa password.");
      return;
    }
    if (!isSupabaseConfigured()) {
      setErrorMessage("Supabase belum dikonfigurasi.");
      return;
    }

    setPending(true);
    const { error } = await createSupabaseBrowserClient().auth.updateUser({
      password: result.data.password,
    });
    setPending(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    router.replace("/login?passwordReset=success");
    router.refresh();
  }

  return (
    <section className="w-full max-w-[420px] rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-white">
        <Wallet aria-hidden="true" className="size-5" />
      </span>
      <div className="mt-5">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          Pemulihan akun
        </p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">
          Buat password baru
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Gunakan password minimal 8 karakter.
        </p>
      </div>
      <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
        <div className="space-y-2">
          <Label htmlFor="password">Password baru</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={pending}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm-password">Konfirmasi password</Label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            disabled={pending}
          />
        </div>
        {errorMessage && (
          <p role="alert" className="text-sm text-red-700">
            {errorMessage}
          </p>
        )}
        <Button type="submit" disabled={pending} className="w-full gap-2">
          <KeyRound aria-hidden="true" className="size-4" />
          {pending ? "Menyimpan..." : "Simpan password"}
        </Button>
      </form>
      <Link
        href="/login"
        className="mt-6 inline-flex text-sm font-medium text-slate-600 hover:text-primary"
      >
        Kembali ke login
      </Link>
    </section>
  );
}
