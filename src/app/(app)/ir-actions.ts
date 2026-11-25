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

export type IRActionState = {
  error?: string;
  success?: string;
  createdId?: string;
};

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal tidak valid.");
type EvidenceMimeType = "image/jpeg" | "image/png" | "application/pdf";

function isEvidenceMimeType(mimeType: string): mimeType is EvidenceMimeType {
  return ["image/jpeg", "image/png", "application/pdf"].includes(mimeType);
}

const amountSchema = z
  .number()
  .finite()
  .positive("Nominal harus lebih dari nol.")
  .refine(
    (value) =>
      Number.isSafeInteger(Math.round(value * 100)) &&
      Math.abs(value * 100 - Math.round(value * 100)) < 1e-8,
    {
    message: "Nominal maksimal dua angka desimal.",
    },
  );
const fileSchema = z
  .custom<File>((value) => value instanceof File && value.size > 0, {
    message: "Pilih file yang valid.",
  })
  .refine(
    (file) => isEvidenceMimeType(file.type),
    { message: "File harus JPG, PNG, atau PDF." },
  );
const allocationSchema = z
  .object({
    source_type: z.enum(["ip", "personal"]),
    ip_record_id: z.string(),
    amount: amountSchema,
  })
  .refine(
    (allocation) =>
      (allocation.source_type === "ip" &&
        z.string().uuid().safeParse(allocation.ip_record_id).success) ||
      (allocation.source_type === "personal" && allocation.ip_record_id === ""),
    { message: "Setiap alokasi harus memiliki sumber dana yang valid." },
  );

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function file(formData: FormData, key: string) {
  const value = formData.get(key);
  return value instanceof File && value.size > 0 ? value : null;
}

function files(formData: FormData, key: string) {
  return formData.getAll(key).filter(
    (value): value is File => value instanceof File && value.size > 0,
  );
}

function pathFor(irType: "operasional" | "facility") {
  return irType === "operasional" ? "/ir-operasional" : "/ir-facility-management";
}

function toActionError(error: unknown, cleanupWarning?: string | null): IRActionState {
  console.error("Internal Reimbursement action failed.", error);
  const message = error instanceof Error
    ? error.message
    : "Terjadi kesalahan. Silakan coba kembali.";
  return {
    error: cleanupWarning ? `${message} ${cleanupWarning}` : message,
  };
}

async function uploadIRFile(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
  irId: string,
  source: string,
  selected: File,
  documentType: "receipt" | "invoice" | "bank_transfer" | "other",
  maxFileSize?: number,
) {
  const parsed = fileSchema.safeParse(selected);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "File tidak valid.");
  }
  const allowedFileSize = maxFileSize ?? await getEvidenceMaxFileSize(supabase);
  const prepared = await prepareEvidenceForStorage(selected, allowedFileSize);
  const { mimeType } = prepared;
  const systemFileName = `${crypto.randomUUID()}.${evidenceFileExtension(mimeType)}`;
  const objectPath = `${userId}/ir/${irId}/${source}/${systemFileName}`;
  const { error } = await supabase.storage
    .from("faams-evidence")
    .upload(objectPath, prepared.bytes, {
      contentType: mimeType,
      upsert: false,
    });
  if (error) throw new Error(`Unggah bukti gagal: ${error.message}`);

  return {
    object_path: objectPath,
    original_file_name: evidenceFileName(selected.name),
    system_file_name: systemFileName,
    document_type: documentType,
    mime_type: mimeType,
    file_size_bytes: prepared.bytes.byteLength,
  };
}

async function cleanupUploaded(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  uploadedPaths: string[],
): Promise<string | null> {
  if (uploadedPaths.length === 0) return null;
  try {
    const { error } = await supabase.storage.from("faams-evidence").remove(uploadedPaths);
    if (error) throw new Error(error.message);
    return null;
  } catch (error) {
    console.error("IR evidence cleanup failed after a transaction error.", error);
    return "File bukti sementara belum berhasil dibersihkan. Periksa Evidence Center sebelum mencoba ulang.";
  }
}

export async function createIRAction(
  _previousState: IRActionState,
  formData: FormData,
): Promise<IRActionState> {
  const parsed = z
    .object({
      irType: z.enum(["operasional", "facility"]),
      submittedOn: dateSchema,
      picName: z.string().trim().min(1, "PIC wajib diisi.").max(120),
      purpose: z.string().trim().min(1, "Tujuan wajib diisi.").max(1000),
      title: z.string().trim().min(1, "Deskripsi wajib diisi.").max(200),
      periodStart: z.union([dateSchema, z.literal("")]),
      periodEnd: z.union([dateSchema, z.literal("")]),
      notes: z.string().trim().max(2000),
    })
    .safeParse({
      irType: text(formData, "ir_type"),
      submittedOn: text(formData, "submitted_on"),
      picName: text(formData, "pic_name"),
      purpose: text(formData, "purpose"),
      title: text(formData, "title"),
      periodStart: text(formData, "period_start"),
      periodEnd: text(formData, "period_end"),
      notes: text(formData, "notes"),
    });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data IR tidak valid." };
  }
  if (
    parsed.data.periodStart &&
    parsed.data.periodEnd &&
    parsed.data.periodEnd < parsed.data.periodStart
  ) {
    return { error: "Tanggal akhir periode tidak boleh sebelum tanggal awal." };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("create_ir_record", {
      p_ir_type: parsed.data.irType,
      p_submitted_on: parsed.data.submittedOn,
      p_pic_name: parsed.data.picName,
      p_purpose: parsed.data.purpose,
      p_title: parsed.data.title,
      p_period_start: parsed.data.periodStart || null,
      p_period_end: parsed.data.periodEnd || null,
      p_notes: parsed.data.notes || null,
    });
    if (error) throw new Error(error.message);
    revalidatePath(pathFor(parsed.data.irType));
    return {
      success: "IR berhasil dibuat. Tambahkan transaksi dan sumber dananya.",
      createdId: data,
    };
  } catch (error) {
    return toActionError(error);
  }
}

export async function saveIRReferenceAction(
  irId: string,
  irType: "operasional" | "facility",
  _previousState: IRActionState,
  formData: FormData,
): Promise<IRActionState> {
  const parsed = z
    .string()
    .trim()
    .min(1, "Nomor IR dari admin wajib diisi.")
    .max(120, "Nomor IR maksimal 120 karakter.")
    .safeParse(text(formData, "reference_code"));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Nomor IR tidak valid." };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("set_ir_reference_code", {
      p_ir_record_id: irId,
      p_reference_code: parsed.data,
    });
    if (error?.code === "23505") {
      throw new Error("Nomor IR tersebut sudah digunakan. Periksa kembali nomor dari admin.");
    }
    if (error) throw new Error(error.message);

    const listPath = pathFor(irType);
    revalidatePath(listPath);
    revalidatePath(`${listPath}/${irId}`);
    revalidatePath("/transaction-ledger");
    revalidatePath("/reconciliation");
    revalidatePath("/evidence-center");
    return { success: "Nomor resmi IR berhasil disimpan." };
  } catch (error) {
    return toActionError(error);
  }
}

export async function addIRTransactionAction(
  irId: string,
  irType: "operasional" | "facility",
  _previousState: IRActionState,
  formData: FormData,
): Promise<IRActionState> {
  let allocationInput: unknown;
  try {
    allocationInput = JSON.parse(text(formData, "allocations") || "null");
  } catch {
    return { error: "Rincian alokasi dana tidak terbaca." };
  }

  const parsed = z
    .object({
      date: dateSchema,
      categoryId: z.string().uuid("Pilih kategori."),
      description: z.string().trim().min(1, "Deskripsi wajib diisi.").max(300),
      amount: amountSchema,
      paymentMethod: z.enum(["cash", "transfer", "card", "other"]),
      allocations: z.array(allocationSchema).min(1, "Tambahkan sumber dana."),
    })
    .safeParse({
      date: text(formData, "transaction_date"),
      categoryId: text(formData, "category_id"),
      description: text(formData, "description"),
      amount: Number(text(formData, "amount")),
      paymentMethod: text(formData, "payment_method"),
      allocations: allocationInput,
    });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data transaksi tidak valid." };
  }
  const allocatedCents = parsed.data.allocations.reduce(
    (sum, allocation) => sum + Math.round(allocation.amount * 100),
    0,
  );
  if (allocatedCents !== Math.round(parsed.data.amount * 100)) {
    return { error: "Total alokasi harus sama persis dengan nominal transaksi." };
  }

  const selectedFiles = [
    { selected: file(formData, "receipt"), type: "receipt" as const },
    { selected: file(formData, "transfer_evidence"), type: "bank_transfer" as const },
    ...files(formData, "other_evidence").map((selected) => ({
      selected,
      type: "other" as const,
    })),
  ].filter(
    (item): item is { selected: File; type: "receipt" | "bank_transfer" | "other" } =>
      item.selected !== null,
  );
  if (selectedFiles.reduce((sum, item) => sum + item.selected.size, 0) > 50 * 1024 * 1024) {
    return { error: "Total file bukti untuk satu transaksi maksimal 50 MiB." };
  }

  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> | null = null;
  const uploadedPaths: string[] = [];
  try {
    supabase = await createSupabaseServerClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) throw new Error("Sesi berakhir. Silakan masuk kembali.");
    const maxFileSize = await getEvidenceMaxFileSize(supabase);
    const evidence = [];
    for (const item of selectedFiles) {
      const uploaded = await uploadIRFile(
        supabase,
        userData.user.id,
        irId,
        "transactions",
        item.selected,
        item.type,
        maxFileSize,
      );
      uploadedPaths.push(uploaded.object_path);
      evidence.push(uploaded);
    }

    const { error } = await supabase.rpc("record_ir_transaction", {
      p_ir_record_id: irId,
      p_transaction_date: parsed.data.date,
      p_category_id: parsed.data.categoryId,
      p_description: parsed.data.description,
      p_vendor: null,
      p_amount: parsed.data.amount,
      p_payment_method: parsed.data.paymentMethod,
      p_allocations: parsed.data.allocations,
      p_evidence: evidence,
    });
    if (error) throw new Error(error.message);
    revalidatePath(pathFor(irType));
    revalidatePath(`${pathFor(irType)}/${irId}`);
    revalidatePath("/internal-prepayment");
    return {
      success:
        evidence.length === 0
          ? "Transaksi tercatat. Bukti belum lengkap sehingga IR belum siap untuk PTJB."
          : "Transaksi, alokasi dana, dan bukti berhasil dicatat.",
    };
  } catch (error) {
    const cleanupWarning = supabase
      ? await cleanupUploaded(supabase, uploadedPaths)
      : null;
    return toActionError(error, cleanupWarning);
  }
}

export async function editIRTransactionAction(
  irId: string,
  irType: "operasional" | "facility",
  expenseId: string,
  _previousState: IRActionState,
  formData: FormData,
): Promise<IRActionState> {
  let allocationInput: unknown;
  try {
    allocationInput = JSON.parse(text(formData, "allocations") || "null");
  } catch {
    return { error: "Rincian alokasi dana tidak terbaca." };
  }

  const parsed = z
    .object({
      date: dateSchema,
      categoryId: z.string().uuid("Pilih kategori."),
      description: z.string().trim().min(1, "Deskripsi wajib diisi.").max(300),
      vendor: z.string().trim().max(200),
      amount: amountSchema,
      paymentMethod: z.enum(["cash", "transfer", "card", "other"]),
      allocations: z.array(allocationSchema).min(1, "Tambahkan sumber dana."),
      documentType: z.enum(["receipt", "invoice", "bank_transfer", "other"]),
    })
    .safeParse({
      date: text(formData, "transaction_date"),
      categoryId: text(formData, "category_id"),
      description: text(formData, "description"),
      vendor: text(formData, "vendor"),
      amount: Number(text(formData, "amount")),
      paymentMethod: text(formData, "payment_method"),
      allocations: allocationInput,
      documentType: text(formData, "document_type"),
    });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data transaksi tidak valid." };
  }
  const allocatedCents = parsed.data.allocations.reduce(
    (sum, allocation) => sum + Math.round(allocation.amount * 100),
    0,
  );
  if (allocatedCents !== Math.round(parsed.data.amount * 100)) {
    return { error: "Total alokasi harus sama persis dengan nominal transaksi." };
  }
  const selectedFiles = files(formData, "additional_evidence");
  if (selectedFiles.reduce((sum, selected) => sum + selected.size, 0) > 50 * 1024 * 1024) {
    return { error: "Total file bukti tambahan untuk satu transaksi maksimal 50 MiB." };
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
      const uploaded = await uploadIRFile(
        supabase,
        userData.user.id,
        irId,
        "transactions",
        selected,
        parsed.data.documentType,
        maxFileSize,
      );
      uploadedPaths.push(uploaded.object_path);
      evidence.push(uploaded);
    }

    const { error } = await supabase.rpc("edit_ir_transaction_expense", {
      p_expense_id: expenseId,
      p_transaction_date: parsed.data.date,
      p_category_id: parsed.data.categoryId,
      p_description: parsed.data.description,
      p_vendor: parsed.data.vendor || null,
      p_amount: parsed.data.amount,
      p_payment_method: parsed.data.paymentMethod,
      p_allocations: parsed.data.allocations,
      p_evidence: evidence,
    });
    if (error) throw new Error(error.message);
    revalidatePath(pathFor(irType));
    revalidatePath(`${pathFor(irType)}/${irId}`);
    revalidatePath("/internal-prepayment");
    revalidatePath("/transaction-ledger");
    revalidatePath("/reconciliation");
    revalidatePath("/evidence-center");
    return { success: "Transaksi IR dan alokasi sumber dana berhasil diperbarui." };
  } catch (error) {
    const cleanupWarning = supabase
      ? await cleanupUploaded(supabase, uploadedPaths)
      : null;
    return toActionError(error, cleanupWarning);
  }
}

export async function updateIRPTJBAction(
  irId: string,
  irType: "operasional" | "facility",
  nextStatus: "submitted" | "approved",
  _previousState: IRActionState,
  _formData: FormData,
): Promise<IRActionState> {
  void _previousState;
  void _formData;
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("set_ir_ptjb_status", {
      p_ir_record_id: irId,
      p_next_status: nextStatus,
    });
    if (error) throw new Error(error.message);
    revalidatePath(pathFor(irType));
    revalidatePath(`${pathFor(irType)}/${irId}`);
    return {
      success: nextStatus === "submitted" ? "PTJB berhasil diajukan." : "PTJB ditandai disetujui.",
    };
  } catch (error) {
    return toActionError(error);
  }
}

export async function addIREvidenceAction(
  irId: string,
  irType: "operasional" | "facility",
  expenseId: string,
  _previousState: IRActionState,
  formData: FormData,
): Promise<IRActionState> {
  const parsed = z
    .object({
      files: z.array(fileSchema).min(1, "Pilih minimal satu file bukti."),
      documentType: z.enum(["receipt", "bank_transfer", "other"]),
    })
    .safeParse({
      files: files(formData, "evidence"),
      documentType: text(formData, "document_type"),
    });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Bukti transaksi tidak valid." };
  }

  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> | null = null;
  const uploadedPaths: string[] = [];
  try {
    supabase = await createSupabaseServerClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) throw new Error("Sesi berakhir. Silakan masuk kembali.");
    if (parsed.data.files.reduce((sum, selected) => sum + selected.size, 0) > 50 * 1024 * 1024) {
      throw new Error("Total file bukti untuk satu unggahan maksimal 50 MiB.");
    }
    const maxFileSize = await getEvidenceMaxFileSize(supabase);
    const evidenceRows = [];
    for (const selected of parsed.data.files) {
      const metadata = await uploadIRFile(
        supabase,
        userData.user.id,
        irId,
        "transactions",
        selected,
        parsed.data.documentType,
        maxFileSize,
      );
      uploadedPaths.push(metadata.object_path);
      evidenceRows.push({
        expense_id: expenseId,
        object_path: metadata.object_path,
        original_file_name: metadata.original_file_name,
        system_file_name: metadata.system_file_name,
        document_type: metadata.document_type,
        mime_type: metadata.mime_type,
        file_size_bytes: metadata.file_size_bytes,
        uploaded_by: userData.user.id,
      });
    }
    const { error } = await supabase.from("evidence_files").insert(evidenceRows);
    if (error) throw new Error(error.message);
    revalidatePath(pathFor(irType));
    revalidatePath(`${pathFor(irType)}/${irId}`);
    return { success: `${parsed.data.files.length} file bukti berhasil diunggah.` };
  } catch (error) {
    const cleanupWarning = supabase
      ? await cleanupUploaded(supabase, uploadedPaths)
      : null;
    return toActionError(error, cleanupWarning);
  }
}

export async function recordIRPaymentAction(
  irId: string,
  irType: "operasional" | "facility",
  _previousState: IRActionState,
  formData: FormData,
): Promise<IRActionState> {
  void _previousState;
  const parsed = z
    .object({
      date: dateSchema,
      amount: amountSchema,
      reference: z.string().trim().max(120),
      notes: z.string().trim().max(1000),
      evidence: z.custom<File>((value) => value instanceof File && value.size > 0, {
        message: "Bukti transfer pembayaran wajib dipilih.",
      }),
    })
    .safeParse({
      date: text(formData, "payment_date"),
      amount: Number(text(formData, "amount")),
      reference: text(formData, "reference"),
      notes: text(formData, "notes"),
      evidence: formData.get("evidence"),
    });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data pembayaran tidak valid." };
  }

  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> | null = null;
  let uploadedPath: string | null = null;
  try {
    supabase = await createSupabaseServerClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) throw new Error("Sesi berakhir. Silakan masuk kembali.");
    const evidence = await uploadIRFile(
      supabase,
      userData.user.id,
      irId,
      "payments",
      parsed.data.evidence,
      "bank_transfer",
    );
    uploadedPath = evidence.object_path;

    const { error } = await supabase.rpc("record_ir_reimbursement_payment", {
      p_ir_record_id: irId,
      p_payment_date: parsed.data.date,
      p_amount: parsed.data.amount,
      p_reference: parsed.data.reference || null,
      p_notes: parsed.data.notes || null,
      p_evidence: evidence,
    });
    if (error) throw new Error(error.message);
    revalidatePath(pathFor(irType));
    revalidatePath(`${pathFor(irType)}/${irId}`);
    revalidatePath("/internal-prepayment");
    revalidatePath("/transaction-ledger");
    revalidatePath("/reconciliation");
    return { success: "Pembayaran reimbursement berhasil dicatat." };
  } catch (error) {
    const cleanupWarning = supabase && uploadedPath
      ? await cleanupUploaded(supabase, [uploadedPath])
      : null;
    return toActionError(error, cleanupWarning);
  }
}

export async function recordIRIPReplenishmentAction(
  irId: string,
  irType: "operasional" | "facility",
  _previousState: IRActionState,
  formData: FormData,
): Promise<IRActionState> {
  void _previousState;
  const parsed = z
    .object({
      date: dateSchema,
      reference: z.string().trim().max(120),
      notes: z.string().trim().min(1, "Catatan konfirmasi wajib diisi.").max(1000),
      evidence: z.custom<File>((value) => value instanceof File && value.size > 0, {
        message: "Bukti transfer pengembalian wajib dipilih.",
      }),
    })
    .safeParse({
      date: text(formData, "replenishment_date"),
      reference: text(formData, "reference"),
      notes: text(formData, "notes"),
      evidence: formData.get("evidence"),
    });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data pengembalian dana IP tidak valid." };
  }

  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> | null = null;
  let uploadedPath: string | null = null;
  try {
    supabase = await createSupabaseServerClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) throw new Error("Sesi berakhir. Silakan masuk kembali.");
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (profileError) throw new Error(`Hak administrator gagal diverifikasi: ${profileError.message}`);
    if (!profile?.is_admin) throw new Error("Hanya administrator yang dapat mengonfirmasi pengembalian dana IP.");

    const evidence = await uploadIRFile(
      supabase,
      userData.user.id,
      irId,
      "replenishments",
      parsed.data.evidence,
      "bank_transfer",
    );
    uploadedPath = evidence.object_path;

    const { error } = await supabase.rpc("record_ir_ip_replenishment", {
      p_ir_record_id: irId,
      p_replenishment_date: parsed.data.date,
      p_reference: parsed.data.reference || null,
      p_notes: parsed.data.notes,
      p_evidence: evidence,
    });
    if (error) throw new Error(error.message);
    revalidatePath(pathFor(irType));
    revalidatePath(`${pathFor(irType)}/${irId}`);
    revalidatePath("/internal-prepayment");
    revalidatePath("/transaction-ledger");
    revalidatePath("/reconciliation");
    revalidatePath("/evidence-center");
    return { success: "Pengembalian dana IP dari IR berhasil dicatat." };
  } catch (error) {
    const cleanupWarning = supabase && uploadedPath
      ? await cleanupUploaded(supabase, [uploadedPath])
      : null;
    return toActionError(error, cleanupWarning);
  }
}

export async function closeIRAction(
  irId: string,
  irType: "operasional" | "facility",
  _previousState: IRActionState,
  _formData: FormData,
): Promise<IRActionState> {
  void _previousState;
  void _formData;
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("close_ir_record", {
      p_ir_record_id: irId,
    });
    if (error) throw new Error(error.message);
    revalidatePath(pathFor(irType));
    revalidatePath(`${pathFor(irType)}/${irId}`);
    return { success: "IR berhasil ditutup." };
  } catch (error) {
    return toActionError(error);
  }
}
