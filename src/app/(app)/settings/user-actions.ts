"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type InviteUserState = { error?: string; success?: string };

export async function inviteUserAction(
  _previousState: InviteUserState,
  formData: FormData,
): Promise<InviteUserState> {
  const parsed = z
    .object({ email: z.email("Masukkan email yang valid.").trim().toLowerCase() })
    .safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Email tidak valid." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return { error: "Sesi administrator tidak valid." };
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profileError) {
    console.error("Could not verify admin access for user invitation.", profileError);
    return { error: "Hak administrator gagal diverifikasi." };
  }
  if (!profile?.is_admin) return { error: "Hanya administrator yang dapat mengundang akun." };

  try {
    const adminClient = createSupabaseAdminClient();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");
    const redirectTo = siteUrl
      ? `${siteUrl}/auth/callback?next=%2Fonboarding`
      : undefined;
    const { error } = await adminClient.auth.admin.inviteUserByEmail(
      parsed.data.email,
      redirectTo ? { redirectTo } : undefined,
    );
    if (error) throw new Error(error.message);
    revalidatePath("/settings");
    return { success: `Undangan berhasil dikirim ke ${parsed.data.email}.` };
  } catch (error) {
    console.error("FAAMS user invitation failed.", error);
    return {
      error: error instanceof Error ? error.message : "Undangan gagal dikirim.",
    };
  }
}
