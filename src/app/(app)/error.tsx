"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ApplicationError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("FAAMS page failed to render.", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center text-center">
      <p className="text-sm font-semibold text-red-700">Terjadi kesalahan</p>
      <h1 className="mt-2 text-2xl font-bold text-slate-900">
        Halaman tidak dapat dimuat
      </h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Periksa koneksi Anda, lalu coba muat ulang halaman.
      </p>
      <Button className="mt-5" onClick={() => reset()}>
        Coba lagi
      </Button>
    </main>
  );
}
