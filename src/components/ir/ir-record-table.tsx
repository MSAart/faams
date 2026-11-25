"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { Database } from "@/lib/supabase/database.types";
import { formatIDR } from "@/lib/format-currency";
import { formatDateId } from "@/lib/format-number";
import { ResponsiveDateInput } from "@/components/ui/responsive-date-input";

type IRRecord = Database["public"]["Views"]["ir_monitoring"]["Row"];

function formatDate(value: string | null) {
  return formatDateId(value);
}

function statusTone(status: string) {
  if (["Reimbursed", "Closed"].includes(status)) return "bg-emerald-50 text-emerald-700 ring-emerald-100";
  if (["Evidence Incomplete", "Reimbursement Outstanding", "Partially Reimbursed"].includes(status)) {
    return "bg-amber-50 text-amber-800 ring-amber-100";
  }
  if (status === "Void") return "bg-red-50 text-red-700 ring-red-100";
  return "bg-slate-100 text-slate-700 ring-slate-200";
}

export function IRRecordTable({
  records,
  irType,
}: {
  records: IRRecord[];
  irType: "operasional" | "facility";
}) {
  const [query, setQuery] = useState("");
  const [month, setMonth] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const filtered = useMemo(() => records.filter((record) => {
    const text = `${record.reference_code ?? ""} ${record.title} ${record.purpose} ${record.pic_name ?? ""}`.toLowerCase();
    return (!query || text.includes(query.trim().toLowerCase())) &&
      (!month || record.submitted_on?.startsWith(month)) &&
      (!status || record.workflow_status === status);
  }), [records, query, month, status]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const url = irType === "operasional" ? "/ir-operasional" : "/ir-facility-management";

  function updateFilter(setter: (value: string) => void, value: string) {
    setter(value);
    setPage(1);
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-3 border-b border-slate-100 p-4 md:grid-cols-[minmax(0,1fr)_minmax(160px,200px)_minmax(150px,180px)] md:items-center">
        <label className="relative min-w-0 flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(event) => updateFilter(setQuery, event.target.value)}
            placeholder="Cari nomor IR, keperluan, atau PIC"
            className="h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />
        </label>
        <ResponsiveDateInput
          aria-label="Filter bulan pengajuan"
          type="month"
          value={month}
          onChange={(event) => updateFilter(setMonth, event.target.value)}
          className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        />
        <select
          aria-label="Filter status IR"
          value={status}
          onChange={(event) => updateFilter(setStatus, event.target.value)}
          className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        >
          <option value="">Semua status</option>
          {[...new Set(records.map((record) => record.workflow_status))].sort().map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </div>
      {filtered.length === 0 ? (
        <p className="px-5 py-12 text-center text-sm text-slate-500">
          {records.length ? "Tidak ada IR yang cocok dengan filter." : "Belum ada IR. Gunakan tombol Tambah IR untuk membuat pengajuan."}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1060px] text-left text-[13px]">
              <thead className="bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3.5">ID IR / Keperluan</th>
                  <th className="px-4 py-3.5">Tanggal</th>
                  <th className="px-4 py-3.5">Pelaksana</th>
                  <th className="px-4 py-3.5 text-right">Pengeluaran</th>
                  <th className="px-4 py-3.5 text-right">Personal / IP</th>
                  <th className="px-4 py-3.5">Status PTJB</th>
                  <th className="px-5 py-3.5">Reimbursement / Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pageRows.map((record) => (
                  <tr key={record.id} className="transition-colors hover:bg-slate-50/70">
                    <td className="px-5 py-4">
                      <Link href={`${url}/${record.id}`} className="font-semibold text-blue-700 hover:text-blue-800 hover:underline">
                        {record.reference_code ?? "Nomor belum diisi"}
                      </Link>
                      <p className="mt-1 max-w-[280px] truncate text-xs text-slate-500">{record.title}</p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-slate-600">{formatDate(record.submitted_on)}</td>
                    <td className="max-w-[160px] truncate px-4 py-4 text-slate-600">{record.pic_name ?? "—"}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-right font-semibold tabular-nums">{formatIDR(record.total_amount)}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-right tabular-nums text-slate-600">
                      {formatIDR(record.personal_amount)} <span className="text-slate-300">/</span> {formatIDR(record.ip_amount)}
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex rounded-md px-2 py-1 text-[11px] font-medium ring-1 ring-inset ${statusTone(record.workflow_status)}`}>
                        {record.ptjb_status.replaceAll("_", " ")}
                      </span>
                      {record.missing_evidence_count > 0 && (
                        <p className="mt-1 text-[11px] text-amber-700">{record.missing_evidence_count} bukti kurang</p>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <span className={`inline-flex rounded-md px-2 py-1 text-[11px] font-medium ring-1 ring-inset ${record.outstanding_amount > 0 ? "bg-amber-50 text-amber-800 ring-amber-100" : "bg-emerald-50 text-emerald-700 ring-emerald-100"}`}>
                            {record.outstanding_amount > 0 ? "Outstanding" : "Lunas"}
                          </span>
                          <p className="mt-1 text-xs tabular-nums text-slate-500">{formatIDR(record.outstanding_amount)}</p>
                        </div>
                        <Link href={`${url}/${record.id}`} className="shrink-0 rounded-md px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-[#172B4D]">
                          Detail
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500">
              Menampilkan {filtered.length ? (currentPage - 1) * pageSize + 1 : 0}–{Math.min(currentPage * pageSize, filtered.length)} dari {filtered.length} IR
            </p>
            <div className="flex items-center gap-2">
              <button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40">
                <ChevronLeft aria-hidden="true" className="size-3.5" /> Sebelumnya
              </button>
              <span className="min-w-16 text-center text-xs text-slate-500">{currentPage} / {pages}</span>
              <button type="button" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)} className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40">
                Berikutnya <ChevronRight aria-hidden="true" className="size-3.5" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
