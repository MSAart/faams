import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-[70vh] flex-col items-center justify-center px-5 text-center">
      <p className="text-sm font-semibold text-primary">404</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
        Halaman tidak ditemukan
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        Alamat yang Anda buka tidak tersedia di FAAMS.
      </p>
      <Button render={<Link href="/" />} className="mt-6">
        Kembali ke dashboard
      </Button>
    </main>
  );
}
