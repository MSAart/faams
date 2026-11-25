"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  evidenceFileExtension,
  evidenceFileName,
  getEvidenceMaxFileSize,
  prepareEvidenceForStorage,
} from "@/lib/evidence";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type EvidenceActionState = { error?: string; success?: string };

const parentSchema = z
  .string()
  .regex(/^(ip|ir|expense|settlement|reimbursement_payment)\|[0-9a-f-]{36}$/i)
  .or(z.literal(""));
const documentTypeSchema = z.enum([
  "ip_application",
  "ip_disbursement",
  "purchase_receipt",
  "transfer_proof",
  "expense_documentation",
  "fund_return",
  "ptjb_document",
  "reimbursement_payment",
  "other_supporting_document",
]);
const categoryParents: Record<z.infer<typeof documentTypeSchema>, readonly string[]> = {
  ip_application: ["ip"],
  ip_disbursement: ["ip"],
  purchase_receipt: ["expense"],
  transfer_proof: ["ip", "ir", "expense", "settlement", "reimbursement_payment"],
  expense_documentation: ["expense"],
  fund_return: ["settlement"],
  ptjb_document: ["ir"],
  reimbursement_payment: ["reimbursement_payment"],
  other_supporting_document: ["ip", "ir", "expense", "settlement", "reimbursement_payment"],
};

function formText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function toParentColumns(parent: string) {
  if (!parent) return {};
  const [type, id] = parent.split("|");
  switch (type) {
    case "ip":
      return { ip_record_id: id };
    case "ir":
      return { ir_record_id: id };
    case "expense":
      return { expense_id: id };
    case "settlement":
      return { settlement_id: id };
    case "reimbursement_payment":
      return { reimbursement_payment_id: id };
    default:
      throw new Error("Relasi evidence tidak valid.");
  }
}

function actionError(error: unknown): EvidenceActionState {
  console.error("Evidence management action failed.", error);
  return {
    error: error instanceof Error ? error.message : "Terjadi kesalahan. Silakan coba kembali.",
  };
}

export async function uploadEvidenceCenterAction(
  _previousState: EvidenceActionState,
  formData: FormData,
): Promise<EvidenceActionState> {
  const parsed = z
    .object({
      parent: parentSchema,
      documentType: documentTypeSchema,
    })
    .safeParse({
      parent: formText(formData, "parent"),
      documentType: formText(formData, "document_type"),
    });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data evidence tidak valid." };
  }
  const selectedParentType = parsed.data.parent.split("|")[0];
  if (
    selectedParentType &&
    !categoryParents[parsed.data.documentType].includes(selectedParentType)
  ) {
    return { error: "Kategori evidence tidak sesuai dengan relasi transaksi yang dipilih." };
  }

  const files = formData.getAll("evidence").filter((value): value is File => value instanceof File && value.size > 0);
  if (files.length === 0 || files.length > 10) {
    return { error: "Pilih 1 sampai 10 file evidence." };
  }

  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> | null = null;
  const uploadedPaths: string[] = [];
  let metadataSaved = false;
  try {
    supabase = await createSupabaseServerClient();
    const [{ data: userData, error: userError }, maxFileSize] = await Promise.all([
      supabase.auth.getUser(),
      getEvidenceMaxFileSize(supabase),
    ]);
    if (userError || !userData.user) throw new Error("Sesi berakhir. Silakan masuk kembali.");
    if (files.some((file) => file.size > maxFileSize)) {
      throw new Error(`Ukuran setiap file harus maksimal ${Math.floor(maxFileSize / 1024 / 1024)} MiB.`);
    }
    if (files.reduce((total, file) => total + file.size, 0) > 50 * 1024 * 1024) {
      throw new Error("Ukuran total unggahan dalam satu kali proses maksimal 50 MiB.");
    }

    const rows = [];
    for (const file of files) {
      const prepared = await prepareEvidenceForStorage(file, maxFileSize);
      const { mimeType } = prepared;
      const systemFileName = `${crypto.randomUUID()}.${evidenceFileExtension(mimeType)}`;
      const objectPath = `${userData.user.id}/evidence-center/${systemFileName}`;
      const { error } = await supabase.storage
        .from("faams-evidence")
        .upload(objectPath, prepared.bytes, {
          contentType: mimeType,
          upsert: false,
        });
      if (error) throw new Error(`Unggah ${file.name} gagal: ${error.message}`);
      uploadedPaths.push(objectPath);
      rows.push({
        ...toParentColumns(parsed.data.parent),
        object_path: objectPath,
        original_file_name: evidenceFileName(file.name),
        system_file_name: systemFileName,
        document_type: parsed.data.documentType,
        mime_type: mimeType,
        file_size_bytes: prepared.bytes.byteLength,
        uploaded_by: userData.user.id,
      });
    }

    const { error } = await supabase.from("evidence_files").insert(rows);
    if (error) throw new Error(`Metadata evidence gagal disimpan: ${error.message}`);
    metadataSaved = true;
    revalidatePath("/evidence-center");
    revalidatePath("/internal-prepayment");
    revalidatePath("/internal-prepayment/[ipId]", "page");
    revalidatePath("/ir-operasional");
    revalidatePath("/ir-operasional/[irId]", "page");
    revalidatePath("/ir-facility-management");
    revalidatePath("/ir-facility-management/[irId]", "page");
    return { success: `${files.length} file evidence berhasil diunggah.` };
  } catch (error) {
    if (supabase && uploadedPaths.length > 0 && !metadataSaved) {
      const { error: cleanupError } = await supabase.storage
        .from("faams-evidence")
        .remove(uploadedPaths);
      if (cleanupError) {
        console.error("Could not clean up uploaded evidence after a failed action.", cleanupError);
      }
    }
    return actionError(error);
  }
}

export async function linkEvidenceAction(
  evidenceId: string,
  _previousState: EvidenceActionState,
  formData: FormData,
): Promise<EvidenceActionState> {
  const parsed = parentSchema
    .refine((value) => value.length > 0, "Pilih relasi transaksi.")
    .safeParse(formText(formData, "parent"));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Relasi evidence tidak valid." };
  }
  const [parentType, parentId] = parsed.data.split("|");
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("link_evidence_file", {
      p_evidence_file_id: evidenceId,
      p_parent_type: parentType,
      p_parent_id: parentId,
    });
    if (error) throw new Error(error.message);
    revalidatePath("/evidence-center");
    revalidatePath("/internal-prepayment");
    revalidatePath("/internal-prepayment/[ipId]", "page");
    revalidatePath("/ir-operasional");
    revalidatePath("/ir-operasional/[irId]", "page");
    revalidatePath("/ir-facility-management");
    revalidatePath("/ir-facility-management/[irId]", "page");
    return { success: "Evidence berhasil dihubungkan." };
  } catch (error) {
    return actionError(error);
  }
}

export async function deleteEvidenceAction(
  evidenceId: string,
  objectPath: string,
  _previousState: EvidenceActionState,
): Promise<EvidenceActionState> {
  void _previousState;
  const parsed = z
    .object({
      id: z.string().uuid(),
      objectPath: z.string().min(1).max(1024),
    })
    .safeParse({ id: evidenceId, objectPath });
  if (!parsed.success) return { error: "Evidence yang dipilih tidak valid." };

  try {
    const supabase = await createSupabaseServerClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) throw new Error("Sesi berakhir. Silakan masuk kembali.");

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", userData.user.id)
      .single();
    if (profileError) throw new Error(`Hak akses admin gagal diverifikasi: ${profileError.message}`);
    if (!profile.is_admin) throw new Error("Hanya admin yang dapat menghapus evidence permanen.");

    const { data: evidence, error: evidenceError } = await supabase
      .from("evidence_files")
      .select("id, object_path, expense_id, ip_record_id, settlement_id, reimbursement_payment_id, ir_record_id")
      .eq("id", parsed.data.id)
      .maybeSingle();
    if (evidenceError) throw new Error(`Evidence gagal diperiksa: ${evidenceError.message}`);

    let pathToRemove: string;
    if (evidence) {
      pathToRemove = evidence.object_path;
      const { data: deleted, error: deleteError } = await supabase
        .from("evidence_files")
        .delete()
        .eq("id", evidence.id)
        .select("id")
        .maybeSingle();
      if (deleteError) throw new Error(`Metadata evidence gagal dihapus: ${deleteError.message}`);
      if (!deleted) throw new Error("Evidence sudah berubah. Muat ulang halaman lalu coba kembali.");
    } else {
      const { data: deletion, error: auditError } = await supabase
        .from("audit_logs")
        .select("old_data")
        .eq("entity_table", "evidence_files")
        .eq("entity_id", parsed.data.id)
        .eq("action", "DELETE")
        .maybeSingle();
      if (auditError) throw new Error(`Riwayat penghapusan evidence gagal diperiksa: ${auditError.message}`);
      const oldData = deletion?.old_data;
      if (
        !oldData ||
        typeof oldData !== "object" ||
        Array.isArray(oldData) ||
        oldData.object_path !== parsed.data.objectPath
      ) {
        throw new Error("Evidence tidak ditemukan. Muat ulang halaman sebelum mencoba kembali.");
      }
      pathToRemove = parsed.data.objectPath;
    }

    const { error: storageError } = await supabase.storage
      .from("faams-evidence")
      .remove([pathToRemove]);
    if (storageError) {
      console.error("Evidence metadata deleted but its Storage object could not be removed.", storageError);
      return {
        error: "Metadata sudah terhapus, tetapi file Storage gagal dihapus. Tekan tombol hapus lagi untuk mencoba pembersihan ulang.",
      };
    }

    revalidatePath("/evidence-center");
    revalidatePath("/internal-prepayment");
    revalidatePath("/internal-prepayment/[ipId]", "page");
    revalidatePath("/ir-operasional");
    revalidatePath("/ir-operasional/[irId]", "page");
    revalidatePath("/ir-facility-management");
    revalidatePath("/ir-facility-management/[irId]", "page");
    return { success: "Evidence dihapus permanen." };
  } catch (error) {
    return actionError(error);
  }
}

export async function updateEvidenceMaxSizeAction(
  _previousState: EvidenceActionState,
  formData: FormData,
): Promise<EvidenceActionState> {
  const parsed = z.coerce.number().int().min(1).max(50).safeParse(formText(formData, "max_size_mib"));
  if (!parsed.success) {
    return { error: "Batas ukuran harus berupa bilangan bulat antara 1 dan 50 MiB." };
  }
  try {
    const supabase = await createSupabaseServerClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) throw new Error("Sesi berakhir. Silakan masuk kembali.");
    const { error } = await supabase
      .from("system_settings")
      .update({
        value: parsed.data * 1024 * 1024,
        updated_by: userData.user.id,
      })
      .eq("key", "evidence_max_file_size_bytes")
      .select("key")
      .single();
    if (error) throw new Error(error.message);
    revalidatePath("/evidence-center");
    return { success: `Batas unggah diubah menjadi ${parsed.data} MiB.` };
  } catch (error) {
    return actionError(error);
  }
}
