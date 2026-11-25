import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getIRDetailExportData } from "@/lib/ir-detail-export";
import { verifyIRRecordOwnerOrAdmin } from "@/lib/report-auth";
import { createExportFilename } from "@/lib/export-filename";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const navy = "17304F";
const line = "A8B1BC";
const moneyFormat = '#,##0.##;[Red]-#,##0.##;"—"';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function formatDate(value: string | null) {
  return value ? new Date(`${value.slice(0, 10)}T00:00:00.000Z`) : null;
}

function setBorder(cell: ExcelJS.Cell) {
  cell.border = {
    top: { style: "thin", color: { argb: line } },
    bottom: { style: "thin", color: { argb: line } },
    left: { style: "thin", color: { argb: line } },
    right: { style: "thin", color: { argb: line } },
  };
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ irId: string }> },
) {
  try {
    const { irId } = await ctx.params;
    if (!uuidPattern.test(irId)) return NextResponse.json({ error: "ID IR tidak valid." }, { status: 400 });
    const irType = new URL(request.url).searchParams.get("type");
    if (irType !== "operasional" && irType !== "facility") {
      return NextResponse.json({ error: "Jenis IR tidak valid." }, { status: 400 });
    }

    const supabase = await createSupabaseServerClient();
    if (!await verifyIRRecordOwnerOrAdmin(supabase, irId)) {
      return NextResponse.json({ error: "Akses ke dokumen IR ini ditolak." }, { status: 403 });
    }
    const data = await getIRDetailExportData(supabase, irId, irType);
    if (!data) return NextResponse.json({ error: "IR tidak ditemukan." }, { status: 404 });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "FAAMS";
    workbook.subject = `Rincian ${data.record.reference_code ?? "IR"}`;
    workbook.title = "Rincian Internal Reimbursement";
    const sheet = workbook.addWorksheet(
      irType === "operasional" ? "IR Operasional" : "IR Facility",
      {
        pageSetup: {
          paperSize: 9,
          orientation: "landscape",
          fitToPage: true,
          fitToWidth: 1,
          fitToHeight: 0,
        },
      },
    );
    sheet.pageSetup.margins = { left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 };
    [17, 74, 20, 20, 20].forEach((width, index) => {
      sheet.getColumn(index + 1).width = width;
    });

    const title = irType === "operasional"
      ? "LAPORAN REIMBURSEMENT INTERNAL OPERASIONAL"
      : "LAPORAN REIMBURSEMENT INTERNAL FACILITY MANAGEMENT";
    sheet.mergeCells("A1:E1");
    sheet.getCell("A1").value = title;
    sheet.getCell("A1").font = { name: "Arial", size: 15, bold: true, color: { argb: navy } };
    sheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
    sheet.getRow(1).height = 30;
    sheet.mergeCells("A2:E2");
    sheet.getCell("A2").value = `${data.record.reference_code ?? "IR"} — ${data.record.title}`;
    sheet.getCell("A2").font = { name: "Arial", size: 10, bold: true };
    sheet.getCell("A2").alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    sheet.getRow(2).height = 25;

    const metadata: Array<[string, ExcelJS.CellValue]> = [
      ["No. IR", data.record.reference_code ?? "—"],
      ["Keperluan", data.record.purpose],
      ["Pelaksana / PIC", data.record.pic_name ?? "—"],
    ];
    metadata.forEach(([label, value], index) => {
      const row = index + 3;
      sheet.getCell(row, 1).value = label;
      sheet.mergeCells(row, 2, row, 5);
      sheet.getCell(row, 2).value = value;
      sheet.getCell(row, 1).font = { name: "Arial", size: 9, bold: true };
      sheet.getCell(row, 2).font = { name: "Arial", size: 9 };
      sheet.getCell(row, 1).alignment = { vertical: "middle" };
      sheet.getCell(row, 2).alignment = { wrapText: true, vertical: "middle" };
      sheet.getRow(row).height = label === "Keperluan" ? 27 : 21;
      for (let column = 1; column <= 5; column++) setBorder(sheet.getCell(row, column));
    });

    sheet.mergeCells("A6:E6");
    sheet.getCell("A6").value = "Total berjalan menunjukkan akumulasi pengeluaran terverifikasi.";
    sheet.getCell("A6").font = { name: "Arial", size: 9, italic: true, color: { argb: "64748B" } };
    sheet.getCell("A6").alignment = { horizontal: "center", vertical: "middle" };

    const headerRow = 8;
    const headers = ["Tanggal", "Keterangan", "Debit", "Kredit", "Total"];
    headers.forEach((value, index) => {
      const cell = sheet.getCell(headerRow, index + 1);
      cell.value = value;
      cell.font = { name: "Arial", size: 9, bold: true, color: { argb: navy } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "EAF1F9" } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = {
        top: { style: "medium", color: { argb: line } },
        bottom: { style: "medium", color: { argb: line } },
        left: { style: "thin", color: { argb: line } },
        right: { style: "thin", color: { argb: line } },
      };
    });
    sheet.getRow(headerRow).height = 25;

    const expenses = data.transactions.flatMap((transaction) =>
      transaction.expenses.map((expense) => ({ transaction, expense })),
    ).sort((left, right) =>
      left.expense.date.localeCompare(right.expense.date) ||
      left.expense.id.localeCompare(right.expense.id),
    );
    let balance = 0;
    let totalDebit = 0;
    expenses.forEach(({ transaction, expense }, index) => {
      const row = headerRow + index + 1;
      const active = expense.status === "posted" && transaction.status === "active";
      const personalAmount = active
        ? expense.allocations.filter((allocation) => allocation.sourceType === "personal").reduce((sum, allocation) => sum + allocation.amount, 0)
        : 0;
      const ipAmount = active
        ? expense.allocations.filter((allocation) => allocation.sourceType === "ip").reduce((sum, allocation) => sum + allocation.amount, 0)
        : 0;
      const allocated = personalAmount + ipAmount;
      const sourceDescription = expense.allocations.map((allocation) =>
        allocation.sourceType === "personal"
          ? `Personal ${new Intl.NumberFormat("id-ID").format(allocation.amount)}`
          : `IP ${allocation.ipReference ?? "tanpa nomor"} ${new Intl.NumberFormat("id-ID").format(allocation.amount)}`,
      ).join(" · ") || "Belum dialokasikan";
      const notes = [
        expense.category,
        expense.paymentMethod ? `Metode ${expense.paymentMethod}` : "",
        `Sumber dana: ${sourceDescription}`,
        !active ? "VOID — tidak dihitung" : "",
        active && Math.round(allocated * 100) !== Math.round(expense.amount * 100)
          ? `Alokasi berbeda Rp ${new Intl.NumberFormat("id-ID").format(expense.amount - allocated)}`
          : "",
        expense.ipUsageStatus === "pending_review" ? "Perlu verifikasi" : "",
        expense.ipUsageStatus === "linked_ir" ? "Terkait IR" : "",
        expense.evidence.length === 0 ? "Evidence belum tersedia" : "",
      ].filter(Boolean);
      const description = `${active ? "Pengeluaran · Realisasi" : "VOID · Realisasi"} — ${expense.description}${notes.length ? `\n${notes.join(" | ")}` : ""}`;
      const debit = active ? expense.amount : 0;
      balance += debit;
      totalDebit += debit;
      const values: ExcelJS.CellValue[] = [
        formatDate(expense.date),
        description,
        debit || "—",
        "—",
        balance,
      ];
      values.forEach((value, column) => {
        const cell = sheet.getCell(row, column + 1);
        cell.value = value;
        cell.font = { name: "Arial", size: 9, color: { argb: active ? "1F2937" : "64748B" } };
        cell.alignment = {
          vertical: "middle",
          wrapText: true,
          horizontal: column === 0 ? "center" : column > 1 ? "right" : "left",
        };
        setBorder(cell);
      });
      sheet.getCell(row, 1).numFmt = "dd/mm/yy";
      for (const column of [3, 4, 5]) sheet.getCell(row, column).numFmt = moneyFormat;
      sheet.getRow(row).height = Math.max(30, Math.min(60, 18 + notes.length * 9));
    });

    if (expenses.length === 0) {
      sheet.mergeCells(headerRow + 1, 1, headerRow + 1, 5);
      sheet.getCell(headerRow + 1, 1).value = "Belum ada transaksi pengeluaran.";
      sheet.getCell(headerRow + 1, 1).alignment = { horizontal: "center", vertical: "middle" };
      setBorder(sheet.getCell(headerRow + 1, 1));
      sheet.getRow(headerRow + 1).height = 30;
    }

    const totalRow = headerRow + Math.max(expenses.length, 1) + 1;
    const totalValues = ["—", "TOTAL", totalDebit, 0, balance];
    totalValues.forEach((value, index) => {
      sheet.getCell(totalRow, index + 1).value = value;
    });
    for (let column = 1; column <= 5; column++) {
      const cell = sheet.getCell(totalRow, column);
      cell.font = { name: "Arial", size: 9, bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "F1F5F9" } };
      cell.border = {
        top: { style: "medium", color: { argb: line } },
        bottom: { style: "medium", color: { argb: line } },
      };
    }
    sheet.getCell(totalRow, 2).alignment = { horizontal: "right", vertical: "middle" };
    if (totalDebit === 0) sheet.getCell(totalRow, 3).value = "—";
    sheet.getCell(totalRow, 4).value = "—";
    for (const column of [3, 4, 5]) {
      sheet.getCell(totalRow, column).numFmt = moneyFormat;
      sheet.getCell(totalRow, column).alignment = { horizontal: "right", vertical: "middle" };
    }
    sheet.getRow(totalRow).height = 25;

    const signatureRow = totalRow + 2;
    sheet.mergeCells(signatureRow, 4, signatureRow, 5);
    sheet.getCell(signatureRow, 4).value = "MELAPORKAN";
    sheet.getCell(signatureRow, 4).font = { name: "Arial", size: 9, bold: true, color: { argb: navy } };
    sheet.getCell(signatureRow, 4).alignment = { horizontal: "center", vertical: "middle" };
    sheet.getRow(signatureRow).height = 20;
    sheet.getRow(signatureRow + 1).height = 48;
    sheet.mergeCells(signatureRow + 2, 4, signatureRow + 2, 5);
    sheet.getCell(signatureRow + 2, 4).value = data.settings.submitter_name;
    sheet.getCell(signatureRow + 2, 4).font = { name: "Arial", size: 8, color: { argb: "334155" } };
    sheet.getCell(signatureRow + 2, 4).alignment = { horizontal: "center", vertical: "middle" };
    sheet.getRow(signatureRow + 2).height = 20;
    sheet.mergeCells(signatureRow + 3, 4, signatureRow + 3, 5);
    sheet.getCell(signatureRow + 3, 4).value = `NIK: ${data.settings.submitter_employee_id}`;
    sheet.getCell(signatureRow + 3, 4).font = { name: "Arial", size: 8, color: { argb: "334155" } };
    sheet.getCell(signatureRow + 3, 4).alignment = { horizontal: "center", vertical: "middle" };
    sheet.getRow(signatureRow + 3).height = 18;
    const signature = data.images.submitterSignature;
    if (signature) {
      const imageId = workbook.addImage({
        base64: `data:${signature.mimeType};base64,${Buffer.from(signature.bytes).toString("base64")}`,
        extension: signature.mimeType === "image/png" ? "png" : "jpeg",
      });
      sheet.addImage(imageId, {
        tl: { col: 3.65, row: signatureRow + 1.05 },
        ext: { width: 80, height: 38 },
        editAs: "oneCell",
      });
    }
    sheet.views = [{ state: "frozen", ySplit: headerRow }];
    sheet.autoFilter = {
      from: { row: headerRow, column: 1 },
      to: { row: headerRow + Math.max(expenses.length, 1), column: 5 },
    };
    const filename = createExportFilename("IR", data.record.title, data.record.submitted_on, "xlsx");
    const bytes = await workbook.xlsx.writeBuffer();
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": filename.contentDisposition,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Could not export IR details to Excel.", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Export Excel IR gagal." },
      { status: 500 },
    );
  }
}
