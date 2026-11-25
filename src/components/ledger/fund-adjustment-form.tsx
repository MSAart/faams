"use client";

import { useActionState, useState } from "react";
import {
  recordFundAdjustmentAction,
  type LedgerActionState,
} from "@/app/(app)/ledger-actions";
import { Button } from "@/components/ui/button";
import { ResponsiveDateInput } from "@/components/ui/responsive-date-input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export type LedgerIPOption = {
  id: string;
  reference_code: string | null;
  title: string;
};

export type LedgerIROption = {
  id: string;
  reference_code: string | null;
  title: string;
  ir_type: "operasional" | "facility";
};

function ActionMessage({ state }: { state: LedgerActionState }) {
  if (state.error) return <p role="alert" className="text-sm text-red-700">{state.error}</p>;
  if (state.success) return <p role="status" className="text-sm text-emerald-700">{state.success}</p>;
  return null;
}

export function FundAdjustmentForm({
  ips,
  irs,
  initialDate,
}: {
  ips: LedgerIPOption[];
  irs: LedgerIROption[];
  initialDate: string;
}) {
  const [state, formAction, pending] = useActionState(recordFundAdjustmentAction, {});
  const [sourceType, setSourceType] = useState<"ip" | "personal">("ip");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Koreksi / penyesuaian saldo</CardTitle>
        <CardDescription>
          Catat hanya penyesuaian yang disetujui. Alasan wajib; setiap perubahan masuk audit trail.
          Untuk IP yang sudah ditutup, gunakan form koreksi ini dan jelaskan alasannya.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <label className="space-y-1.5 text-sm font-medium">
            Sumber dana
            <select
              name="source_type"
              value={sourceType}
              onChange={(event) => setSourceType(event.target.value as "ip" | "personal")}
              className="w-full rounded-lg border bg-white px-3 py-2 font-normal"
            >
              <option value="ip">Internal Prepayment</option>
              <option value="personal">Personal administrator</option>
            </select>
          </label>
          {sourceType === "ip" ? (
            <label className="space-y-1.5 text-sm font-medium">
              IP terkait
              <select name="ip_record_id" required className="w-full rounded-lg border bg-white px-3 py-2 font-normal">
                <option value="">Pilih IP</option>
                {ips.map((ip) => (
                  <option key={ip.id} value={ip.id}>
                    {ip.reference_code ?? "Nomor IP belum diisi"} · {ip.title}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <input type="hidden" name="ip_record_id" value="" />
          )}
          <label className="space-y-1.5 text-sm font-medium">
            IR terkait (opsional)
            <select name="ir_record_id" defaultValue="" className="w-full rounded-lg border bg-white px-3 py-2 font-normal">
              <option value="">Tidak terkait IR</option>
              {irs.map((ir) => (
                <option key={ir.id} value={ir.id}>{ir.reference_code ?? "Nomor IR belum diisi"} · {ir.title}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5 text-sm font-medium">
            Arah perubahan
            <select name="direction" required className="w-full rounded-lg border bg-white px-3 py-2 font-normal">
              <option value="inflow">Debit — dana masuk ke saldo</option>
              <option value="outflow">Kredit — dana keluar dari saldo</option>
            </select>
          </label>
          <label className="space-y-1.5 text-sm font-medium">
            Tanggal
            <ResponsiveDateInput name="movement_date" defaultValue={initialDate} required className="w-full rounded-lg border bg-white px-3 py-2 font-normal" />
          </label>
          <label className="space-y-1.5 text-sm font-medium">
            Nominal (IDR)
            <input name="amount" type="number" min="0.01" step="0.01" required className="w-full rounded-lg border bg-white px-3 py-2 font-normal" />
          </label>
          <label className="space-y-1.5 text-sm font-medium">
            Referensi
            <input name="reference" maxLength={120} className="w-full rounded-lg border bg-white px-3 py-2 font-normal" placeholder="Nomor memo / dokumen" />
          </label>
          <label className="space-y-1.5 text-sm font-medium sm:col-span-2 xl:col-span-2">
            Deskripsi
            <input name="description" required maxLength={300} className="w-full rounded-lg border bg-white px-3 py-2 font-normal" />
          </label>
          <label className="space-y-1.5 text-sm font-medium sm:col-span-2 xl:col-span-3">
            Alasan koreksi / persetujuan
            <textarea name="reason" required maxLength={1000} rows={2} className="w-full rounded-lg border bg-white px-3 py-2 font-normal" />
          </label>
          <div className="space-y-2 sm:col-span-2 xl:col-span-3">
            <ActionMessage state={state} />
            <Button type="submit" disabled={pending}>
              {pending ? "Mencatat..." : "Catat penyesuaian"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
