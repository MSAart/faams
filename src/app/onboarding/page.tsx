import { redirect } from "next/navigation";
import { ProfileOnboardingForm } from "@/components/auth/profile-onboarding-form";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ProfileOnboardingPage() {
  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("display_name, employee_id, signature_path")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (profileError) throw new Error(`Profil gagal dimuat: ${profileError.message}`);
  if (!profile) throw new Error("Profil pengguna belum dibuat. Hubungi administrator FAAMS.");

  let signatureUrl: string | null = null;
  if (profile.signature_path) {
    const { data, error } = await supabase.storage
      .from("faams-evidence")
      .createSignedUrl(profile.signature_path, 300);
    if (error) throw new Error(`Preview tanda tangan gagal dimuat: ${error.message}`);
    signatureUrl = data.signedUrl;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <section className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Profil pemohon</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Lengkapi profil FAAMS</h1>
        <p className="mt-2 mb-6 text-sm leading-6 text-slate-600">
          Nama, NIK kantor, dan tanda tangan akan digunakan pada dokumen IP dan IR yang Anda ajukan.
        </p>
        <ProfileOnboardingForm
          displayName={profile.display_name ?? ""}
          officeId={profile.employee_id ?? ""}
          signatureUrl={signatureUrl}
        />
      </section>
    </main>
  );
}
