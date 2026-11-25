"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { evidenceFileExtension, prepareEvidenceForStorage } from "@/lib/evidence";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type IPFormSettingsState = { error?: string; success?: string };

const textFields = [
  "company_name",
  "regional_name",
  "department_name",
  "area_name",
  "submitter_title",
  "submitter_name",
  "submitter_employee_id",
  "approver_title",
  "approver_name",
  "approver_employee_id",
] as const;

const schema = z.object({
  company_name: z.string().trim().max(120),
  regional_name: z.string().trim().max(160),
  department_name: z.string().trim().max(160),
  area_name: z.string().trim().max(160),
  submitter_title: z.string().trim().max(120),
  submitter_name: z.string().trim().max(120),
  submitter_employee_id: z.string().trim().max(80),
  approver_title: z.string().trim().max(120),
  approver_name: z.string().trim().max(120),
  approver_employee_id: z.string().trim().max(80),
});

function getString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function getImage(formData: FormData, key: string) {
  const value = formData.get(key);
  return value instanceof File && value.size > 0 ? value : null;
}

async function uploadImage(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  file: File,
  userId: string,
) {
  const prepared = await prepareEvidenceForStorage(file, 5 * 1024 * 1024);
  const { mimeType } = prepared;
  if (mimeType !== "image/jpeg" && mimeType !== "image/png") {
    throw new Error("Logo dan tanda tangan hanya boleh berupa JPG atau PNG.");
  }
  const path = `${userId}/ip-application-template/${crypto.randomUUID()}.${evidenceFileExtension(mimeType)}`;
  const { error } = await supabase.storage.from("faams-evidence").upload(
    path,
    prepared.bytes,
    { contentType: mimeType, upsert: false },
  );
  if (error) throw new Error(`Gambar template gagal diunggah: ${error.message}`);
  return path;
}

export async function saveIPApplicationSettingsAction(
  _previousState: IPFormSettingsState,
  formData: FormData,
): Promise<IPFormSettingsState> {
  const parsed = schema.safeParse(
    Object.fromEntries(textFields.map((key) => [key, getString(formData, key)])),
  );
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Pengaturan template tidak valid." };
  }

  const files = {
    logo_path: getImage(formData, "logo"),
    submitter_signature_path: getImage(formData, "submitter_signature"),
    approver_signature_path: getImage(formData, "approver_signature"),
  };
  const remove = {
    logo_path: getString(formData, "remove_logo") === "on",
    submitter_signature_path: getString(formData, "remove_submitter_signature") === "on",
    approver_signature_path: getString(formData, "remove_approver_signature") === "on",
  };

  const uploadedPaths: string[] = [];
  try {
    const supabase = await createSupabaseServerClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError) throw new Error(`Sesi admin tidak dapat divalidasi: ${userError.message}`);
    if (!userData.user) throw new Error("Sesi berakhir. Silakan masuk kembali.");
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (profileError) throw new Error(`Hak administrator gagal diverifikasi: ${profileError.message}`);
    if (!profile?.is_admin) throw new Error("Akses administrator diperlukan.");

    const { data: current, error: currentError } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", "ip_application_form")
      .maybeSingle();
    if (currentError) throw new Error(`Pengaturan template gagal dimuat: ${currentError.message}`);

    const oldPaths = new Map<string, string>();
    if (current?.value && typeof current.value === "object" && !Array.isArray(current.value)) {
      for (const key of Object.keys(files)) {
        const value = current.value[key];
        oldPaths.set(key, typeof value === "string" ? value : "");
      }
    } else {
      for (const key of Object.keys(files)) oldPaths.set(key, "");
    }

    const nextPaths = new Map(oldPaths);
    for (const key of Object.keys(files) as Array<keyof typeof files>) {
      if (files[key]) {
        const path = await uploadImage(supabase, files[key], userData.user.id);
        uploadedPaths.push(path);
        nextPaths.set(key, path);
      } else if (remove[key]) {
        nextPaths.set(key, "");
      }
    }

    const value = {
      ...parsed.data,
      logo_path: nextPaths.get("logo_path") ?? "",
      submitter_signature_path: nextPaths.get("submitter_signature_path") ?? "",
      approver_signature_path: nextPaths.get("approver_signature_path") ?? "",
    };
    const { error: saveError } = await supabase.rpc("save_ip_application_form_settings", {
      p_value: value,
    });
    if (saveError) throw new Error(`Pengaturan template gagal disimpan: ${saveError.message}`);

    const replacedPaths = [...oldPaths.entries()]
      .filter(([key, oldPath]) => oldPath && nextPaths.get(key) !== oldPath)
      .map(([, path]) => path);
    let cleanupWarning = "";
    if (replacedPaths.length) {
      const { error } = await supabase.storage.from("faams-evidence").remove(replacedPaths);
      if (error) {
        console.error("Previous IP form template images could not be removed.", error);
        cleanupWarning = " Namun file template lama gagal dihapus; silakan hubungi administrator.";
      }
    }
    revalidatePath("/settings");
    return { success: `Pengaturan form pengajuan IP berhasil disimpan.${cleanupWarning}` };
  } catch (error) {
    if (uploadedPaths.length) {
      const supabase = await createSupabaseServerClient();
      const { error: cleanupError } = await supabase.storage.from("faams-evidence").remove(uploadedPaths);
      if (cleanupError) console.error("Uncommitted IP template images could not be removed.", cleanupError);
    }
    console.error("Could not save IP application form settings.", error);
    return { error: error instanceof Error ? error.message : "Pengaturan template gagal disimpan." };
  }
}
