import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getReportDataset, parseReportFilters, reportFiltersLabel, reportReference } from "@/lib/reports";
import { verifyReportAdministrator } from "@/lib/report-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const navy = "17304F";
const slate = "475569";
const moneyFormat = '"Rp" #,##0.00;[Red]-"Rp" #,##0.00';
const dateFormat = "dd/mm/yyyy";

type RowValue = string | number | Date | null;
type TableOptions = {
  moneyColumns?: number[];
  dateColumns?: number[];
  totalColumns?: number[];
  statusColumn?: number;
};

function addTable(
  workbook: ExcelJS.Workbook,
  name: string,
  headers: string[],
  rows: RowValue[][],
  options: TableOptions = {},
) {
  const sheet = workbook.addWorksheet(name);
  sheet.addRow(headers);
  for (const values of rows) sheet.addRow(values);

  const lastDataRow = Math.max(1, rows.length + 1);
  sheet.views = [{ state: "frozen", ySplit: 1, topLeftCell: "A2" }];
  if (rows.length) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: lastDataRow, column: headers.length },
    };
  }
  sheet.getRow(1).height = 30;
  sheet.getRow(1).eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: navy } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "medium", color: { argb: "0F172A" } } };
  });

  for (let rowNumber = 2; rowNumber <= lastDataRow; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    row.height = 22;
    row.eachCell((cell, column) => {
      if (rowNumber % 2 === 0) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "F8FAFC" } };
      }
      cell.font = { color: { argb: "1E293B" }, size: 10 };
      cell.alignment = { vertical: "middle", wrapText: false };
      if (options.moneyColumns?.includes(column)) {
        cell.numFmt = moneyFormat;
        cell.alignment = { horizontal: "right", vertical: "middle" };
      }
      if (options.dateColumns?.includes(column)) {
        cell.numFmt = dateFormat;
        cell.alignment = { horizontal: "center", vertical: "middle" };
      }
      if (options.statusColumn === column) {
        const status = String(cell.value ?? "").toLowerCase();
        if (status.includes("discrepancy") || status.includes("over budget") || status.includes("pending_review")) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FEE2E2" } };
          cell.font = { color: { argb: "B91C1C" }, bold: true, size: 10 };
        } else if (status.includes("outstanding") || status.includes("unverified") || status.includes("incomplete")) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FEF3C7" } };
          cell.font = { color: { argb: "92400E" }, bold: true, size: 10 };
        }
      }
    });
  }

  if (options.totalColumns?.length && rows.length) {
    const totalRowNumber = rows.length + 2;
    const totalRow = sheet.addRow([]);
    totalRow.height = 25;
    totalRow.getCell(1).value = "TOTAL";
    for (const column of options.totalColumns) {
      const letter = sheet.getColumn(column).letter;
      const values = rows.map((row) => Number(row[column - 1] ?? 0));
      const result = values.reduce((sum, value) => sum + value, 0);
      const cell = totalRow.getCell(column);
      cell.value = {
        formula: `SUM(${letter}2:${letter}${totalRowNumber - 1})`,
        result,
      };
      cell.numFmt = moneyFormat;
      cell.alignment = { horizontal: "right" };
    }
    totalRow.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "E2E8F0" } };
      cell.font = { bold: true, color: { argb: navy } };
      cell.border = { top: { style: "thin", color: { argb: "94A3B8" } } };
    });
  }

  for (let column = 1; column <= headers.length; column++) {
    const headerLength = headers[column - 1].length;
    const maxLength = Math.max(
      headerLength,
      ...rows.map((row) => String(row[column - 1] ?? "").length),
    );
    sheet.getColumn(column).width = Math.min(Math.max(maxLength + 2, 12), 42);
  }
  return sheet;
}

function dateCell(value: string | null | undefined): Date | null {
  return value ? new Date(`${value.slice(0, 10)}T00:00:00.000Z`) : null;
}

function scopeLabel(scope: string) {
  return scope === "operasional" ? "IR Operasional" : scope === "facility" ? "IR Facility" : "Semua transaksi";
}

export async function GET(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    if (!await verifyReportAdministrator(supabase)) {
      return NextResponse.json({ error: "Akses administrator diperlukan." }, { status: 403 });
    }
    const url = new URL(request.url);
    const filters = parseReportFilters(url.searchParams);
    const data = await getReportDataset(supabase, filters, true);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "FAAMS";
    workbook.subject = "Finance Administration Report";
    workbook.title = "FAAMS Finance Report";
    workbook.created = new Date(data.generatedAt);
    workbook.modified = new Date(data.generatedAt);
    const cover = workbook.addWorksheet("Cover");
    cover.mergeCells("A1:F1");
    cover.getCell("A1").value = "FAAMS";
    cover.getCell("A1").font = { name: "Aptos Display", size: 28, bold: true, color: { argb: "FFFFFFFF" } };
    cover.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: navy } };
    cover.getCell("A1").alignment = { vertical: "middle" };
    cover.getRow(1).height = 58;
    cover.mergeCells("A3:F3");
    cover.getCell("A3").value = "FINANCE ADMINISTRATION & ACCOUNTABILITY REPORT";
    cover.getCell("A3").font = { size: 17, bold: true, color: { argb: navy } };
    cover.mergeCells("A5:B5");
    cover.getCell("A5").value = "Periode";
    cover.getCell("C5").value = reportFiltersLabel(filters);
    cover.getCell("A6").value = "Jenis laporan";
    cover.getCell("C6").value = scopeLabel(filters.scope);
    cover.getCell("A7").value = "Filter record";
    cover.getCell("C7").value = filters.ipId
      ? data.ips.find((row) => row.id === filters.ipId)?.reference_code ?? filters.ipId
      : filters.irId
        ? data.irs.find((row) => row.id === filters.irId)?.reference_code ?? filters.irId
        : "Semua record";
    cover.getCell("A8").value = "Dibuat";
    cover.getCell("C8").value = new Date(data.generatedAt);
    cover.getCell("C8").numFmt = "dd/mm/yyyy hh:mm";
    cover.getColumn(1).width = 22;
    cover.getColumn(2).width = 4;
    cover.getColumn(3).width = 34;
    cover.getColumn(4).width = 18;
    cover.getColumn(5).width = 18;
    cover.getColumn(6).width = 18;
    cover.views = [{ state: "frozen", ySplit: 3 }];
    cover.eachRow((row, rowNumber) => {
      if (rowNumber >= 5 && rowNumber <= 8) row.getCell(1).font = { bold: true, color: { argb: slate } };
    });

    const moneyTotal = (rows: typeof data.ledger, field: "debit" | "credit") =>
      rows.reduce((sum, row) => sum + row[field], 0);
    const summary = addTable(workbook, "Executive Summary",
      ["Indikator", "Nilai", "Status / catatan"],
      [
        ["IP disbursed", moneyTotal(data.ledger.filter((row) => row.movement_type === "disbursement"), "debit"), "Sumber transaction ledger"],
        ["IP realization", moneyTotal(data.ledger.filter((row) => row.movement_type === "expense" && row.source_type === "ip"), "credit"), "Hanya alokasi IP"],
        ["IR Operasional", moneyTotal(data.ledger.filter((row) => row.movement_type === "expense" && row.ir_type === "operasional"), "credit"), "Expense dihitung satu kali per alokasi sumber"],
        ["IR Facility", moneyTotal(data.ledger.filter((row) => row.movement_type === "expense" && row.ir_type === "facility"), "credit"), "Expense dihitung satu kali per alokasi sumber"],
        ["IP outstanding", data.balances.filter((row) => row.entity_type === "ip").reduce((sum, row) => sum + row.outstanding_amount, 0), "Saldo snapshot saat ini"],
        ["Personal receivable", data.balances.filter((row) => row.entity_type === "ir").reduce((sum, row) => sum + row.outstanding_amount, 0), "Tidak termasuk expense dari IP"],
        ["Reimbursement paid", moneyTotal(data.ledger.filter((row) => row.movement_type === "reimbursement_received"), "debit"), "Pembayaran terverifikasi pada ledger"],
      ],
      { moneyColumns: [2] },
    );
    summary.getColumn(1).width = 32;
    summary.getColumn(2).width = 24;
    summary.getColumn(3).width = 70;
    summary.getCell("E1").value = "VALIDATION WARNINGS";
    summary.getCell("E1").font = { bold: true, color: { argb: "FFFFFFFF" } };
    summary.getCell("E1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: navy } };
    summary.getColumn(5).width = 70;
    const warningMessages = data.warnings.length ? data.warnings : ["Tidak ada warning."];
    warningMessages.forEach((warning, index) => {
      summary.getCell(index + 2, 5).value = warning;
      summary.getCell(index + 2, 5).alignment = { wrapText: true, vertical: "top" };
      summary.getCell(index + 2, 5).font = { color: { argb: data.warnings.length ? "92400E" : "047857" }, size: 10 };
    });

    const ipIds = new Set(data.ips.map((row) => row.id));
    const irIds = new Set(data.irs.map((row) => row.id));
    const categoryById = new Map(data.categories.map((row) => [row.id, row.name]));
    const ipById = new Map(data.ips.map((row) => [row.id, row]));
    const irById = new Map(data.irs.map((row) => [row.id, row]));
    const ipSheet = addTable(workbook, "IP Register",
      ["No IP", "Kegiatan", "Tujuan", "Tanggal Pengajuan", "Tanggal Cair", "Anggaran", "Nilai Cair", "Realisasi Valid", "Dikembalikan", "Outstanding", "Target 10 HK", "Deadline 14 HK", "Status"],
      data.ips.map((row) => [
        row.reference_code ?? row.id, row.title, row.purpose, dateCell(row.requested_on), dateCell(row.disbursement_date),
        row.requested_amount, row.disbursed_amount, row.valid_realization, row.returned_amount,
        row.unsettled_balance, dateCell(row.target_settlement_date), dateCell(row.administrative_deadline), row.status,
      ]),
      { dateColumns: [4, 5, 11, 12], moneyColumns: [6, 7, 8, 9, 10], totalColumns: [6, 7, 8, 9, 10], statusColumn: 13 },
    );
    ipSheet.autoFilter = { from: "A1", to: `M${data.ips.length + 1}` };

    addTable(workbook, "IP Budget Items",
      ["No IP", "Item Anggaran", "Kategori", "Nominal Anggaran", "Status", "Catatan"],
      data.budgetItems.filter((row) => ipIds.has(row.ip_record_id)).map((row) => [
        ipById.get(row.ip_record_id)?.reference_code ?? row.ip_record_id,
        row.description, categoryById.get(row.category_id) ?? "Kategori tidak ditemukan",
        row.requested_amount, row.status, row.notes,
      ]),
      { moneyColumns: [4], totalColumns: [4], statusColumn: 5 },
    );

    const ipRealizations = data.ledger.filter((row) =>
      row.movement_type === "expense" && row.source_type === "ip",
    );
    const recognizedIPExpenseIds = new Set(ipRealizations.flatMap((row) => row.related_expense_id ?? []));
    const pendingIPExpenses = data.expenses.filter((expense) =>
      expense.ip_record_id && !recognizedIPExpenseIds.has(expense.id),
    );
    addTable(workbook, "IP Realization",
      ["Tanggal", "No IP", "No IR terkait", "Kategori", "Deskripsi", "Sumber Dana", "Nominal Dilaporkan", "Nominal Valid di Ledger", "Evidence", "Usage Status", "Expense Status"],
      [
        ...ipRealizations.map((row) => {
          const expense = data.expenses.find((item) => item.id === row.related_expense_id);
          return [
        dateCell(row.transaction_date), row.related_ip_reference ?? reportReference(data, row.related_ip_id),
        row.related_ir_reference ?? "—", row.category_name ?? "—", row.description,
            row.funding_source, row.credit, row.credit,
            row.evidence_reference ?? "Belum ada evidence",
            expense?.ip_usage_status ?? "verified", expense?.status ?? row.record_status ?? "—",
          ];
        }),
        ...pendingIPExpenses.map((expense) => [
          dateCell(expense.expense_date),
          ipById.get(expense.ip_record_id!)?.reference_code ?? expense.ip_record_id,
          expense.related_ir_record_id
            ? irById.get(expense.related_ir_record_id)?.reference_code ?? expense.related_ir_record_id
            : "—",
          categoryById.get(expense.category_id) ?? "—",
          expense.description,
          "IP - belum diposting ke ledger",
          expense.amount,
          0,
          data.evidence.filter((file) => file.expense_id === expense.id).map((file) => file.original_file_name).join(", ") || "BELUM ADA",
          expense.ip_usage_status,
          expense.status,
        ]),
      ],
      { dateColumns: [1], moneyColumns: [7, 8], totalColumns: [7, 8], statusColumn: 10 },
    );

    addTable(workbook, "IP Settlement",
      ["No IP", "Tanggal Settlement", "Nominal Pengeluaran", "Nominal Kembali", "Metode", "Referensi", "Status", "Catatan", "Evidence"],
      data.settlements.filter((row) => ipIds.has(row.ip_record_id)).map((row) => [
        ipById.get(row.ip_record_id)?.reference_code ?? row.ip_record_id, dateCell(row.settlement_date),
        row.amount_spent, row.amount_returned, row.return_method, row.reference_code, row.status,
        row.notes, data.evidence.filter((file) => file.settlement_id === row.id).map((file) => file.original_file_name).join(", ") || "Belum ada evidence",
      ]),
      { dateColumns: [2], moneyColumns: [3, 4], totalColumns: [3, 4], statusColumn: 7 },
    );

    for (const [sheetName, irType] of [["IR Operasional", "operasional"], ["IR Facility", "facility"]] as const) {
      const selectedIRs = data.irs.filter((row) => row.ir_type === irType && irIds.has(row.id));
      const transactionById = new Map(data.irTransactions.map((transaction) => [transaction.id, transaction]));
      const irExpenseRows: RowValue[][] = [];
      for (const ir of selectedIRs) {
        const irTransactions = data.irTransactions.filter((transaction) => transaction.ir_record_id === ir.id);
        const irExpenses = data.expenses.filter((expense) =>
          expense.ir_transaction_id && irTransactions.some((transaction) => transaction.id === expense.ir_transaction_id),
        );
        const expenseRows = irExpenses.length ? irExpenses : [null];
        for (const [expenseIndex, expense] of expenseRows.entries()) {
          const transaction = expense?.ir_transaction_id ? transactionById.get(expense.ir_transaction_id) : null;
          const expenseAllocations = expense
            ? data.allocations.filter((allocation) => allocation.expense_id === expense.id && allocation.status === "active")
            : [];
          const personal = expense?.status === "posted"
            ? expenseAllocations.filter((allocation) => allocation.source_type === "personal").reduce((sum, allocation) => sum + allocation.amount, 0)
            : 0;
          const fromIP = expense?.status === "posted"
            ? expenseAllocations.filter((allocation) => allocation.source_type === "ip").reduce((sum, allocation) => sum + allocation.amount, 0)
            : 0;
          const paid = data.payments.filter((payment) => payment.ir_record_id === ir.id && payment.status === "paid")
            .reduce((sum, payment) => sum + payment.amount, 0);
          irExpenseRows.push([
            ir.reference_code ?? ir.id, dateCell(ir.submitted_on), ir.pic_name, ir.title,
            dateCell(expense?.expense_date), expense?.description ?? "Belum ada expense",
            expense ? categoryById.get(expense.category_id) ?? "Kategori tidak ditemukan" : "—",
            expense?.amount ?? 0, expense?.status === "posted" ? expense.amount : 0,
            personal, fromIP,
            expense ? data.evidence.filter((file) => file.expense_id === expense.id).map((file) => file.original_file_name).join(", ") || "BELUM ADA" : "—",
            expense?.status === "posted" && !data.evidence.some((file) => file.expense_id === expense.id) ? "missing evidence" : "—",
            expense?.ip_usage_status ?? "—", expense?.status ?? "—",
            ir.ptjb_status, expenseIndex === 0 ? paid : null,
            expenseIndex === 0 ? ir.outstanding_amount : null, ir.status,
            transaction?.description ?? "—",
          ]);
        }
      }
      addTable(workbook, sheetName,
        ["No IR", "Tanggal Pengajuan", "PIC", "Tujuan", "Tanggal Transaksi", "Deskripsi Expense", "Kategori", "Nominal", "Diakui", "Dana Personal", "Dana IP", "Evidence", "Evidence Status", "IP Usage Status", "Expense Status", "PTJB Status", "Paid (snapshot)", "Outstanding (snapshot)", "IR Status", "Deskripsi Transaksi"],
        irExpenseRows,
        { dateColumns: [2, 5], moneyColumns: [8, 9, 10, 11, 17, 18], totalColumns: [9, 10, 11], statusColumn: 15 },
      );
    }

    addTable(workbook, "Transaction Ledger",
      ["Transaction ID", "Tanggal", "Referensi", "Deskripsi", "Debit", "Credit", "Sumber", "Jenis", "No IP", "No IR", "Kategori", "Status", "Evidence", "Alasan Koreksi"],
      data.ledger.map((row) => [
        row.transaction_id, dateCell(row.transaction_date), row.reference, row.description, row.debit, row.credit,
        row.funding_source, row.movement_type, row.related_ip_reference, row.related_ir_reference,
        row.category_name, row.record_status, row.evidence_reference ?? "Belum ada evidence",
        row.correction_reason,
      ]),
      { dateColumns: [2], moneyColumns: [5, 6], totalColumns: [5, 6], statusColumn: 12 },
    );

    addTable(workbook, "Balance Reconciliation",
      ["Jenis", "Referensi", "Deskripsi", "Tanggal Aktivitas", "Principal", "Realisasi / Personal", "Return / Paid", "Saldo", "Outstanding", "Status", "Keterangan"],
      data.balances.map((row) => [
        row.entity_type === "ip" ? "IP" : row.entity_subtype === "facility" ? "IR Facility" : "IR Operasional",
        row.reference_code, row.description, dateCell(row.activity_date), row.principal_amount,
        row.entity_type === "ip" ? row.realized_amount : row.personal_funded_amount,
        row.entity_type === "ip" ? row.returned_amount : row.reimbursement_paid_amount,
        row.balance_amount, row.outstanding_amount, row.reconciliation_status, row.discrepancy_detail,
      ]),
      { dateColumns: [4], moneyColumns: [5, 6, 7, 8, 9], totalColumns: [5, 6, 7, 8, 9], statusColumn: 10 },
    );

    const reimbursementRows: RowValue[][] = [];
    for (const ir of data.irs) {
      reimbursementRows.push([
        ir.reference_code ?? ir.id, "Piutang Personal", dateCell(ir.submitted_on),
        ir.personal_amount, ir.paid_amount, ir.outstanding_amount, ir.ptjb_status, ir.payment_status,
      ]);
    }
    for (const payment of data.payments) {
      reimbursementRows.push([
        irById.get(payment.ir_record_id)?.reference_code ?? payment.ir_record_id,
        payment.reference_code ?? "Pembayaran",
        dateCell(payment.payment_date),
        0, payment.status === "paid" ? payment.amount : 0, null,
        irById.get(payment.ir_record_id)?.ptjb_status ?? "—", payment.status,
      ]);
    }
    addTable(workbook, "Reimbursement Tracking",
      ["No IR", "Jenis Catatan", "Tanggal", "Piutang", "Dibayar", "Outstanding", "PTJB Status", "Payment Status"],
      reimbursementRows,
      { dateColumns: [3], moneyColumns: [4, 5, 6], totalColumns: [4, 5, 6], statusColumn: 8 },
    );

    const evidenceIndex = addTable(workbook, "Evidence Index",
      ["Evidence Ref", "File Asli", "Kategori", "Jenis MIME", "Tanggal Upload", "Parent Type", "Referensi Transaksi", "Deskripsi", "Ukuran (byte)", "Preview"],
      data.evidence.map((file, index) => [
        `EV-${String(index + 1).padStart(5, "0")}`, file.original_file_name, file.evidence_category,
        file.mime_type, new Date(file.uploaded_at), file.parent_type,
        file.parent_reference ?? file.parent_id, file.parent_description,
        file.file_size_bytes, file.base64 ? "Gambar tertanam di baris" : file.mime_type === "application/pdf" ? "PDF terdaftar" : "Tidak tersedia",
      ]),
      { dateColumns: [5] },
    );
    evidenceIndex.getColumn(10).width = 30;
    const evidencePhotos = workbook.addWorksheet("Evidence Photos");
    evidencePhotos.views = [{ state: "frozen", ySplit: 1, topLeftCell: "A2" }];
    evidencePhotos.addRow(["Evidence Ref", "File Asli", "Kategori", "Tanggal Upload", "Referensi Transaksi", "Foto"]);
    evidencePhotos.getRow(1).height = 28;
    evidencePhotos.getRow(1).eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: navy } };
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    });
    const photoRows = data.evidence.filter((file) =>
      file.base64 && (file.mime_type === "image/jpeg" || file.mime_type === "image/png"),
    );
    for (const [index, file] of photoRows.entries()) {
      const rowNumber = index + 2;
      evidencePhotos.addRow([
        `EV-${String(data.evidence.indexOf(file) + 1).padStart(5, "0")}`,
        file.original_file_name, file.evidence_category, new Date(file.uploaded_at),
        file.parent_reference ?? file.parent_id, "Foto tertanam",
      ]);
      evidencePhotos.getRow(rowNumber).height = 86;
      const imageId = workbook.addImage({
        base64: `data:${file.mime_type};base64,${file.base64}`,
        extension: file.mime_type === "image/png" ? "png" : "jpeg",
      });
      evidencePhotos.addImage(imageId, {
        tl: { col: 5, row: rowNumber - 1 },
        ext: { width: 130, height: 78 },
      });
    }
    evidencePhotos.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(photoRows.length + 1, 1), column: 6 },
    };
    [16, 34, 28, 20, 32, 24].forEach((width, index) => { evidencePhotos.getColumn(index + 1).width = width; });
    evidencePhotos.getColumn(4).numFmt = dateFormat;

    const bytes = await workbook.xlsx.writeBuffer();
    const filename = `FAAMS-Report-${filters.from ?? "all"}-${filters.to ?? "period"}.xlsx`;
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Could not export FAAMS Excel report.", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Excel report gagal dibuat." },
      { status: 400 },
    );
  }
}
