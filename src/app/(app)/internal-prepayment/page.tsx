import Link from "next/link";
import { ArrowUpRight, CalendarClock, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const currency = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 2,
});
const dateFormat = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function formatDate(value: string | null) {
  return value ? dateFormat.format(new Date(`${value}T00:00:00Z`)) : "—";
}

function statusLabel(status: string) {
  return (
    {
      draft: "Draft",
      submitted: "Diajukan",
      approved: "Disetujui",
      disbursed: "Dicairkan",
      settlement_in_progress: "Settlement berjalan",
      settled: "Settled",
      closed: "Ditutup",
      void: "Void",
    }[status] ?? status
  );
}

export default async function InternalPrepaymentPage() {
  const supabase = await createSupabaseServerClient();
  const { data: records, error } = await supabase
    .from("ip_monitoring")
    .select("*")
    .order("requested_on", { ascending: false });
  if (error) {
    throw new Error(`Daftar IP gagal dimuat: ${error.message}`);
  }

  const ipIds = records.map((record) => record.id);
  const irUsageByIP = new Map<string, number>();
  const irReplenishmentByIP = new Map<string, number>();
  const directRealizationByIP = new Map<string, number>();
  if (ipIds.length > 0) {
    const { data: irTransactions, error: irTransactionsError } = await supabase
      .from("ir_transactions")
      .select("id")
      .eq("status", "active");
    if (irTransactionsError) {
      throw new Error(`Transaksi IR untuk monitoring IP gagal dimuat: ${irTransactionsError.message}`);
    }

    const irTransactionIds = irTransactions.map((transaction) => transaction.id);
    const { data: irExpenses, error: irExpensesError } = irTransactionIds.length
      ? await supabase
          .from("expenses")
          .select("id")
          .in("ir_transaction_id", irTransactionIds)
          .eq("status", "posted")
      : { data: [], error: null };
    if (irExpensesError) throw new Error(`Pengeluaran IR untuk monitoring IP gagal dimuat: ${irExpensesError.message}`);
    const irExpenseIds = irExpenses.map((expense) => expense.id);
    if (irExpenseIds.length > 0) {
      const { data: allocations, error: allocationsError } = await supabase
        .from("transaction_allocations")
        .select("ip_record_id, amount")
        .in("expense_id", irExpenseIds)
        .in("ip_record_id", ipIds)
        .eq("source_type", "ip")
        .eq("status", "active");
      if (allocationsError) throw new Error(`Alokasi dana IR per IP gagal dimuat: ${allocationsError.message}`);
      for (const allocation of allocations) {
        if (!allocation.ip_record_id) continue;
        irUsageByIP.set(
          allocation.ip_record_id,
          (irUsageByIP.get(allocation.ip_record_id) ?? 0) + allocation.amount,
        );
      }
    }

    const { data: ledgerRows, error: ledgerError } = await supabase
      .from("transaction_ledger")
      .select("related_ip_id, related_expense_id, credit, debit, movement_type, ir_replenishment")
      .eq("source_type", "ip")
      .in("related_ip_id", ipIds);
    if (ledgerError) {
      const message = ledgerError.message.includes("transaction_ledger.ir_replenishment")
        ? "Migration pengembalian dana IP dari IR belum diterapkan atau schema cache Supabase belum diperbarui. Terapkan migration 20261122220000_ir_ip_replenishment.sql."
        : ledgerError.message;
      throw new Error(`Penggunaan dana IP gagal dimuat: ${message}`);
    }

    const irExpenseIdSet = new Set(irExpenseIds);

    for (const row of ledgerRows) {
      if (!row.related_ip_id) continue;
      if (row.ir_replenishment) {
        irReplenishmentByIP.set(
          row.related_ip_id,
          (irReplenishmentByIP.get(row.related_ip_id) ?? 0) + row.debit,
        );
        continue;
      }
      if (row.movement_type !== "expense") continue;
      if (!irExpenseIdSet.has(row.related_expense_id ?? "")) {
        directRealizationByIP.set(
          row.related_ip_id,
          (directRealizationByIP.get(row.related_ip_id) ?? 0) + row.credit,
        );
      }
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const activeCount = records.filter(
    (record) => !["closed", "void", "settled"].includes(record.status),
  ).length;
  const settlementOverdueCount = records.filter(
    (record) =>
      !["closed", "void", "settled"].includes(record.status) &&
      record.target_settlement_date !== null &&
      record.target_settlement_date < today,
  ).length;
  const overdueCount = records.filter(
    (record) =>
      !["closed", "void", "settled"].includes(record.status) &&
      record.administrative_deadline !== null &&
      record.administrative_deadline < today,
  ).length;

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="mb-2 flex size-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
            <WalletCards aria-hidden="true" className="size-5" />
          </div>
          <p className="text-sm font-medium text-slate-500">Manajemen pengajuan dan pertanggungjawaban</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
            Internal Prepayment
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Pantau pencairan, realisasi terverifikasi, pengembalian dana, dan deadline dalam satu tempat.
          </p>
        </div>
        <Button
          render={<Link href="/internal-prepayment/new" />}
          className="w-full gap-2 sm:w-auto"
        >
          Ajukan IP
          <ArrowUpRight aria-hidden="true" className="size-4" />
        </Button>
      </section>

      <section aria-label="Ringkasan IP" className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-sm text-slate-500">IP aktif</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{activeCount}</p>
            </div>
            <WalletCards aria-hidden="true" className="size-6 text-blue-700" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-sm text-slate-500">Melewati target settlement (10 HK)</p>
              <p className="mt-1 text-2xl font-bold text-amber-700">{settlementOverdueCount}</p>
            </div>
            <CalendarClock aria-hidden="true" className="size-6 text-amber-700" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-sm text-slate-500">Melewati deadline administrasi</p>
              <p className="mt-1 text-2xl font-bold text-red-700">{overdueCount}</p>
            </div>
            <CalendarClock aria-hidden="true" className="size-6 text-red-700" />
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Monitoring IP</CardTitle>
          <CardDescription>
            Realisasi langsung IP dipisahkan dari dana yang digunakan dalam IR. Saat IR lunas, dana IP yang diganti tercatat kembali ke saldo sumber IP.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {records.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-sm font-medium text-slate-700">Belum ada pengajuan IP</p>
              <p className="mt-1 text-sm text-slate-500">Buat pengajuan pertama melalui halaman Ajukan IP.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1300px] text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">IP / Kegiatan</th>
                    <th className="px-4 py-3 font-medium">Tanggal cair</th>
                    <th className="px-4 py-3 text-right font-medium">Nilai IP</th>
                    <th className="px-4 py-3 text-right font-medium">Realisasi valid</th>
                    <th className="px-4 py-3 text-right font-medium">Terpakai di IR</th>
                    <th className="px-4 py-3 text-right font-medium">Kembali dari IR</th>
                    <th className="px-4 py-3 text-right font-medium">Dikembalikan</th>
                    <th className="px-4 py-3 text-right font-medium">Sisa PUM</th>
                    <th className="px-4 py-3 font-medium">Deadline 10 / 14 HK</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {records.map((record) => {
                    const targetOverdue =
                      !["closed", "settled", "void"].includes(record.status) &&
                      record.target_settlement_date !== null &&
                      record.target_settlement_date < today;
                    const overdue =
                      !["closed", "settled", "void"].includes(record.status) &&
                      record.administrative_deadline !== null &&
                      record.administrative_deadline < today;
                    return (
                      <tr key={record.id} className="hover:bg-slate-50/70">
                        <td className="px-5 py-4">
                          <Link
                            href={`/internal-prepayment/${record.id}`}
                            className="font-semibold text-primary hover:underline"
                          >
                            {record.reference_code ?? "Nomor belum diisi"}
                          </Link>
                          <p className="mt-1 max-w-xs truncate text-xs text-slate-500">{record.title}</p>
                        </td>
                        <td className="px-4 py-4">{formatDate(record.disbursement_date)}</td>
                        <td className="px-4 py-4 text-right tabular-nums">
                          {currency.format(record.disbursed_amount)}
                        </td>
                        <td className="px-4 py-4 text-right tabular-nums text-emerald-700">
                          {currency.format(directRealizationByIP.get(record.id) ?? 0)}
                        </td>
                        <td className="px-4 py-4 text-right tabular-nums text-slate-700">
                          {currency.format(irUsageByIP.get(record.id) ?? 0)}
                        </td>
                        <td className="px-4 py-4 text-right tabular-nums text-emerald-700">
                          {currency.format(irReplenishmentByIP.get(record.id) ?? 0)}
                        </td>
                        <td className="px-4 py-4 text-right tabular-nums">
                          {currency.format(record.returned_amount)}
                        </td>
                        <td className={`px-4 py-4 text-right font-semibold tabular-nums ${record.unsettled_balance < 0 ? "text-red-700" : "text-slate-800"}`}>
                          {currency.format(record.unsettled_balance)}
                        </td>
                        <td className="px-4 py-4 text-xs">
                          {record.disbursement_date ? (
                            <>
                              <p className={targetOverdue ? "font-semibold text-amber-700" : ""}>
                                Target: {formatDate(record.target_settlement_date)}
                                {targetOverdue && " · Terlambat"}
                              </p>
                              <p className={overdue ? "mt-1 font-semibold text-red-700" : "mt-1 text-slate-500"}>
                                Administrasi: {formatDate(record.administrative_deadline)}
                                {overdue && " · Terlambat"}
                              </p>
                            </>
                          ) : (
                            <span className="text-slate-400">Belum dicairkan</span>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                            overdue
                              ? "bg-red-50 text-red-700"
                              : record.status === "closed"
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-slate-100 text-slate-700"
                          }`}>
                            {statusLabel(record.status)}
                            {record.discrepancy_count > 0 && ` · ${record.discrepancy_count} selisih`}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
