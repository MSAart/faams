import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment } from "react";
import { ArrowLeft, Download, ExternalLink, TriangleAlert } from "lucide-react";
import {
  IPCloseSettlementForm,
  IPDisbursementForm,
  IPDiscrepancyResolutionForm,
  IPRealizationForm,
  IPRealizationEditForm,
  IPReferenceForm,
  IPReturnForm,
} from "@/components/internal-prepayment/ip-detail-actions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatIDR } from "@/lib/format-currency";

export const dynamic = "force-dynamic";

type EvidenceRow = {
  id: string;
  expense_id: string | null;
  ip_record_id: string | null;
  settlement_id: string | null;
  original_file_name: string;
  object_path: string;
  document_type: string;
  status: string;
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function statusLabel(status: string) {
  return (
    {
      submitted: "Diajukan",
      approved: "Disetujui",
      disbursed: "Dicairkan",
      settlement_in_progress: "Settlement berjalan",
      settled: "Settled",
      closed: "Ditutup",
      verified: "Terverifikasi",
      pending_review: "Perlu tindak lanjut",
      linked_ir: "Dihubungkan ke IR",
      posted: "Tercatat",
      void: "Void",
    }[status] ?? status
  );
}

function StatCard({ label, value, tone = "text-slate-900" }: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <p className={`mt-2 text-lg font-bold tabular-nums ${tone}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

export default async function InternalPrepaymentDetailPage({
  params,
}: {
  params: Promise<{ ipId: string }>;
}) {
  const { ipId } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) throw new Error("Sesi pengguna gagal diverifikasi.");
  const [
    { data: record, error: recordError },
    { data: profile, error: profileError },
  ] = await Promise.all([
    supabase
      .from("ip_monitoring")
      .select("*")
      .eq("id", ipId)
      .maybeSingle(),
    supabase.from("profiles").select("is_admin").eq("id", authData.user.id).maybeSingle(),
  ]);

  if (recordError) throw new Error(`Detail IP gagal dimuat: ${recordError.message}`);
  if (profileError) throw new Error(`Hak administrator gagal diverifikasi: ${profileError.message}`);
  if (!record) notFound();
  const isAdmin = profile?.is_admin ?? false;

  const [
    { data: budgetRows, error: budgetError },
    { data: expenses, error: expenseError },
    { data: settlements, error: settlementError },
    { data: ipEvidence, error: ipEvidenceError },
    { data: categories, error: categoriesError },
    { data: irRecords, error: irError },
  ] = await Promise.all([
    supabase
      .from("ip_budget_items")
      .select("id, category_id, description, quantity, unit_cost, requested_amount, notes, status")
      .eq("ip_record_id", ipId)
      .order("created_at"),
    supabase
      .from("expenses")
      .select("id, updated_at, ip_budget_item_id, category_id, expense_date, description, vendor, amount, payment_method, ip_usage_status, ip_mismatch_reason, ip_resolution_note, related_ir_record_id, status")
      .eq("ip_record_id", ipId)
      .order("expense_date", { ascending: false }),
    supabase
      .from("settlements")
      .select("id, settlement_date, amount_spent, amount_returned, status, return_method, reference_code, notes")
      .eq("ip_record_id", ipId)
      .order("settlement_date", { ascending: false }),
    supabase
      .from("evidence_files")
      .select("id, expense_id, ip_record_id, settlement_id, original_file_name, object_path, document_type, status")
      .eq("ip_record_id", ipId)
      .eq("status", "active"),
    supabase.from("categories").select("id, name, scope"),
    supabase
      .from("ir_records")
      .select("id, reference_code, title, ir_type")
      .neq("status", "void")
      .order("created_at", { ascending: false }),
  ]);
  if (budgetError) throw new Error(`Item anggaran gagal dimuat: ${budgetError.message}`);
  if (expenseError) throw new Error(`Realisasi gagal dimuat: ${expenseError.message}`);
  if (settlementError) throw new Error(`Pengembalian gagal dimuat: ${settlementError.message}`);
  if (ipEvidenceError) throw new Error(`Bukti pencairan gagal dimuat: ${ipEvidenceError.message}`);
  if (categoriesError) throw new Error(`Kategori gagal dimuat: ${categoriesError.message}`);
  if (irError) throw new Error(`Daftar IR gagal dimuat: ${irError.message}`);

  const expenseIds = expenses.map((expense) => expense.id);
  let expenseEvidence: EvidenceRow[] = [];
  if (expenseIds.length > 0) {
    const { data, error } = await supabase
      .from("evidence_files")
      .select("id, expense_id, ip_record_id, settlement_id, original_file_name, object_path, document_type, status")
      .in("expense_id", expenseIds)
      .eq("status", "active");
    if (error) throw new Error(`Bukti realisasi gagal dimuat: ${error.message}`);
    expenseEvidence = data;
  }
  const settlementIds = settlements.map((settlement) => settlement.id);
  let returnEvidence: EvidenceRow[] = [];
  if (settlementIds.length > 0) {
    const { data, error } = await supabase
      .from("evidence_files")
      .select("id, expense_id, ip_record_id, settlement_id, original_file_name, object_path, document_type, status")
      .in("settlement_id", settlementIds)
      .eq("status", "active");
    if (error) throw new Error(`Bukti pengembalian gagal dimuat: ${error.message}`);
    returnEvidence = data;
  }

  const { data: activeIRTransactions, error: activeIRTransactionsError } = await supabase
    .from("ir_transactions")
    .select("id, ir_record_id")
    .eq("status", "active");
  if (activeIRTransactionsError) {
    throw new Error(`Alokasi IR untuk settlement IP gagal dimuat: ${activeIRTransactionsError.message}`);
  }
  const activeIRTransactionIds = activeIRTransactions.map((transaction) => transaction.id);
  const { data: activeIRExpenses, error: activeIRExpensesError } = activeIRTransactionIds.length
    ? await supabase
        .from("expenses")
        .select("id, ir_transaction_id")
        .in("ir_transaction_id", activeIRTransactionIds)
        .eq("status", "posted")
    : { data: [], error: null };
  if (activeIRExpensesError) {
    throw new Error(`Pengeluaran IR untuk settlement IP gagal dimuat: ${activeIRExpensesError.message}`);
  }
  const irIdByTransactionId = new Map(
    activeIRTransactions.map((transaction) => [transaction.id, transaction.ir_record_id]),
  );
  const irIdByExpenseId = new Map<string, string>();
  for (const expense of activeIRExpenses) {
    const irRecordId = expense.ir_transaction_id
      ? irIdByTransactionId.get(expense.ir_transaction_id)
      : null;
    if (irRecordId) irIdByExpenseId.set(expense.id, irRecordId);
  }
  const { data: activeIRAllocations, error: activeIRAllocationsError } = activeIRExpenses.length
    ? await supabase
        .from("transaction_allocations")
        .select("expense_id, amount")
        .in("expense_id", activeIRExpenses.map((expense) => expense.id))
        .eq("source_type", "ip")
        .eq("ip_record_id", ipId)
        .eq("status", "active")
    : { data: [], error: null };
  if (activeIRAllocationsError) {
    throw new Error(`Alokasi dana IR untuk settlement IP gagal dimuat: ${activeIRAllocationsError.message}`);
  }
  const allocatedToIRById = new Map<string, number>();
  for (const allocation of activeIRAllocations) {
    const irRecordId = irIdByExpenseId.get(allocation.expense_id);
    if (!irRecordId) continue;
    allocatedToIRById.set(
      irRecordId,
      (allocatedToIRById.get(irRecordId) ?? 0) + allocation.amount,
    );
  }
  const { data: replenishments, error: replenishmentsError } = await supabase
    .from("transaction_ledger")
    .select("related_ir_id, debit")
    .eq("related_ip_id", ipId)
    .eq("ir_replenishment", true);
  if (replenishmentsError) {
    throw new Error(`Pengembalian dana IR untuk settlement IP gagal dimuat: ${replenishmentsError.message}`);
  }
  const replenishedByIRId = new Map<string, number>();
  for (const replenishment of replenishments) {
    if (!replenishment.related_ir_id) continue;
    replenishedByIRId.set(
      replenishment.related_ir_id,
      (replenishedByIRId.get(replenishment.related_ir_id) ?? 0) + replenishment.debit,
    );
  }
  const unreturnedIRAmount = [...allocatedToIRById].reduce(
    (total, [irRecordId, amount]) =>
      total + Math.max(0, amount - (replenishedByIRId.get(irRecordId) ?? 0)),
    0,
  );

  const evidence = [...ipEvidence, ...expenseEvidence, ...returnEvidence];
  const evidenceWithUrl = await Promise.all(
    evidence.map(async (file) => {
      const { data, error } = await supabase.storage
        .from("faams-evidence")
        .createSignedUrl(file.object_path, 60);
      if (error) throw new Error(`Tautan bukti ${file.original_file_name} gagal dibuat: ${error.message}`);
      return { ...file, url: data.signedUrl };
    }),
  );
  const evidenceByExpense = new Map<string, typeof evidenceWithUrl>();
  for (const file of evidenceWithUrl) {
    if (file.expense_id) {
      evidenceByExpense.set(file.expense_id, [
        ...(evidenceByExpense.get(file.expense_id) ?? []),
        file,
      ]);
    }
  }

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const budgetOptions = budgetRows
    .filter((item) => item.status === "active")
    .map((item) => ({
      ...item,
      category_name: categoryById.get(item.category_id)?.name ?? "Kategori",
    }));
  const validExpenses = expenses.filter(
    (expense) => expense.status === "posted" && expense.ip_usage_status === "verified",
  );
  const directValidRealization = validExpenses.reduce((total, expense) => total + expense.amount, 0);
  const realizationByBudgetItem = new Map<string, number>();
  for (const expense of validExpenses) {
    if (expense.ip_budget_item_id) {
      realizationByBudgetItem.set(
        expense.ip_budget_item_id,
        (realizationByBudgetItem.get(expense.ip_budget_item_id) ?? 0) + expense.amount,
      );
    }
  }
  const pendingExpenses = expenses.filter(
    (expense) => expense.status === "posted" && expense.ip_usage_status === "pending_review",
  );
  const evidenceComplete = expenses
    .filter((expense) => expense.status === "posted")
    .every((expense) => (evidenceByExpense.get(expense.id)?.length ?? 0) > 0);
  const allReturnEvidenceComplete = settlements
    .filter((settlement) => settlement.status !== "void" && settlement.amount_returned > 0)
    .every((settlement) =>
      evidenceWithUrl.some((file) => file.settlement_id === settlement.id),
    );
  const canClose =
    ["disbursed", "settlement_in_progress"].includes(record.status) &&
    record.unsettled_balance === 0 &&
    unreturnedIRAmount === 0 &&
    pendingExpenses.length === 0 &&
    evidenceComplete &&
    allReturnEvidenceComplete &&
    ipEvidence.length > 0;
  const isActive = ["disbursed", "settlement_in_progress"].includes(record.status);

  return (
    <div className="space-y-6">
      <Link
        href="/internal-prepayment"
        className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-primary"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Kembali ke monitoring IP
      </Link>

      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="text-sm font-medium text-slate-500">{record.reference_code ?? "Nomor IP belum diisi"}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">{record.title}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{record.purpose}</p>
        </div>
        {record.status !== "void" && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button render={<a href={`/api/internal-prepayment/${ipId}/export/excel`} />}>
              <Download aria-hidden="true" />
              Export Form Excel
            </Button>
            <Button variant="outline" render={<a href={`/api/internal-prepayment/${ipId}/export/pdf`} />}>
              <Download aria-hidden="true" />
              Export Form PDF
            </Button>
          </div>
        )}
      </section>

      <IPReferenceForm ipId={ipId} referenceCode={record.reference_code} />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Ringkasan IP">
        <StatCard label="Nilai pencairan" value={formatIDR(record.disbursed_amount)} />
        <StatCard
          label="Realisasi valid"
          value={formatIDR(directValidRealization)}
          tone="text-emerald-700"
        />
        <StatCard label="Dana dikembalikan" value={formatIDR(record.returned_amount)} />
        <StatCard
          label="Saldo belum selesai"
          value={formatIDR(record.unsettled_balance)}
          tone={record.unsettled_balance < 0 ? "text-red-700" : "text-slate-900"}
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Informasi pengajuan</CardTitle>
          <CardDescription>
            {record.department_area || "Area belum diisi"} · PIC {record.pic_name || "belum ditentukan"}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <p><span className="text-slate-500">Tanggal pengajuan:</span><br />{formatDate(record.requested_on)}</p>
          <p><span className="text-slate-500">Status:</span><br />{statusLabel(record.status)}</p>
          <p><span className="text-slate-500">Periode pekerjaan:</span><br />{formatDate(record.project_start_date)} – {formatDate(record.project_end_date)}</p>
          <p><span className="text-slate-500">Lokasi project:</span><br />{record.project_location || "—"}</p>
          <p><span className="text-slate-500">Target settlement (10 HK):</span><br />{formatDate(record.target_settlement_date)}</p>
          <p><span className="text-slate-500">Batas administrasi (14 HK):</span><br />{formatDate(record.administrative_deadline)}</p>
          {record.disbursement_reference && (
            <p><span className="text-slate-500">Referensi transfer:</span><br />{record.disbursement_reference}</p>
          )}
          {record.recipient_details && (
            <p><span className="text-slate-500">Penerima:</span><br />{record.recipient_details}</p>
          )}
          {record.notes && <p className="sm:col-span-2"><span className="text-slate-500">Catatan:</span><br />{record.notes}</p>}
        </CardContent>
      </Card>

      {record.disbursed_amount > record.requested_amount && (
        <p role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          Nilai pencairan melebihi total anggaran yang diajukan.
        </p>
      )}
      {record.unsettled_balance < 0 && (
        <p role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          Realisasi dan pengembalian melebihi pencairan sebesar {formatIDR(Math.abs(record.unsettled_balance))}. Settlement tidak dapat ditutup.
        </p>
      )}
      {pendingExpenses.length > 0 && (
        <p role="alert" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          Ada {pendingExpenses.length} realisasi yang belum diverifikasi. Nilainya belum dihitung sebagai realisasi valid.
        </p>
      )}
      {unreturnedIRAmount > 0 && (
        <p role="alert" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          Dana IP sebesar {formatIDR(unreturnedIRAmount)} masih digunakan oleh IR dan belum dikembalikan ke sumber IP. Settlement dan penutupan belum dapat dilakukan.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Item pengajuan dan anggaran</CardTitle>
          <CardDescription>
            Total diminta {formatIDR(record.requested_amount)} · Total realisasi langsung IP {formatIDR(directValidRealization)}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {budgetRows.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">Belum ada item anggaran.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-2.5">Kategori / item</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Kuantitas</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Biaya satuan</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Realisasi valid</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Anggaran</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {budgetRows.map((item) => {
                    const realized = realizationByBudgetItem.get(item.id) ?? 0;
                    const overBudget = realized > item.requested_amount;
                    return (
                      <tr key={item.id} className="align-top hover:bg-slate-50/70">
                        <td className="max-w-sm px-4 py-3">
                          <p className="font-medium text-slate-800">{item.description}</p>
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            {categoryById.get(item.category_id)?.name ?? "Kategori"}
                            {item.notes ? ` · ${item.notes}` : ""}
                          </p>
                          {overBudget && (
                            <p className="mt-1 text-[11px] font-semibold text-red-700">
                              Melebihi anggaran {formatIDR(realized - item.requested_amount)}
                            </p>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-600">{item.quantity}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-600">{formatIDR(item.unit_cost)}</td>
                        <td className={`whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums ${overBudget ? "text-red-700" : "text-slate-700"}`}>{formatIDR(realized)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-[#172B4D]">{formatIDR(item.requested_amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="border-t border-slate-200 bg-slate-50">
                  <tr>
                    <th colSpan={3} scope="row" className="px-4 py-2.5 text-right font-semibold text-slate-700">Total</th>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular-nums text-slate-700">{formatIDR(directValidRealization)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular-nums text-[#172B4D]">{formatIDR(record.requested_amount)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {isAdmin && (record.status === "submitted" || record.status === "approved") ? (
        <IPDisbursementForm ipId={ipId} />
      ) : null}

      {isActive && (
        <div className="grid gap-5 xl:grid-cols-2">
          <IPRealizationForm ipId={ipId} budgetItems={budgetOptions} />
          {isAdmin && <IPReturnForm ipId={ipId} />}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Realisasi dan bukti transaksi</CardTitle>
            <CardDescription>
              Pengeluaran yang ditandai tidak sesuai tidak dimasukkan dalam saldo valid sampai ada keputusan tindak lanjut.
            </CardDescription>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              render={<a href={`/api/internal-prepayment/${ipId}/export/realizations/excel`} />}
            >
              <Download aria-hidden="true" />
              Export Realisasi Excel
            </Button>
            <Button
              render={<a href={`/api/internal-prepayment/${ipId}/export/realizations/pdf`} />}
            >
              <Download aria-hidden="true" />
              Export Realisasi PDF
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {expenses.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">Belum ada realisasi.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-xs">
                <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-2.5">Tanggal</th>
                    <th scope="col" className="px-4 py-2.5">Rincian pengeluaran</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Nominal</th>
                    <th scope="col" className="px-4 py-2.5">Status</th>
                    <th scope="col" className="px-4 py-2.5">Bukti transaksi</th>
                    <th scope="col" className="px-4 py-2.5">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {expenses.map((expense) => {
                    const evidenceFiles = evidenceByExpense.get(expense.id) ?? [];
                    const category = categoryById.get(expense.category_id);
                    const linkedIR = expense.related_ir_record_id
                      ? irRecords.find((candidate) => candidate.id === expense.related_ir_record_id)
                      : null;
                    const statusClass = expense.ip_usage_status === "verified"
                      ? "bg-emerald-50 text-emerald-700"
                      : expense.ip_usage_status === "pending_review"
                        ? "bg-amber-50 text-amber-800"
                        : "bg-blue-50 text-blue-700";
                    return (
                      <Fragment key={expense.id}>
                        <tr className="align-top hover:bg-slate-50/70">
                          <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDate(expense.expense_date)}</td>
                          <td className="max-w-md px-4 py-3">
                            <p className="font-medium leading-4 text-slate-800">{expense.description}</p>
                            <p className="mt-1 text-[11px] text-slate-500">
                              {[category?.name ?? "Kategori", expense.vendor, expense.payment_method].filter(Boolean).join(" · ")}
                            </p>
                            {expense.ip_mismatch_reason && (
                              <p className="mt-1.5 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
                                Ketidaksesuaian: {expense.ip_mismatch_reason}
                              </p>
                            )}
                            {expense.ip_resolution_note && <p className="mt-1 text-[11px] text-slate-500">Tindak lanjut: {expense.ip_resolution_note}</p>}
                            {expense.related_ir_record_id && (
                              <p className="mt-1 text-[11px] text-blue-700">
                                {linkedIR ? `Terhubung ke ${linkedIR.reference_code ?? "nomor IR belum diisi"} · ${linkedIR.title}` : `Terhubung ke IR ${expense.related_ir_record_id}`}
                              </p>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-[#172B4D]">{formatIDR(expense.amount)}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${statusClass}`}>
                              {statusLabel(expense.ip_usage_status)}
                            </span>
                          </td>
                          <td className="max-w-xs px-4 py-2.5">
                            {evidenceFiles.length > 0 ? (
                              <div className="flex flex-col items-start gap-1">
                                {evidenceFiles.map((file) => (
                                  <a
                                    key={file.id}
                                    href={file.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-medium text-primary hover:bg-blue-50"
                                  >
                                    <span className="max-w-48 truncate">{file.original_file_name}</span>
                                    <ExternalLink aria-hidden="true" className="size-3 shrink-0" />
                                  </a>
                                ))}
                              </div>
                            ) : (
                              <span className="text-[11px] font-medium text-amber-800">Bukti belum tersedia</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            {isAdmin && isActive && !expense.related_ir_record_id && (
                              <IPRealizationEditForm
                                key={`${expense.id}-${expense.updated_at}`}
                                ipId={ipId}
                                expense={expense}
                                budgetItems={budgetOptions}
                              />
                            )}
                          </td>
                        </tr>
                        {isAdmin && expense.ip_usage_status === "pending_review" && isActive && (
                          <tr>
                            <td colSpan={6} className="bg-amber-50/40 px-4 py-2">
                              <IPDiscrepancyResolutionForm
                                ipId={ipId}
                                expenseId={expense.id}
                                irRecords={irRecords}
                                defaultIRType={category?.scope ?? "operasional"}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot className="border-t border-slate-200 bg-slate-50">
                  <tr>
                    <th colSpan={2} scope="row" className="px-4 py-2.5 text-right font-semibold text-slate-700">Total realisasi valid</th>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular-nums text-[#172B4D]">{formatIDR(validExpenses.reduce((sum, expense) => sum + expense.amount, 0))}</td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          {validExpenses.reduce((sum, expense) => sum + expense.amount, 0) > record.requested_amount && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              Total realisasi valid melebihi anggaran pengajuan. Selisih ditampilkan transparan dan tidak dapat ditutup tanpa saldo dana nol.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pengembalian dana</CardTitle>
          <CardDescription>Setiap pengembalian dicatat sebagai arus dana tersendiri.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {settlements.filter((settlement) => settlement.amount_returned > 0).length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-500">Belum ada pengembalian dana.</p>
          ) : settlements
            .filter((settlement) => settlement.amount_returned > 0)
            .map((settlement) => (
              <div key={settlement.id} className="flex flex-col justify-between gap-2 rounded-lg border p-3 sm:flex-row sm:items-center">
                <div>
                  <p className="font-medium">{formatDate(settlement.settlement_date)} · {settlement.return_method ?? "Metode tidak tercatat"}</p>
                  <p className="text-xs text-slate-500">{settlement.reference_code || settlement.notes || "Pengembalian dana"}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {evidenceWithUrl
                      .filter((file) => file.settlement_id === settlement.id)
                      .map((file) => (
                        <a key={file.id} href={file.url} target="_blank" rel="noreferrer" className="text-xs font-medium text-primary underline">
                          {file.original_file_name}
                        </a>
                      ))}
                  </div>
                </div>
                <p className="font-semibold tabular-nums">{formatIDR(settlement.amount_returned)}</p>
              </div>
            ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bukti pencairan</CardTitle>
          <CardDescription>Berkas disimpan di private storage dan diakses dengan signed URL.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {evidenceWithUrl
            .filter((file) => file.ip_record_id === ipId)
            .map((file) => (
              <a key={file.id} href={file.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium text-primary hover:bg-slate-50">
                {file.original_file_name}
                <ExternalLink aria-hidden="true" className="size-3.5" />
              </a>
            ))}
          {ipEvidence.length === 0 && <p className="text-sm text-slate-500">Belum ada bukti pencairan.</p>}
        </CardContent>
      </Card>

      {isAdmin && isActive && (
        <IPCloseSettlementForm ipId={ipId} canClose={canClose} />
      )}
      {record.status === "closed" && (
        <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
          IP dan settlement telah ditutup.
        </p>
      )}
    </div>
  );
}
