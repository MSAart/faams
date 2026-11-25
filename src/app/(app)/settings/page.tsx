import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IPFormSettings } from "@/components/internal-prepayment/ip-form-settings";
import { UserInvitationForm } from "@/components/settings/user-invitation-form";
import { parseIPApplicationFormSettings } from "@/lib/ip-application-export";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw new Error(`Sesi administrator gagal divalidasi: ${userError.message}`);
  if (!userData.user) redirect("/login?next=%2Fsettings");
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profileError) throw new Error(`Hak administrator gagal diverifikasi: ${profileError.message}`);
  if (!profile?.is_admin) redirect("/login?error=admin");

  const { data, error } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", "ip_application_form")
    .maybeSingle();
  if (error) throw new Error(`Pengaturan template IP gagal dimuat: ${error.message}`);
  const settings = parseIPApplicationFormSettings(data?.value);

  const loadUrl = async (path: string) => {
    if (!path) return null;
    const { data: asset, error: assetError } = await supabase.storage
      .from("faams-evidence")
      .createSignedUrl(path, 60);
    if (assetError) throw new Error(`Preview gambar template gagal dimuat: ${assetError.message}`);
    return asset.signedUrl;
  };
  const [logoUrl, approverSignatureUrl] = await Promise.all([
    loadUrl(settings.logo_path),
    loadUrl(settings.approver_signature_path),
  ]);
  const imageUrls = {
    logo: logoUrl,
    approverSignature: approverSignatureUrl,
  };

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-medium text-slate-500">Pengaturan organisasi</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Template Pengajuan IP</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Atur kop organisasi dan blok tanda tangan untuk formulir Excel/PDF Internal Prepayment.
        </p>
      </header>
      <IPFormSettings settings={settings} imageUrls={imageUrls} />
      <Card>
        <CardHeader>
          <CardTitle>Undang pengguna</CardTitle>
          <CardDescription>
            Undangan membuat akun pemohon non-admin. Pengguna melengkapi nama, NIK kantor, dan tanda tangan saat pertama masuk.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UserInvitationForm />
          {!process.env.SUPABASE_SERVICE_ROLE_KEY && (
            <p className="mt-3 text-xs text-amber-800">
              Atur SUPABASE_SERVICE_ROLE_KEY pada environment server untuk mengaktifkan undangan.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
