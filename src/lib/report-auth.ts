import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export async function verifyReportAdministrator(
  supabase: SupabaseClient<Database>,
) {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw new Error(`Sesi laporan tidak dapat divalidasi: ${userError.message}`);
  if (!userData.user) return false;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profileError) throw new Error(`Hak administrator gagal diverifikasi: ${profileError.message}`);
  return profile?.is_admin === true;
}

async function verifyRecordOwnerOrAdmin(
  supabase: SupabaseClient<Database>,
  table: "ip_records" | "ir_records",
  recordId: string,
) {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw new Error(`Sesi export tidak dapat divalidasi: ${userError.message}`);
  if (!userData.user) return false;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profileError) throw new Error(`Hak akses export gagal diverifikasi: ${profileError.message}`);
  if (profile?.is_admin) return true;

  const { data: record, error: recordError } = table === "ip_records"
    ? await supabase.from("ip_records").select("created_by").eq("id", recordId).maybeSingle()
    : await supabase.from("ir_records").select("created_by").eq("id", recordId).maybeSingle();
  if (recordError) throw new Error(`Kepemilikan dokumen gagal diverifikasi: ${recordError.message}`);
  return record?.created_by === userData.user.id;
}

export function verifyIPRecordOwnerOrAdmin(
  supabase: SupabaseClient<Database>,
  ipId: string,
) {
  return verifyRecordOwnerOrAdmin(supabase, "ip_records", ipId);
}

export function verifyIRRecordOwnerOrAdmin(
  supabase: SupabaseClient<Database>,
  irId: string,
) {
  return verifyRecordOwnerOrAdmin(supabase, "ir_records", irId);
}
