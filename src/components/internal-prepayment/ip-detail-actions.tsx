"use client";

import { useActionState, useState } from "react";
import { Pencil } from "lucide-react";
import {
  closeIPSettlementAction,
  disburseIPAction,
  editIPRealizationAction,
  recordIPExpenseAction,
  recordIPReturnAction,
  resolveIPDiscrepancyAction,
  saveIPReferenceAction,
  type IPActionState,
} from "@/app/(app)/internal-prepayment/actions";
import { Button } from "@/components/ui/button";
import { PasteableFileInput } from "@/components/ui/pasteable-file-input";
import { ResponsiveDateInput } from "@/components/ui/responsive-date-input";
import { formatIDR } from "@/lib/format-currency";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type BudgetOption = {
  id: string;
  description: string;
  requested_amount: number;
  category_id: string;
  category_name: string;
};

type IROption = {
  id: string;
  reference_code: string | null;
  title: string;
  ir_type: "operasional" | "facility";
};

function ActionMessage({ state }: { state: IPActionState }) {
  return (
    <>
      {state.error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {state.error}
        </p>
      )}
      {state.success && (
        <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          {state.success}
        </p>
      )}
    </>
  );
}

function FileField({
  label = "Bukti (JPG, PNG, atau PDF; batas diatur dari Evidence Center)",
  name = "evidence",
  required = true,
}: {
  label?: string;
  name?: string;
  required?: boolean;
}) {
  return (
    <label className="block space-y-1.5 text-sm font-medium">
      {label}
      <PasteableFileInput
        name={name}
        accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
        required={required}
        className="block w-full rounded-lg border bg-white px-3 py-2 text-sm font-normal file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold"
      />
    </label>
  );
}

export function IPReferenceForm({
  ipId,
  referenceCode,
}: {
  ipId: string;
  referenceCode: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    saveIPReferenceAction.bind(null, ipId),
    {},
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Nomor resmi IP</CardTitle>
        <CardDescription>
          Masukkan nomor yang diberikan admin di luar aplikasi. Perubahan nomor akan tercatat di audit log.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1 space-y-1.5 text-sm font-medium">
            No. IP
            <input
              name="reference_code"
              defaultValue={referenceCode ?? ""}
              maxLength={120}
              required
              placeholder="Masukkan nomor resmi IP"
              className="w-full rounded-lg border bg-white px-3 py-2 font-normal"
            />
          </label>
          <Button type="submit" disabled={pending}>
            {pending ? "Menyimpan..." : state.success ? "Nomor tersimpan" : referenceCode ? "Perbarui nomor IP" : "Simpan nomor IP"}
          </Button>
        </form>
        <div className="mt-3"><ActionMessage state={state} /></div>
      </CardContent>
    </Card>
  );
}

function TextField({
  label,
  name,
  type = "text",
  required = false,
  defaultValue,
  min,
  step,
  maxLength,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
  min?: string;
  step?: string;
  maxLength?: number;
}) {
  return (
    <label className="block space-y-1.5 text-sm font-medium">
      {label}
      {type === "date" ? (
        <ResponsiveDateInput
          name={name}
          required={required}
          defaultValue={defaultValue}
          className="w-full rounded-lg border bg-white px-3 py-2 font-normal"
        />
      ) : (
        <input
          name={name}
          type={type}
          required={required}
          defaultValue={defaultValue}
          min={min}
          step={step}
          maxLength={maxLength}
          className="w-full rounded-lg border bg-white px-3 py-2 font-normal"
        />
      )}
    </label>
  );
}

export function IPDisbursementForm({ ipId }: { ipId: string }) {
  const action = disburseIPAction.bind(null, ipId);
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pencairan dana</CardTitle>
        <CardDescription>Satu IP hanya dapat dicairkan satu kali.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Tanggal pencairan" name="date" type="date" required />
            <TextField
              label="Nominal pencairan (IDR)"
              name="amount"
              type="number"
              min="0.01"
              step="0.01"
              required
            />
            <TextField label="Referensi transfer" name="reference" maxLength={120} />
            <TextField label="Rekening / penerima" name="recipient" maxLength={300} />
          </div>
          <label className="block space-y-1.5 text-sm font-medium">
            Catatan pencairan
            <textarea name="notes" rows={2} maxLength={1000} className="w-full rounded-lg border bg-white px-3 py-2 font-normal" />
          </label>
          <FileField label="Bukti transfer wajib (JPG, PNG, atau PDF; batas diatur dari Evidence Center)" />
          <ActionMessage state={state} />
          <Button type="submit" disabled={pending}>
            {pending ? "Mencatat..." : "Catat pencairan"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function IPRealizationForm({
  ipId,
  budgetItems,
}: {
  ipId: string;
  budgetItems: BudgetOption[];
}) {
  const action = recordIPExpenseAction.bind(null, ipId);
  const [state, formAction, pending] = useActionState(action, {});
  const [consistent, setConsistent] = useState("yes");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Catat realisasi IP</CardTitle>
        <CardDescription>
          Realisasi yang tidak sesuai akan ditahan dari perhitungan saldo sampai ditindaklanjuti.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Tanggal transaksi" name="date" type="date" required />
            <label className="block space-y-1.5 text-sm font-medium">
              Item pengajuan
              <select
                name="budget_item_id"
                required
                defaultValue=""
                className="w-full rounded-lg border bg-white px-3 py-2 font-normal"
              >
                <option value="" disabled>Pilih item anggaran</option>
                {budgetItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.description} — {formatIDR(item.requested_amount)}
                  </option>
                ))}
              </select>
            </label>
            <TextField label="Deskripsi" name="description" required maxLength={300} />
            <TextField label="Vendor" name="vendor" maxLength={200} />
            <TextField
              label="Nominal (IDR)"
              name="amount"
              type="number"
              min="0.01"
              step="0.01"
              required
            />
            <label className="block space-y-1.5 text-sm font-medium">
              Metode pembayaran
              <select name="payment_method" className="w-full rounded-lg border bg-white px-3 py-2 font-normal">
                <option value="cash">Tunai</option>
                <option value="transfer">Transfer</option>
                <option value="card">Kartu</option>
                <option value="other">Lainnya</option>
              </select>
            </label>
            <label className="block space-y-1.5 text-sm font-medium sm:col-span-2">
              Apakah penggunaan sesuai dengan pengajuan?
              <select
                name="is_consistent"
                value={consistent}
                onChange={(event) => setConsistent(event.target.value)}
                className="w-full rounded-lg border bg-white px-3 py-2 font-normal"
              >
                <option value="yes">Ya, sesuai</option>
                <option value="no">Tidak sesuai — perlu tindak lanjut</option>
              </select>
            </label>
            {consistent === "no" && (
              <label className="block space-y-1.5 text-sm font-medium sm:col-span-2">
                Alasan ketidaksesuaian
                <textarea
                  name="mismatch_reason"
                  required
                  maxLength={1000}
                  rows={2}
                  className="w-full rounded-lg border bg-white px-3 py-2 font-normal"
                />
              </label>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FileField label="Bukti nota wajib" />
            <FileField label="Bukti transfer (opsional)" name="transfer_evidence" required={false} />
            <label className="block space-y-1.5 text-sm font-medium">
              Dokumentasi lainnya (opsional, beberapa file; total maksimal 50 MiB)
              <PasteableFileInput
                name="other_evidence"
                accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                multiple
                className="block w-full rounded-lg border bg-white px-3 py-2 text-sm font-normal file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold"
              />
            </label>
          </div>
          <p className="text-xs text-slate-500">
            Bukti gambar dan PDF dioptimalkan sebelum disimpan. PDF bertanda tangan digital dipertahankan agar tanda tangannya tetap valid.
          </p>
          {consistent === "no" && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              Data akan berstatus belum diverifikasi dan tidak dihitung sebagai realisasi IP yang valid.
            </p>
          )}
          <ActionMessage state={state} />
          <Button type="submit" disabled={pending || budgetItems.length === 0}>
            {pending ? "Menyimpan..." : "Simpan realisasi"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function IPRealizationEditForm({
  ipId,
  expense,
  budgetItems,
}: {
  ipId: string;
  expense: {
    id: string;
    updated_at: string;
    expense_date: string;
    ip_budget_item_id: string | null;
    description: string;
    vendor: string | null;
    amount: number;
    payment_method: "cash" | "transfer" | "card" | "other" | null;
  };
  budgetItems: BudgetOption[];
}) {
  const [state, formAction, pending] = useActionState(
    editIPRealizationAction.bind(null, ipId, expense.id),
    {},
  );
  return (
    <details key={expense.updated_at} className="min-w-24">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
        <Pencil aria-hidden="true" className="size-3" />
        Edit
      </summary>
      <form action={formAction} className="mt-2 min-w-[min(30rem,80vw)] space-y-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs font-medium">
            Tanggal
            <ResponsiveDateInput name="date" defaultValue={expense.expense_date} required className="w-full rounded-md border bg-white px-2.5 py-2 text-sm font-normal" />
          </label>
          <label className="space-y-1 text-xs font-medium">
            Item pengajuan
            <select name="budget_item_id" defaultValue={expense.ip_budget_item_id ?? ""} required className="w-full rounded-md border bg-white px-2.5 py-2 text-sm font-normal">
              <option value="" disabled>Pilih item anggaran</option>
              {budgetItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.description} — {formatIDR(item.requested_amount)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium sm:col-span-2">
            Rincian pengeluaran
            <input name="description" defaultValue={expense.description} maxLength={300} required className="w-full rounded-md border bg-white px-2.5 py-2 text-sm font-normal" />
          </label>
          <label className="space-y-1 text-xs font-medium">
            Vendor
            <input name="vendor" defaultValue={expense.vendor ?? ""} maxLength={200} className="w-full rounded-md border bg-white px-2.5 py-2 text-sm font-normal" />
          </label>
          <label className="space-y-1 text-xs font-medium">
            Nominal (IDR)
            <input name="amount" type="number" min="0.01" step="0.01" defaultValue={expense.amount} required className="w-full rounded-md border bg-white px-2.5 py-2 text-sm font-normal" />
          </label>
          <label className="space-y-1 text-xs font-medium sm:col-span-2">
            Metode pembayaran
            <select name="payment_method" defaultValue={expense.payment_method ?? "other"} className="w-full rounded-md border bg-white px-2.5 py-2 text-sm font-normal">
              <option value="cash">Tunai</option>
              <option value="transfer">Transfer</option>
              <option value="card">Kartu</option>
              <option value="other">Lainnya</option>
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium">
            Jenis evidence tambahan
            <select name="document_type" defaultValue="other" className="w-full rounded-md border bg-white px-2.5 py-2 text-sm font-normal">
              <option value="receipt">Nota</option>
              <option value="invoice">Invoice</option>
              <option value="bank_transfer">Bukti transfer</option>
              <option value="other">Dokumen lainnya</option>
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium">
            Tambah evidence (opsional, beberapa file; total maksimal 50 MiB)
            <PasteableFileInput name="additional_evidence" multiple accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" className="w-full rounded-md border bg-white px-2 py-1.5 text-xs font-normal" />
          </label>
        </div>
        <p className="text-[11px] text-slate-500">Evidence lama tidak dihapus. Perubahan data realisasi dicatat dalam audit log.</p>
        <ActionMessage state={state} />
        <Button type="submit" size="sm" disabled={pending || budgetItems.length === 0}>
          {pending ? "Menyimpan..." : "Simpan perubahan"}
        </Button>
      </form>
    </details>
  );
}

export function IPReturnForm({ ipId }: { ipId: string }) {
  const action = recordIPReturnAction.bind(null, ipId);
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pengembalian dana</CardTitle>
        <CardDescription>Dapat dicatat beberapa kali sesuai pengembalian bertahap.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Tanggal pengembalian" name="date" type="date" required />
            <TextField label="Nominal (IDR)" name="amount" type="number" min="0.01" step="0.01" required />
            <label className="block space-y-1.5 text-sm font-medium">
              Metode
              <select name="method" className="w-full rounded-lg border bg-white px-3 py-2 font-normal">
                <option value="transfer">Transfer</option>
                <option value="cash">Tunai</option>
                <option value="other">Lainnya</option>
              </select>
            </label>
            <TextField label="Referensi transfer" name="reference" maxLength={120} />
          </div>
          <label className="block space-y-1.5 text-sm font-medium">
            Catatan
            <textarea name="notes" rows={2} maxLength={1000} className="w-full rounded-lg border bg-white px-3 py-2 font-normal" />
          </label>
          <FileField label="Bukti pengembalian wajib (JPG, PNG, atau PDF; batas diatur dari Evidence Center)" />
          <ActionMessage state={state} />
          <Button type="submit" disabled={pending}>
            {pending ? "Mencatat..." : "Catat pengembalian"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function IPDiscrepancyResolutionForm({
  ipId,
  expenseId,
  irRecords,
  defaultIRType,
}: {
  ipId: string;
  expenseId: string;
  irRecords: IROption[];
  defaultIRType: "operasional" | "facility";
}) {
  const action = resolveIPDiscrepancyAction.bind(null, expenseId, ipId);
  const [state, formAction, pending] = useActionState(action, {});
  const [followUp, setFollowUp] = useState("verify");

  return (
    <form action={formAction} className="mt-4 space-y-3 rounded-lg border border-amber-200 bg-amber-50/60 p-4">
      <h4 className="text-sm font-semibold text-amber-950">Tindak lanjut ketidaksesuaian</h4>
      <label className="block space-y-1 text-sm font-medium">
        Tindakan
        <select
          name="action"
          value={followUp}
          onChange={(event) => setFollowUp(event.target.value)}
          className="w-full rounded-lg border bg-white px-3 py-2 font-normal"
        >
          <option value="verify">Verifikasi sebagai realisasi IP</option>
          <option value="create_ir">Buat draft IR untuk ditindaklanjuti</option>
          <option value="link_ir">Hubungkan ke IR yang sudah ada</option>
        </select>
      </label>
      {followUp === "create_ir" && (
        <label className="block space-y-1 text-sm font-medium">
          Jenis IR
          <select name="ir_type" defaultValue={defaultIRType} className="w-full rounded-lg border bg-white px-3 py-2 font-normal">
            <option value="operasional">IR Operasional</option>
            <option value="facility">IR Facility Management</option>
          </select>
        </label>
      )}
      {followUp === "link_ir" && (
        <label className="block space-y-1 text-sm font-medium">
          IR yang sudah ada
          <select name="ir_record_id" required defaultValue="" className="w-full rounded-lg border bg-white px-3 py-2 font-normal">
            <option value="" disabled>Pilih IR</option>
            {irRecords
              .filter((record) => record.ir_type === defaultIRType)
              .map((record) => (
                <option key={record.id} value={record.id}>
                  {record.reference_code ?? record.id.slice(0, 8)} — {record.title}
                </option>
              ))}
          </select>
        </label>
      )}
      <label className="block space-y-1 text-sm font-medium">
        Catatan keputusan / tindak lanjut
        <textarea name="resolution_note" required maxLength={1000} rows={2} className="w-full rounded-lg border bg-white px-3 py-2 font-normal" />
      </label>
      <ActionMessage state={state} />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Menyimpan..." : "Simpan tindak lanjut"}
      </Button>
    </form>
  );
}

export function IPCloseSettlementForm({
  ipId,
  canClose,
}: {
  ipId: string;
  canClose: boolean;
}) {
  const action = closeIPSettlementAction.bind(null, ipId);
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tutup settlement</CardTitle>
        <CardDescription>
          Penutupan memerlukan saldo nol, dana IP yang digunakan IR sudah dikembalikan, bukti aktif untuk setiap pengeluaran, dan semua selisih sudah ditindaklanjuti.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <TextField label="Tanggal settlement" name="date" type="date" required />
          <label className="block space-y-1.5 text-sm font-medium">
            Catatan settlement
            <textarea name="notes" rows={2} maxLength={1000} className="w-full rounded-lg border bg-white px-3 py-2 font-normal" />
          </label>
          {!canClose && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              Settlement belum dapat ditutup. Periksa saldo, selisih penggunaan, dan bukti transaksi.
            </p>
          )}
          <ActionMessage state={state} />
          <Button type="submit" disabled={pending || !canClose}>
            {pending ? "Memproses..." : "Tinjau dan tutup IP"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
