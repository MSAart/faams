"use client";

import Link from "next/link";
import { useState } from "react";
import { z } from "zod";
import { ArrowLeft, MailCheck, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

const emailSchema = z.email("Masukkan alamat email yang valid.");

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");

    const result = emailSchema.safeParse(email);
    if (!result.success) {
      setErrorMessage(result.error.issues[0]?.message ?? "Periksa alamat email.");
      return;
    }
    if (!isSupabaseConfigured()) {
      setErrorMessage("Supabase belum dikonfigurasi.");
      return;
    }

    setPending(true);
    const redirectTo = new URL(
      "/auth/callback?next=/reset-password",
      window.location.origin,
    ).toString();
    const { error } = await createSupabaseBrowserClient().auth.resetPasswordForEmail(
      result.data,
      { redirectTo },
    );
    setPending(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }
    setSent(true);
  }

  return (
    <section className="w-full max-w-[420px] rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-white">
        <Wallet aria-hidden="true" className="size-5" />
      </span>
      {sent ? (
        <div className="mt-6">
          <span className="flex size-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
            <MailCheck aria-hidden="true" className="size-5" />
          </span>
          <h1 className="mt-4 text-2xl font-bold text-slate-900">
            Periksa email Anda
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Jika alamat terdaftar, tautan untuk mengatur ulang password telah
            dikirim ke <strong>{email}</strong>.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            Kembali ke login
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-5">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              Pemulihan akun
            </p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">
              Lupa password?
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Masukkan email akun administrator untuk menerima tautan reset.
            </p>
          </div>
          <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={pending}
              />
            </div>
            {errorMessage && (
              <p role="alert" className="text-sm text-red-700">
                {errorMessage}
              </p>
            )}
            <Button
              type="submit"
              disabled={pending || !isSupabaseConfigured()}
              className="w-full"
            >
              {pending ? "Mengirim..." : "Kirim tautan reset"}
            </Button>
          </form>
          <Link
            href="/login"
            className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-primary"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            Kembali ke login
          </Link>
        </>
      )}
    </section>
  );
}
