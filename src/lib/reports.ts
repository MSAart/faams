import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

export type ReportScope = "all" | "operasional" | "facility";
export type ReportFilters = {
  from: string | null;
  to: string | null;
  ipId: string | null;
  irId: string | null;
  scope: ReportScope;
};

type IP = Database["public"]["Views"]["ip_monitoring"]["Row"];
type IR = Database["public"]["Views"]["ir_monitoring"]["Row"];
type Ledger = Database["public"]["Views"]["transaction_ledger"]["Row"];
type Balance = Database["public"]["Views"]["reconciliation_balances"]["Row"];
type IPRecord = Database["public"]["Tables"]["ip_records"]["Row"];
type BudgetItem = Database["public"]["Tables"]["ip_budget_items"]["Row"];
type Expense = Database["public"]["Tables"]["expenses"]["Row"];
type IRTransaction = Database["public"]["Tables"]["ir_transactions"]["Row"];
type Allocation = Database["public"]["Tables"]["transaction_allocations"]["Row"];
type Settlement = Database["public"]["Tables"]["settlements"]["Row"];
type Payment = Database["public"]["Tables"]["reimbursement_payments"]["Row"];
type Category = Database["public"]["Tables"]["categories"]["Row"];
type Evidence = Database["public"]["Views"]["evidence_center"]["Row"] & {
  base64: string | null;
};

export type ReportDataset = {
  filters: ReportFilters;
  ips: IP[];
  ipRecords: IPRecord[];
  budgetItems: BudgetItem[];
  irs: IR[];
  expenses: Expense[];
  irTransactions: IRTransaction[];
  allocations: Allocation[];
  settlements: Settlement[];
  payments: Payment[];
  ledger: Ledger[];
  balances: Balance[];
  evidence: Evidence[];
  categories: Category[];
  warnings: string[];
  generatedAt: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const batchSize = 1000;

function isValidDate(value: string) {
  if (!datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function monthRange(year: number, month: number) {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: start, to: `${year}-${String(month).padStart(2, "0")}-${last}` };
}

export function parseReportFilters(params: URLSearchParams): ReportFilters {
  const now = new Date();
  const period = params.get("period") ?? "year";
  const scopeValue = params.get("scope") ?? "all";
  if (!["all", "year", "month", "custom"].includes(period)) {
    throw new Error("Periode laporan tidak valid.");
  }
  if (!["all", "operasional", "facility"].includes(scopeValue)) {
    throw new Error("Jenis laporan tidak valid.");
  }

  let from: string | null = null;
  let to: string | null = null;
  if (period === "year") {
    const year = Number(params.get("year") ?? now.getFullYear());
    if (!Number.isInteger(year) || year < 2000 || year > now.getFullYear() + 1) {
      throw new Error("Tahun laporan tidak valid.");
    }
    from = `${year}-01-01`;
    to = `${year}-12-31`;
  } else if (period === "month") {
    const year = Number(params.get("year") ?? now.getFullYear());
    const month = Number(params.get("month"));
    if (!Number.isInteger(year) || year < 2000 || year > now.getFullYear() + 1) {
      throw new Error("Tahun laporan tidak valid.");
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new Error("Bulan laporan tidak valid.");
    }
    ({ from, to } = monthRange(year, month));
  } else if (period === "custom") {
    from = params.get("from");
    to = params.get("to");
    if (!from || !to || !isValidDate(from) || !isValidDate(to) || from > to) {
      throw new Error("Rentang tanggal khusus tidak valid.");
    }
  }

  const ipId = params.get("ipId") || null;
  const irId = params.get("irId") || null;
  if (ipId && !uuidPattern.test(ipId)) throw new Error("ID IP tidak valid.");
  if (irId && !uuidPattern.test(irId)) throw new Error("ID IR tidak valid.");
  if (ipId && irId) throw new Error("Pilih IP atau IR saja untuk satu laporan.");

  return {
    from,
    to,
    ipId,
    irId,
    scope: scopeValue as ReportScope,
  };
}

async function loadAll<T>(
  loadPage: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>,
  label: string,
) {
  const result: T[] = [];
  for (let from = 0; ; from += batchSize) {
    const { data, error } = await loadPage(from, from + batchSize - 1);
    if (error) throw new Error(`${label} gagal dimuat: ${error.message}`);
    result.push(...(data ?? []));
    if (!data || data.length < batchSize) return result;
  }
}

function inRange(date: string | null, filters: ReportFilters) {
  if (!date) return false;
  return (!filters.from || date >= filters.from) && (!filters.to || date <= filters.to);
}

function selectedByScope(scope: ReportScope, irType: string) {
  return scope === "all" || scope === irType;
}

function base64(bytes: ArrayBuffer) {
  return Buffer.from(bytes).toString("base64");
}

export async function getReportDataset(
  supabase: Client,
  filters: ReportFilters,
  includeEvidenceData = false,
): Promise<ReportDataset> {
  const [
    ipsAll,
    ipRecordsAll,
    budgetsAll,
    irsAll,
    expensesAll,
    transactionsAll,
    allocationsAll,
    settlementsAll,
    paymentsAll,
    ledgerAll,
    balancesAll,
    evidenceAll,
    categories,
  ] = await Promise.all([
    loadAll<IP>(async (from, to) => supabase.from("ip_monitoring").select("*").order("id").range(from, to), "Register IP"),
    loadAll<IPRecord>(async (from, to) => supabase.from("ip_records").select("*").order("id").range(from, to), "Detail IP"),
    loadAll<BudgetItem>(async (from, to) => supabase.from("ip_budget_items").select("*").order("id").range(from, to), "Item budget IP"),
    loadAll<IR>(async (from, to) => supabase.from("ir_monitoring").select("*").order("id").range(from, to), "Register IR"),
    loadAll<Expense>(async (from, to) => supabase.from("expenses").select("*").order("id").range(from, to), "Expense"),
    loadAll<IRTransaction>(async (from, to) => supabase.from("ir_transactions").select("*").order("id").range(from, to), "Transaksi IR"),
    loadAll<Allocation>(async (from, to) => supabase.from("transaction_allocations").select("*").order("id").range(from, to), "Alokasi dana"),
    loadAll<Settlement>(async (from, to) => supabase.from("settlements").select("*").order("id").range(from, to), "Settlement"),
    loadAll<Payment>(async (from, to) => supabase.from("reimbursement_payments").select("*").order("id").range(from, to), "Pembayaran reimbursement"),
    loadAll<Ledger>(async (from, to) => supabase.from("transaction_ledger").select("*").order("transaction_date").order("transaction_id").range(from, to), "Transaction ledger"),
    loadAll<Balance>(async (from, to) => supabase.from("reconciliation_balances").select("*").order("entity_id").range(from, to), "Rekonsiliasi"),
    loadAll<Database["public"]["Views"]["evidence_center"]["Row"]>(async (from, to) => supabase.from("evidence_center").select("*").eq("status", "active").order("uploaded_at").order("id").range(from, to), "Evidence index"),
    loadAll<Category>(async (from, to) => supabase.from("categories").select("*").order("id").range(from, to), "Kategori"),
  ]);

  const transactionsById = new Map(transactionsAll.map((transaction) => [transaction.id, transaction]));
  const expensesById = new Map(expensesAll.map((expense) => [expense.id, expense]));
  const expensesByIrId = new Map<string, Expense[]>();
  const irIdsByIpId = new Map<string, Set<string>>();
  const ipIdsByIrId = new Map<string, Set<string>>();
  for (const expense of expensesAll) {
    const irId = expense.ir_transaction_id
      ? transactionsById.get(expense.ir_transaction_id)?.ir_record_id
      : expense.related_ir_record_id;
    if (irId) expensesByIrId.set(irId, [...(expensesByIrId.get(irId) ?? []), expense]);
  }
  for (const allocation of allocationsAll) {
    const expense = expensesById.get(allocation.expense_id);
    if (!expense) continue;
    const irId = expense.ir_transaction_id
      ? transactionsById.get(expense.ir_transaction_id)?.ir_record_id
      : null;
    if (!irId || !allocation.ip_record_id) continue;
    irIdsByIpId.set(allocation.ip_record_id, new Set([...(irIdsByIpId.get(allocation.ip_record_id) ?? []), irId]));
    ipIdsByIrId.set(irId, new Set([...(ipIdsByIrId.get(irId) ?? []), allocation.ip_record_id]));
  }

  const scopedIRs = irsAll.filter((ir) => {
    if (!selectedByScope(filters.scope, ir.ir_type)) return false;
    const activityDate = inRange(ir.submitted_on, filters) ||
      (expensesByIrId.get(ir.id) ?? []).some((expense) => inRange(expense.expense_date, filters));
    if (!filters.from && !filters.to) return true;
    if (!activityDate && !filters.irId) return false;
    if (filters.ipId) return irIdsByIpId.get(filters.ipId)?.has(ir.id) ?? false;
    return !filters.irId || ir.id === filters.irId;
  });
  const scopedIRIds = new Set(scopedIRs.map((ir) => ir.id));

  const scopedIPs = ipsAll.filter((ip) => {
    const dateMatches = inRange(ip.disbursement_date, filters) || inRange(ip.requested_on, filters);
    if (filters.ipId) return ip.id === filters.ipId;
    if (filters.scope !== "all") return false;
    if (filters.irId) return ipIdsByIrId.get(filters.irId)?.has(ip.id) ?? false;
    if (!filters.from && !filters.to) return true;
    return dateMatches;
  });
  const scopedIPIds = new Set(scopedIPs.map((ip) => ip.id));

  const selectedTransactions = transactionsAll.filter((transaction) => scopedIRIds.has(transaction.ir_record_id));
  const scopedExpenses = expensesAll.filter((expense) => {
    const irId = expense.ir_transaction_id
      ? transactionsById.get(expense.ir_transaction_id)?.ir_record_id
      : expense.related_ir_record_id;
    const selectedIP = expense.ip_record_id && scopedIPIds.has(expense.ip_record_id);
    const selectedIR = irId && scopedIRIds.has(irId);
    const includeByDate = inRange(expense.expense_date, filters);
    if (filters.ipId) {
      return Boolean(includeByDate && (
        selectedIP || (selectedIR && (irIdsByIpId.get(filters.ipId)?.has(irId) ?? false))
      ));
    }
    if (filters.irId) return Boolean(includeByDate && (
      selectedIR || (expense.ip_record_id && (ipIdsByIrId.get(filters.irId)?.has(expense.ip_record_id) ?? false))
    ));
    if (!selectedByScope(filters.scope, irId ? irsAll.find((ir) => ir.id === irId)?.ir_type ?? "" : "all")) return false;
    return selectedIP || selectedIR ? (!filters.from && !filters.to ? true : includeByDate) : false;
  });
  const scopedExpenseIds = new Set(scopedExpenses.map((expense) => expense.id));
  const scopedExpenseIrIds = new Set(scopedExpenses.flatMap((expense) =>
    expense.ir_transaction_id
      ? [transactionsById.get(expense.ir_transaction_id)?.ir_record_id].filter((id): id is string => Boolean(id))
      : expense.related_ir_record_id ? [expense.related_ir_record_id] : [],
  ));
  const reportIRs = scopedIRs.filter((ir) => !filters.ipId || scopedExpenseIrIds.has(ir.id));
  const reportIRIds = new Set(reportIRs.map((ir) => ir.id));

  const reportLedger = ledgerAll.filter((row) => {
    if (!inRange(row.transaction_date, filters)) return false;
    if (filters.scope !== "all" && row.ir_type !== filters.scope) return false;
    if (filters.ipId) return row.related_ip_id === filters.ipId;
    if (filters.irId) return row.related_ir_id === filters.irId;
    return filters.scope === "all" ||
      (row.related_ir_id !== null && reportIRIds.has(row.related_ir_id));
  });
  const reportBalances = balancesAll.filter((row) => {
    if (filters.ipId) return row.entity_type === "ip" && row.entity_id === filters.ipId;
    if (filters.irId) return row.entity_type === "ir" && row.entity_id === filters.irId;
    if (filters.scope === "operasional") return row.entity_type === "ir" && row.entity_subtype === "operasional";
    if (filters.scope === "facility") return row.entity_type === "ir" && row.entity_subtype === "facility";
    const activity = row.activity_date;
    return (!filters.from && !filters.to) || inRange(activity, filters);
  });
  const reportIPRecords = ipRecordsAll.filter((ip) => scopedIPIds.has(ip.id));
  const reportBudgets = budgetsAll.filter((item) => scopedIPIds.has(item.ip_record_id));
  const reportSettlements = settlementsAll.filter((item) =>
    scopedIPIds.has(item.ip_record_id) &&
    ((!filters.from && !filters.to) || inRange(item.settlement_date, filters)),
  );
  const reportPayments = paymentsAll.filter((item) =>
    reportIRIds.has(item.ir_record_id) &&
    ((!filters.from && !filters.to) || inRange(item.payment_date, filters)),
  );
  const reportAllocations = allocationsAll.filter((item) => scopedExpenseIds.has(item.expense_id));

  const expenseEvidence = new Map<string, number>();
  const evidenceBySettlement = new Map<string, number>();
  const evidenceByPayment = new Map<string, number>();
  const evidenceByIR = new Map<string, number>();
  const evidenceByIPDisbursement = new Set<string>();
  for (const item of evidenceAll) {
    if (item.expense_id) expenseEvidence.set(item.expense_id, (expenseEvidence.get(item.expense_id) ?? 0) + 1);
    if (item.settlement_id) evidenceBySettlement.set(item.settlement_id, (evidenceBySettlement.get(item.settlement_id) ?? 0) + 1);
    if (item.reimbursement_payment_id) evidenceByPayment.set(item.reimbursement_payment_id, (evidenceByPayment.get(item.reimbursement_payment_id) ?? 0) + 1);
    if (item.ir_record_id) evidenceByIR.set(item.ir_record_id, (evidenceByIR.get(item.ir_record_id) ?? 0) + 1);
    if (item.ip_record_id && item.evidence_category === "ip_disbursement") {
      evidenceByIPDisbursement.add(item.ip_record_id);
    }
  }
  const reportEvidence = evidenceAll.filter((item) => {
    if (item.expense_id && scopedExpenseIds.has(item.expense_id)) return true;
    if (item.ip_record_id && scopedIPIds.has(item.ip_record_id)) return true;
    if (item.ir_record_id && reportIRIds.has(item.ir_record_id)) return true;
    if (item.settlement_id && reportSettlements.some((settlement) => settlement.id === item.settlement_id)) return true;
    if (item.reimbursement_payment_id && reportPayments.some((payment) => payment.id === item.reimbursement_payment_id)) return true;
    return item.parent_type === "unlinked" &&
      ((!filters.from && !filters.to) || inRange(item.uploaded_at.slice(0, 10), filters));
  });

  const warnings: string[] = [];
  const unverified = scopedExpenses.filter((expense) =>
    expense.status !== "void" &&
    (expense.ip_usage_status === "pending_review" ||
      (expense.status === "posted" && !expenseEvidence.has(expense.id))),
  );
  if (unverified.length) warnings.push(`${unverified.length} expense perlu verifikasi atau belum memiliki evidence.`);
  const missingIPDisbursementEvidence = scopedIPs.filter((ip) =>
    ip.disbursement_date && ip.disbursed_amount > 0 && !evidenceByIPDisbursement.has(ip.id),
  );
  if (missingIPDisbursementEvidence.length) warnings.push(`${missingIPDisbursementEvidence.length} pencairan IP belum memiliki evidence aktif.`);
  const missingIRDocumentation = reportIRs.filter((ir) =>
    !evidenceByIR.has(ir.id) &&
    !scopedExpenses.some((expense) => {
      const irId = expense.ir_transaction_id
        ? transactionsById.get(expense.ir_transaction_id)?.ir_record_id
        : expense.related_ir_record_id;
      return irId === ir.id && expenseEvidence.has(expense.id);
    }),
  );
  if (missingIRDocumentation.length) warnings.push(`${missingIRDocumentation.length} IR belum memiliki dokumentasi evidence aktif.`);
  const missingReturnEvidence = reportSettlements.filter((settlement) =>
    settlement.amount_returned > 0 && settlement.status !== "void" && !evidenceBySettlement.has(settlement.id),
  );
  if (missingReturnEvidence.length) warnings.push(`${missingReturnEvidence.length} pengembalian dana belum memiliki evidence aktif.`);
  const missingPaymentEvidence = reportPayments.filter((payment) =>
    payment.status === "paid" && !evidenceByPayment.has(payment.id),
  );
  if (missingPaymentEvidence.length) warnings.push(`${missingPaymentEvidence.length} pembayaran reimbursement belum memiliki evidence aktif.`);
  const discrepancyRows = reportBalances.filter((row) =>
    ["Discrepancy", "Unverified", "Over Budget"].includes(row.reconciliation_status),
  );
  if (discrepancyRows.length) warnings.push(`${discrepancyRows.length} record memiliki status discrepancy, unverified, atau over budget.`);
  const outstandingRows = reportBalances.filter((row) => row.outstanding_amount > 0);
  if (outstandingRows.length) warnings.push(`${outstandingRows.length} record masih memiliki outstanding balance.`);

  const evidenceWithData: Evidence[] = await Promise.all(reportEvidence.map(async (item) => {
    if (!includeEvidenceData || !["image/jpeg", "image/png", "application/pdf"].includes(item.mime_type)) {
      return { ...item, base64: null };
    }
    const { data, error } = await supabase.storage.from("faams-evidence").download(item.object_path);
    if (error) {
      throw new Error(`Evidence ${item.original_file_name} gagal diunduh untuk laporan: ${error.message}`);
    }
    return { ...item, base64: base64(await data.arrayBuffer()) };
  }));

  return {
    filters,
    ips: scopedIPs,
    ipRecords: reportIPRecords,
    budgetItems: reportBudgets,
    irs: reportIRs,
    expenses: scopedExpenses,
    irTransactions: selectedTransactions,
    allocations: reportAllocations,
    settlements: reportSettlements,
    payments: reportPayments,
    ledger: reportLedger,
    balances: reportBalances,
    evidence: evidenceWithData,
    categories,
    warnings,
    generatedAt: new Date().toISOString(),
  };
}

export function reportReference(data: ReportDataset, id: string | null) {
  if (!id) return "—";
  return data.ips.find((row) => row.id === id)?.reference_code ??
    data.irs.find((row) => row.id === id)?.reference_code ??
    data.ipRecords.find((row) => row.id === id)?.reference_code ??
    id;
}

export function reportFiltersLabel(filters: ReportFilters) {
  if (!filters.from && !filters.to) return "Semua periode";
  return `${filters.from ?? "Awal"} s.d. ${filters.to ?? "Akhir"}`;
}
