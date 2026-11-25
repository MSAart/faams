import Link from "next/link";
import { ArrowLeft, WalletCards } from "lucide-react";
import { IPRegistrationForm } from "@/components/internal-prepayment/ip-registration-form";
import { Button } from "@/components/ui/button";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function NewInternalPrepaymentPage() {
  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) throw new Error("Sesi pengguna gagal diverifikasi.");
  const [
    { data: categories, error },
    { data: profile, error: profileError },
  ] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name")
      .eq("is_active", true)
      .order("scope")
      .order("name"),
    supabase.from("profiles").select("display_name").eq("id", authData.user.id).maybeSingle(),
  ]);

  if (error) {
    throw new Error(`Kategori IP gagal dimuat: ${error.message}`);
  }
  if (profileError) throw new Error(`Profil pemohon gagal dimuat: ${profileError.message}`);
  if (!profile?.display_name) throw new Error("Nama pada profil pemohon belum tersedia.");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Button render={<Link href="/internal-prepayment" />} variant="outline" className="gap-2">
        <ArrowLeft aria-hidden="true" />
        Kembali ke Internal Prepayment
      </Button>
      <section>
        <div className="mb-3 inline-flex size-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
          <WalletCards aria-hidden="true" className="size-5" />
        </div>
        <p className="text-sm font-medium text-slate-500">Pengajuan baru</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
          Ajukan Internal Prepayment
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          Isi informasi kegiatan dan rincian anggaran. Nomor resmi IP dapat dimasukkan setelah diberikan oleh admin.
        </p>
      </section>
      <IPRegistrationForm categories={categories} applicantName={profile.display_name} />
    </div>
  );
}
