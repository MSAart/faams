import { FinanceDashboard } from "@/components/dashboard/finance-dashboard";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";
const pageSize = 1000;

type PaginatedResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

async function loadAll<T>(
  loadPage: (from: number, to: number) => Promise<PaginatedResult<T>>,
  label: string,
) {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await loadPage(from, from + pageSize - 1);
    if (error) throw new Error(`${label} gagal dimuat: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const currentYear = new Date().getFullYear();
  const requestedYear = typeof params.year === "string" ? Number(params.year) : currentYear;
  const year = Number.isSafeInteger(requestedYear) && requestedYear >= 2000 && requestedYear <= currentYear + 1
    ? requestedYear
    : currentYear;
  const requestedMonth = typeof params.month === "string" ? Number(params.month) : null;
  const month = requestedMonth !== null && Number.isInteger(requestedMonth) && requestedMonth >= 1 && requestedMonth <= 12
    ? requestedMonth
    : null;

  const supabase = await createSupabaseServerClient();
  const [
    ledger,
    balances,
    ips,
    irs,
    expenses,
    evidence,
    irTransactions,
    categories,
  ] = await Promise.all([
    loadAll<Database["public"]["Views"]["transaction_ledger"]["Row"]>(
      async (from, to) => {
        const { data, error } = await supabase
          .from("transaction_ledger")
          .select("*")
          .order("transaction_date", { ascending: true })
          .order("transaction_id", { ascending: true })
          .range(from, to);
        return { data, error };
      },
      "Ledger dashboard",
    ),
    loadAll<Database["public"]["Views"]["reconciliation_balances"]["Row"]>(
      async (from, to) => {
        const { data, error } = await supabase
          .from("reconciliation_balances")
          .select("*")
          .range(from, to);
        return { data, error };
      },
      "Saldo rekonsiliasi",
    ),
    loadAll<Database["public"]["Views"]["ip_monitoring"]["Row"]>(
      async (from, to) => {
        const { data, error } = await supabase
          .from("ip_monitoring")
          .select("*")
          .order("requested_on", { ascending: false })
          .range(from, to);
        return { data, error };
      },
      "Monitoring IP",
    ),
    loadAll<Database["public"]["Views"]["ir_monitoring"]["Row"]>(
      async (from, to) => {
        const { data, error } = await supabase
          .from("ir_monitoring")
          .select("*")
          .order("submitted_on", { ascending: false, nullsFirst: false })
          .range(from, to);
        return { data, error };
      },
      "Monitoring IR",
    ),
    loadAll<Pick<
      Database["public"]["Tables"]["expenses"]["Row"],
      "id" | "ip_record_id" | "ir_transaction_id" | "category_id" |
      "expense_date" | "description" | "amount" | "ip_usage_status" | "status"
    >>(
      async (from, to) => {
        const { data, error } = await supabase
          .from("expenses")
          .select("id, ip_record_id, ir_transaction_id, category_id, expense_date, description, amount, ip_usage_status, status")
          .order("expense_date", { ascending: true })
          .range(from, to);
        return { data, error };
      },
      "Detail expense",
    ),
    loadAll<Pick<
      Database["public"]["Tables"]["evidence_files"]["Row"],
      "expense_id"
    >>(
      async (from, to) => {
        const { data, error } = await supabase
          .from("evidence_files")
          .select("expense_id")
          .eq("status", "active")
          .not("expense_id", "is", null)
          .range(from, to);
        return { data, error };
      },
      "Evidence transaksi",
    ),
    loadAll<Pick<
      Database["public"]["Tables"]["ir_transactions"]["Row"],
      "id" | "ir_record_id"
    >>(
      async (from, to) => {
        const { data, error } = await supabase
          .from("ir_transactions")
          .select("id, ir_record_id")
          .range(from, to);
        return { data, error };
      },
      "Relasi transaksi IR",
    ),
    loadAll<Pick<
      Database["public"]["Tables"]["categories"]["Row"],
      "id" | "name"
    >>(
      async (from, to) => {
        const { data, error } = await supabase
          .from("categories")
          .select("id, name")
          .order("name")
          .range(from, to);
        return { data, error };
      },
      "Kategori",
    ),
  ]);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <FinanceDashboard
      data={{
        ledger,
        balances,
        ips,
        irs,
        expenses,
        evidenceExpenseIds: evidence.flatMap((row) => row.expense_id ? [row.expense_id] : []),
        transactionToIR: irTransactions,
        categories,
        today,
      }}
      initialFilters={{
        year,
        month,
        type: "",
        categoryId: "",
        status: "",
        source: "",
      }}
    />
  );
}
