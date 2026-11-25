import { AlertCircle, ArrowUpRight, FileText, WalletCards } from "lucide-react";
import Link from "next/link";
import type { IRType } from "@/components/ir/ir-management-forms";
import { IRRecordTable } from "@/components/ir/ir-record-table";
import { formatIDR } from "@/lib/format-currency";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function IRListPage({ irType }: { irType: IRType }) {
  const supabase = await createSupabaseServerClient();
  const { data: records, error: recordsError } = await supabase
    .from("ir_monitoring")
    .select("*")
    .eq("ir_type", irType)
    .order("submitted_on", { ascending: false });

  if (recordsError) {
    if (recordsError) console.error("Could not load IR monitoring records.", recordsError);
    const databaseError = recordsError;
    const migrationMissing =
      databaseError?.code === "42P01" ||
      databaseError?.code === "PGRST205" ||
      databaseError?.message.includes("ir_monitoring");

    return (
      <section
        role="alert"
        className="mx-auto flex min-h-[50vh] max-w-xl flex-col items-center justify-center px-4 text-center"
      >
        <AlertCircle aria-hidden="true" className="size-8 text-red-600" />
        <p className="mt-4 text-sm font-semibold text-red-700">
          {migrationMissing ? "Database IR belum siap" : "Data IR tidak dapat dimuat"}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
          {migrationMissing ? "Migration Part 04 belum diterapkan" : "Periksa koneksi database"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {migrationMissing
            ? "Jalankan migration Supabase terbaru dari folder project dengan perintah npx supabase db push. Setelah selesai, muat ulang halaman ini."
            : "Data monitoring atau ringkasan IR gagal dibaca. Periksa koneksi Supabase dan hak akses administrator, lalu coba lagi."}
        </p>
        <Button
          render={
            <a
              href={
                irType === "operasional"
                  ? "/ir-operasional"
                  : "/ir-facility-management"
              }
            />
          }
          className="mt-5"
        >
          Coba lagi
        </Button>
      </section>
    );
  }
  const isOperational = irType === "operasional";
  const pageTitle = isOperational ? "IR Operasional" : "IR Facility Management";
  const totalAmount = records.reduce((sum, record) => sum + record.total_amount, 0);
  const outstanding = records.reduce((sum, record) => sum + record.outstanding_amount, 0);
  const unfinished = records.filter((record) => !["Closed", "Void"].includes(record.workflow_status)).length;

  return (
    <div className="space-y-7">
      <section className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-md bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 ring-1 ring-blue-100">
            <FileText aria-hidden="true" className="size-3.5" />
            Administrasi reimbursement internal
          </div>
          <h1 className="text-[25px] font-semibold tracking-[-0.03em] text-[#172B4D]">{pageTitle}</h1>
          <p className="mt-1.5 max-w-2xl text-[13px] leading-5 text-slate-600">
            Kelola transaksi, alokasi dana personal/IP, kelengkapan bukti, PTJB, dan pembayaran secara terpisah.
          </p>
        </div>
        <Button
          render={<Link href={`${isOperational ? "/ir-operasional" : "/ir-facility-management"}/new`} />}
          className="h-10 w-full gap-2 bg-[#172B4D] px-4 hover:bg-[#10243A] sm:w-auto"
        >
          Tambah IR
          <ArrowUpRight aria-hidden="true" className="size-4" />
        </Button>
      </section>

      <section aria-label="Ringkasan reimbursement" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {([
          { label: "Total IR", value: String(records.length), note: "Seluruh status" },
          { label: "Total pengeluaran", value: formatIDR(totalAmount), note: "Transaksi tercatat" },
          { label: "Outstanding reimbursement", value: formatIDR(outstanding), note: "Belum dibayarkan" },
          { label: "IR belum selesai", value: String(unfinished), note: "Perlu tindak lanjut" },
        ]).map(({ label, value, note }) => (
          <Card key={label} className="transition-shadow hover:shadow-sm">
            <CardContent className="flex items-start justify-between gap-3 p-4">
              <div>
                <p className="text-[11px] font-medium text-slate-500">{label}</p>
                <p className="mt-2 text-lg font-semibold tracking-tight tabular-nums text-[#172B4D]">{value}</p>
                <p className="mt-1 text-[11px] text-slate-400">{note}</p>
              </div>
              <span className="flex size-8 items-center justify-center rounded-lg bg-slate-50 text-slate-500 ring-1 ring-slate-200/70">
                <WalletCards aria-hidden="true" className="size-4" />
              </span>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card id="daftar-ir" className="scroll-mt-24">
        <CardHeader className="border-b border-slate-100 px-5 py-4">
          <CardTitle className="text-[16px]">Daftar {pageTitle}</CardTitle>
          <CardDescription className="text-xs">
            Pengeluaran dihitung sekali; alokasi sumber dana ditampilkan terpisah.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <IRRecordTable records={records} irType={irType} />
        </CardContent>
      </Card>
    </div>
  );
}
