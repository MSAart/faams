"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("FAAMS encountered a critical application error.", error);
  }, [error]);

  return (
    <html lang="id">
      <body className="flex min-h-screen items-center justify-center bg-slate-50 p-6 font-sans text-slate-900">
        <main className="max-w-md text-center">
          <h1 className="text-2xl font-bold">Aplikasi mengalami kendala</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Silakan coba muat ulang. Jika masalah berlanjut, periksa log
            aplikasi.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            className="mt-5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
          >
            Coba lagi
          </button>
        </main>
      </body>
    </html>
  );
}
