import Image from "next/image";
import Link from "next/link";
import { Download, FileText, Search } from "lucide-react";
import { DeleteEvidenceForm, EvidenceLinkForm, EvidenceSizeForm, EvidenceUploadForm, type EvidenceParentOption } from "@/components/evidence/evidence-forms";
import { Button } from "@/components/ui/button";
import { ResponsiveDateInput } from "@/components/ui/responsive-date-input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getEvidenceMaxFileSize } from "@/lib/evidence";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const moneyFormat = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 2,
});

const pageSize = 24;
const categories = [
  ["ip_application", "IP Application"],
  ["ip_disbursement", "IP Disbursement"],
  ["purchase_receipt", "Purchase Receipt"],
  ["transfer_proof", "Transfer Proof"],
  ["expense_documentation", "Expense Documentation"],
  ["fund_return", "Fund Return"],
  ["ptjb_document", "PTJB Document"],
  ["reimbursement_payment", "Reimbursement Payment"],
  ["other_supporting_document", "Other Supporting Document"],
] as const;

function documentLabel(value: string) {
  return categories.find(([key]) => key === value)?.[1] ?? value.replaceAll("_", " ");
}

function formatBytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function formatMoney(amount: number) {
  return moneyFormat.format(amount);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(new Date(value));
}

function buildParents(
  ips: Array<{ id: string; reference_code: string | null; title: string }>,
  irs: Array<{ id: string; reference_code: string | null; title: string }>,
  expenses: Array<{ id: string; description: string; expense_date: string }>,
  settlements: Array<{ id: string; settlement_date: string; amount_returned: number }>,
  payments: Array<{ id: string; payment_date: string | null; amount: number; reference_code: string | null }>,
): EvidenceParentOption[] {
  return [
    ...ips.map((ip) => ({
      value: `ip|${ip.id}`,
      label: `IP · ${ip.reference_code ?? "No.IP Belum Diinput"} · ${ip.title}`,
    })),
    ...irs.map((ir) => ({
      value: `ir|${ir.id}`,
      label: `IR / PTJB · ${ir.reference_code ?? "No.IR Belum Diinput"} · ${ir.title}`,
    })),
    ...expenses.map((expense) => ({
      value: `expense|${expense.id}`,
      label: `Expense · ${expense.expense_date} · ${expense.description}`,
    })),
    ...settlements.map((settlement) => ({
      value: `settlement|${settlement.id}`,
      label: `Pengembalian · ${settlement.settlement_date} · ${formatMoney(settlement.amount_returned)}`,
    })),
    ...payments.map((payment) => ({
      value: `reimbursement_payment|${payment.id}`,
      label: `Pembayaran IR · ${payment.reference_code ?? payment.payment_date ?? "Pembayaran"} · ${formatMoney(payment.amount)}`,
    })),
  ];
}

export default async function EvidenceCenterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 120) : "";
  const category = typeof params.category === "string" ? params.category : "";
  const from = typeof params.from === "string" ? params.from : "";
  const to = typeof params.to === "string" ? params.to : "";
  const unlinked = params.unlinked === "true";
  const requestedPage = Number(typeof params.page === "string" ? params.page : "1");
  const currentPage = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error("Filter tanggal awal tidak valid.");
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error("Filter tanggal akhir tidak valid.");
  if (from && to && from > to) throw new Error("Tanggal awal tidak boleh sesudah tanggal akhir.");
  if (category && !categories.some(([value]) => value === category)) {
    throw new Error("Kategori evidence yang dipilih tidak dikenal.");
  }
  const categoryFilter = categories.find(([value]) => value === category)?.[0];

  const supabase = await createSupabaseServerClient();
  const [
    maxFileSize,
    { data: ips, error: ipError },
    { data: irs, error: irError },
    { data: expenses, error: expenseError },
    { data: settlements, error: settlementError },
    { data: payments, error: paymentError },
    { data: currentUser, error: currentUserError },
  ] = await Promise.all([
    getEvidenceMaxFileSize(supabase),
    supabase.from("ip_monitoring").select("id, reference_code, title").order("requested_on", { ascending: false }).limit(1000),
    supabase.from("ir_records").select("id, reference_code, title").neq("status", "void").order("created_at", { ascending: false }).limit(1000),
    supabase.from("expenses").select("id, description, expense_date").eq("status", "posted").order("expense_date", { ascending: false }).limit(1000),
    supabase.from("settlements").select("id, settlement_date, amount_returned").neq("status", "void").order("settlement_date", { ascending: false }).limit(1000),
    supabase.from("reimbursement_payments").select("id, payment_date, amount, reference_code").eq("status", "paid").order("payment_date", { ascending: false }).limit(1000),
    supabase.auth.getUser(),
  ]);
  if (ipError) throw new Error(`Pilihan IP gagal dimuat: ${ipError.message}`);
  if (irError) throw new Error(`Pilihan IR gagal dimuat: ${irError.message}`);
  if (expenseError) throw new Error(`Pilihan expense gagal dimuat: ${expenseError.message}`);
  if (settlementError) throw new Error(`Pilihan settlement gagal dimuat: ${settlementError.message}`);
  if (paymentError) throw new Error(`Pilihan pembayaran gagal dimuat: ${paymentError.message}`);
  if (currentUserError) throw new Error(`Sesi pengguna gagal diverifikasi: ${currentUserError.message}`);
  if (!currentUser.user) throw new Error("Sesi berakhir. Silakan masuk kembali.");
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", currentUser.user.id)
    .single();
  if (profileError) throw new Error(`Hak akses pengguna gagal dimuat: ${profileError.message}`);
  const parents = buildParents(ips, irs, expenses, settlements, payments);

  let evidenceQuery = supabase
    .from("evidence_center")
    .select("*", { count: "exact" })
    .order("uploaded_at", { ascending: false });
  if (query) evidenceQuery = evidenceQuery.ilike("search_text", `%${query.replace(/[\\%_]/g, "\\$&")}%`);
  if (categoryFilter) evidenceQuery = evidenceQuery.eq("evidence_category", categoryFilter);
  if (from) evidenceQuery = evidenceQuery.gte("uploaded_at", `${from}T00:00:00+07:00`);
  if (to) evidenceQuery = evidenceQuery.lte("uploaded_at", `${to}T23:59:59.999+07:00`);
  if (unlinked) evidenceQuery = evidenceQuery.eq("parent_type", "unlinked");
  const { data: evidenceRows, error: evidenceError, count } = await evidenceQuery.range(
    (currentPage - 1) * pageSize,
    currentPage * pageSize - 1,
  );
  if (evidenceError) throw new Error(`Daftar evidence gagal dimuat: ${evidenceError.message}`);

  const evidenceWithUrls = await Promise.all(evidenceRows.map(async (evidence) => {
    const [{ data: preview, error: previewError }, { data: download, error: downloadError }] =
      await Promise.all([
        supabase.storage.from("faams-evidence").createSignedUrl(evidence.object_path, 300),
        supabase.storage.from("faams-evidence").createSignedUrl(evidence.object_path, 300, {
          download: evidence.original_file_name,
        }),
      ]);
    if (previewError) throw new Error(`Preview ${evidence.original_file_name} gagal dibuat: ${previewError.message}`);
    if (downloadError) throw new Error(`Download ${evidence.original_file_name} gagal dibuat: ${downloadError.message}`);
    return { ...evidence, previewUrl: preview.signedUrl, downloadUrl: download.signedUrl };
  }));
  const totalCount = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const maxSizeMib = Math.floor(maxFileSize / 1024 / 1024);
  const getPageUrl = (page: number) => {
    const next = new URLSearchParams();
    if (query) next.set("q", query);
    if (category) next.set("category", category);
    if (from) next.set("from", from);
    if (to) next.set("to", to);
    if (unlinked) next.set("unlinked", "true");
    next.set("page", String(page));
    return `/evidence-center?${next.toString()}`;
  };

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-medium text-slate-500">Dokumentasi transaksi keuangan</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Evidence Center</h1>
        <p className="mt-2 text-sm text-slate-600">Bukti disimpan di private storage dan hanya dapat dibuka melalui tautan sementara setelah autentikasi.</p>
      </header>

      <EvidenceUploadForm parents={parents} maxFileSize={maxFileSize} />
      <EvidenceSizeForm maxSizeMib={maxSizeMib} />

      <Card>
        <CardHeader>
          <CardTitle>Filter evidence</CardTitle>
          <CardDescription>{totalCount.toLocaleString("id-ID")} file sesuai filter</CardDescription>
        </CardHeader>
        <CardContent>
          <form method="get" className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            <label className="min-w-0 space-y-1 text-sm font-medium lg:col-span-2 2xl:col-span-2">
              Cari nama atau nomor transaksi
              <span className="relative block">
                <Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <input name="q" defaultValue={query} className="w-full rounded-lg border bg-white py-2 pl-9 pr-3 font-normal" placeholder="IP-2026… atau IR-OPS…" />
              </span>
            </label>
            <label className="min-w-0 space-y-1 text-sm font-medium">
              Kategori
              <select name="category" defaultValue={category} className="w-full rounded-lg border bg-white px-3 py-2 font-normal">
                <option value="">Semua kategori</option>
                {categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="min-w-0 space-y-1 text-sm font-medium">
              Dari
              <ResponsiveDateInput name="from" defaultValue={from} className="w-full rounded-lg border bg-white px-3 py-2 font-normal" />
            </label>
            <label className="min-w-0 space-y-1 text-sm font-medium">
              Sampai
              <ResponsiveDateInput name="to" defaultValue={to} className="w-full rounded-lg border bg-white px-3 py-2 font-normal" />
            </label>
            <div className="flex min-w-0 flex-wrap items-end gap-3">
              <label className="flex min-h-10 items-center gap-2 text-sm">
                <input type="checkbox" name="unlinked" value="true" defaultChecked={unlinked} className="size-4 rounded border-slate-300" />
                Belum berelasi
              </label>
              <Button type="submit" className="w-full sm:w-auto">Terapkan</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {evidenceWithUrls.length === 0 ? (
        <Card><CardContent className="py-14 text-center text-sm text-slate-500">Tidak ada evidence yang cocok dengan filter.</CardContent></Card>
      ) : (
        <section className="grid min-w-0 gap-4 sm:grid-cols-2 2xl:grid-cols-3">
          {evidenceWithUrls.map((evidence) => (
            <Card key={evidence.id} className="overflow-hidden">
              <div className="flex h-56 items-center justify-center bg-slate-100">
                {evidence.mime_type === "application/pdf" ? (
                  <iframe title={`Preview ${evidence.original_file_name}`} src={evidence.previewUrl} className="h-full w-full" />
                ) : (
                  <Image src={evidence.previewUrl} alt={evidence.original_file_name} width={600} height={400} unoptimized className="h-full w-full object-contain" />
                )}
              </div>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900" title={evidence.original_file_name}>{evidence.original_file_name}</p>
                    <p className="mt-1 text-xs text-slate-500">{documentLabel(evidence.evidence_category)} · {formatBytes(evidence.file_size_bytes)}</p>
                    <p className="mt-1 text-xs text-slate-500">{formatDate(evidence.uploaded_at)}</p>
                  </div>
                  <Link href={evidence.downloadUrl} target="_blank" rel="noreferrer" aria-label={`Unduh ${evidence.original_file_name}`} className="rounded-lg border p-2 text-slate-600 hover:bg-slate-50">
                    <Download aria-hidden="true" className="size-4" />
                  </Link>
                </div>
                <div className="rounded-lg bg-slate-50 p-3 text-sm">
                  {evidence.parent_type === "unlinked" ? (
                    <>
                      <p className="font-medium text-amber-800">Belum memiliki relasi</p>
                      <EvidenceLinkForm evidenceId={evidence.id} parents={parents} />
                    </>
                  ) : (
                    <>
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{evidence.parent_type.replaceAll("_", " ")}</p>
                      <p className="mt-1 font-semibold text-slate-800">{evidence.parent_reference ?? evidence.parent_id}</p>
                      {evidence.parent_description && <p className="mt-1 line-clamp-2 text-xs text-slate-600">{evidence.parent_description}</p>}
                    </>
                  )}
                  {evidence.status === "void" && <p className="mt-2 text-xs font-semibold text-red-700">Evidence dibatalkan</p>}
                </div>
                {profile.is_admin && (
                  <DeleteEvidenceForm evidenceId={evidence.id} objectPath={evidence.object_path} />
                )}
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {totalPages > 1 && (
        <nav aria-label="Halaman evidence" className="flex items-center justify-between">
          <p className="text-sm text-slate-500">Halaman {currentPage} dari {totalPages}</p>
          <div className="flex gap-2">
            {currentPage > 1
              ? <Button render={<Link href={getPageUrl(currentPage - 1)} />} variant="outline">Sebelumnya</Button>
              : <Button variant="outline" disabled>Sebelumnya</Button>}
            {currentPage < totalPages
              ? <Button render={<Link href={getPageUrl(currentPage + 1)} />} variant="outline">Berikutnya</Button>
              : <Button variant="outline" disabled>Berikutnya</Button>}
          </div>
        </nav>
      )}
      <p className="flex items-center gap-2 text-xs text-slate-500"><FileText aria-hidden="true" className="size-4" /> Tautan preview dan download kedaluwarsa setelah 5 menit. Muat ulang halaman untuk membuat tautan baru.</p>
    </div>
  );
}
