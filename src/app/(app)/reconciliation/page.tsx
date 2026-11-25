import Link from "next/link";
import { AlertTriangle, CheckCircle2, CircleDollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatIDR } from "@/lib/format-currency";
import { ResponsiveDateInput } from "@/components/ui/responsive-date-input";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const statuses = ["Balance", "Outstanding", "Over Budget", "Unverified", "Discrepancy", "Closed"] as const;

function statusStyle(status: string) {
  if (status === "Balance" || status === "Closed") return "bg-emerald-50 text-emerald-700";
  if (status === "Outstanding") return "bg-amber-50 text-amber-800";
  if (status === "Over Budget" || status === "Discrepancy") return "bg-red-50 text-red-700";
  return "bg-slate-100 text-slate-700";
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function pageTitle(entityType: string) {
  return entityType === "ip" ? "Internal Prepayment" : "Internal Reimbursement";
}

export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const from = typeof params.from === "string" ? params.from : "";
  const to = typeof params.to === "string" ? params.to : "";
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 120) : "";
  const status = typeof params.status === "string" ? params.status : "";
  const statusFilter = statuses.find((value) => value === status);
  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error("Tanggal awal periode tidak valid.");
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error("Tanggal akhir periode tidak valid.");
  if (from && to && from > to) throw new Error("Tanggal awal periode tidak boleh sesudah tanggal akhir.");
  if (status && !statusFilter) {
    throw new Error("Status rekonsiliasi tidak dikenal.");
  }

  const supabase = await createSupabaseServerClient();
  const [
    { data: summaryRows, error: summaryError },
    { data: periodRows, error: periodError },
    { data: periodBalanceRows, error: periodBalancesError },
  ] = await Promise.all([
    supabase.from("reconciliation_summary").select("*").limit(1),
    supabase.rpc("reconciliation_period_summary", {
      p_from_date: from || null,
      p_to_date: to || null,
    }),
    supabase.rpc("reconciliation_period_balances", {
      p_from_date: from || null,
      p_to_date: to || null,
    }),
  ]);
  if (summaryError) throw new Error(`Ringkasan rekonsiliasi gagal dimuat: ${summaryError.message}`);
  if (periodError) throw new Error(`Aktivitas periode gagal dihitung: ${periodError.message}`);
  if (periodBalancesError) throw new Error(`Rincian rekonsiliasi periode gagal dimuat: ${periodBalancesError.message}`);
  const summary = summaryRows[0];
  const period = periodRows[0];
  if (!summary || !period) throw new Error("Ringkasan rekonsiliasi tidak tersedia.");

  let balancesQuery = supabase
    .from("reconciliation_balances")
    .select("*")
    .order("activity_date", { ascending: false, nullsFirst: false });
  if (query) balancesQuery = balancesQuery.ilike("search_text", `%${query.replace(/[\\%_]/g, "\\$&")}%`);
  if (from) balancesQuery = balancesQuery.gte("activity_date", from);
  if (to) balancesQuery = balancesQuery.lte("activity_date", to);
  if (statusFilter) balancesQuery = balancesQuery.eq("reconciliation_status", statusFilter);
  const { data: balances, error: balancesError } = await balancesQuery;
  if (balancesError) throw new Error(`Saldo rekonsiliasi gagal dimuat: ${balancesError.message}`);

  const currentPeriod = from || to
    ? `${from || "Awal"} s.d. ${to || "Hari ini"}`
    : "Seluruh periode";

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-medium text-slate-500">Rekonsiliasi berdasarkan transaksi dan ledger aktual</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Balance Reconciliation</h1>
        <p className="mt-2 text-sm text-slate-600">
          Saldo IP berasal dari arus kas IP; piutang IR hanya berasal dari alokasi Personal. Expense IR yang dibiayai IP tidak menjadi piutang tambahan.
        </p>
      </header>

      <section aria-label="Ringkasan saldo saat ini" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[
          { label: "IP outstanding", amount: summary.ip_outstanding, note: "Saldo belum dipertanggungjawabkan" },
          { label: "IR outstanding", amount: summary.ir_outstanding, note: "Piutang reimbursement personal" },
          { label: "Personal receivable", amount: summary.personal_receivable, note: "Dikurangi pembayaran yang diterima" },
          { label: "Total belum direkonsiliasi", amount: summary.total_unreconciled, note: "IP outstanding + piutang personal" },
          { label: "Total telah direkonsiliasi", amount: summary.total_reconciled, note: "Dana IP terpakai/returned + reimbursement diterima" },
        ].map((item) => (
          <Card key={item.label}>
            <CardContent className="p-4">
              <p className="text-xs font-medium text-slate-500">{item.label}</p>
              <p className="mt-2 text-xl font-bold tabular-nums text-slate-900">{formatIDR(item.amount)}</p>
              <p className="mt-1 text-xs text-slate-500">{item.note}</p>
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium text-slate-500">Item perlu tindak lanjut</p>
            <p className="mt-2 flex items-center gap-2 text-xl font-bold tabular-nums text-red-700">
              <AlertTriangle aria-hidden="true" className="size-5" />
              {summary.discrepancy_count + summary.unverified_count + summary.over_budget_count}
            </p>
            <p className="mt-1 text-xs text-slate-500">Selisih, belum diverifikasi, atau over budget</p>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Aktivitas periode</CardTitle>
          <CardDescription>
            {currentPeriod} · {period.transaction_count.toLocaleString("id-ID")} ledger entries. Saldo pada daftar di bawah adalah saldo terkini.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "IP debit / dana masuk", amount: period.ip_debit, tone: "text-emerald-700" },
            { label: "IP credit / dana keluar", amount: period.ip_credit, tone: "text-red-700" },
            { label: "Personal debit / diterima", amount: period.personal_debit, tone: "text-emerald-700" },
            { label: "Personal credit / dibayarkan", amount: period.personal_credit, tone: "text-red-700" },
          ].map((item) => (
            <div key={item.label} className="rounded-lg bg-slate-50 p-4">
              <p className="text-xs font-medium text-slate-500">{item.label}</p>
              <p className={`mt-2 font-bold tabular-nums ${item.tone}`}>{formatIDR(item.amount)}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pergerakan per IP dan IR dalam periode</CardTitle>
          <CardDescription>
            Nilai adalah arus dalam rentang tanggal terpilih, bukan saldo historis. Alokasi IP pada IR terlihat pada dimensi sumber IP dan penggunaan IR; jangan jumlahkan lintas dimensi.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {periodBalanceRows.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">Belum ada ledger entry pada periode ini.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1050px] text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Record</th>
                    <th className="px-4 py-3 font-medium">Jenis</th>
                    <th className="px-4 py-3 text-right font-medium">IP debit / credit</th>
                    <th className="px-4 py-3 text-right font-medium">Personal debit / credit</th>
                    <th className="px-4 py-3 text-right font-medium">Arus neto</th>
                    <th className="px-4 py-3 text-right font-medium">Entries</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {periodBalanceRows.map((row) => {
                    const ipNet = row.ip_debit - row.ip_credit;
                    const personalNet = row.personal_debit - row.personal_credit;
                    const net = ipNet + personalNet;
                    const href = row.entity_type === "ip"
                      ? `/internal-prepayment/${row.entity_id}`
                      : row.entity_subtype === "facility"
                        ? `/ir-facility-management/${row.entity_id}`
                        : `/ir-operasional/${row.entity_id}`;
                    return (
                      <tr key={`${row.entity_type}-${row.entity_id}`}>
                        <td className="px-4 py-3">
                          <Link href={href} className="font-semibold text-primary hover:underline">{row.reference_code ?? pageTitle(row.entity_type)}</Link>
                          <p className="mt-1 text-xs text-slate-500">{row.description}</p>
                        </td>
                        <td className="px-4 py-3">{pageTitle(row.entity_type)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatIDR(row.ip_debit)} / {formatIDR(row.ip_credit)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatIDR(row.personal_debit)} / {formatIDR(row.personal_credit)}</td>
                        <td className={`px-4 py-3 text-right font-semibold tabular-nums ${net < 0 ? "text-red-700" : "text-emerald-700"}`}>{formatIDR(net)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{row.movement_count.toLocaleString("id-ID")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Filter saldo dan discrepancy report</CardTitle>
          <CardDescription>
            Discrepancy dan status verifikasi memiliki keterangan yang diturunkan dari transaksi sumber.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form method="get" className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <label className="space-y-1 text-sm font-medium xl:col-span-2">
              Cari nomor / deskripsi
              <input name="q" defaultValue={query} className="w-full rounded-lg border bg-white px-3 py-2 font-normal" placeholder="IP-… atau IR-…" />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Dari
              <ResponsiveDateInput name="from" defaultValue={from} className="w-full rounded-lg border bg-white px-3 py-2 font-normal" />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Sampai
              <ResponsiveDateInput name="to" defaultValue={to} className="w-full rounded-lg border bg-white px-3 py-2 font-normal" />
            </label>
            <div className="flex items-end gap-2">
              <select name="status" defaultValue={status} className="min-w-0 flex-1 rounded-lg border bg-white px-3 py-2 text-sm">
                <option value="">Semua status</option>
                {statuses.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
              <Button type="submit">Terapkan</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Saldo per IP dan IR</CardTitle>
          <CardDescription>{balances.length.toLocaleString("id-ID")} catatan sesuai filter · filter tanggal berdasarkan tanggal aktivitas record; nilai saldo adalah snapshot terkini</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {balances.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-500">Tidak ada saldo sesuai filter.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1050px] text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Record / tanggal</th>
                    <th className="px-4 py-3 font-medium">Jenis</th>
                    <th className="px-4 py-3 text-right font-medium">Principal</th>
                    <th className="px-4 py-3 text-right font-medium">Realisasi / dana Personal</th>
                    <th className="px-4 py-3 text-right font-medium">Dikembalikan / dibayar</th>
                    <th className="px-4 py-3 text-right font-medium">Saldo</th>
                    <th className="px-4 py-3 font-medium">Status / keterangan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {balances.map((balance) => {
                    const href = balance.entity_type === "ip"
                      ? `/internal-prepayment/${balance.entity_id}`
                      : balance.entity_subtype === "facility"
                        ? `/ir-facility-management/${balance.entity_id}`
                        : `/ir-operasional/${balance.entity_id}`;
                    return (
                      <tr key={`${balance.entity_type}-${balance.entity_id}`} className="align-top hover:bg-slate-50/70">
                        <td className="px-4 py-4">
                          <Link href={href} className="font-semibold text-primary hover:underline">{balance.reference_code ?? pageTitle(balance.entity_type)}</Link>
                          <p className="mt-1 max-w-xs truncate text-xs text-slate-600">{balance.description}</p>
                          <p className="mt-1 text-xs text-slate-400">{formatDate(balance.activity_date)}</p>
                        </td>
                        <td className="px-4 py-4">{pageTitle(balance.entity_type)}</td>
                        <td className="px-4 py-4 text-right tabular-nums">{formatIDR(balance.principal_amount)}</td>
                        <td className="px-4 py-4 text-right tabular-nums">{formatIDR(balance.entity_type === "ip" ? balance.realized_amount : balance.personal_funded_amount)}</td>
                        <td className="px-4 py-4 text-right tabular-nums">{formatIDR(balance.entity_type === "ip" ? balance.returned_amount : balance.reimbursement_paid_amount)}</td>
                        <td className={`px-4 py-4 text-right font-semibold tabular-nums ${balance.balance_amount < 0 ? "text-red-700" : ""}`}>{formatIDR(balance.balance_amount)}</td>
                        <td className="max-w-sm px-4 py-4">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusStyle(balance.reconciliation_status)}`}>{balance.reconciliation_status}</span>
                          {balance.discrepancy_detail && <p className="mt-2 whitespace-normal text-xs leading-5 text-slate-600">{balance.discrepancy_detail}</p>}
                          {balance.entity_type === "ir" && balance.realized_amount > balance.personal_funded_amount && <p className="mt-1 text-xs text-slate-500">Termasuk {formatIDR(balance.realized_amount - balance.personal_funded_amount)} yang didanai IP; bukan piutang reimbursement.</p>}
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

      <div className="flex items-center gap-2 text-xs text-slate-500">
        <CircleDollarSign aria-hidden="true" className="size-4" />
        <span>Saldo IP = pencairan + debit penyesuaian − realisasi/return. Piutang IR = alokasi Personal − pembayaran; alokasi IP tidak dihitung sebagai piutang.</span>
        {summary.discrepancy_count + summary.unverified_count + summary.over_budget_count === 0 && <CheckCircle2 aria-hidden="true" className="ml-auto size-4 text-emerald-700" />}
      </div>
    </div>
  );
}
