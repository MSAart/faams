import Link from "next/link";
import { notFound } from "next/navigation";
import Image from "next/image";
import { Fragment } from "react";
import { ArrowLeft, CalendarDays, CircleDollarSign, ExternalLink, FileText, WalletCards, TriangleAlert } from "lucide-react";
import {
  IRCloseForm,
  IREvidenceForm,
  IRIPReplenishmentForm,
  IRPaymentForm,
  IRPTJBActions,
  IRReferenceForm,
  IRTransactionForm,
  IRTransactionEditForm,
  type IRType,
} from "@/components/ir/ir-management-forms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IRExportButtons } from "@/components/ir/ir-export-buttons";
import { formatIDR } from "@/lib/format-currency";
import { formatDateId, getCurrentISODate } from "@/lib/format-number";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type EvidenceRow = {
  id: string;
  expense_id: string | null;
  reimbursement_payment_id: string | null;
  ir_record_id: string | null;
  object_path: string;
  original_file_name: string;
  document_type: string;
  mime_type: "image/jpeg" | "image/png" | "application/pdf";
  uploaded_at: string;
};

function formatDate(value: string | null) {
  return formatDateId(value, "long");
}

function statusTone(status: string) {
  if (status === "Personal") return "bg-blue-50 text-blue-700";
  if (status === "IP") return "bg-emerald-50 text-emerald-700";
  return "bg-slate-100 text-slate-700";
}

function ptjbLabel(status: string) {
  return ({
    not_submitted: "Belum diajukan",
    in_progress: "Recorded",
    submitted: "PTJB Submitted",
    approved: "Disetujui",
    rejected: "Ditolak",
  }[status] ?? status);
}

function paymentLabel(status: string) {
  return ({
    unpaid: "Belum dibayarkan",
    partially_paid: "Dibayar sebagian",
    paid: "Lunas",
  }[status] ?? status);
}

export async function IRDetailPage({
  irId,
  irType,
}: {
  irId: string;
  irType: IRType;
}) {
  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) throw new Error("Sesi pengguna gagal diverifikasi.");
  const [
    { data: ir, error: irError },
    { data: categories, error: categoriesError },
    { data: ipRecords, error: ipError },
    { data: profile, error: profileError },
  ] = await Promise.all([
    supabase.from("ir_monitoring").select("*").eq("id", irId).eq("ir_type", irType).maybeSingle(),
    supabase.from("categories").select("id, name, scope").eq("scope", irType).eq("is_active", true).order("name"),
    supabase.rpc("available_ip_sources_for_ir"),
    supabase.from("profiles").select("is_admin").eq("id", authData.user.id).maybeSingle(),
  ]);
  if (irError) throw new Error(`IR gagal dimuat: ${irError.message}`);
  if (categoriesError) throw new Error(`Kategori IR gagal dimuat: ${categoriesError.message}`);
  if (ipError) throw new Error(`Daftar sumber dana IP gagal dimuat: ${ipError.message}`);
  if (profileError) throw new Error(`Hak administrator gagal diverifikasi: ${profileError.message}`);
  if (!ir) notFound();
  const isAdmin = profile?.is_admin ?? false;
  const { data: ipReplenishments, error: replenishmentError } = await supabase
    .from("transaction_ledger")
    .select("debit")
    .eq("related_ir_id", irId)
    .eq("ir_replenishment", true)
    .eq("is_void", false);
  if (replenishmentError) {
    const message = replenishmentError.message.includes("transaction_ledger.ir_replenishment")
      ? "Migration pengembalian dana IP dari IR belum diterapkan atau schema cache Supabase belum diperbarui. Terapkan migration 20261122220000_ir_ip_replenishment.sql."
      : replenishmentError.message;
    throw new Error(`Pengembalian dana IP gagal dimuat: ${message}`);
  }
  const returnedToIPAmount = ipReplenishments.reduce((sum, movement) => sum + movement.debit, 0);

  const { data: transactions, error: transactionsError } = await supabase
    .from("ir_transactions")
    .select("id, transaction_date, description, status")
    .eq("ir_record_id", irId)
    .order("transaction_date", { ascending: false });
  if (transactionsError) throw new Error(`Transaksi IR gagal dimuat: ${transactionsError.message}`);

  const transactionIds = transactions.map((transaction) => transaction.id);
  let expenses: Array<{
    id: string;
    updated_at: string;
    ir_transaction_id: string | null;
    category_id: string;
    expense_date: string;
    description: string;
    vendor: string | null;
    amount: number;
    payment_method: "cash" | "transfer" | "card" | "other" | null;
    status: string;
  }> = [];
  if (transactionIds.length > 0) {
    const { data, error } = await supabase
      .from("expenses")
      .select("id, updated_at, ir_transaction_id, category_id, expense_date, description, vendor, amount, payment_method, status")
      .in("ir_transaction_id", transactionIds)
      .order("expense_date", { ascending: false });
    if (error) throw new Error(`Detail pengeluaran gagal dimuat: ${error.message}`);
    expenses = data;
  }

  const expenseIds = expenses.map((expense) => expense.id);
  let allocations: Array<{
    id: string;
    expense_id: string;
    source_type: "ip" | "personal";
    ip_record_id: string | null;
    amount: number;
    status: string;
  }> = [];
  let transactionEvidence: EvidenceRow[] = [];
  if (expenseIds.length > 0) {
    const [
      { data: allocationData, error: allocationError },
      { data: evidenceData, error: evidenceError },
    ] = await Promise.all([
      supabase
        .from("transaction_allocations")
        .select("id, expense_id, source_type, ip_record_id, amount, status")
        .in("expense_id", expenseIds)
        .eq("status", "active"),
      supabase
        .from("evidence_files")
        .select("id, expense_id, reimbursement_payment_id, ir_record_id, object_path, original_file_name, document_type, mime_type, uploaded_at")
        .in("expense_id", expenseIds)
        .eq("status", "active"),
    ]);
    if (allocationError) throw new Error(`Alokasi dana gagal dimuat: ${allocationError.message}`);
    if (evidenceError) throw new Error(`Bukti transaksi gagal dimuat: ${evidenceError.message}`);
    allocations = allocationData;
    transactionEvidence = evidenceData;
  }

  const { data: payments, error: paymentsError } = await supabase
    .from("reimbursement_payments")
    .select("id, payment_date, amount, reference_code, notes, status")
    .eq("ir_record_id", irId)
    .order("payment_date", { ascending: false });
  if (paymentsError) throw new Error(`Pembayaran gagal dimuat: ${paymentsError.message}`);

  const paymentIds = payments.map((payment) => payment.id);
  let paymentEvidence: EvidenceRow[] = [];
  if (paymentIds.length > 0) {
    const { data, error } = await supabase
      .from("evidence_files")
      .select("id, expense_id, reimbursement_payment_id, ir_record_id, object_path, original_file_name, document_type, mime_type, uploaded_at")
      .in("reimbursement_payment_id", paymentIds)
      .eq("status", "active");
    if (error) throw new Error(`Bukti pembayaran gagal dimuat: ${error.message}`);
    paymentEvidence = data;
  }

  const { data: irEvidence, error: irEvidenceError } = await supabase
    .from("evidence_files")
    .select("id, expense_id, reimbursement_payment_id, ir_record_id, object_path, original_file_name, document_type, mime_type, uploaded_at")
    .eq("ir_record_id", irId)
    .eq("status", "active");
  if (irEvidenceError) throw new Error(`Dokumen PTJB gagal dimuat: ${irEvidenceError.message}`);

  const allEvidence = [...transactionEvidence, ...paymentEvidence, ...irEvidence];
  const evidenceWithUrl = await Promise.all(
    allEvidence.map(async (evidence) => {
      const { data, error } = await supabase.storage
        .from("faams-evidence")
        .createSignedUrl(evidence.object_path, 60);
      if (error) throw new Error(`Signed URL bukti ${evidence.original_file_name} gagal dibuat: ${error.message}`);
      return { ...evidence, url: data.signedUrl };
    }),
  );
  const categoryById = new Map(categories.map((category) => [category.id, category.name]));
  const ipById = new Map(ipRecords.map((record) => [record.id, record]));
  const allocationsByExpense = new Map<string, typeof allocations>();
  for (const allocation of allocations) {
    allocationsByExpense.set(allocation.expense_id, [
      ...(allocationsByExpense.get(allocation.expense_id) ?? []),
      allocation,
    ]);
  }
  const evidenceByExpense = new Map<string, typeof evidenceWithUrl>();
  for (const evidence of evidenceWithUrl) {
    if (!evidence.expense_id) continue;
    evidenceByExpense.set(evidence.expense_id, [
      ...(evidenceByExpense.get(evidence.expense_id) ?? []),
      evidence,
    ]);
  }

  const activeExpenses = expenses.filter((expense) => expense.status === "posted");
  const evidenceComplete =
    transactions.length > 0 &&
    transactions.every((transaction) =>
      activeExpenses.some((expense) =>
        expense.ir_transaction_id === transaction.id &&
        (evidenceByExpense.get(expense.id)?.length ?? 0) > 0,
      ),
    );
  const allocationsComplete = activeExpenses.every((expense) => {
    const total = (allocationsByExpense.get(expense.id) ?? []).reduce(
      (sum, allocation) => sum + allocation.amount,
      0,
    );
    return Math.round(total * 100) === Math.round(expense.amount * 100);
  });
  const canSubmit = evidenceComplete && allocationsComplete;
  const canClose =
    ir.status !== "completed" &&
    ir.status !== "void" &&
    ir.ptjb_status === "approved" &&
    ir.outstanding_amount === 0;
  const isLocked = ["completed", "void"].includes(ir.status) ||
    ["submitted", "approved"].includes(ir.ptjb_status);

  return (
    <div className="space-y-7">
      <Link
        href={irType === "operasional" ? "/ir-operasional" : "/ir-facility-management"}
        className="inline-flex items-center gap-2 text-xs font-medium text-slate-500 transition hover:text-blue-700"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Kembali ke daftar IR
      </Link>

      <section className="space-y-5">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-semibold tracking-wide text-blue-700">{ir.reference_code ?? "Nomor IR belum diisi"}</span>
              <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">{irType === "facility" ? "Facility Management" : "Operasional"}</span>
              <span className={`rounded-md px-2 py-1 text-[11px] font-medium ring-1 ring-inset ${ir.workflow_status === "Closed" ? "bg-emerald-50 text-emerald-700 ring-emerald-100" : ir.workflow_status === "Void" ? "bg-red-50 text-red-700 ring-red-100" : "bg-slate-100 text-slate-700 ring-slate-200"}`}>{ir.workflow_status}</span>
            </div>
            <h1 className="mt-2 text-[25px] font-semibold tracking-[-0.03em] text-[#172B4D]">Detail Internal Reimbursement</h1>
            <p className="mt-1 text-[13px] font-medium text-slate-700">{ir.title}</p>
            <p className="mt-1 max-w-3xl text-[13px] leading-5 text-slate-500">{ir.purpose}</p>
          </div>
        </div>
        <div className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5 sm:flex-row sm:items-center">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#172B4D]">Ekspor laporan</p>
            <p className="mt-0.5 text-xs text-slate-500">Excel tanpa lampiran · PDF dengan evidence</p>
          </div>
          <IRExportButtons irId={irId} irType={irType} />
        </div>
      </section>

      <IRReferenceForm irId={irId} irType={irType} referenceCode={ir.reference_code} />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {([
          { label: "Total pengeluaran", amount: ir.total_amount, icon: CircleDollarSign },
          { label: "Dana pribadi", amount: ir.personal_amount, icon: WalletCards },
          { label: "Dana IP", amount: ir.ip_amount, icon: WalletCards },
          { label: "Outstanding reimbursement", amount: ir.outstanding_amount, icon: CalendarDays },
        ]).map(({ label, amount, icon: Icon }) => (
          <Card key={label} className="transition-shadow hover:shadow-sm">
            <CardContent className="flex items-start justify-between gap-3 p-4">
              <div>
                <p className="text-xs font-medium text-slate-500">{label}</p>
                <p className="mt-2 text-xl font-semibold tracking-tight tabular-nums text-[#172B4D]">{formatIDR(amount)}</p>
              </div>
              <span className="flex size-8 items-center justify-center rounded-lg bg-slate-50 text-slate-500 ring-1 ring-slate-200/70">
                <Icon aria-hidden="true" className="size-4" />
              </span>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader className="border-b border-slate-100 px-5 py-3">
          <CardTitle className="text-[16px]">Informasi IR</CardTitle>
          <CardDescription className="text-xs">Identitas pengajuan dan ringkasan status keuangan.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 p-4 md:grid-cols-2">
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Informasi umum</p>
            <dl className="grid gap-x-4 gap-y-2 text-[12px] sm:grid-cols-2">
              <div><dt className="text-[10px] text-slate-500">Nomor IR</dt><dd className="mt-0.5 font-medium text-[#172B4D]">{ir.reference_code ?? "—"}</dd></div>
              <div><dt className="text-[10px] text-slate-500">Tanggal pengajuan</dt><dd className="mt-0.5 font-medium text-slate-700">{formatDate(ir.submitted_on)}</dd></div>
              <div><dt className="text-[10px] text-slate-500">Pelaksana / PIC</dt><dd className="mt-0.5 font-medium text-slate-700">{ir.pic_name ?? "—"}</dd></div>
              <div><dt className="text-[10px] text-slate-500">Periode</dt><dd className="mt-0.5 font-medium text-slate-700">{formatDate(ir.period_start)} – {formatDate(ir.period_end)}</dd></div>
              <div className="sm:col-span-2"><dt className="text-[10px] text-slate-500">Keperluan</dt><dd className="mt-0.5 font-medium leading-4 text-slate-700">{ir.purpose}</dd></div>
              {ir.notes && <div className="sm:col-span-2"><dt className="text-[10px] text-slate-500">Catatan</dt><dd className="mt-0.5 font-medium text-slate-700">{ir.notes}</dd></div>}
            </dl>
          </div>
          <div className="border-t border-slate-100 pt-4 md:border-l md:border-t-0 md:pl-5 md:pt-0">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Ringkasan keuangan</p>
            <dl className="grid gap-x-4 gap-y-2 text-[12px] sm:grid-cols-2">
              <div><dt className="text-[10px] text-slate-500">Sumber dana</dt><dd className="mt-0.5 font-medium text-slate-700">{ir.personal_amount > 0 && ir.ip_amount > 0 ? "Personal + IP" : ir.personal_amount > 0 ? "Personal" : ir.ip_amount > 0 ? "IP" : "Belum ada"}</dd></div>
              <div><dt className="text-[10px] text-slate-500">Total pengeluaran</dt><dd className="mt-0.5 font-semibold tabular-nums text-[#172B4D]">{formatIDR(ir.total_amount)}</dd></div>
              <div><dt className="text-[10px] text-slate-500">Dana pribadi</dt><dd className="mt-0.5 font-medium tabular-nums text-slate-700">{formatIDR(ir.personal_amount)}</dd></div>
              <div><dt className="text-[10px] text-slate-500">Dana IP</dt><dd className="mt-0.5 font-medium tabular-nums text-slate-700">{formatIDR(ir.ip_amount)}</dd></div>
              <div><dt className="text-[10px] text-slate-500">Dikembalikan ke IP</dt><dd className="mt-0.5 font-medium tabular-nums text-emerald-700">{formatIDR(returnedToIPAmount)}</dd></div>
              <div><dt className="text-[10px] text-slate-500">Status PTJB</dt><dd className="mt-0.5 font-medium text-slate-700">{ptjbLabel(ir.ptjb_status)}</dd></div>
              <div><dt className="text-[10px] text-slate-500">Status reimbursement</dt><dd className="mt-0.5 font-medium text-slate-700">{paymentLabel(ir.payment_status)}</dd></div>
            </dl>
          </div>
        </CardContent>
      </Card>

      {irEvidence.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Dokumen IR dan PTJB</CardTitle>
            <CardDescription>Dokumentasi yang terhubung langsung ke pengajuan IR.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {evidenceWithUrl
              .filter((evidence) => evidence.ir_record_id === irId)
              .map((evidence) => (
                <a key={evidence.id} href={evidence.url} target="_blank" rel="noreferrer" className="group flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 transition hover:border-blue-200 hover:bg-slate-50">
                  <span className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100 text-slate-500">
                    {evidence.mime_type === "image/jpeg" || evidence.mime_type === "image/png"
                      ? <Image src={evidence.url} alt="" fill sizes="44px" unoptimized className="object-cover" />
                      : <FileText aria-hidden="true" className="size-5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-slate-700 group-hover:text-blue-700">{evidence.original_file_name}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-slate-400">{evidence.document_type} · {formatDate(evidence.uploaded_at)}</span>
                  </span>
                  <ExternalLink aria-hidden="true" className="size-3.5 shrink-0 text-slate-400" />
                </a>
              ))}
          </CardContent>
        </Card>
      )}

      {ir.missing_evidence_count > 0 && (
        <p role="alert" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {ir.missing_evidence_count} transaksi belum memiliki bukti aktif. IR belum dapat diajukan sebagai PTJB.
        </p>
      )}

      <Card>
        <CardHeader className="border-b border-slate-100 px-5 py-3">
          <CardTitle className="text-[16px]">Rincian transaksi</CardTitle>
          <CardDescription>
            Setiap transaksi dicatat sekali; porsi sumber dana dipisahkan agar tidak terjadi penghitungan ganda.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {transactions.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">Belum ada transaksi untuk IR ini.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse text-left text-xs">
                <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-2.5">Tanggal</th>
                    <th scope="col" className="px-4 py-2.5">Rincian pengeluaran</th>
                    <th scope="col" className="px-4 py-2.5">Sumber dana</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Nominal</th>
                    <th scope="col" className="px-4 py-2.5">Evidence</th>
                    <th scope="col" className="px-4 py-2.5">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {transactions.map((transaction) => {
                    const transactionExpenses = expenses.filter(
                      (expense) => expense.ir_transaction_id === transaction.id,
                    );
                    const transactionDescriptionIsRepeated = transactionExpenses.some(
                      (expense) =>
                        expense.description.trim().toLocaleLowerCase() ===
                        transaction.description.trim().toLocaleLowerCase(),
                    );
                    const showTransactionHeading =
                      transactionExpenses.length === 0 || !transactionDescriptionIsRepeated;
                    return (
                      <Fragment key={transaction.id}>
                        {showTransactionHeading && (
                          <tr className="bg-slate-50/60">
                            <th colSpan={6} scope="rowgroup" className="px-4 py-2 text-left">
                              <span className="font-semibold text-[#172B4D]">{transaction.description}</span>
                              <span className={`ml-2 inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-medium ${statusTone(transaction.status)}`}>
                                {transaction.status === "active" ? "Tercatat" : transaction.status}
                              </span>
                            </th>
                          </tr>
                        )}
                        {transactionExpenses.length === 0 && (
                          <tr className="text-slate-500">
                            <td className="whitespace-nowrap px-4 py-3">{formatDate(transaction.transaction_date)}</td>
                            <td colSpan={5} className="px-4 py-3">Belum ada rincian pengeluaran.</td>
                          </tr>
                        )}
                        {transactionExpenses.map((expense) => {
                          const expenseAllocations = allocationsByExpense.get(expense.id) ?? [];
                          const expenseFiles = evidenceByExpense.get(expense.id) ?? [];
                          return (
                            <tr key={expense.id} className="align-top transition-colors hover:bg-slate-50/70">
                              <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDate(expense.expense_date)}</td>
                              <td className="max-w-[260px] px-4 py-3">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  <p className="font-medium leading-4 text-slate-800">{expense.description}</p>
                                  {!showTransactionHeading && expense === transactionExpenses[0] && (
                                    <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-medium ${statusTone(transaction.status)}`}>
                                      {transaction.status === "active" ? "Tercatat" : transaction.status}
                                    </span>
                                  )}
                                </div>
                                <p className="mt-1 text-[11px] text-slate-500">
                                  {categoryById.get(expense.category_id) ?? "Kategori"}
                                  {expense.payment_method ? ` · ${expense.payment_method}` : ""}
                                </p>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex max-w-[260px] flex-wrap gap-1">
                                  {expenseAllocations.map((allocation) => {
                                    const source = allocation.source_type === "personal"
                                      ? "Personal"
                                      : `IP ${ipById.get(allocation.ip_record_id ?? "")?.reference_code ?? allocation.ip_record_id?.slice(0, 8) ?? ""}`;
                                    return (
                                      <span key={allocation.id} className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${statusTone(allocation.source_type === "personal" ? "Personal" : "IP")}`}>
                                        {source}: {formatIDR(allocation.amount)}
                                      </span>
                                    );
                                  })}
                                </div>
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-[#172B4D]">{formatIDR(expense.amount)}</td>
                              <td className="max-w-[240px] px-4 py-2.5">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {expenseFiles.map((evidence) => (
                                    <a key={evidence.id} href={evidence.url} target="_blank" rel="noreferrer" title={evidence.original_file_name} className="group flex max-w-full items-center gap-1.5 rounded-md border border-slate-200 bg-white py-0.5 pl-0.5 pr-2 transition hover:border-blue-200 hover:bg-blue-50/50">
                                      <span className="relative flex size-6 shrink-0 items-center justify-center overflow-hidden rounded bg-slate-100 text-slate-500">
                                        {evidence.mime_type === "image/jpeg" || evidence.mime_type === "image/png"
                                          ? <Image src={evidence.url} alt="" fill sizes="24px" unoptimized className="object-cover" />
                                          : <FileText aria-hidden="true" className="size-3.5" />}
                                      </span>
                                      <span className="max-w-36 truncate text-[10px] font-medium text-slate-600 group-hover:text-blue-700">{evidence.original_file_name}</span>
                                      <ExternalLink aria-hidden="true" className="size-3 shrink-0 text-slate-400" />
                                    </a>
                                  ))}
                                  {expenseFiles.length === 0 && (
                                    <>
                                      <span className="text-[11px] text-amber-800">Belum ada bukti</span>
                                      {!isLocked && <IREvidenceForm irId={irId} irType={irType} expenseId={expense.id} />}
                                    </>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-2.5">
                                {isAdmin && !isLocked && (
                                  <IRTransactionEditForm
                                    key={`${expense.id}-${expense.updated_at}`}
                                    irId={irId}
                                    irType={irType}
                                    expense={expense}
                                    allocations={expenseAllocations}
                                    categories={categories}
                                    ipSources={ipRecords}
                                  />
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {!isLocked && (
        <IRTransactionForm irId={irId} irType={irType} categories={categories} ipSources={ipRecords} initialDate={getCurrentISODate()} />
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        <IRPTJBActions
          irId={irId}
          irType={irType}
          ptjbStatus={ir.ptjb_status}
          canSubmit={canSubmit && !isLocked}
          isAdmin={isAdmin}
        />
        <Card>
          <CardHeader>
            <CardTitle>Reimbursement</CardTitle>
            <CardDescription>
              Status pembayaran terpisah dari PTJB. Dana dari IP bukan piutang reimbursement pribadi.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">Status pembayaran: <strong>{paymentLabel(ir.payment_status)}</strong></p>
            <p className="text-sm">Terbayar: <strong>{formatIDR(ir.paid_amount)}</strong> · Outstanding: <strong>{formatIDR(ir.outstanding_amount)}</strong></p>
            {payments.map((payment) => (
              <div key={payment.id} className="rounded-lg border p-3">
                <div className="flex justify-between gap-3 text-sm">
                  <span>{formatDate(payment.payment_date)}{payment.reference_code ? ` · ${payment.reference_code}` : ""}</span>
                  <strong className="tabular-nums">{formatIDR(payment.amount)}</strong>
                </div>
                {payment.notes && <p className="mt-1 text-xs text-slate-500">{payment.notes}</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  {evidenceWithUrl.filter((item) => item.reimbursement_payment_id === payment.id).map((evidence) => (
                    <a key={evidence.id} href={evidence.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary underline">
                      {evidence.original_file_name}<ExternalLink aria-hidden="true" className="size-3" />
                    </a>
                  ))}
                </div>
              </div>
            ))}
            {isAdmin && ir.ptjb_status === "approved" && ir.outstanding_amount > 0 && ir.status !== "completed" && (
              <IRPaymentForm irId={irId} irType={irType} outstanding={ir.outstanding_amount} initialDate={getCurrentISODate()} />
            )}
            {isAdmin &&
              ir.ptjb_status === "approved" &&
              ir.status !== "void" &&
              ir.ip_amount > 0 &&
              ir.personal_amount === 0 &&
              Math.round(returnedToIPAmount * 100) < Math.round(ir.ip_amount * 100) && (
                <IRIPReplenishmentForm
                  irId={irId}
                  irType={irType}
                  ipAmount={ir.ip_amount}
                  initialDate={getCurrentISODate()}
                />
              )}
          </CardContent>
        </Card>
      </div>

      {isAdmin && ir.status !== "completed" && ir.status !== "void" && (
        <IRCloseForm irId={irId} irType={irType} canClose={canClose} />
      )}
      {ir.status === "completed" && (
        <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
          IR telah ditutup.
        </p>
      )}
    </div>
  );
}
