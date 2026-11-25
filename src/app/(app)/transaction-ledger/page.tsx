import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Search } from "lucide-react";
import { FundAdjustmentForm } from "@/components/ledger/fund-adjustment-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatIDR } from "@/lib/format-currency";
import { getCurrentISODate } from "@/lib/format-number";
import { ResponsiveDateInput } from "@/components/ui/responsive-date-input";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const pageSize = 50;

const movementNames: Record<string, string> = {
  disbursement: "Pencairan IP",
  expense: "Pengeluaran",
  return: "Pengembalian IP",
  adjustment: "Penyesuaian / koreksi",
  reimbursement_received: "Reimbursement diterima",
};
const sourceTypes = ["ip", "personal"] as const;
const movementTypes = [
  "disbursement",
  "expense",
  "return",
  "adjustment",
  "reimbursement_received",
] as const;

function formatDate(value: string) {
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function pageUrl(page: number, filters: Record<string, string>) {
  const search = new URLSearchParams(filters);
  search.set("page", String(page));
  return `/transaction-ledger?${search.toString()}`;
}

export default async function TransactionLedgerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 120) : "";
  const from = typeof params.from === "string" ? params.from : "";
  const to = typeof params.to === "string" ? params.to : "";
  const source = typeof params.source === "string" ? params.source : "";
  const movementType = typeof params.type === "string" ? params.type : "";
  const sourceFilter = sourceTypes.find((value) => value === source);
  const movementFilter = movementTypes.find((value) => value === movementType);
  const requestedPage = Number(typeof params.page === "string" ? params.page : "1");
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error("Tanggal awal tidak valid.");
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error("Tanggal akhir tidak valid.");
  if (from && to && from > to) throw new Error("Tanggal awal tidak boleh sesudah tanggal akhir.");
  if (source && !sourceFilter) throw new Error("Sumber dana tidak dikenal.");
  if (movementType && !movementFilter) throw new Error("Jenis transaksi tidak dikenal.");

  const supabase = await createSupabaseServerClient();
  let ledgerQuery = supabase
    .from("transaction_ledger")
    .select("*", { count: "exact" })
    .order("transaction_date", { ascending: false })
    .order("transaction_id", { ascending: false });
  if (query) ledgerQuery = ledgerQuery.ilike("search_text", `%${query.replace(/[\\%_]/g, "\\$&")}%`);
  if (from) ledgerQuery = ledgerQuery.gte("transaction_date", from);
  if (to) ledgerQuery = ledgerQuery.lte("transaction_date", to);
  if (sourceFilter) ledgerQuery = ledgerQuery.eq("source_type", sourceFilter);
  if (movementFilter) ledgerQuery = ledgerQuery.eq("movement_type", movementFilter);
  const [
    { data: rows, error: ledgerError, count },
    { data: ips, error: ipError },
    { data: irs, error: irError },
  ] = await Promise.all([
    ledgerQuery.range((page - 1) * pageSize, page * pageSize - 1),
    supabase.from("ip_monitoring").select("id, reference_code, title").neq("status", "void").order("requested_on", { ascending: false }).limit(1000),
    supabase.from("ir_records").select("id, reference_code, title, ir_type").neq("status", "void").order("created_at", { ascending: false }).limit(1000),
  ]);
  if (ledgerError) throw new Error(`Transaction ledger gagal dimuat: ${ledgerError.message}`);
  if (ipError) throw new Error(`Daftar IP untuk koreksi gagal dimuat: ${ipError.message}`);
  if (irError) throw new Error(`Daftar IR untuk koreksi gagal dimuat: ${irError.message}`);
  const totalRows = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const filters = {
    ...(query ? { q: query } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(source ? { source } : {}),
    ...(movementType ? { type: movementType } : {}),
  };

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-medium text-slate-500">Sumber data: ledger pergerakan dana</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Transaction Ledger</h1>
        <p className="mt-2 text-sm text-slate-600">Setiap arus ditampilkan satu kali. Pembayaran reimbursement tercatat sebagai penerimaan personal, bukan pengeluaran IP.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Filter ledger</CardTitle>
          <CardDescription>{totalRows.toLocaleString("id-ID")} pergerakan dana</CardDescription>
        </CardHeader>
        <CardContent>
          <form method="get" className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <label className="space-y-1 text-sm font-medium xl:col-span-2">
              Cari ID, referensi, deskripsi, atau evidence
              <span className="relative block">
                <Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <input name="q" defaultValue={query} className="w-full rounded-lg border bg-white py-2 pl-9 pr-3 font-normal" />
              </span>
            </label>
            <label className="space-y-1 text-sm font-medium">
              Sumber dana
              <select name="source" defaultValue={source} className="w-full rounded-lg border bg-white px-3 py-2 font-normal">
                <option value="">Semua sumber</option>
                <option value="ip">IP</option>
                <option value="personal">Personal</option>
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium">
              Jenis transaksi
              <select name="type" defaultValue={movementType} className="w-full rounded-lg border bg-white px-3 py-2 font-normal">
                <option value="">Semua jenis</option>
                {Object.entries(movementNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium">
              Dari
              <ResponsiveDateInput name="from" defaultValue={from} className="w-full rounded-lg border bg-white px-3 py-2 font-normal" />
            </label>
            <div className="grid grid-cols-2 items-end gap-2">
              <label className="space-y-1 text-sm font-medium">
                Sampai
                <ResponsiveDateInput name="to" defaultValue={to} className="w-full rounded-lg border bg-white px-3 py-2 font-normal" />
              </label>
              <Button type="submit">Terapkan</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pergerakan dana</CardTitle>
          <CardDescription>Debit = dana masuk ke saldo sumber; kredit = dana keluar dari saldo sumber.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-500">Belum ada transaksi yang sesuai filter.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1200px] text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Transaction ID / tanggal</th>
                    <th className="px-4 py-3 font-medium">Referensi / deskripsi</th>
                    <th className="px-4 py-3 text-right font-medium">Debit</th>
                    <th className="px-4 py-3 text-right font-medium">Credit</th>
                    <th className="px-4 py-3 font-medium">Sumber</th>
                    <th className="px-4 py-3 font-medium">IP / IR terkait</th>
                    <th className="px-4 py-3 font-medium">Evidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => (
                    <tr key={`${row.movement_type}-${row.transaction_id}`} className="align-top hover:bg-slate-50/70">
                      <td className="px-4 py-4">
                        <p className="font-mono text-xs text-slate-700">{row.transaction_id.slice(0, 12)}</p>
                        <p className="mt-1 text-xs text-slate-500">{formatDate(row.transaction_date)}</p>
                        <span className="mt-2 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{row.ir_replenishment ? "Dana IP kembali dari IR" : movementNames[row.movement_type] ?? row.movement_type}</span>
                      </td>
                      <td className="max-w-xs px-4 py-4">
                        <p className="font-semibold text-slate-900">{row.reference}</p>
                        <p className="mt-1 whitespace-normal text-xs leading-5 text-slate-600">{row.description}</p>
                        {row.correction_reason && <p className="mt-1 text-xs text-amber-800">Alasan: {row.correction_reason}</p>}
                      </td>
                      <td className="px-4 py-4 text-right font-medium tabular-nums text-emerald-700">{row.debit > 0 ? formatIDR(row.debit) : "—"}</td>
                      <td className="px-4 py-4 text-right font-medium tabular-nums text-red-700">{row.credit > 0 ? formatIDR(row.credit) : "—"}</td>
                      <td className="px-4 py-4">{row.funding_source}</td>
                      <td className="px-4 py-4">
                        <div className="space-y-1">
                          {row.related_ip_id && <Link className="block text-xs font-medium text-primary hover:underline" href={`/internal-prepayment/${row.related_ip_id}`}>{row.related_ip_reference ?? "Internal Prepayment"}</Link>}
                          {row.related_ir_id && <Link className="block text-xs font-medium text-primary hover:underline" href={`${irs.find((ir) => ir.id === row.related_ir_id)?.ir_type === "facility" ? "/ir-facility-management" : "/ir-operasional"}/${row.related_ir_id}`}>{row.related_ir_reference ?? "Internal Reimbursement"}</Link>}
                          {!row.related_ip_id && !row.related_ir_id && <span className="text-xs text-slate-400">—</span>}
                        </div>
                      </td>
                      <td className="max-w-[200px] px-4 py-4">
                        {row.evidence_reference ? (
                          <Link href={`/evidence-center?q=${encodeURIComponent(row.related_ip_reference ?? row.related_ir_reference ?? row.reference)}`} className="text-xs font-medium text-primary hover:underline">
                            {row.evidence_count} file · {row.evidence_reference}
                          </Link>
                        ) : <span className="text-xs text-slate-400">Tidak ada evidence</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t px-4 py-3">
              <p className="text-sm text-slate-500">Halaman {page} dari {totalPages}</p>
              <div className="flex gap-2">
                {page > 1 ? <Button render={<Link href={pageUrl(page - 1, filters)} />} variant="outline">Sebelumnya</Button> : <Button variant="outline" disabled>Sebelumnya</Button>}
                {page < totalPages ? <Button render={<Link href={pageUrl(page + 1, filters)} />} variant="outline">Berikutnya</Button> : <Button variant="outline" disabled>Berikutnya</Button>}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <summary className="cursor-pointer font-semibold text-slate-900">Catat koreksi / penyesuaian dana</summary>
        <div className="mt-4">
          <FundAdjustmentForm ips={ips} irs={irs} initialDate={getCurrentISODate()} />
        </div>
      </details>
      <p className="flex items-center gap-2 text-xs text-slate-500">
        <ArrowDownLeft aria-hidden="true" className="size-4 text-emerald-700" /> Debit adalah arus masuk.
        <ArrowUpRight aria-hidden="true" className="ml-2 size-4 text-red-700" /> Kredit adalah arus keluar.
      </p>
    </div>
  );
}
