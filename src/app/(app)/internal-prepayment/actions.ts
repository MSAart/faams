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

export type IPActionState = {
  error?: string;
  success?: string;
  createdId?: string;
};

const budgetItemSchema = z.object({
  category_id: z.string().uuid(),
  description: z.string().trim().min(1).max(200),
  quantity: z.number().finite().positive().refine((value) => Number.isInteger(value * 100), "Kuantitas maksimal 2 angka desimal."),
  unit_cost: z.number().finite().positive().refine((value) => Number.isInteger(value * 100), "Biaya satuan maksimal 2 angka desimal."),
  notes: z.string().trim().max(500).optional(),
});

const fileSchema = z
  .custom<File>((value) => value instanceof File && value.size > 0, {
    message: "Pilih file bukti terlebih dahulu.",
  })
  .refine(
    (file) =>
      ["image/jpeg", "image/png", "application/pdf"].includes(file.type),
    { message: "Bukti harus berupa JPG, PNG, atau PDF." },
  );
const optionalFileSchema = fileSchema.nullable();

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal tidak valid.");
const optionalDateSchema = z.union([
  z.literal(""),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal pekerjaan tidak valid."),
]);

function getText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function getAmount(formData: FormData, key: string) {
  return Number(getText(formData, key));
}

function getFile(formData: FormData) {
  return formData.get("evidence");
}

function getOptionalFile(formData: FormData, key: string) {
  const value = formData.get(key);
  return value instanceof File && value.size > 0 ? value : null;
}

function getOptionalFiles(formData: FormData, key: string) {
  return formData.getAll(key).filter(
    (value): value is File => value instanceof File && value.size > 0,
  );
}

function errorState(error: unknown): IPActionState {
  console.error("Internal Prepayment action failed.", error);
  if (error instanceof Error) {
    return { error: error.message };
  }
  return { error: "Terjadi kesalahan. Silakan coba kembali." };
}

function rpcError(message: string) {
  if (message.includes("duplicate key")) {
    return "Data dengan nomor tersebut sudah ada. Muat ulang halaman dan coba kembali.";
  }
  return message;
}

async function uploadEvidence(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  file: File,
  userId: string,
  folder: string,
  documentType: string,
  maxFileSize?: number,
) {
  const parsed = fileSchema.safeParse(file);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "File bukti tidak valid.");
  }

  const allowedFileSize = maxFileSize ?? await getEvidenceMaxFileSize(supabase);
  const prepared = await prepareEvidenceForStorage(file, allowedFileSize);
  const { mimeType } = prepared;
  const systemFileName = `${crypto.randomUUID()}.${evidenceFileExtension(mimeType)}`;
  const objectPath = `${userId}/${folder}/${systemFileName}`;
  const { error } = await supabase.storage
    .from("faams-evidence")
    .upload(objectPath, prepared.bytes, {
      contentType: mimeType,
      upsert: false,
    });

  if (error) {
    throw new Error(`Bukti gagal diunggah: ${error.message}`);
  }

  return {
    object_path: objectPath,
    original_file_name: evidenceFileName(file.name),
    system_file_name: systemFileName,
    mime_type: mimeType,
    file_size_bytes: prepared.bytes.byteLength,
    document_type: documentType,
  };
}

async function removeUploadedFile(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  path: string,
) {
  const { error } = await supabase.storage.from("faams-evidence").remove([path]);
  if (error) {
    console.error("Uploaded evidence could not be removed after a database error.", error);
  }
}

export async function createIPAction(
  _previousState: IPActionState,
  formData: FormData,
): Promise<IPActionState> {
  let itemsInput: unknown;
  try {
    itemsInput = JSON.parse(getText(formData, "budget_items") || "null");
  } catch {
    return { error: "Rincian anggaran tidak terbaca. Periksa item lalu coba kembali." };
  }
  const itemsResult = z
    .array(budgetItemSchema)
    .min(1, "Tambahkan minimal satu item anggaran.")
    .safeParse(itemsInput);
  const result = z
    .object({
      title: z.string().trim().min(1, "Nama kegiatan wajib diisi.").max(200),
      purpose: z.string().trim().min(1, "Tujuan penggunaan wajib diisi.").max(1000),
      requested_on: dateSchema,
      department_area: z.string().trim().max(120),
      pic_name: z.string().trim().max(120),
      project_start_date: optionalDateSchema,
      project_end_date: optionalDateSchema,
      project_location: z.string().trim().max(200),
      notes: z.string().trim().max(2000),
    })
    .safeParse({
      title: getText(formData, "title"),
      purpose: getText(formData, "purpose"),
      requested_on: getText(formData, "requested_on"),
      department_area: getText(formData, "department_area"),
      pic_name: getText(formData, "pic_name"),
      project_start_date: getText(formData, "project_start_date"),
      project_end_date: getText(formData, "project_end_date"),
      project_location: getText(formData, "project_location"),
      notes: getText(formData, "notes"),
    });

  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? "Data pengajuan tidak valid." };
  }
  if (!itemsResult.success) {
    return { error: itemsResult.error.issues[0]?.message ?? "Item anggaran tidak valid." };
  }
  if (
    result.data.project_start_date &&
    result.data.project_end_date &&
    result.data.project_end_date < result.data.project_start_date
  ) {
    return { error: "Tanggal selesai pekerjaan tidak boleh lebih awal dari tanggal mulai." };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      throw new Error("Sesi berakhir. Silakan masuk kembali.");
    }

    const { data, error } = await supabase.rpc("create_ip_application", {
      p_title: result.data.title,
      p_purpose: result.data.purpose,
      p_requested_on: result.data.requested_on,
      p_department_area: result.data.department_area || null,
      p_pic_name: result.data.pic_name || null,
      p_notes: result.data.notes || null,
      p_budget_items: itemsResult.data.map((item) => ({
        ...item,
        requested_amount: Math.round(item.quantity * item.unit_cost * 100) / 100,
      })),
      p_project_start_date: result.data.project_start_date || null,
      p_project_end_date: result.data.project_end_date || null,
      p_project_location: result.data.project_location || null,
    });
    if (error) throw new Error(rpcError(error.message));

    revalidatePath("/internal-prepayment");
    return {
      success: "Pengajuan IP berhasil dibuat.",
      createdId: data,
    };
  } catch (error) {
    return errorState(error);
  }
}

export async function saveIPReferenceAction(
  ipId: string,
  _previousState: IPActionState,
  formData: FormData,
): Promise<IPActionState> {
  const parsed = z
    .string()
    .trim()
    .min(1, "Nomor IP dari admin wajib diisi.")
    .max(120, "Nomor IP maksimal 120 karakter.")
    .safeParse(getText(formData, "reference_code"));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Nomor IP tidak valid." };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("set_ip_reference_code", {
      p_ip_record_id: ipId,
      p_reference_code: parsed.data,
    });
    if (error?.code === "23505") {
      throw new Error("Nomor IP tersebut sudah digunakan. Periksa kembali nomor dari admin.");
    }
    if (error) throw new Error(rpcError(error.message));

    revalidatePath("/internal-prepayment");
    revalidatePath(`/internal-prepayment/${ipId}`);
    revalidatePath("/transaction-ledger");
    revalidatePath("/reconciliation");
    revalidatePath("/evidence-center");
    return { success: "Nomor resmi IP berhasil disimpan." };
  } catch (error) {
    return errorState(error);
  }
}

export async function disburseIPAction(
  ipId: string,
  _previousState: IPActionState,
  formData: FormData,
): Promise<IPActionState> {
  const parsed = z
    .object({
      date: dateSchema,
      amount: z.number().finite().positive("Nominal pencairan harus lebih dari nol."),
      reference: z.string().trim().max(120),
      recipient: z.string().trim().max(300),
      notes: z.string().trim().max(1000),
      evidence: fileSchema,
    })
    .safeParse({
      date: getText(formData, "date"),
      amount: getAmount(formData, "amount"),
      reference: getText(formData, "reference"),
      recipient: getText(formData, "recipient"),
      notes: getText(formData, "notes"),
      evidence: getFile(formData),
    });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data pencairan tidak valid." };
  }

  let uploadedPath: string | undefined;
  try {
    const supabase = await createSupabaseServerClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) throw new Error("Sesi berakhir. Silakan masuk kembali.");
    const evidence = await uploadEvidence(
      supabase,
      parsed.data.evidence,
      userData.user.id,
      `ip/${ipId}/disbursement`,
      "bank_transfer",
    );
    uploadedPath = evidence.object_path;

    const { error } = await supabase.rpc("record_ip_disbursement", {
      p_ip_record_id: ipId,
      p_disbursement_date: parsed.data.date,
      p_amount: parsed.data.amount,
      p_reference: parsed.data.reference || null,
      p_recipient_details: parsed.data.recipient || null,
      p_notes: parsed.data.notes || null,
      p_evidence: evidence,
    });
    if (error) throw new Error(rpcError(error.message));

    revalidatePath("/internal-prepayment");
    revalidatePath(`/internal-prepayment/${ipId}`);
    return { success: "Pencairan dan bukti transfer berhasil dicatat." };
  } catch (error) {
    if (uploadedPath) {
      const supabase = await createSupabaseServerClient();
      await removeUploadedFile(supabase, uploadedPath);
    }
    return errorState(error);
  }
}

export async function recordIPExpenseAction(
  ipId: string,
  _previousState: IPActionState,
  formData: FormData,
): Promise<IPActionState> {
  const parsed = z
    .object({
      date: dateSchema,
      budgetItemId: z.string().uuid("Pilih item pengajuan."),
      description: z.string().trim().min(1, "Deskripsi wajib diisi.").max(300),
      vendor: z.string().trim().max(200),
      amount: z
        .number()
        .finite()
        .positive("Nominal harus lebih dari nol.")
        .refine(
          (value) =>
            Number.isSafeInteger(Math.round(value * 100)) &&
            Math.abs(value * 100 - Math.round(value * 100)) < 1e-8,
          "Nominal maksimal dua angka desimal.",
        ),
      paymentMethod: z.enum(["cash", "transfer", "card", "other"]),
      isConsistent: z.enum(["yes", "no"]),
      mismatchReason: z.string().trim().max(1000),
      evidence: fileSchema,
      transferEvidence: optionalFileSchema,
      otherEvidence: z.array(fileSchema),
    })
    .safeParse({
      date: getText(formData, "date"),
      budgetItemId: getText(formData, "budget_item_id"),
      description: getText(formData, "description"),
      vendor: getText(formData, "vendor"),
      amount: getAmount(formData, "amount"),
      paymentMethod: getText(formData, "payment_method"),
      isConsistent: getText(formData, "is_consistent"),
      mismatchReason: getText(formData, "mismatch_reason"),
      evidence: getFile(formData),
      transferEvidence: getOptionalFile(formData, "transfer_evidence"),
      otherEvidence: getOptionalFiles(formData, "other_evidence"),
    });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data realisasi tidak valid." };
  }
  if (parsed.data.isConsistent === "no" && !parsed.data.mismatchReason) {
    return { error: "Alasan ketidaksesuaian wajib diisi." };
  }

  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> | null = null;
  const uploadedPaths: string[] = [];
  try {
    supabase = await createSupabaseServerClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) throw new Error("Sesi berakhir. Silakan masuk kembali.");
    const evidenceFiles = [
      { file: parsed.data.evidence, documentType: "receipt" },
      ...(parsed.data.transferEvidence
        ? [{ file: parsed.data.transferEvidence, documentType: "transfer_proof" }]
        : []),
      ...parsed.data.otherEvidence.map((file) => ({
        file,
        documentType: "other_supporting_document",
      })),
    ];
    if (evidenceFiles.reduce((sum, item) => sum + item.file.size, 0) > 50 * 1024 * 1024) {
      throw new Error("Total file bukti untuk satu realisasi maksimal 50 MiB.");
    }
    const maxFileSize = await getEvidenceMaxFileSize(supabase);
    const evidence = [];
    for (const item of evidenceFiles) {
      const uploaded = await uploadEvidence(
        supabase,
        item.file,
        userData.user.id,
        `ip/${ipId}/expenses`,
        item.documentType,
        maxFileSize,
      );
      uploadedPaths.push(uploaded.object_path);
      evidence.push(uploaded);
    }

    const { error } = await supabase.rpc("record_ip_expense", {
      p_ip_record_id: ipId,
      p_expense_date: parsed.data.date,
      p_budget_item_id: parsed.data.budgetItemId,
      p_description: parsed.data.description,
      p_vendor: parsed.data.vendor || null,
      p_amount: parsed.data.amount,
      p_payment_method: parsed.data.paymentMethod,
      p_is_consistent: parsed.data.isConsistent === "yes",
      p_mismatch_reason: parsed.data.mismatchReason || null,
      p_evidence: evidence,
    });
    if (error) throw new Error(rpcError(error.message));

    revalidatePath("/internal-prepayment");
    revalidatePath(`/internal-prepayment/${ipId}`);
    return {
      success:
        parsed.data.isConsistent === "yes"
          ? "Realisasi terverifikasi berhasil dicatat."
          : "Realisasi dicatat sebagai belum terverifikasi dan belum mengurangi saldo.",
    };
  } catch (error) {
    if (supabase && uploadedPaths.length > 0) {
      const { error: cleanupError } = await supabase.storage
        .from("faams-evidence")
        .remove(uploadedPaths);
      if (cleanupError) {
        console.error("Uploaded IP evidence could not be removed after a database error.", cleanupError);
      }
    }
    return errorState(error);
  }
}

export async function editIPRealizationAction(
  ipId: string,
  expenseId: string,
  _previousState: IPActionState,
  formData: FormData,
): Promise<IPActionState> {
  const selectedFiles = getOptionalFiles(formData, "additional_evidence");
  const parsed = z
    .object({
      date: dateSchema,
      budgetItemId: z.string().uuid("Pilih item pengajuan."),
      description: z.string().trim().min(1, "Deskripsi wajib diisi.").max(300),
      vendor: z.string().trim().max(200),
      amount: z
        .number()
        .finite()
        .positive("Nominal harus lebih dari nol.")
        .refine(
          (value) =>
            Number.isSafeInteger(Math.round(value * 100)) &&
            Math.abs(value * 100 - Math.round(value * 100)) < 1e-8,
          "Nominal maksimal dua angka desimal.",
        ),
      paymentMethod: z.enum(["cash", "transfer", "card", "other"]),
      documentType: z.enum(["receipt", "invoice", "bank_transfer", "other"]),
    })
    .safeParse({
      date: getText(formData, "date"),
      budgetItemId: getText(formData, "budget_item_id"),
      description: getText(formData, "description"),
      vendor: getText(formData, "vendor"),
      amount: getAmount(formData, "amount"),
      paymentMethod: getText(formData, "payment_method"),
      documentType: getText(formData, "document_type"),
    });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data realisasi tidak valid." };
  }
  if (selectedFiles.reduce((sum, selected) => sum + selected.size, 0) > 50 * 1024 * 1024) {
    return { error: "Total file bukti tambahan untuk satu realisasi maksimal 50 MiB." };
  }

  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> | null = null;
  const uploadedPaths: string[] = [];
  try {
    supabase = await createSupabaseServerClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) throw new Error("Sesi berakhir. Silakan masuk kembali.");
    const maxFileSize = await getEvidenceMaxFileSize(supabase);
    const evidence = [];
    for (const selected of selectedFiles) {
      const uploaded = await uploadEvidence(
        supabase,
        selected,
        userData.user.id,
        `ip/${ipId}/expenses`,
        parsed.data.documentType,
        maxFileSize,
      );
      uploadedPaths.push(uploaded.object_path);
      evidence.push(uploaded);
    }

    const { error } = await supabase.rpc("edit_ip_realization", {
      p_ip_record_id: ipId,
      p_expense_id: expenseId,
      p_expense_date: parsed.data.date,
      p_budget_item_id: parsed.data.budgetItemId,
      p_description: parsed.data.description,
      p_vendor: parsed.data.vendor || null,
      p_amount: parsed.data.amount,
      p_payment_method: parsed.data.paymentMethod,
      p_evidence: evidence,
    });
    if (error) throw new Error(rpcError(error.message));
    revalidatePath("/internal-prepayment");
    revalidatePath(`/internal-prepayment/${ipId}`);
    revalidatePath("/transaction-ledger");
    revalidatePath("/reconciliation");
    revalidatePath("/evidence-center");
    return { success: "Realisasi IP berhasil diperbarui." };
  } catch (error) {
    if (supabase && uploadedPaths.length > 0) {
      const { error: cleanupError } = await supabase.storage
        .from("faams-evidence")
        .remove(uploadedPaths);
      if (cleanupError) {
        console.error("Uploaded IP evidence could not be removed after a database error.", cleanupError);
      }
    }
    return errorState(error);
  }
}

export async function resolveIPDiscrepancyAction(
  expenseId: string,
  ipId: string,
  _previousState: IPActionState,
  formData: FormData,
): Promise<IPActionState> {
  const parsed = z
    .object({
      action: z.enum(["verify", "link_ir", "create_ir"]),
      resolutionNote: z.string().trim().min(1, "Catatan tindak lanjut wajib diisi.").max(1000),
      irRecordId: z.string().uuid().or(z.literal("")),
      irType: z.enum(["operasional", "facility"]).or(z.literal("")),
    })
    .safeParse({
      action: getText(formData, "action"),
      resolutionNote: getText(formData, "resolution_note"),
      irRecordId: getText(formData, "ir_record_id"),
      irType: getText(formData, "ir_type"),
    });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Tindak lanjut tidak valid." };
  }
  if (parsed.data.action === "link_ir" && !parsed.data.irRecordId) {
    return { error: "Pilih IR yang akan dihubungkan." };
  }
  if (parsed.data.action === "create_ir" && !parsed.data.irType) {
    return { error: "Pilih jenis IR yang akan dibuat." };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("resolve_ip_discrepancy", {
      p_expense_id: expenseId,
      p_action: parsed.data.action,
      p_resolution_note: parsed.data.resolutionNote,
      p_ir_record_id: parsed.data.irRecordId || null,
      p_ir_type: parsed.data.action === "create_ir" ? parsed.data.irType || null : null,
    });
    if (error) throw new Error(rpcError(error.message));
    revalidatePath("/internal-prepayment");
    revalidatePath(`/internal-prepayment/${ipId}`);
    return {
      success: data
        ? `Tindak lanjut tersimpan${parsed.data.action === "verify" ? "." : ` (IR ${data.slice(0, 8)}).`}`
        : "Realisasi berhasil diverifikasi dan dimasukkan ke perhitungan IP.",
    };
  } catch (error) {
    return errorState(error);
  }
}

export async function recordIPReturnAction(
  ipId: string,
  _previousState: IPActionState,
  formData: FormData,
): Promise<IPActionState> {
  const parsed = z
    .object({
      date: dateSchema,
      amount: z.number().finite().positive("Nominal pengembalian harus lebih dari nol."),
      method: z.enum(["cash", "transfer", "other"]),
      reference: z.string().trim().max(120),
      notes: z.string().trim().max(1000),
      evidence: fileSchema,
    })
    .safeParse({
      date: getText(formData, "date"),
      amount: getAmount(formData, "amount"),
      method: getText(formData, "method"),
      reference: getText(formData, "reference"),
      notes: getText(formData, "notes"),
      evidence: getFile(formData),
    });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data pengembalian tidak valid." };
  }

  let uploadedPath: string | undefined;
  try {
    const supabase = await createSupabaseServerClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) throw new Error("Sesi berakhir. Silakan masuk kembali.");
    const evidence = await uploadEvidence(
      supabase,
      parsed.data.evidence,
      userData.user.id,
      `ip/${ipId}/returns`,
      "fund_return",
    );
    uploadedPath = evidence.object_path;

    const { error } = await supabase.rpc("record_ip_return", {
      p_ip_record_id: ipId,
      p_return_date: parsed.data.date,
      p_amount: parsed.data.amount,
      p_return_method: parsed.data.method,
      p_reference: parsed.data.reference || null,
      p_notes: parsed.data.notes || null,
      p_evidence: evidence,
    });
    if (error) throw new Error(rpcError(error.message));
    revalidatePath("/internal-prepayment");
    revalidatePath(`/internal-prepayment/${ipId}`);
    return { success: "Pengembalian dana dan buktinya berhasil dicatat." };
  } catch (error) {
    if (uploadedPath) {
      const supabase = await createSupabaseServerClient();
      await removeUploadedFile(supabase, uploadedPath);
    }
    return errorState(error);
  }
}

export async function closeIPSettlementAction(
  ipId: string,
  _previousState: IPActionState,
  formData: FormData,
): Promise<IPActionState> {
  const parsed = z
    .object({
      date: dateSchema,
      notes: z.string().trim().max(1000),
    })
    .safeParse({
      date: getText(formData, "date"),
      notes: getText(formData, "notes"),
    });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Tanggal settlement tidak valid." };
  }
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("close_ip_settlement", {
      p_ip_record_id: ipId,
      p_settlement_date: parsed.data.date,
      p_notes: parsed.data.notes || null,
    });
    if (error) throw new Error(rpcError(error.message));
    revalidatePath("/internal-prepayment");
    revalidatePath(`/internal-prepayment/${ipId}`);
    return { success: "Settlement berhasil ditinjau dan IP ditutup." };
  } catch (error) {
    return errorState(error);
  }
}
