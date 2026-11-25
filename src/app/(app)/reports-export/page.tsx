import Link from "next/link";
import { AlertTriangle, FileSpreadsheet, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResponsiveDateInput } from "@/components/ui/responsive-date-input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getReportDataset, parseReportFilters, reportFiltersLabel } from "@/lib/reports";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const months = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
const optionBatchSize = 1000;

async function loadOptions<T>(
  loadPage: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>,
  label: string,
) {
  const rows: T[] = [];
  for (let from = 0; ; from += optionBatchSize) {
    const { data, error } = await loadPage(from, from + optionBatchSize - 1);
    if (error) throw new Error(`${label} gagal dimuat: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < optionBatchSize) return rows;
  }
}

export default async function ReportsExportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const rawParams = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(rawParams)) {
    if (typeof value === "string") query.set(key, value);
  }
  const filters = parseReportFilters(query);
  const supabase = await createSupabaseServerClient();
  const [ipOptions, irOptions, dataset] = await Promise.all([
    loadOptions(
      async (from, to) => await supabase.from("ip_monitoring").select("id, reference_code, title")
        .order("requested_on", { ascending: false }).order("id").range(from, to),
      "Pilihan IP",
    ),
    loadOptions(
      async (from, to) => await supabase.from("ir_monitoring").select("id, reference_code, title, ir_type")
        .neq("status", "void").order("submitted_on", { ascending: false }).order("id").range(from, to),
      "Pilihan IR",
    ),
    getReportDataset(supabase, filters),
  ]);

  const params = new URLSearchParams(query);
  if (!params.has("period")) {
    params.set("period", "year");
    params.set("year", String(new Date().getFullYear()));
  }
  params.set("scope", filters.scope);
  const queryString = params.toString();
  const year = new Date().getFullYear();

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-medium text-slate-500">Excel & PDF Reporting</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Reporting Center</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Buat laporan administrasi dari data ledger dan transaksi aktual. Evidence gambar disisipkan pada Excel/PDF dan dokumen PDF dilampirkan sebagai halaman PDF, bukan tautan eksternal.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Filter export</CardTitle>
          <CardDescription>Periode aktif: {reportFiltersLabel(filters)} · scope: {filters.scope}</CardDescription>
        </CardHeader>
        <CardContent>
          <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="space-y-1 text-sm font-medium">
              Periode
              <select name="period" defaultValue={query.get("period") ?? "year"} className="w-full rounded-lg border bg-white px-3 py-2 font-normal">
                <option value="all">Semua periode</option>
                <option value="year">Per tahun</option>
                <option value="month">Per bulan</option>
                <option value="custom">Rentang tanggal</option>
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium">
              Tahun
              <select name="year" defaultValue={query.get("year") ?? String(year)} className="w-full rounded-lg border bg-white px-3 py-2 font-normal">
                {Array.from({ length: 10 }, (_, index) => year - index).map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium">
              Bulan
              <select name="month" defaultValue={query.get("month") ?? String(new Date().getMonth() + 1)} className="w-full rounded-lg border bg-white px-3 py-2 font-normal">
                {months.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium">
              Jenis IR
              <select name="scope" defaultValue={filters.scope} className="w-full rounded-lg border bg-white px-3 py-2 font-normal">
                <option value="all">Semua transaksi</option>
                <option value="operasional">IR Operasional</option>
                <option value="facility">IR Facility</option>
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium">
              Dari tanggal
              <ResponsiveDateInput name="from" defaultValue={query.get("from") ?? ""} className="w-full rounded-lg border bg-white px-3 py-2 font-normal" />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Sampai tanggal
              <ResponsiveDateInput name="to" defaultValue={query.get("to") ?? ""} className="w-full rounded-lg border bg-white px-3 py-2 font-normal" />
            </label>
            <label className="space-y-1 text-sm font-medium">
              IP tertentu
              <select name="ipId" defaultValue={filters.ipId ?? ""} className="w-full rounded-lg border bg-white px-3 py-2 font-normal">
                <option value="">Semua IP</option>
                {ipOptions.map((ip) => <option key={ip.id} value={ip.id}>{ip.reference_code ?? "Nomor IP belum diisi"} · {ip.title}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium">
              IR tertentu
              <select name="irId" defaultValue={filters.irId ?? ""} className="w-full rounded-lg border bg-white px-3 py-2 font-normal">
                <option value="">Semua IR</option>
                {irOptions.map((ir) => <option key={ir.id} value={ir.id}>{ir.reference_code ?? "Nomor IR belum diisi"} · {ir.title}</option>)}
              </select>
            </label>
            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
              <Button type="submit">Terapkan filter</Button>
              <Button type="button" variant="outline" render={<Link href="/reports-export" />}>Reset</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="flex h-full flex-col gap-4 p-5">
            <div className="flex items-start gap-3">
              <span className="flex size-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><FileSpreadsheet aria-hidden="true" className="size-5" /></span>
              <div>
                <h2 className="font-semibold text-slate-900">Excel Workbook</h2>
                <p className="mt-1 text-sm text-slate-600">12 sheet administrasi, filter, freeze panes, format Rupiah/tanggal, formula total, dan foto evidence tertanam.</p>
              </div>
            </div>
            <Button render={<a href={`/api/reports/excel?${queryString}`} />} className="mt-auto w-full">Unduh Excel</Button>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex h-full flex-col gap-4 p-5">
            <div className="flex items-start gap-3">
              <span className="flex size-10 items-center justify-center rounded-lg bg-red-50 text-red-700"><FileText aria-hidden="true" className="size-5" /></span>
              <div>
                <h2 className="font-semibold text-slate-900">PDF Report</h2>
                <p className="mt-1 text-sm text-slate-600">Dokumen A4 dengan summary, detail IP/IR, rekonsiliasi, outstanding, nomor halaman, serta foto dan halaman dokumen PDF terlampir.</p>
              </div>
            </div>
            <Button variant="outline" render={<a href={`/api/reports/pdf?${queryString}`} />} className="mt-auto w-full">Unduh PDF</Button>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Validasi & kelengkapan data</CardTitle>
          <CardDescription>
            {dataset.ledger.length.toLocaleString("id-ID")} ledger entries · {dataset.ips.length.toLocaleString("id-ID")} IP · {dataset.irs.length.toLocaleString("id-ID")} IR · {dataset.evidence.length.toLocaleString("id-ID")} evidence
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {dataset.warnings.length === 0 ? (
            <p className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">Tidak ada warning kelengkapan, outstanding, atau discrepancy untuk filter ini.</p>
          ) : dataset.warnings.map((warning) => (
            <p key={warning} className="flex items-start gap-2 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {warning}
            </p>
          ))}
          <p className="text-xs leading-5 text-slate-500">
            Warning tidak menyembunyikan baris terkait. Status dan catatan discrepancy, missing evidence, serta outstanding tetap dicantumkan dalam laporan.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
