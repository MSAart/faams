import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getIPApplicationExportData } from "@/lib/ip-application-export";
import { verifyIPRecordOwnerOrAdmin } from "@/lib/report-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const navy = "17304F";
const line = "A8B1BC";
const moneyFormat = '"Rp" #,##0.00;[Red]-"Rp" #,##0.00';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function formatDate(value: string | null) {
  return value
    ? new Date(`${value.slice(0, 10)}T00:00:00.000Z`)
    : null;
}

function setBorder(cell: ExcelJS.Cell, style: "thin" | "medium" = "thin") {
  cell.border = {
    top: { style, color: { argb: line } },
    bottom: { style, color: { argb: line } },
    left: { style, color: { argb: line } },
    right: { style, color: { argb: line } },
  };
}

function styleRange(sheet: ExcelJS.Worksheet, row: number, from: number, to: number, style: "thin" | "medium" = "thin") {
  for (let column = from; column <= to; column++) setBorder(sheet.getCell(row, column), style);
}

function merge(sheet: ExcelJS.Worksheet, row: number, from: number, to: number, value: ExcelJS.CellValue) {
  if (to > from) sheet.mergeCells(row, from, row, to);
  sheet.getCell(row, from).value = value;
}

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/internal-prepayment/[ipId]/export/excel">,
) {
  try {
    const { ipId } = await ctx.params;
    if (!uuidPattern.test(ipId)) return NextResponse.json({ error: "ID IP tidak valid." }, { status: 400 });
    const supabase = await createSupabaseServerClient();
    if (!await verifyIPRecordOwnerOrAdmin(supabase, ipId)) {
      return NextResponse.json({ error: "Akses ke dokumen IP ini ditolak." }, { status: 403 });
    }
    const data = await getIPApplicationExportData(supabase, ipId);
    if (!data) return NextResponse.json({ error: "Pengajuan IP tidak ditemukan." }, { status: 404 });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "FAAMS";
    workbook.subject = `Form Pengajuan ${data.record.reference_code ?? "IP"}`;
    workbook.title = "Form Pengajuan IP";
    const sheet = workbook.addWorksheet("Form Pengajuan IP", {
      pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    sheet.pageSetup.margins = { left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 };
    sheet.pageSetup.printArea = `A1:G${24 + data.items.length}`;
    [9, 17, 15, 15, 12, 17, 17].forEach((width, index) => {
      sheet.getColumn(index + 1).width = width;
    });

    merge(sheet, 1, 1, 7, "FORM PENGAJUAN IP");
    sheet.getRow(1).height = 27;
    const title = sheet.getCell("A1");
    title.font = { name: "Arial", size: 15, bold: true, color: { argb: "111827" } };
    title.alignment = { horizontal: "center", vertical: "middle" };
    styleRange(sheet, 1, 1, 7, "medium");

    merge(sheet, 2, 1, 7, `${data.record.reference_code ?? "IP"} — ${data.record.title}`);
    sheet.getRow(2).height = 22;
    sheet.getCell("A2").font = { name: "Arial", size: 10, bold: true };
    styleRange(sheet, 2, 1, 7);

    const details: Array<[number, string, ExcelJS.CellValue]> = [
      [3, "TANGGAL PENGAJUAN", formatDate(data.record.requested_on)],
      [4, "NAMA PROJECT", `${data.record.title}\n${data.record.purpose}`],
      [5, "TGL PEKERJAAN", formatDate(data.record.project_start_date)],
      [6, "SELESAI PEKERJAAN", formatDate(data.record.project_end_date)],
      [7, "LOKASI PROJECT", data.record.project_location ?? ""],
      [8, "DEPARTEMEN / AREA", data.record.department_area ?? ""],
      [9, "PIC", data.record.pic_name ?? ""],
    ];
    for (const [row, label, value] of details) {
      merge(sheet, row, 1, 2, label);
      merge(sheet, row, 3, 4, value);
      sheet.getCell(row, 1).font = { name: "Arial", size: 9, bold: true };
      sheet.getCell(row, 1).alignment = { vertical: "middle" };
      sheet.getCell(row, 3).font = { name: "Arial", size: 9, bold: row === 4 };
      sheet.getCell(row, 3).alignment = { vertical: "middle", wrapText: true };
      sheet.getRow(row).height = row === 4 ? 36 : 21;
      styleRange(sheet, row, 1, 4);
    }
    for (const [row, label] of [
      [6, data.settings.company_name],
      [7, data.settings.regional_name],
      [8, data.settings.department_name],
      [9, data.settings.area_name],
    ] as const) {
      merge(sheet, row, 5, 7, label);
      sheet.getCell(row, 5).font = { name: "Arial", size: 9, bold: true };
      sheet.getCell(row, 5).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      styleRange(sheet, row, 5, 7);
    }
    if (data.images.logo) {
      const imageId = workbook.addImage({
        base64: `data:${data.images.logo.mimeType};base64,${Buffer.from(data.images.logo.bytes).toString("base64")}`,
        extension: data.images.logo.mimeType === "image/png" ? "png" : "jpeg",
      });
      sheet.addImage(imageId, { tl: { col: 4.18, row: 2.15 }, ext: { width: 115, height: 58 }, editAs: "oneCell" });
    } else {
      merge(sheet, 3, 5, 7, data.settings.company_name || "LOGO ORGANISASI");
      sheet.getCell("E3").font = { name: "Arial", size: 12, bold: true, color: { argb: navy } };
      sheet.getCell("E3").alignment = { horizontal: "center", vertical: "middle" };
      sheet.getRow(3).height = 38;
    }

    const requestedRow = 10;
    const spentRow = 11;
    const balanceRow = 12;
    const spent = data.directRealizationAmount;
    const balance = data.directUnsettledBalance;
    for (const [row, label, amount] of [
      [requestedRow, "PERMOHONAN", data.record.requested_amount],
      [spentRow, "PEMAKAIAN", spent],
      [balanceRow, "SISA / KURANG", balance],
    ] as const) {
      merge(sheet, row, 1, 2, label);
      sheet.getCell(row, 3).value = "Rp";
      sheet.getCell(row, 4).value = amount;
      sheet.getCell(row, 1).font = { name: "Arial", size: 9, bold: true };
      sheet.getCell(row, 3).font = { name: "Arial", size: 9, bold: true };
      sheet.getCell(row, 4).numFmt = moneyFormat;
      sheet.getCell(row, 4).font = { name: "Arial", size: 9, bold: true };
      sheet.getCell(row, 4).alignment = { horizontal: "right", vertical: "middle" };
      sheet.getRow(row).height = 20;
      styleRange(sheet, row, 1, 4);
    }

    const headerRow = 14;
    const headers = ["NOMOR", "DESKRIPSI", "", "", "JUMLAH", "BIAYA", ""];
    headers.forEach((value, index) => {
      sheet.getCell(headerRow, index + 1).value = value;
      sheet.getCell(headerRow, index + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "F1F5F9" } };
      sheet.getCell(headerRow, index + 1).font = { name: "Arial", size: 9, bold: true };
      sheet.getCell(headerRow, index + 1).alignment = { horizontal: "center", vertical: "middle" };
    });
    sheet.mergeCells(headerRow, 2, headerRow, 4);
    sheet.mergeCells(headerRow, 6, headerRow, 7);
    sheet.getRow(headerRow).height = 24;
    styleRange(sheet, headerRow, 1, 7, "medium");

    data.items.forEach((item, index) => {
      const row = headerRow + index + 1;
      sheet.getCell(row, 1).value = index + 1;
      merge(sheet, row, 2, 4, item.description);
      sheet.getCell(row, 5).value = item.quantity;
      sheet.getCell(row, 6).value = item.unit_cost;
      sheet.mergeCells(row, 6, row, 7);
      sheet.getCell(row, 1).alignment = { horizontal: "center", vertical: "middle" };
      sheet.getCell(row, 2).alignment = { vertical: "middle", wrapText: true };
      sheet.getCell(row, 5).numFmt = "0.00";
      sheet.getCell(row, 5).alignment = { horizontal: "center", vertical: "middle" };
      sheet.getCell(row, 6).numFmt = moneyFormat;
      sheet.getCell(row, 6).alignment = { horizontal: "right", vertical: "middle" };
      sheet.getRow(row).height = 26;
      styleRange(sheet, row, 1, 7);
    });

    const totalRow = headerRow + data.items.length + 2;
    merge(sheet, totalRow, 5, 5, "Total");
    sheet.getCell(totalRow, 5).font = { name: "Arial", size: 9, bold: true };
    sheet.getCell(totalRow, 5).alignment = { horizontal: "center", vertical: "middle" };
    sheet.getCell(totalRow, 6).value = {
      formula: `SUMPRODUCT(E${headerRow + 1}:E${headerRow + data.items.length},F${headerRow + 1}:F${headerRow + data.items.length})`,
      result: data.items.reduce((sum, item) => sum + item.requested_amount, 0),
    };
    sheet.getCell(totalRow, 6).numFmt = moneyFormat;
    sheet.getCell(totalRow, 6).font = { name: "Arial", size: 9, bold: true };
    sheet.mergeCells(totalRow, 6, totalRow, 7);
    styleRange(sheet, totalRow, 5, 7);

    const signatureTop = totalRow + 2;
    merge(sheet, signatureTop, 1, 4, "Mengajukan");
    merge(sheet, signatureTop, 5, 7, "Menyetujui");
    merge(sheet, signatureTop + 1, 1, 4, data.settings.submitter_title);
    merge(sheet, signatureTop + 1, 5, 7, data.settings.approver_title);
    for (let row = signatureTop; row <= signatureTop + 4; row++) {
      styleRange(sheet, row, 1, 7);
      sheet.getRow(row).height = row === signatureTop + 2 ? 52 : 20;
    }
    const submitterSignature = data.images.submitterSignature;
    const approverSignature = data.images.approverSignature;
    for (const [signature, fromCol, width] of [
      [submitterSignature, 1.8, 80],
      [approverSignature, 4.3, (6.8 - 4.3) * 55],
    ] as const) {
      if (!signature) continue;
      const imageId = workbook.addImage({
        base64: `data:${signature.mimeType};base64,${Buffer.from(signature.bytes).toString("base64")}`,
        extension: signature.mimeType === "image/png" ? "png" : "jpeg",
      });
      sheet.addImage(imageId, {
        tl: { col: fromCol, row: signatureTop + 1.15 },
        ext: { width, height: 45 },
        editAs: "oneCell",
      });
    }
    merge(sheet, signatureTop + 3, 1, 4, data.settings.submitter_name);
    merge(sheet, signatureTop + 3, 5, 7, data.settings.approver_name);
    merge(sheet, signatureTop + 4, 1, 4, data.settings.submitter_employee_id);
    merge(sheet, signatureTop + 4, 5, 7, data.settings.approver_employee_id);
    for (const row of [signatureTop, signatureTop + 1, signatureTop + 3, signatureTop + 4]) {
      for (let col = 1; col <= 7; col++) {
        sheet.getCell(row, col).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      }
    }
    sheet.views = [{ state: "frozen", ySplit: headerRow }];
    const filenameRef = (data.record.reference_code ?? "IP").replace(/[^a-zA-Z0-9_-]/g, "-");
    const bytes = await workbook.xlsx.writeBuffer();
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Form-Pengajuan-${filenameRef}.xlsx"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Could not export IP application form to Excel.", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Export Excel pengajuan IP gagal." },
      { status: 400 },
    );
  }
}
