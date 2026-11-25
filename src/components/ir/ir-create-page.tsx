import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";
import { IRRegistrationForm, type IRType } from "@/components/ir/ir-management-forms";
import { Button } from "@/components/ui/button";
import { getCurrentISODate } from "@/lib/format-number";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function IRCreatePage({ irType }: { irType: IRType }) {
  const isOperational = irType === "operasional";
  const listPath = isOperational ? "/ir-operasional" : "/ir-facility-management";
  const pageTitle = isOperational ? "IR Operasional" : "IR Facility Management";
  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) throw new Error("Sesi pengguna gagal diverifikasi.");
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (profileError) throw new Error(`Profil pemohon gagal dimuat: ${profileError.message}`);
  if (!profile?.display_name) throw new Error("Nama pada profil pemohon belum tersedia.");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Button render={<Link href={listPath} />} variant="outline" className="gap-2">
        <ArrowLeft aria-hidden="true" />
        Kembali ke {pageTitle}
      </Button>
      <section>
        <div className="mb-3 inline-flex size-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
          <FileText aria-hidden="true" className="size-5" />
        </div>
        <p className="text-sm font-medium text-slate-500">Pengajuan baru</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
          Buat {pageTitle}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          Isi informasi pengajuan. Setelah tersimpan, tambahkan transaksi dan alokasi sumber dananya pada halaman detail.
        </p>
      </section>
      <IRRegistrationForm irType={irType} initialDate={getCurrentISODate()} applicantName={profile.display_name} />
    </div>
  );
}
