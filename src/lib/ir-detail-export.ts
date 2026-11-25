import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  parseIPApplicationFormSettings,
  type ExportImage,
  type IPApplicationFormSettings,
} from "@/lib/ip-application-export";

type Client = SupabaseClient<Database>;
type IRRecord = Database["public"]["Views"]["ir_monitoring"]["Row"];

export type IRExportEvidence = {
  id: string;
  expenseId: string | null;
  paymentId: string | null;
  originalFileName: string;
  documentType: string;
  mimeType: "image/jpeg" | "image/png" | "application/pdf";
  uploadedAt: string;
  bytes: Uint8Array;
};

export type IRDetailExportData = {
  record: IRRecord;
  transactions: Array<{
    id: string;
    transactionDate: string;
    description: string;
    status: string;
    expenses: Array<{
      id: string;
      date: string;
      description: string;
      category: string;
      paymentMethod: string | null;
      amount: number;
      status: string;
      ipUsageStatus: string;
      allocations: Array<{
        sourceType: "ip" | "personal";
        ipReference: string | null;
        amount: number;
      }>;
      evidence: IRExportEvidence[];
    }>;
  }>;
  payments: Array<{
    id: string;
    date: string | null;
    amount: number;
    reference: string | null;
    notes: string | null;
    status: string;
    evidence: IRExportEvidence[];
  }>;
  irEvidence: IRExportEvidence[];
  settings: IPApplicationFormSettings;
  images: {
    submitterSignature: ExportImage | null;
  };
};

export async function getIRDetailExportData(
  client: Client,
  irId: string,
  irType: "operasional" | "facility",
): Promise<IRDetailExportData | null> {
  const [
    { data: record, error: recordError },
    { data: irRows, error: irError },
    { data: settingsRow, error: settingsError },
  ] = await Promise.all([
    client.from("ir_monitoring").select("*").eq("id", irId).eq("ir_type", irType).maybeSingle(),
    client.from("ir_records").select("id, reference_code, created_by").eq("id", irId).maybeSingle(),
    client.from("system_settings").select("value").eq("key", "ip_application_form").maybeSingle(),
  ]);
  if (recordError) throw new Error(`Detail IR gagal dimuat: ${recordError.message}`);
  if (irError) throw new Error(`Identitas IR gagal dimuat: ${irError.message}`);
  if (settingsError) throw new Error(`Pengaturan template laporan gagal dimuat: ${settingsError.message}`);
  if (!record || !irRows) return null;
  if (record.status === "void") throw new Error("IR berstatus void tidak dapat diekspor.");
  const { data: applicant, error: applicantError } = irRows.created_by
    ? await client
      .from("profiles")
      .select("display_name, employee_id, signature_path")
      .eq("id", irRows.created_by)
      .maybeSingle()
    : { data: null, error: null };
  if (applicantError) throw new Error(`Profil pemohon IR gagal dimuat: ${applicantError.message}`);
  if (!applicant?.signature_path) {
    throw new Error("Tanda tangan profil pemohon IR belum tersedia.");
  }

  const { data: transactionRows, error: transactionError } = await client.from("ir_transactions")
    .select("id, transaction_date, description, status")
    .eq("ir_record_id", irId)
    .order("transaction_date")
    .order("id");
  if (transactionError) throw new Error(`Transaksi IR gagal dimuat: ${transactionError.message}`);
  const transactionIds = transactionRows.map((row) => row.id);

  const { data: expenseRows, error: expenseError } = transactionIds.length
    ? await client.from("expenses")
      .select("id, ir_transaction_id, category_id, expense_date, description, amount, payment_method, ip_usage_status, status")
      .in("ir_transaction_id", transactionIds)
      .order("expense_date")
      .order("id")
    : { data: [], error: null };
  if (expenseError) throw new Error(`Rincian pengeluaran IR gagal dimuat: ${expenseError.message}`);

  const expenseIds = expenseRows.map((row) => row.id);
  const [{ data: allocations, error: allocationError }, { data: evidenceRows, error: evidenceError }] =
    expenseIds.length
      ? await Promise.all([
        client.from("transaction_allocations")
          .select("id, expense_id, source_type, ip_record_id, amount, status")
          .in("expense_id", expenseIds)
          .eq("status", "active"),
        client.from("evidence_files")
          .select("id, expense_id, reimbursement_payment_id, ir_record_id, object_path, original_file_name, document_type, mime_type, uploaded_at")
          .in("expense_id", expenseIds)
          .eq("status", "active"),
      ])
      : [{ data: [], error: null }, { data: [], error: null }];
  if (allocationError) throw new Error(`Alokasi dana IR gagal dimuat: ${allocationError.message}`);
  if (evidenceError) throw new Error(`Evidence pengeluaran IR gagal dimuat: ${evidenceError.message}`);

  const [{ data: payments, error: paymentError }, { data: irEvidenceRows, error: irEvidenceError }] =
    await Promise.all([
      client.from("reimbursement_payments")
        .select("id, payment_date, amount, reference_code, notes, status")
        .eq("ir_record_id", irId)
        .order("payment_date")
        .order("id"),
      client.from("evidence_files")
        .select("id, expense_id, reimbursement_payment_id, ir_record_id, object_path, original_file_name, document_type, mime_type, uploaded_at")
        .eq("ir_record_id", irId)
        .eq("status", "active"),
    ]);
  if (paymentError) throw new Error(`Pembayaran reimbursement gagal dimuat: ${paymentError.message}`);
  if (irEvidenceError) throw new Error(`Dokumen IR gagal dimuat: ${irEvidenceError.message}`);

  const paymentIds = payments.map((payment) => payment.id);
  const { data: paymentEvidenceRows, error: paymentEvidenceError } = paymentIds.length
    ? await client.from("evidence_files")
      .select("id, expense_id, reimbursement_payment_id, ir_record_id, object_path, original_file_name, document_type, mime_type, uploaded_at")
      .in("reimbursement_payment_id", paymentIds)
      .eq("status", "active")
    : { data: [], error: null };
  if (paymentEvidenceError) throw new Error(`Bukti pembayaran IR gagal dimuat: ${paymentEvidenceError.message}`);

  const allEvidenceRows = [...new Map(
    [...evidenceRows, ...paymentEvidenceRows, ...irEvidenceRows].map((row) => [row.id, row]),
  ).values()];
  const evidence = await Promise.all(allEvidenceRows.map(async (row): Promise<IRExportEvidence> => {
    const { data, error } = await client.storage.from("faams-evidence").download(row.object_path);
    if (error) throw new Error(`Evidence ${row.original_file_name} gagal diunduh: ${error.message}`);
    if (data.type !== row.mime_type) {
      throw new Error(`Tipe file evidence ${row.original_file_name} tidak sesuai metadata.`);
    }
    return {
      id: row.id,
      expenseId: row.expense_id,
      paymentId: row.reimbursement_payment_id,
      originalFileName: row.original_file_name,
      documentType: row.document_type,
      mimeType: row.mime_type,
      uploadedAt: row.uploaded_at,
      bytes: new Uint8Array(await data.arrayBuffer()),
    };
  }));
  const evidenceByExpense = new Map<string, IRExportEvidence[]>();
  const evidenceByPayment = new Map<string, IRExportEvidence[]>();
  const directIREvidence: IRExportEvidence[] = [];
  for (const file of evidence) {
    if (file.expenseId) {
      evidenceByExpense.set(file.expenseId, [...(evidenceByExpense.get(file.expenseId) ?? []), file]);
    } else if (file.paymentId) {
      evidenceByPayment.set(file.paymentId, [...(evidenceByPayment.get(file.paymentId) ?? []), file]);
    } else {
      directIREvidence.push(file);
    }
  }

  const categoryIds = [...new Set(expenseRows.map((expense) => expense.category_id))];
  const ipIds = [...new Set(allocations.flatMap((allocation) => allocation.ip_record_id ? [allocation.ip_record_id] : []))];
  const [
    { data: categories, error: categoryError },
    { data: ipRows, error: ipError },
  ] = await Promise.all([
    categoryIds.length
      ? client.from("categories").select("id, name").in("id", categoryIds)
      : { data: [], error: null },
    ipIds.length
      ? client.from("ip_records").select("id, reference_code").in("id", ipIds)
      : { data: [], error: null },
  ]);
  if (categoryError) throw new Error(`Kategori pengeluaran gagal dimuat: ${categoryError.message}`);
  if (ipError) throw new Error(`Referensi IP gagal dimuat: ${ipError.message}`);
  const categoryById = new Map(categories.map((category) => [category.id, category.name]));
  const ipById = new Map(ipRows.map((ip) => [ip.id, ip.reference_code]));
  const allocationsByExpense = new Map<string, typeof allocations>();
  for (const allocation of allocations) {
    allocationsByExpense.set(allocation.expense_id, [
      ...(allocationsByExpense.get(allocation.expense_id) ?? []),
      allocation,
    ]);
  }

  const settings = parseIPApplicationFormSettings(settingsRow?.value);
  settings.submitter_name = applicant.display_name ?? "";
  settings.submitter_employee_id = applicant.employee_id ?? "";
  settings.submitter_signature_path = applicant.signature_path;
  const { data: signatureData, error: signatureError } = await client.storage
    .from("faams-evidence")
    .download(settings.submitter_signature_path);
  if (signatureError) throw new Error(`Tanda tangan pelapor IR gagal dimuat: ${signatureError.message}`);
  const signatureMimeType = signatureData.type === "image/png" ? "image/png" :
    signatureData.type === "image/jpeg" ? "image/jpeg" : null;
  if (!signatureMimeType) throw new Error("Tanda tangan pelapor IR harus berupa PNG atau JPG.");
  const submitterSignature: ExportImage = {
    bytes: new Uint8Array(await signatureData.arrayBuffer()),
    mimeType: signatureMimeType,
  };
  const expensesByTransaction = new Map<string, typeof expenseRows>();
  for (const expense of expenseRows) {
    if (!expense.ir_transaction_id) continue;
    expensesByTransaction.set(expense.ir_transaction_id, [
      ...(expensesByTransaction.get(expense.ir_transaction_id) ?? []),
      expense,
    ]);
  }

  return {
    record,
    transactions: transactionRows.map((transaction) => ({
      id: transaction.id,
      transactionDate: transaction.transaction_date,
      description: transaction.description,
      status: transaction.status,
      expenses: (expensesByTransaction.get(transaction.id) ?? []).map((expense) => ({
        id: expense.id,
        date: expense.expense_date,
        description: expense.description,
        category: categoryById.get(expense.category_id) ?? "Kategori tidak ditemukan",
        paymentMethod: expense.payment_method,
        amount: expense.amount,
        status: expense.status,
        ipUsageStatus: expense.ip_usage_status,
        allocations: (allocationsByExpense.get(expense.id) ?? []).map((allocation) => ({
          sourceType: allocation.source_type,
          ipReference: allocation.ip_record_id ? ipById.get(allocation.ip_record_id) ?? null : null,
          amount: allocation.amount,
        })),
        evidence: evidenceByExpense.get(expense.id) ?? [],
      })),
    })),
    payments: payments.map((payment) => ({
      id: payment.id,
      date: payment.payment_date,
      amount: payment.amount,
      reference: payment.reference_code,
      notes: payment.notes,
      status: payment.status,
      evidence: evidenceByPayment.get(payment.id) ?? [],
    })),
    irEvidence: directIREvidence,
    settings,
    images: { submitterSignature },
  };
}
