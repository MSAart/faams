import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  loadIPApplicationImage,
  type ExportImage,
} from "@/lib/ip-application-export";

type Client = SupabaseClient<Database>;

export type IPRealizationExportData = {
  record: Pick<
    Database["public"]["Views"]["ip_monitoring"]["Row"],
    | "id"
    | "reference_code"
    | "title"
    | "purpose"
    | "pic_name"
    | "disbursement_date"
    | "disbursed_amount"
    | "disbursement_reference"
  >;
  expenses: Array<
    Pick<
      Database["public"]["Tables"]["expenses"]["Row"],
      | "id"
      | "ip_budget_item_id"
      | "category_id"
      | "expense_date"
      | "description"
      | "vendor"
      | "amount"
      | "payment_method"
      | "ip_usage_status"
      | "ip_mismatch_reason"
      | "ip_resolution_note"
      | "status"
    >
  >;
  movements: Array<
    Pick<
      Database["public"]["Views"]["transaction_ledger"]["Row"],
      "movement_type" | "transaction_date" | "debit" | "credit" | "description"
    >
  >;
  categories: Array<{ id: string; name: string }>;
  budgetItems: Array<{ id: string; description: string }>;
  evidence: Array<
    Pick<
      Database["public"]["Tables"]["evidence_files"]["Row"],
      | "id"
      | "expense_id"
      | "original_file_name"
      | "object_path"
      | "document_type"
      | "mime_type"
    >
  >;
  submitter: {
    name: string;
    employeeId: string;
  };
  images: {
    submitterSignature: ExportImage | null;
  };
};

export type IPRealizationLedgerEntry = {
  date: string;
  description: string;
  debit: number;
  credit: number;
};

export function toIPRealizationLedgerEntry(
  movement: IPRealizationExportData["movements"][number],
): IPRealizationLedgerEntry | null {
  if (movement.movement_type === "return") return null;
  if (movement.movement_type === "reimbursement_received") return null;

  if (movement.movement_type === "disbursement") {
    return {
      date: movement.transaction_date,
      description: `Pemasukan · Pencairan saldo IP — ${movement.description}`,
      debit: 0,
      credit: movement.debit,
    };
  }

  if (movement.movement_type === "expense") {
    return {
      date: movement.transaction_date,
      description: `Pengeluaran · Realisasi — ${movement.description}`,
      debit: movement.credit,
      credit: 0,
    };
  }

  return {
    date: movement.transaction_date,
    description: `${movement.debit > 0 ? "Pemasukan" : "Pengeluaran"} · Penyesuaian — ${movement.description}`,
    debit: movement.credit,
    credit: movement.debit,
  };
}

export async function getIPRealizationExportData(
  client: Client,
  ipId: string,
): Promise<IPRealizationExportData | null> {
  const { data: record, error: recordError } = await client
    .from("ip_monitoring")
    .select("id, reference_code, title, purpose, pic_name, disbursement_date, disbursed_amount, disbursement_reference")
    .eq("id", ipId)
    .maybeSingle();
  if (recordError) throw new Error(`Data IP gagal dimuat: ${recordError.message}`);
  if (!record) return null;

  const { data: owner, error: ownerError } = await client
    .from("ip_records")
    .select("created_by")
    .eq("id", ipId)
    .maybeSingle();
  if (ownerError) throw new Error(`Pemilik IP gagal dimuat: ${ownerError.message}`);
  if (!owner?.created_by) throw new Error("Pemilik dokumen IP tidak ditemukan.");
  const { data: applicant, error: applicantError } = await client
    .from("profiles")
    .select("display_name, employee_id, signature_path")
    .eq("id", owner.created_by)
    .maybeSingle();
  if (applicantError) throw new Error(`Profil pemohon IP gagal dimuat: ${applicantError.message}`);
  if (!applicant?.signature_path) throw new Error("Tanda tangan profil pemohon IP belum tersedia.");
  const submitterSignature = await loadIPApplicationImage(client, applicant.signature_path);

  const { data: expenses, error: expenseError } = await client
    .from("expenses")
    .select(
      "id, ip_budget_item_id, category_id, expense_date, description, vendor, amount, payment_method, ip_usage_status, ip_mismatch_reason, ip_resolution_note, status",
    )
    .eq("ip_record_id", ipId)
    .is("related_ir_record_id", null)
    .eq("status", "posted")
    .order("expense_date", { ascending: false });
  if (expenseError) throw new Error(`Realisasi IP gagal dimuat: ${expenseError.message}`);

  const expenseIds = expenses.map((expense) => expense.id);
  const categoryIds = [...new Set(expenses.map((expense) => expense.category_id))];
  const budgetItemIds = [
    ...new Set(
      expenses
        .map((expense) => expense.ip_budget_item_id)
        .filter((id): id is string => id !== null),
    ),
  ];

  const [categoryResult, budgetResult, evidenceResult, movementResult] = await Promise.all([
    categoryIds.length
      ? client.from("categories").select("id, name").in("id", categoryIds)
      : Promise.resolve({ data: [], error: null }),
    budgetItemIds.length
      ? client.from("ip_budget_items").select("id, description").in("id", budgetItemIds)
      : Promise.resolve({ data: [], error: null }),
    expenseIds.length
      ? client
          .from("evidence_files")
          .select("id, expense_id, original_file_name, object_path, document_type, mime_type")
          .in("expense_id", expenseIds)
          .eq("status", "active")
          .order("uploaded_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    client
      .from("transaction_ledger")
      .select("movement_type, transaction_date, debit, credit, description")
      .eq("related_ip_id", ipId)
      .is("related_ir_id", null)
      .eq("ir_replenishment", false)
      .order("transaction_date", { ascending: true }),
  ]);
  if (categoryResult.error) throw new Error(`Kategori realisasi gagal dimuat: ${categoryResult.error.message}`);
  if (budgetResult.error) throw new Error(`Item anggaran realisasi gagal dimuat: ${budgetResult.error.message}`);
  if (evidenceResult.error) throw new Error(`Bukti realisasi gagal dimuat: ${evidenceResult.error.message}`);
  if (movementResult.error) throw new Error(`Ledger IP gagal dimuat: ${movementResult.error.message}`);

  return {
    record,
    expenses,
    movements: movementResult.data,
    categories: categoryResult.data,
    budgetItems: budgetResult.data,
    evidence: evidenceResult.data,
    submitter: {
      name: applicant.display_name ?? "",
      employeeId: applicant.employee_id ?? "",
    },
    images: { submitterSignature },
  };
}
