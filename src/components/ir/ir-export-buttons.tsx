"use client";

import { useState } from "react";
import { FileSpreadsheet, FileText, LoaderCircle } from "lucide-react";
import { toast } from "sonner";

type ExportFormat = "excel" | "pdf";

export function IRExportButtons({
  irId,
  irType,
}: {
  irId: string;
  irType: "operasional" | "facility";
}) {
  const [pending, setPending] = useState<ExportFormat | null>(null);

  async function exportReport(format: ExportFormat) {
    setPending(format);
    try {
      const response = await fetch(
        `/api/internal-reimbursement/${irId}/export/${format}?type=${irType}`,
      );
      if (!response.ok) {
        const result: unknown = await response.json().catch(() => null);
        const message = typeof result === "object" && result !== null && "error" in result &&
          typeof result.error === "string"
          ? result.error
          : `Export ${format.toUpperCase()} gagal.`;
        throw new Error(message);
      }

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition");
      const filename = disposition?.match(/filename="([^"]+)"/)?.[1] ??
        `IR-${irId}.${format === "excel" ? "xlsx" : "pdf"}`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast.success(`${format === "excel" ? "Excel" : "PDF"} berhasil diunduh.`);
    } catch (error) {
      toast.error("Ekspor gagal", {
        description: error instanceof Error ? error.message : "Terjadi kesalahan saat membuat laporan.",
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <button
        type="button"
        onClick={() => void exportReport("excel")}
        disabled={pending !== null}
        title="Laporan transaksi dan keuangan tanpa lampiran evidence"
        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-white px-3.5 text-sm font-semibold text-emerald-700 shadow-sm transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:cursor-wait disabled:opacity-60"
      >
        {pending === "excel" ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <FileSpreadsheet aria-hidden="true" className="size-4" />}
        {pending === "excel" ? "Menyiapkan Excel..." : "Export Excel"}
      </button>
      <button
        type="button"
        onClick={() => void exportReport("pdf")}
        disabled={pending !== null}
        title="Laporan lengkap dengan rincian transaksi dan evidence"
        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#172B4D] px-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#10243A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-wait disabled:opacity-60"
      >
        {pending === "pdf" ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <FileText aria-hidden="true" className="size-4" />}
        {pending === "pdf" ? "Menyiapkan PDF..." : "Export PDF"}
      </button>
    </div>
  );
}
