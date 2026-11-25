"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  evidenceFileExtension,
  prepareEvidenceForStorage,
} from "@/lib/evidence";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const profileSchema = z.object({
  displayName: z.string().trim().min(2, "Nama minimal 2 karakter.").max(120),
  officeId: z.string().trim().min(1, "NIK kantor wajib diisi.").max(80, "NIK kantor maksimal 80 karakter."),
});

export type ProfileActionState = { error?: string };

export async function saveProfileAction(
  _previousState: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const parsed = profileSchema.safeParse({
    displayName: formData.get("display_name"),
    officeId: formData.get("employee_id"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data profil tidak valid." };
  }

  const signatureMode = formData.get("signature_mode");
  const uploadedFile = formData.get("signature");
  let signature =
    signatureMode === "upload" && uploadedFile instanceof File && uploadedFile.size > 0
      ? uploadedFile
      : null;
  if (signatureMode === "draw") {
    const dataUrl = formData.get("signature_drawn");
    if (typeof dataUrl === "string" && dataUrl.length > 0) {
      const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
      if (!match) return { error: "Gambar tanda tangan tidak valid. Silakan gambar ulang." };
      const bytes = Buffer.from(match[1], "base64");
      if (bytes.byteLength > 5 * 1024 * 1024) {
        return { error: "Ukuran tanda tangan maksimal 5 MB." };
      }
      signature = new File([new Uint8Array(bytes)], "signature.png", { type: "image/png" });
    }
  }
  if (
    signature &&
    (!["image/jpeg", "image/png"].includes(signature.type) ||
      !/\.(jpe?g|png)$/i.test(signature.name))
  ) {
    return { error: "Tanda tangan harus berupa file JPG atau PNG." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return { error: "Sesi berakhir. Silakan masuk kembali." };
  }
  const { data: existingProfile, error: profileError } = await supabase
    .from("profiles")
    .select("signature_path")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (profileError) {
    console.error("Could not load the profile before saving.", profileError);
    return { error: "Profil gagal dimuat. Silakan coba kembali." };
  }

  let signaturePath = existingProfile?.signature_path ?? null;
  let uploadedPath: string | null = null;
  if (signature) {
    try {
      const prepared = await prepareEvidenceForStorage(signature, 5 * 1024 * 1024);
      if (prepared.mimeType === "application/pdf") {
        return { error: "Tanda tangan harus berupa file JPG atau PNG." };
      }
      const extension = evidenceFileExtension(prepared.mimeType);
      uploadedPath = `${authData.user.id}/profile/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from("faams-evidence")
        .upload(uploadedPath, prepared.bytes, {
          contentType: prepared.mimeType,
          upsert: false,
        });
      if (uploadError) throw new Error(uploadError.message);
      signaturePath = uploadedPath;
    } catch (error) {
      console.error("Profile signature upload failed.", error);
      return {
        error: error instanceof Error ? error.message : "Tanda tangan gagal diunggah.",
      };
    }
  }

  if (!signaturePath) {
    return { error: "Unggah atau gambar tanda tangan terlebih dahulu." };
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update({
      display_name: parsed.data.displayName,
      employee_id: parsed.data.officeId,
      signature_path: signaturePath,
    })
    .eq("id", authData.user.id);
  if (updateError) {
    if (uploadedPath) {
      const { error: cleanupError } = await supabase.storage
        .from("faams-evidence")
        .remove([uploadedPath]);
      if (cleanupError) {
        console.error("Failed to remove an unlinked profile signature.", cleanupError);
      }
    }
    console.error("Profile update failed.", updateError);
    return { error: `Profil gagal disimpan: ${updateError.message}` };
  }

  revalidatePath("/", "layout");
  redirect("/");
}
