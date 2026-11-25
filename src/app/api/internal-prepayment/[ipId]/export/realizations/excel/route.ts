import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import {
  getIPRealizationExportData,
  toIPRealizationLedgerEntry,
} from "@/lib/ip-realization-export";
import { verifyIPRecordOwnerOrAdmin } from "@/lib/report-auth";
import { createExportFilename } from "@/lib/export-filename";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const moneyFormat = '"Rp" #,##0.00;[Red]-"Rp" #,##0.00';
const borderColor = "CBD5E1";

function dateValue(value: string) {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ ipId: string }> },
) {
  try {
    const { ipId } = await ctx.params;
    if (!uuidPattern.test(ipId)) {
      return NextResponse.json({ error: "ID IP tidak valid." }, { status: 400 });
    }

    const supabase = await createSupabaseServerClient();
    if (!await verifyIPRecordOwnerOrAdmin(supabase, ipId)) {
      return NextResponse.json({ error: "Akses ke dokumen IP ini ditolak." }, { status: 403 });
    }
    const data = await getIPRealizationExportData(supabase, ipId);
    if (!data) return NextResponse.json({ error: "Pengajuan IP tidak ditemukan." }, { status: 404 });

    const entries = data.movements
      .map(toIPRealizationLedgerEntry)
      .filter((entry) => entry !== null)
      .map((entry) => ({ ...entry, date: dateValue(entry.date) }));
    let balance = 0;
    const rows = entries.map((entry) => {
      balance += entry.credit - entry.debit;
      return { ...entry, balance };
    });
    const totalDebit = entries.reduce((sum, entry) => sum + entry.debit, 0);
    const totalCredit = entries.reduce((sum, entry) => sum + entry.credit, 0);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "FAAMS";
    workbook.subject = `Realisasi ${data.record.reference_code ?? "IP"}`;
    workbook.title = "Realisasi Internal Prepayment";
    const sheet = workbook.addWorksheet("Realisasi IP", {
      pageSetup: {
        paperSize: 9,
        orientation: "landscape",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
    });
    sheet.pageSetup.margins = {
      left: 0.3,
      right: 0.3,
      top: 0.45,
      bottom: 0.45,
      header: 0.15,
      footer: 0.15,
    };
    sheet.columns = [
      { header: "Tanggal", key: "date", width: 17 },
      { header: "Keterangan", key: "description", width: 66 },
      { header: "Debit", key: "debit", width: 20 },
      { header: "Kredit", key: "credit", width: 20 },
      { header: "Total", key: "balance", width: 20 },
    ];

    sheet.mergeCells("A1:E1");
    sheet.getCell("A1").value = "RINCIAN REALISASI INTERNAL PREPAYMENT";
    sheet.getCell("A1").font = { name: "Arial", size: 15, bold: true, color: { argb: "17304F" } };
    sheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
    sheet.getRow(1).height = 30;
    sheet.mergeCells("A2:E2");
    sheet.getCell("A2").value = `${data.record.reference_code ?? "IP"} — ${data.record.title}`;
    sheet.getCell("A2").font = { name: "Arial", size: 10, bold: true };
    sheet.getCell("A2").alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    sheet.getRow(2).height = 25;
    const metadata: Array<[string, string]> = [
      ["No. IP", data.record.reference_code ?? "—"],
      ["Keperluan", data.record.purpose],
      ["Pelaksana", data.record.pic_name ?? "—"],
    ];
    metadata.forEach(([label, value], index) => {
      const row = index + 3;
      sheet.getCell(row, 1).value = label;
      sheet.mergeCells(row, 2, row, 5);
      sheet.getCell(row, 2).value = value;
      sheet.getCell(row, 1).font = { name: "Arial", size: 9, bold: true };
      sheet.getCell(row, 2).font = { name: "Arial", size: 9 };
      sheet.getCell(row, 1).alignment = { vertical: "middle" };
      sheet.getCell(row, 2).alignment = { vertical: "middle", wrapText: true };
      sheet.getRow(row).height = label === "Keperluan" ? 27 : 21;
      for (let column = 1; column <= 5; column++) {
        sheet.getCell(row, column).border = {
          top: { style: "thin", color: { argb: borderColor } },
          bottom: { style: "thin", color: { argb: borderColor } },
          left: { style: "thin", color: { argb: borderColor } },
          right: { style: "thin", color: { argb: borderColor } },
        };
      }
    });
    sheet.mergeCells("A6:E6");
    sheet.getCell("A6").value = "Saldo berjalan dihitung dari Kredit dikurangi Debit.";
    sheet.getCell("A6").font = { name: "Arial", size: 9, italic: true, color: { argb: "64748B" } };
    sheet.getCell("A6").alignment = { horizontal: "center", vertical: "middle" };

    const headerRow = 8;
    sheet.getRow(headerRow).values = ["Tanggal", "Keterangan", "Debit", "Kredit", "Total"];
    sheet.getRow(headerRow).height = 25;
    sheet.getRow(headerRow).eachCell((cell) => {
      cell.font = { name: "Arial", size: 9, bold: true, color: { argb: "17304F" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "EAF1F9" } };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = {
        top: { style: "medium", color: { argb: borderColor } },
        bottom: { style: "medium", color: { argb: borderColor } },
        left: { style: "thin", color: { argb: borderColor } },
        right: { style: "thin", color: { argb: borderColor } },
      };
    });

    rows.forEach((entry) => {
      const row = sheet.addRow({
        date: entry.date,
        description: entry.description,
        debit: entry.debit || "",
        credit: entry.credit || "",
        balance: entry.balance,
      });
      row.height = 23;
      row.eachCell((cell, columnNumber) => {
        cell.font = { name: "Arial", size: 9, color: { argb: "1F2937" } };
        cell.alignment = {
          vertical: "middle",
          horizontal: columnNumber === 1 ? "center" : columnNumber > 2 ? "right" : "left",
          wrapText: true,
        };
        cell.border = {
          top: { style: "thin", color: { argb: borderColor } },
          bottom: { style: "thin", color: { argb: borderColor } },
          left: { style: "thin", color: { argb: borderColor } },
          right: { style: "thin", color: { argb: borderColor } },
        };
      });
      row.getCell(1).numFmt = "dd/mm/yy";
      for (const column of [3, 4, 5]) row.getCell(column).numFmt = moneyFormat;
    });

    if (rows.length === 0) {
      sheet.mergeCells("A6:E6");
      sheet.getCell("A6").value = "Belum ada transaksi realisasi.";
      sheet.getCell("A6").alignment = { horizontal: "center", vertical: "middle" };
    }
    const totalRow = sheet.addRow({
      date: "",
      description: "TOTAL",
      debit: totalDebit,
      credit: totalCredit,
      balance,
    });
    totalRow.height = 25;
    totalRow.eachCell((cell) => {
      cell.font = { name: "Arial", size: 9, bold: true, color: { argb: "17304F" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "F1F5F9" } };
      cell.border = {
        top: { style: "medium", color: { argb: borderColor } },
        bottom: { style: "medium", color: { argb: borderColor } },
      };
    });
    totalRow.getCell(2).alignment = { horizontal: "right", vertical: "middle" };
    for (const column of [3, 4, 5]) {
      totalRow.getCell(column).numFmt = moneyFormat;
      totalRow.getCell(column).alignment = { horizontal: "right", vertical: "middle" };
    }
    const signatureRow = totalRow.number + 2;
    sheet.mergeCells(signatureRow, 4, signatureRow, 5);
    sheet.getCell(signatureRow, 4).value = "MELAPORKAN";
    sheet.getCell(signatureRow, 4).font = { name: "Arial", size: 9, bold: true, color: { argb: "17304F" } };
    sheet.getCell(signatureRow, 4).alignment = { horizontal: "center", vertical: "middle" };
    sheet.getRow(signatureRow).height = 20;
    sheet.getRow(signatureRow + 1).height = 48;
    sheet.mergeCells(signatureRow + 2, 4, signatureRow + 2, 5);
    sheet.getCell(signatureRow + 2, 4).value = data.submitter.name;
    sheet.getCell(signatureRow + 2, 4).font = { name: "Arial", size: 8, color: { argb: "334155" } };
    sheet.getCell(signatureRow + 2, 4).alignment = { horizontal: "center", vertical: "middle" };
    sheet.getRow(signatureRow + 2).height = 20;
    sheet.mergeCells(signatureRow + 3, 4, signatureRow + 3, 5);
    sheet.getCell(signatureRow + 3, 4).value = `NIK: ${data.submitter.employeeId}`;
    sheet.getCell(signatureRow + 3, 4).font = { name: "Arial", size: 8, color: { argb: "334155" } };
    sheet.getCell(signatureRow + 3, 4).alignment = { horizontal: "center", vertical: "middle" };
    sheet.getRow(signatureRow + 3).height = 18;
    const image = data.images.submitterSignature;
    if (image) {
      const imageId = workbook.addImage({
        base64: `data:${image.mimeType};base64,${Buffer.from(image.bytes).toString("base64")}`,
        extension: image.mimeType === "image/png" ? "png" : "jpeg",
      });
      sheet.addImage(imageId, {
        tl: { col: 3.65, row: signatureRow + 1.05 },
        ext: {
          width: 80,
          height: 38,
        },
        editAs: "oneCell",
      });
    }
    sheet.autoFilter = {
      from: { row: headerRow, column: 1 },
      to: { row: headerRow, column: 5 },
    };
    sheet.views = [{ state: "frozen", ySplit: headerRow }];

    const bytes = await workbook.xlsx.writeBuffer();
    const filename = createExportFilename(
      "PTJB PUM",
      data.record.title,
      data.record.disbursement_date,
      "xlsx",
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": filename.contentDisposition,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Could not export IP realizations to Excel.", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Export Excel realisasi IP gagal." },
      { status: 400 },
    );
  }
}
