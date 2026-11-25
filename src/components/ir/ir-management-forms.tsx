"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  addIRTransactionAction,
  addIREvidenceAction,
  closeIRAction,
  createIRAction,
  editIRTransactionAction,
  recordIRIPReplenishmentAction,
  recordIRPaymentAction,
  saveIRReferenceAction,
  updateIRPTJBAction,
  type IRActionState,
} from "@/app/(app)/ir-actions";
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

export type IRType = "operasional" | "facility";

export type IRCategoryOption = {
  id: string;
  name: string;
  scope: IRType;
};

export type IPSourceOption = {
  id: string;
  reference_code: string | null;
  title: string;
  unsettled_balance: number;
};

type AllocationDraft = {
  key: number;
  source_type: "personal" | "ip";
  ip_record_id: string;
  amount: string;
};

export function IRRegistrationForm({
  irType,
  initialDate,
  applicantName,
}: {
  irType: IRType;
  initialDate: string;
  applicantName: string;
}) {
  const [state, formAction, pending] = useActionState(createIRAction, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daftarkan IR {irType === "operasional" ? "Operasional" : "Facility Management"}</CardTitle>
        <CardDescription>
          Nomor resmi IR diisi setelah diberikan oleh admin. Setelah tersimpan, tambahkan transaksi dan alokasi sumber dananya.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="ir_type" value={irType} />
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm font-medium">
              Tanggal pengajuan
              <ResponsiveDateInput name="submitted_on" defaultValue={initialDate} required className="w-full rounded-lg border bg-white px-3 py-2 font-normal" />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Pelaksana / PIC
              <input type="hidden" name="pic_name" value={applicantName} />
              <input value={applicantName} readOnly className="w-full rounded-lg border bg-slate-50 px-3 py-2 font-normal text-slate-600" />
            </label>
            <label className="space-y-1.5 text-sm font-medium sm:col-span-2">
              Tujuan
              <textarea name="purpose" required maxLength={1000} rows={2} className="w-full rounded-lg border bg-white px-3 py-2 font-normal" />
            </label>
            <label className="space-y-1.5 text-sm font-medium sm:col-span-2">
              Deskripsi / nama kegiatan
              <input name="title" required maxLength={200} className="w-full rounded-lg border bg-white px-3 py-2 font-normal" />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Periode transaksi — mulai
              <ResponsiveDateInput name="period_start" className="w-full rounded-lg border bg-white px-3 py-2 font-normal" />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Periode transaksi — sampai
              <ResponsiveDateInput name="period_end" className="w-full rounded-lg border bg-white px-3 py-2 font-normal" />
            </label>
          </div>
          <label className="block space-y-1.5 text-sm font-medium">
            Catatan
            <textarea name="notes" rows={2} maxLength={2000} className="w-full rounded-lg border bg-white px-3 py-2 font-normal" />
          </label>
          <ActionMessage state={state} />
          <Button type="submit" disabled={pending}>
            {pending ? "Menyimpan..." : "Simpan IR"}
          </Button>
          {state.createdId && (
            <Link href={`${irType === "operasional" ? "/ir-operasional" : "/ir-facility-management"}/${state.createdId}`} className="ml-3 text-sm font-semibold text-primary underline">
              Buka detail IR
            </Link>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

export function IRReferenceForm({
  irId,
  irType,
  referenceCode,
}: {
  irId: string;
  irType: IRType;
  referenceCode: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    saveIRReferenceAction.bind(null, irId, irType),
    {},
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Nomor resmi IR</CardTitle>
        <CardDescription>
          Masukkan nomor yang diberikan admin di luar aplikasi. Perubahan nomor akan tercatat di audit log.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1 space-y-1.5 text-sm font-medium">
            No. IR
            <input
              name="reference_code"
              defaultValue={referenceCode ?? ""}
              maxLength={120}
              required
              placeholder="Masukkan nomor resmi IR"
              className="w-full rounded-lg border bg-white px-3 py-2 font-normal"
            />
          </label>
          <Button type="submit" disabled={pending}>
            {pending ? "Menyimpan..." : state.success ? "Nomor tersimpan" : referenceCode ? "Perbarui nomor IR" : "Simpan nomor IR"}
          </Button>
        </form>
        <div className="mt-3"><ActionMessage state={state} /></div>
      </CardContent>
    </Card>
  );
}

export function IRTransactionForm({
  irId,
  irType,
  categories,
  ipSources,
  initialDate,
}: {
  irId: string;
  irType: IRType;
  categories: IRCategoryOption[];
  ipSources: IPSourceOption[];
  initialDate: string;
}) {
  const serverAction = addIRTransactionAction.bind(null, irId, irType);
  const [state, formAction, pending] = useActionState(
    async (previousState: IRActionState, formData: FormData) => {
      try {
        return await serverAction(previousState, formData);
      } catch (error) {
        console.error("Could not submit the IR transaction action.", error);
        if (error instanceof TypeError && error.message === "Failed to fetch") {
          return {
            error: "Koneksi terputus saat menyimpan transaksi sehingga statusnya belum dapat dipastikan. Muat ulang detail IR dan pastikan transaksi belum tercatat sebelum mencoba lagi.",
          };
        }
        return {
          error: error instanceof Error
            ? `Permintaan penyimpanan transaksi gagal: ${error.message}`
            : "Permintaan penyimpanan transaksi gagal. Muat ulang halaman dan periksa apakah transaksi sudah tercatat sebelum mencoba lagi.",
        };
      }
    },
    {},
  );
  const [amount, setAmount] = useState("");
  const [allocations, setAllocations] = useState<AllocationDraft[]>([
    { key: 0, source_type: "personal", ip_record_id: "", amount: "" },
  ]);
  const allocated = useMemo(
    () => allocations.reduce((sum, item) => sum + (Number(item.amount) || 0), 0),
    [allocations],
  );
  const amountMatches = Math.round(allocated * 100) === Math.round((Number(amount) || 0) * 100);

  function updateAllocation(key: number, patch: Partial<AllocationDraft>) {
    setAllocations((current) =>
      current.map((item) => item.key === key ? { ...item, ...patch } : item),
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tambah transaksi</CardTitle>
        <CardDescription>
          Rinci sumber dana. Alokasi Personal menjadi piutang reimbursement; alokasi IP mengurangi saldo IP melalui ledger.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm font-medium">
              Tanggal transaksi
              <ResponsiveDateInput name="transaction_date" required defaultValue={initialDate} className="w-full rounded-lg border bg-white px-3 py-2 font-normal" />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Kategori
              <select name="category_id" required defaultValue="" className="w-full rounded-lg border bg-white px-3 py-2 font-normal">
                <option value="" disabled>Pilih kategori</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>
            <label className="space-y-1.5 text-sm font-medium sm:col-span-2">
              Deskripsi
              <input name="description" required maxLength={300} className="w-full rounded-lg border bg-white px-3 py-2 font-normal" />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Nominal transaksi (IDR)
              <input name="amount" type="number" min="0.01" step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} className="w-full rounded-lg border bg-white px-3 py-2 font-normal" />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Metode pembayaran
              <select name="payment_method" className="w-full rounded-lg border bg-white px-3 py-2 font-normal">
                <option value="cash">Tunai</option>
                <option value="transfer">Transfer</option>
                <option value="card">Kartu</option>
                <option value="other">Lainnya</option>
              </select>
            </label>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Alokasi sumber dana</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAllocations((current) => [
                  ...current,
                  { key: Math.max(-1, ...current.map((item) => item.key)) + 1, source_type: "personal", ip_record_id: "", amount: "" },
                ])}
              >
                <Plus aria-hidden="true" />
                Tambah sumber
              </Button>
            </div>
            {allocations.map((allocation, index) => (
              <div key={allocation.key} className="grid gap-3 rounded-xl border bg-slate-50/60 p-3 sm:grid-cols-[1fr_1.5fr_1fr_auto]">
                <label className="space-y-1 text-xs font-medium text-slate-600">
                  Sumber
                  <select
                    value={allocation.source_type}
                    onChange={(event) => {
                      const sourceType = event.target.value === "ip" ? "ip" : "personal";
                      updateAllocation(allocation.key, {
                        source_type: sourceType,
                        ip_record_id: "",
                      });
                    }}
                    className="w-full rounded-lg border bg-white px-3 py-2 text-sm font-normal text-slate-900"
                  >
                    <option value="personal">Personal</option>
                    <option value="ip">Internal Prepayment (IP)</option>
                  </select>
                </label>
                <label className="space-y-1 text-xs font-medium text-slate-600">
                  {allocation.source_type === "ip" ? "Pilih IP (saldo tersedia)" : "Sumber personal"}
                  {allocation.source_type === "ip" ? (
                    <select
                      value={allocation.ip_record_id}
                      required
                      onChange={(event) => updateAllocation(allocation.key, { ip_record_id: event.target.value })}
                      className="w-full rounded-lg border bg-white px-3 py-2 text-sm font-normal text-slate-900"
                    >
                      <option value="">Pilih IP aktif</option>
                      {ipSources.filter((source) => source.unsettled_balance > 0).map((source) => (
                        <option key={source.id} value={source.id}>
                          {source.reference_code ?? "Nomor IP belum diisi"} — {source.title} ({formatIDR(source.unsettled_balance)})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="block rounded-lg border bg-slate-100 px-3 py-2 text-sm font-normal text-slate-700">
                      Administrator saat ini
                    </span>
                  )}
                </label>
                <label className="space-y-1 text-xs font-medium text-slate-600">
                  Nominal alokasi
                  <input value={allocation.amount} onChange={(event) => updateAllocation(allocation.key, { amount: event.target.value })} type="number" min="0.01" step="0.01" required className="w-full rounded-lg border bg-white px-3 py-2 text-sm font-normal text-slate-900" />
                </label>
                <Button type="button" variant="ghost" size="icon" aria-label={`Hapus alokasi ${index + 1}`} disabled={allocations.length === 1} onClick={() => setAllocations((current) => current.filter((entry) => entry.key !== allocation.key))} className="self-end text-slate-500 hover:text-red-700">
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            ))}
            <input type="hidden" name="allocations" value={JSON.stringify(allocations.map(({ source_type, ip_record_id, amount: allocationAmount }) => ({
              source_type,
              ip_record_id: source_type === "ip" ? ip_record_id : "",
              amount: Number(allocationAmount),
            })))} />
            <div className={`flex flex-col justify-between gap-1 rounded-lg px-3 py-2 text-sm sm:flex-row ${amountMatches ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
              <span>Total alokasi {formatIDR(allocated)} dari {formatIDR(Number(amount) || 0)}</span>
              <span className="font-semibold">{amountMatches ? "Sesuai" : "Alokasi harus sama dengan nominal transaksi"}</span>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm font-medium">
              Nota / invoice (opsional; dapat ditambahkan sebelum PTJB)
              <PasteableFileInput name="receipt" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" className="w-full rounded-lg border bg-white px-3 py-2 text-xs font-normal" />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Bukti transfer (opsional)
              <PasteableFileInput name="transfer_evidence" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" className="w-full rounded-lg border bg-white px-3 py-2 text-xs font-normal" />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Dokumentasi lainnya (opsional, beberapa file; total maksimal 50 MiB)
              <PasteableFileInput name="other_evidence" multiple accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" className="w-full rounded-lg border bg-white px-3 py-2 text-xs font-normal" />
            </label>
          </div>
          <p className="text-xs text-slate-500">
            Bukti gambar dan PDF dioptimalkan sebelum disimpan. PDF bertanda tangan digital dipertahankan agar tanda tangannya tetap valid.
          </p>
          {ipSources.length === 0 && allocations.some((item) => item.source_type === "ip") && (
            <p className="text-sm text-amber-800">Tidak ada IP aktif dengan saldo tersedia. Alokasi IP akan ditolak oleh database bila dana tidak cukup.</p>
          )}
          <ActionMessage state={state} />
          <Button type="submit" disabled={pending || !amountMatches || categories.length === 0}>
            {pending ? "Mencatat..." : "Simpan transaksi"}
          </Button>
          {categories.length === 0 && <p className="text-sm text-amber-700">Kategori aktif untuk jenis IR ini belum tersedia.</p>}
        </form>
      </CardContent>
    </Card>
  );
}

export function IRTransactionEditForm({
  irId,
  irType,
  expense,
  allocations: initialAllocations,
  categories,
  ipSources,
}: {
  irId: string;
  irType: IRType;
  expense: {
    id: string;
    updated_at: string;
    expense_date: string;
    category_id: string;
    description: string;
    vendor: string | null;
    amount: number;
    payment_method: "cash" | "transfer" | "card" | "other" | null;
  };
  allocations: Array<{
    source_type: "ip" | "personal";
    ip_record_id: string | null;
    amount: number;
  }>;
  categories: IRCategoryOption[];
  ipSources: IPSourceOption[];
}) {
  const action = editIRTransactionAction.bind(null, irId, irType, expense.id);
  const [state, formAction, pending] = useActionState(action, {});
  const [amount, setAmount] = useState(String(expense.amount));
  const [allocations, setAllocations] = useState<AllocationDraft[]>(
    initialAllocations.map((allocation, key) => ({
      key,
      source_type: allocation.source_type,
      ip_record_id: allocation.ip_record_id ?? "",
      amount: String(allocation.amount),
    })),
  );
  const allocated = useMemo(
    () => allocations.reduce((sum, item) => sum + (Number(item.amount) || 0), 0),
    [allocations],
  );
  const amountMatches = Math.round(allocated * 100) === Math.round((Number(amount) || 0) * 100);

  function updateAllocation(key: number, patch: Partial<AllocationDraft>) {
    setAllocations((current) =>
      current.map((item) => item.key === key ? { ...item, ...patch } : item),
    );
  }

  return (
    <details key={expense.updated_at} className="min-w-40">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
        <Pencil aria-hidden="true" className="size-3" />
        Edit
      </summary>
      <form action={formAction} className="mt-2 min-w-[min(34rem,80vw)] space-y-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs font-medium">
            Tanggal
            <ResponsiveDateInput name="transaction_date" defaultValue={expense.expense_date} required className="w-full rounded-md border bg-white px-2.5 py-2 text-sm font-normal" />
          </label>
          <label className="space-y-1 text-xs font-medium">
            Kategori
            <select name="category_id" defaultValue={expense.category_id} required className="w-full rounded-md border bg-white px-2.5 py-2 text-sm font-normal">
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
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
            <input name="amount" type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required className="w-full rounded-md border bg-white px-2.5 py-2 text-sm font-normal" />
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
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold">Alokasi sumber dana</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAllocations((current) => [
                ...current,
                {
                  key: Math.max(-1, ...current.map((item) => item.key)) + 1,
                  source_type: "personal",
                  ip_record_id: "",
                  amount: "",
                },
              ])}
            >
              <Plus aria-hidden="true" />
              Sumber
            </Button>
          </div>
          {allocations.map((allocation, index) => (
            <div key={allocation.key} className="grid gap-2 rounded-md border bg-slate-50 p-2 sm:grid-cols-[1fr_1.4fr_1fr_auto]">
              <label className="space-y-1 text-[11px] font-medium">
                Sumber
                <select
                  value={allocation.source_type}
                  onChange={(event) => updateAllocation(allocation.key, {
                    source_type: event.target.value === "ip" ? "ip" : "personal",
                    ip_record_id: "",
                  })}
                  className="w-full rounded-md border bg-white px-2 py-1.5 text-xs font-normal"
                >
                  <option value="personal">Personal</option>
                  <option value="ip">Internal Prepayment (IP)</option>
                </select>
              </label>
              <label className="space-y-1 text-[11px] font-medium">
                {allocation.source_type === "ip" ? "IP" : "Sumber personal"}
                {allocation.source_type === "ip" ? (
                  <select
                    value={allocation.ip_record_id}
                    onChange={(event) => updateAllocation(allocation.key, { ip_record_id: event.target.value })}
                    required
                    className="w-full rounded-md border bg-white px-2 py-1.5 text-xs font-normal"
                  >
                    <option value="">Pilih IP</option>
                    {ipSources
                      .filter((source) => source.unsettled_balance > 0 || source.id === allocation.ip_record_id)
                      .map((source) => (
                        <option key={source.id} value={source.id}>
                          {source.reference_code ?? "IP"} — {source.title} ({formatIDR(source.unsettled_balance)})
                        </option>
                      ))}
                  </select>
                ) : (
                  <span className="block rounded-md border bg-slate-100 px-2 py-1.5 text-xs font-normal">Administrator saat ini</span>
                )}
              </label>
              <label className="space-y-1 text-[11px] font-medium">
                Nominal
                <input value={allocation.amount} onChange={(event) => updateAllocation(allocation.key, { amount: event.target.value })} type="number" min="0.01" step="0.01" required className="w-full rounded-md border bg-white px-2 py-1.5 text-xs font-normal" />
              </label>
              <Button type="button" variant="ghost" size="icon" aria-label={`Hapus alokasi ${index + 1}`} disabled={allocations.length === 1} onClick={() => setAllocations((current) => current.filter((entry) => entry.key !== allocation.key))} className="self-end text-slate-500 hover:text-red-700">
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          ))}
          <input type="hidden" name="allocations" value={JSON.stringify(allocations.map(({ source_type, ip_record_id, amount: allocationAmount }) => ({
            source_type,
            ip_record_id: source_type === "ip" ? ip_record_id : "",
            amount: Number(allocationAmount),
          })))} />
          <p className={`rounded-md px-2.5 py-2 text-xs ${amountMatches ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
            Total alokasi {formatIDR(allocated)} dari {formatIDR(Number(amount) || 0)}{amountMatches ? "" : " — harus sama dengan nominal"}
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-[1fr_2fr]">
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
        <p className="text-[11px] text-slate-500">Evidence lama tidak dihapus. Perubahan data dan alokasi dicatat dalam audit log; alokasi sumber akan memperbarui ledger.</p>
        <ActionMessage state={state} />
        <Button type="submit" size="sm" disabled={pending || !amountMatches || categories.length === 0}>
          {pending ? "Menyimpan..." : "Simpan perubahan"}
        </Button>
      </form>
    </details>
  );
}

export function IRPTJBActions({
  irId,
  irType,
  ptjbStatus,
  canSubmit,
  isAdmin,
}: {
  irId: string;
  irType: IRType;
  ptjbStatus: string;
  canSubmit: boolean;
  isAdmin: boolean;
}) {
  const [submitState, submitAction, submitPending] = useActionState(
    updateIRPTJBAction.bind(null, irId, irType, "submitted"),
    {},
  );
  const [approveState, approveAction, approvePending] = useActionState(
    updateIRPTJBAction.bind(null, irId, irType, "approved"),
    {},
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Status PTJB</CardTitle>
        <CardDescription>PTJB dilacak terpisah dari status pembayaran reimbursement.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">Status saat ini: <strong>{ptjbLabel(ptjbStatus)}</strong></p>
        {ptjbStatus !== "submitted" && ptjbStatus !== "approved" && (
          <form action={submitAction}>
            <Button type="submit" disabled={submitPending || !canSubmit}>
              {submitPending ? "Mengirim..." : "Ajukan PTJB"}
            </Button>
            {!canSubmit && <p className="mt-2 text-sm text-amber-800">Lengkapi transaksi, alokasi dana, dan bukti untuk setiap transaksi terlebih dahulu.</p>}
          </form>
        )}
        {isAdmin && ptjbStatus === "submitted" && (
          <form action={approveAction}>
            <Button type="submit" disabled={approvePending}>
              {approvePending ? "Menyimpan..." : "Tandai PTJB disetujui"}
            </Button>
          </form>
        )}
        <ActionMessage state={submitState.error ? submitState : approveState} />
        {submitState.success && <ActionMessage state={submitState} />}
        {approveState.success && <ActionMessage state={approveState} />}
      </CardContent>
    </Card>
  );
}

export function IREvidenceForm({
  irId,
  irType,
  expenseId,
}: {
  irId: string;
  irType: IRType;
  expenseId: string;
}) {
  const [state, formAction, pending] = useActionState(
    addIREvidenceAction.bind(null, irId, irType, expenseId),
    {},
  );
  return (
    <form action={formAction} className="mt-3 grid gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 sm:grid-cols-[1fr_1.5fr_auto] sm:items-end">
      <label className="space-y-1 text-xs font-medium">
        Jenis bukti
        <select name="document_type" className="w-full rounded-lg border bg-white px-3 py-2 text-sm font-normal">
          <option value="receipt">Nota / invoice</option>
          <option value="bank_transfer">Bukti transfer</option>
          <option value="other">Dokumentasi lainnya</option>
        </select>
      </label>
      <label className="space-y-1 text-xs font-medium">
        Unggah satu atau beberapa file JPG, PNG, atau PDF (ukuran total maksimal 50 MiB; dikompres sebelum disimpan, kecuali PDF bertanda tangan digital)
        <PasteableFileInput name="evidence" required multiple accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" className="w-full rounded-lg border bg-white px-3 py-2 text-xs font-normal" />
      </label>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Mengunggah..." : "Tambah bukti"}
      </Button>
      <div className="sm:col-span-3"><ActionMessage state={state} /></div>
    </form>
  );
}

export function IRPaymentForm({
  irId,
  irType,
  outstanding,
  initialDate,
}: {
  irId: string;
  irType: IRType;
  outstanding: number;
  initialDate: string;
}) {
  const [state, formAction, pending] = useActionState(
    recordIRPaymentAction.bind(null, irId, irType),
    {},
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Catat pembayaran reimbursement</CardTitle>
        <CardDescription>
          Pembayaran dapat dicatat bertahap. Setelah seluruh reimbursement lunas, alokasi dana IP pada IR otomatis dikembalikan ke sumber IP. Piutang saat ini {formatIDR(outstanding)}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm font-medium">
              Tanggal pembayaran
              <ResponsiveDateInput name="payment_date" defaultValue={initialDate} required className="w-full rounded-lg border bg-white px-3 py-2 font-normal" />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Nominal pembayaran (IDR)
              <input name="amount" type="number" min="0.01" max={outstanding} step="0.01" required className="w-full rounded-lg border bg-white px-3 py-2 font-normal" />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Referensi transfer
              <input name="reference" maxLength={120} className="w-full rounded-lg border bg-white px-3 py-2 font-normal" />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Bukti transfer wajib
              <PasteableFileInput name="evidence" required accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" className="w-full rounded-lg border bg-white px-3 py-2 text-xs font-normal" />
            </label>
          </div>
          <label className="block space-y-1.5 text-sm font-medium">
            Catatan
            <textarea name="notes" rows={2} maxLength={1000} className="w-full rounded-lg border bg-white px-3 py-2 font-normal" />
          </label>
          <ActionMessage state={state} />
          <Button type="submit" disabled={pending || outstanding <= 0}>
            {pending ? "Mencatat..." : "Catat pembayaran"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function IRIPReplenishmentForm({
  irId,
  irType,
  ipAmount,
  initialDate,
}: {
  irId: string;
  irType: IRType;
  ipAmount: number;
  initialDate: string;
}) {
  const [state, formAction, pending] = useActionState(
    recordIRIPReplenishmentAction.bind(null, irId, irType),
    {},
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Konfirmasi pengembalian dana IP</CardTitle>
        <CardDescription>
          Untuk IR yang seluruh dananya berasal dari IP, catat konfirmasi setelah dana pengganti benar-benar diterima. Nilai yang dikembalikan: {formatIDR(ipAmount)}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm font-medium">
              Tanggal dana diterima
              <ResponsiveDateInput name="replenishment_date" defaultValue={initialDate} required className="w-full rounded-lg border bg-white px-3 py-2 font-normal" />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Referensi transfer
              <input name="reference" maxLength={120} className="w-full rounded-lg border bg-white px-3 py-2 font-normal" />
            </label>
            <label className="space-y-1.5 text-sm font-medium sm:col-span-2">
              Catatan konfirmasi
              <textarea name="notes" required maxLength={1000} rows={2} className="w-full rounded-lg border bg-white px-3 py-2 font-normal" />
            </label>
            <label className="space-y-1.5 text-sm font-medium sm:col-span-2">
              Bukti transfer wajib
              <PasteableFileInput name="evidence" required accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" className="w-full rounded-lg border bg-white px-3 py-2 text-xs font-normal" />
            </label>
          </div>
          <ActionMessage state={state} />
          <Button type="submit" disabled={pending}>
            {pending ? "Mencatat..." : "Konfirmasi dana kembali ke IP"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function IRCloseForm({
  irId,
  irType,
  canClose,
}: {
  irId: string;
  irType: IRType;
  canClose: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    closeIRAction.bind(null, irId, irType),
    {},
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tutup IR</CardTitle>
        <CardDescription>
          IR harus disetujui PTJB dan seluruh piutang reimbursement pribadi sudah dibayar. IR yang hanya didanai IP tidak memerlukan pembayaran reimbursement.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!canClose && <p className="text-sm text-amber-800">IR belum memenuhi syarat penutupan.</p>}
        <form action={formAction}>
          <Button type="submit" disabled={pending || !canClose}>
            {pending ? "Menutup..." : "Tutup IR"}
          </Button>
        </form>
        <ActionMessage state={state} />
      </CardContent>
    </Card>
  );
}

export function ActionMessage({ state }: { state: IRActionState }) {
  return (
    <>
      {state.error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{state.error}</p>}
      {state.success && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{state.success}</p>}
    </>
  );
}

export function ptjbLabel(status: string) {
  return ({
    not_submitted: "Belum diajukan",
    in_progress: "Recorded",
    submitted: "PTJB Submitted",
    approved: "Disetujui",
    rejected: "Ditolak",
  }[status] ?? status);
}

export function paymentLabel(status: string) {
  return ({
    unpaid: "Belum dibayarkan",
    partially_paid: "Dibayar sebagian",
    paid: "Lunas",
  }[status] ?? status);
}
