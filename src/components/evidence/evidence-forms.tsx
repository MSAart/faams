"use client";

import { useActionState } from "react";
import { Trash2 } from "lucide-react";
import {
  deleteEvidenceAction,
  linkEvidenceAction,
  updateEvidenceMaxSizeAction,
  uploadEvidenceCenterAction,
  type EvidenceActionState,
} from "@/app/(app)/evidence-actions";
import { Button } from "@/components/ui/button";
import { PasteableFileInput } from "@/components/ui/pasteable-file-input";

export type EvidenceParentOption = {
  value: string;
  label: string;
};

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

function ActionMessage({ state }: { state: EvidenceActionState }) {
  if (state.error) {
    return <p role="alert" className="text-sm text-red-700">{state.error}</p>;
  }
  if (state.success) {
    return <p role="status" className="text-sm text-emerald-700">{state.success}</p>;
  }
  return null;
}

export function EvidenceUploadForm({
  parents,
  maxFileSize,
}: {
  parents: EvidenceParentOption[];
  maxFileSize: number;
}) {
  const [state, formAction, pending] = useActionState(uploadEvidenceCenterAction, {});
  const maxMiB = Math.floor(maxFileSize / 1024 / 1024);
  return (
    <form action={formAction} className="grid w-full min-w-0 gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-3">
      <label className="min-w-0 space-y-1.5 text-sm font-medium">
        Kategori evidence
        <select name="document_type" className="w-full rounded-lg border bg-white px-3 py-2 font-normal" required>
          {categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="min-w-0 space-y-1.5 text-sm font-medium">
        Relasi transaksi
        <select name="parent" className="w-full rounded-lg border bg-white px-3 py-2 font-normal" defaultValue="">
          <option value="">Belum dihubungkan</option>
          {parents.map((parent) => <option key={parent.value} value={parent.value}>{parent.label}</option>)}
        </select>
      </label>
      <label className="min-w-0 space-y-1.5 text-sm font-medium sm:col-span-2 lg:col-span-1">
        File (maks. {maxMiB} MiB per file)
        <PasteableFileInput
          name="evidence"
          multiple
          required
          accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
          className="w-full rounded-lg border bg-white px-3 py-2 text-xs font-normal"
        />
      </label>
      <div className="flex min-w-0 flex-col gap-3 border-t border-slate-100 pt-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between lg:col-span-3">
        <div className="min-w-0 space-y-1">
          <p className="text-xs leading-5 text-slate-500">
            JPG, JPEG, PNG, atau PDF · Maksimal 10 file dan 50 MiB total per unggahan.
          </p>
          <ActionMessage state={state} />
        </div>
        <Button type="submit" disabled={pending} className="w-full shrink-0 sm:w-auto sm:min-w-44">
          {pending ? "Mengunggah..." : "Unggah evidence"}
        </Button>
      </div>
    </form>
  );
}

export function EvidenceLinkForm({
  evidenceId,
  parents,
}: {
  evidenceId: string;
  parents: EvidenceParentOption[];
}) {
  const [state, formAction, pending] = useActionState(
    linkEvidenceAction.bind(null, evidenceId),
    {},
  );
  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2 sm:flex-row">
      <select name="parent" required defaultValue="" className="min-w-0 flex-1 rounded-lg border bg-white px-3 py-2 text-sm">
        <option value="" disabled>Pilih relasi transaksi</option>
        {parents.map((parent) => <option key={parent.value} value={parent.value}>{parent.label}</option>)}
      </select>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Menghubungkan..." : "Hubungkan"}
      </Button>
      <ActionMessage state={state} />
    </form>
  );
}

export function DeleteEvidenceForm({
  evidenceId,
  objectPath,
}: {
  evidenceId: string;
  objectPath: string;
}) {
  const [state, formAction, pending] = useActionState(
    deleteEvidenceAction.bind(null, evidenceId, objectPath),
    {},
  );
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm("Hapus evidence ini secara permanen? Tindakan ini tidak dapat dibatalkan.")) {
          event.preventDefault();
        }
      }}
      className="space-y-2"
    >
      <Button type="submit" variant="outline" size="sm" disabled={pending} className="w-full text-red-700 hover:bg-red-50 hover:text-red-800">
        <Trash2 aria-hidden="true" className="size-4" />
        {pending ? "Menghapus..." : "Hapus permanen"}
      </Button>
      <ActionMessage state={state} />
    </form>
  );
}

export function EvidenceSizeForm({ maxSizeMib }: { maxSizeMib: number }) {
  const [state, formAction, pending] = useActionState(updateEvidenceMaxSizeAction, {});
  return (
    <details className="w-full min-w-0 rounded-xl border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-semibold text-slate-800">
        Pengaturan batas ukuran file (saat ini {maxSizeMib} MiB)
      </summary>
      <form action={formAction} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="space-y-1.5 text-sm font-medium">
          Batas per file (1–50 MiB)
          <input
            name="max_size_mib"
            type="number"
            min="1"
            max="50"
            step="1"
            defaultValue={maxSizeMib}
            required
            className="block w-full rounded-lg border bg-white px-3 py-2 font-normal"
          />
        </label>
        <Button type="submit" disabled={pending}>{pending ? "Menyimpan..." : "Simpan batas"}</Button>
        <ActionMessage state={state} />
      </form>
    </details>
  );
}
