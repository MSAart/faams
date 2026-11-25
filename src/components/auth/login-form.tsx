"use client";

import Link from "next/link";
import { useState } from "react";
import { z } from "zod";
import type { AuthError } from "@supabase/supabase-js";
import { LockKeyhole } from "lucide-react";
import { AppLogo } from "@/components/app-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

const loginSchema = z.object({
  email: z.email("Masukkan alamat email yang valid.").trim().toLowerCase(),
  password: z.string().min(1, "Masukkan password."),
});

const loginMessages: Record<string, string> = {
  configuration:
    "Supabase belum dikonfigurasi. Lengkapi environment variables sebelum login.",
  session: "Sesi tidak dapat divalidasi. Silakan login kembali.",
  profile: "Profil administrator tidak dapat diverifikasi.",
  unauthorized: "Akun ini tidak memiliki akses administrator FAAMS.",
  callback: "Tautan autentikasi tidak valid atau sudah kedaluwarsa.",
  rate_limit: "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.",
  network:
    "Tidak dapat menghubungi Supabase. Periksa koneksi internet dan konfigurasi project.",
};

function getAuthErrorMessage(error: AuthError) {
  if (/fetch|network|connection|load failed/i.test(error.message)) {
    return loginMessages.network;
  }
  if (error.status === 429) {
    return loginMessages.rate_limit;
  }
  if (
    error.code === "email_not_confirmed" ||
    error.message.toLowerCase().includes("email not confirmed")
  ) {
    return "Email akun belum dikonfirmasi. Periksa email atau pengaturan Auth Supabase.";
  }
  if (error.status === 400 || error.message === "Invalid login credentials") {
    return "Email atau password tidak sesuai.";
  }
  return error.message || "Login gagal. Silakan coba kembali.";
}

type LoginFormProps = {
  nextPath: string;
  errorCode?: string;
};

export function LoginForm({ nextPath, errorCode }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState(
    errorCode ? loginMessages[errorCode] ?? "Silakan login kembali." : "",
  );
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setSubmitted(true);

    const result = loginSchema.safeParse({ email, password });
    if (!result.success) {
      setEmailError(
        result.error.issues.find((issue) => issue.path[0] === "email")
          ?.message ?? "",
      );
      setPasswordError(
        result.error.issues.find((issue) => issue.path[0] === "password")
          ?.message ?? "",
      );
      setErrorMessage(result.error.issues[0]?.message ?? "Periksa data login.");
      return;
    }
    setEmailError("");
    setPasswordError("");
    if (!isSupabaseConfigured()) {
      setErrorMessage(loginMessages.configuration);
      return;
    }

    setPending(true);
    try {
      const { error } =
        await createSupabaseBrowserClient().auth.signInWithPassword(
          result.data,
        );
      if (error) {
        setErrorMessage(getAuthErrorMessage(error));
        return;
      }

      window.location.assign(nextPath);
    } catch (error) {
      console.error("FAAMS login request failed unexpectedly.", error);
      const message = error instanceof Error ? error.message : "";
      setErrorMessage(
        /fetch|network|connection|load failed/i.test(message)
          ? loginMessages.network
          : message || "Login gagal karena kesalahan yang tidak diketahui.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="w-full max-w-[420px] rounded-2xl border border-white/80 bg-white/95 p-6 shadow-[0_24px_80px_-32px_rgba(15,35,70,0.3)] backdrop-blur sm:p-8">
      <div className="mb-7">
        <AppLogo className="mb-7 h-auto w-[min(100%,300px)] object-contain object-left" />
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          Finance Administration
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
          Masuk ke FAAMS
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Masuk menggunakan akun yang telah diundang administrator FAAMS.
        </p>
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            aria-invalid={Boolean(emailError)}
            aria-describedby={emailError ? "email-error" : undefined}
            placeholder="nama@perusahaan.com"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setErrorMessage("");
              if (submitted) {
                const result = z.email().safeParse(event.target.value.trim());
                setEmailError(
                  result.success ? "" : "Masukkan alamat email yang valid.",
                );
              }
            }}
            disabled={pending}
          />
          {emailError && (
            <p id="email-error" className="text-xs text-red-700">
              {emailError}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="password">Password</Label>
            <Link
              href="/forgot-password"
              className="text-xs font-medium text-primary hover:underline"
            >
              Lupa password?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            aria-invalid={Boolean(passwordError)}
            aria-describedby={passwordError ? "password-error" : undefined}
            placeholder="Masukkan password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              setErrorMessage("");
              if (submitted && event.target.value.length > 0) {
                setPasswordError("");
              }
            }}
            disabled={pending}
          />
          {passwordError && (
            <p id="password-error" className="text-xs text-red-700">
              {passwordError}
            </p>
          )}
        </div>
        {errorMessage && (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
          >
            {errorMessage}
          </p>
        )}
        {pending && (
          <p role="status" aria-live="polite" className="text-sm text-slate-600">
            Sedang menghubungi Supabase untuk memverifikasi akun…
          </p>
        )}
        {!isSupabaseConfigured() && !errorMessage && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
            Konfigurasi Supabase tidak tersedia di aplikasi browser. Periksa
            NEXT_PUBLIC_SUPABASE_URL dan NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
            lalu build ulang aplikasi.
          </p>
        )}
        <Button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className="h-10 w-full gap-2"
        >
          <LockKeyhole aria-hidden="true" className="size-4" />
          {pending ? "Menghubungi Supabase..." : "Masuk"}
        </Button>
      </form>

      <p className="mt-6 text-center text-xs leading-5 text-slate-500">
        Aplikasi internal FAAMS. Hubungi administrator jika Anda belum memiliki akun.
      </p>
    </section>
  );
}
