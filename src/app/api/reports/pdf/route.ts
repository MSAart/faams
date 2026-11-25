import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";
import { NextResponse } from "next/server";
import { getReportDataset, parseReportFilters, reportFiltersLabel, reportReference } from "@/lib/reports";
import { verifyReportAdministrator } from "@/lib/report-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pageWidth = 595.28;
const pageHeight = 841.89;
const left = 40;
const right = pageWidth - 40;
const navy = rgb(0.09, 0.19, 0.31);
const emerald = rgb(0.05, 0.46, 0.39);
const slate = rgb(0.28, 0.35, 0.43);
const muted = rgb(0.39, 0.45, 0.52);
const pale = rgb(0.94, 0.96, 0.98);
const amber = rgb(0.58, 0.35, 0.04);
const red = rgb(0.72, 0.12, 0.12);

function safeText(value: unknown) {
  return String(value ?? "—")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "—";
}

function money(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 2,
  }).format(value);
}

function date(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("id-ID", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${value.slice(0, 10)}T00:00:00.000Z`))
    : "—";
}

function wrapText(text: string, maxLength: number) {
  const words = safeText(text).split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxLength && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function reportTitle(scope: string) {
  return scope === "operasional"
    ? "IR OPERASIONAL"
    : scope === "facility"
      ? "IR FACILITY MANAGEMENT"
      : "SEMUA TRANSAKSI";
}

async function buildPdf(data: Awaited<ReturnType<typeof getReportDataset>>) {
  const document = await PDFDocument.create();
  document.setTitle("FAAMS Finance Administration Report");
  document.setAuthor("FAAMS");
  document.setSubject("Finance reporting");
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const pages: PDFPage[] = [];
  const pageSections = new Map<PDFPage, string>();
  let page = document.addPage([pageWidth, pageHeight]);
  pages.push(page);
  let firstPage = true;
  let cursorY = 0;
  let currentSection = "";

  const newPage = (section: string) => {
    if (firstPage) {
      firstPage = false;
    } else {
      page = document.addPage([pageWidth, pageHeight]);
      pages.push(page);
    }
    currentSection = section;
    pageSections.set(page, section);
    page.drawRectangle({
      x: 0, y: pageHeight - 8, width: pageWidth, height: 8, color: navy,
    });
    page.drawText("FAAMS  |  FINANCE ADMINISTRATION", {
      x: left, y: pageHeight - 30, size: 8, font: bold, color: muted,
    });
    page.drawText(safeText(section).toUpperCase(), {
      x: left, y: pageHeight - 59, size: 15, font: bold, color: navy,
    });
    page.drawLine({
      start: { x: left, y: pageHeight - 69 },
      end: { x: right, y: pageHeight - 69 },
      thickness: 0.8, color: pale,
    });
    cursorY = pageHeight - 88;
    return page;
  };

  const ensureSpace = (height: number) => {
    if (cursorY - height < 55) newPage(currentSection);
  };

  const drawText = (
    text: string,
    x: number,
    y: number,
    size = 9,
    font = regular,
    color = slate,
  ) => {
    page.drawText(safeText(text), { x, y, size, font, color, maxWidth: right - x });
  };

  const drawSectionTitle = (title: string) => {
    newPage(title);
  };

  const drawTable = (
    headers: string[],
    rows: string[][],
    widths: number[],
    options: { statusColumn?: number; compact?: boolean } = {},
  ) => {
    const tableWidth = right - left;
    const scale = tableWidth / widths.reduce((sum, width) => sum + width, 0);
    const columnWidths = widths.map((width) => width * scale);
    const headerHeight = 25;
    const drawHeader = () => {
      ensureSpace(headerHeight);
      page.drawRectangle({ x: left, y: cursorY - headerHeight, width: right - left, height: headerHeight, color: navy });
      let x = left + 6;
      headers.forEach((header, index) => {
        page.drawText(safeText(header), {
          x, y: cursorY - 16, size: 6.8, font: bold, color: rgb(1, 1, 1),
          maxWidth: columnWidths[index] - 8,
        });
        x += columnWidths[index];
      });
      cursorY -= headerHeight;
    };
    drawHeader();

    for (const values of rows) {
      const lineSets = values.map((value, index) => wrapText(value, Math.max(8, Math.floor((columnWidths[index] - 10) / 4.1))));
      const maxLines = Math.max(...lineSets.map((lines) => lines.length), 1);
      const rowHeight = Math.min(Math.max(maxLines * 10 + 7, options.compact ? 18 : 23), 56);
      if (cursorY - rowHeight < 55) {
        newPage(currentSection);
        drawHeader();
      }
      if (Math.floor(cursorY / rowHeight) % 2 === 0) {
        page.drawRectangle({ x: left, y: cursorY - rowHeight, width: right - left, height: rowHeight, color: pale });
      }
      if (options.statusColumn !== undefined) {
        const status = (values[options.statusColumn] ?? "").toLowerCase();
        const tone = status.includes("discrepancy") || status.includes("over budget") || status.includes("pending")
          ? rgb(1, 0.91, 0.91)
          : status.includes("outstanding") || status.includes("unverified") || status.includes("incomplete")
            ? rgb(1, 0.96, 0.84)
            : null;
        if (tone) {
          let startX = left;
          for (let column = 0; column < options.statusColumn; column++) startX += columnWidths[column];
          page.drawRectangle({ x: startX, y: cursorY - rowHeight, width: columnWidths[options.statusColumn], height: rowHeight, color: tone });
        }
      }
      let x = left + 6;
      lineSets.forEach((lines, index) => {
        const maxLinesForCell = Math.max(1, Math.floor((rowHeight - 6) / 10));
        lines.slice(0, maxLinesForCell).forEach((line, lineIndex) => {
          page.drawText(safeText(line), {
            x, y: cursorY - 12 - lineIndex * 10, size: 7.2, font: regular, color: slate,
            maxWidth: columnWidths[index] - 9,
          });
        });
        x += columnWidths[index];
      });
      cursorY -= rowHeight;
      page.drawLine({
        start: { x: left, y: cursorY },
        end: { x: right, y: cursorY },
        thickness: 0.25, color: rgb(0.86, 0.89, 0.92),
      });
    }
    cursorY -= 14;
  };

  const addSummaryLines = (rows: Array<[string, string, string]>) => {
    for (const [label, value, note] of rows) {
      ensureSpace(32);
      page.drawText(safeText(label), { x: left + 8, y: cursorY - 13, size: 9, font: bold, color: slate });
      page.drawText(safeText(value), { x: 260, y: cursorY - 13, size: 9, font: bold, color: navy });
      page.drawText(safeText(note), { x: 390, y: cursorY - 13, size: 7.4, font: regular, color: muted, maxWidth: right - 398 });
      page.drawLine({ start: { x: left, y: cursorY - 22 }, end: { x: right, y: cursorY - 22 }, thickness: 0.3, color: pale });
      cursorY -= 29;
    }
  };

  newPage("Cover");
  page.drawRectangle({ x: left, y: pageHeight - 285, width: 5, height: 155, color: emerald });
  page.drawText("FAAMS", { x: left + 22, y: pageHeight - 185, size: 35, font: bold, color: navy });
  page.drawText("FINANCE ADMINISTRATION & ACCOUNTABILITY", {
    x: left + 22, y: pageHeight - 216, size: 13, font: bold, color: slate,
  });
  page.drawText(`${reportTitle(data.filters.scope)} REPORT`, {
    x: left + 22, y: pageHeight - 246, size: 11, font: bold, color: emerald,
  });
  page.drawText(`Periode: ${reportFiltersLabel(data.filters)}`, {
    x: left + 22, y: pageHeight - 340, size: 11, font: regular, color: slate,
  });
  page.drawText(`Dibuat: ${new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(data.generatedAt))}`, {
    x: left + 22, y: pageHeight - 363, size: 9, font: regular, color: muted,
  });
  page.drawText("Dokumen internal - hanya untuk administrator yang berwenang.", {
    x: left + 22, y: pageHeight - 392, size: 8, font: regular, color: muted,
  });

  drawSectionTitle("Executive Summary");
  const ipDisbursed = data.ledger.filter((row) => row.movement_type === "disbursement").reduce((sum, row) => sum + row.debit, 0);
  const ipRealized = data.ledger.filter((row) => row.movement_type === "expense" && row.source_type === "ip").reduce((sum, row) => sum + row.credit, 0);
  const ops = data.ledger.filter((row) => row.movement_type === "expense" && row.ir_type === "operasional").reduce((sum, row) => sum + row.credit, 0);
  const facility = data.ledger.filter((row) => row.movement_type === "expense" && row.ir_type === "facility").reduce((sum, row) => sum + row.credit, 0);
  const paid = data.ledger.filter((row) => row.movement_type === "reimbursement_received").reduce((sum, row) => sum + row.debit, 0);
  const ipOutstanding = data.balances.filter((row) => row.entity_type === "ip").reduce((sum, row) => sum + row.outstanding_amount, 0);
  const personalReceivable = data.balances.filter((row) => row.entity_type === "ir").reduce((sum, row) => sum + row.outstanding_amount, 0);
  addSummaryLines([
    ["Total IP Disbursed", money(ipDisbursed), `${data.ledger.filter((row) => row.movement_type === "disbursement").length} ledger entries`],
    ["Total IP Realization", money(ipRealized), "Alokasi sumber IP"],
    ["IP Outstanding", money(ipOutstanding), "Saldo snapshot rekonsiliasi"],
    ["IR Operasional", money(ops), "Expense periode"],
    ["IR Facility", money(facility), "Expense periode"],
    ["Personal Receivable", money(personalReceivable), "Saldo piutang personal"],
    ["Reimbursement Paid", money(paid), "Arus masuk personal"],
    ["Evidence terlampir", String(data.evidence.length), `${data.evidence.filter((file) => !file.expense_id && !file.ip_record_id && !file.ir_record_id && !file.settlement_id && !file.reimbursement_payment_id).length} file belum berelasi`],
  ]);
  if (data.warnings.length) {
    ensureSpace(30);
    drawText("PERHATIAN: laporan mengandung temuan yang harus ditindaklanjuti.", left, cursorY - 12, 9, bold, amber);
    cursorY -= 25;
    for (const warning of data.warnings) {
      ensureSpace(18);
      drawText(`- ${warning}`, left + 8, cursorY - 10, 8, regular, red);
      cursorY -= 16;
    }
  }

  drawSectionTitle("IP Summary");
  drawTable(
    ["No IP", "Kegiatan", "Cair", "Realisasi", "Kembali", "Outstanding", "Target 10 HK", "Deadline 14 HK", "Status"],
    data.ips.map((ip) => [
      ip.reference_code ?? ip.id, ip.title, money(ip.disbursed_amount), money(ip.valid_realization),
      money(ip.returned_amount), money(ip.unsettled_balance), date(ip.target_settlement_date),
      date(ip.administrative_deadline), ip.status,
    ]),
    [61, 110, 56, 61, 52, 65, 53, 53, 64],
    { statusColumn: 8, compact: true },
  );

  drawSectionTitle("Detail IP");
  const budgetByIP = new Map<string, typeof data.budgetItems>();
  for (const item of data.budgetItems) budgetByIP.set(item.ip_record_id, [...(budgetByIP.get(item.ip_record_id) ?? []), item]);
  const directExpenses = data.expenses.filter((expense) => expense.ip_record_id);
  for (const ip of data.ips) {
    ensureSpace(24);
    drawText(`${ip.reference_code ?? ip.id} - ${ip.title}`, left, cursorY - 12, 10, bold, navy);
    cursorY -= 22;
    const budget = budgetByIP.get(ip.id) ?? [];
    if (budget.length) {
      drawTable(
        ["Item Budget", "Kategori", "Anggaran"],
        budget.map((item) => [
          item.description,
          data.categories.find((category) => category.id === item.category_id)?.name ?? "—",
          money(item.requested_amount),
        ]),
        [282, 146, 127],
        { compact: true },
      );
    }
    const relatedExpenses = directExpenses.filter((expense) => expense.ip_record_id === ip.id);
    if (relatedExpenses.length) {
      drawTable(
        ["Tanggal", "Deskripsi", "Nominal", "Verifikasi", "Evidence"],
        relatedExpenses.map((expense) => [
          date(expense.expense_date), expense.description, money(expense.amount),
          expense.ip_usage_status,
          data.evidence.filter((file) => file.expense_id === expense.id).map((file) => file.original_file_name).join(", ") || "BELUM ADA",
        ]),
        [66, 166, 82, 91, 150],
        { statusColumn: 3, compact: true },
      );
    }
  }

  drawSectionTitle("IP Settlement");
  drawTable(
    ["No IP", "Tanggal", "Pengeluaran", "Kembali", "Metode", "Referensi", "Status", "Evidence"],
    data.settlements.map((settlement) => [
      reportReference(data, settlement.ip_record_id), date(settlement.settlement_date),
      money(settlement.amount_spent), money(settlement.amount_returned), settlement.return_method ?? "—",
      settlement.reference_code ?? "—", settlement.status,
      data.evidence.filter((file) => file.settlement_id === settlement.id).map((file) => file.original_file_name).join(", ") || "BELUM ADA",
    ]),
    [66, 55, 75, 65, 54, 80, 57, 123],
    { statusColumn: 6, compact: true },
  );

  for (const [section, type] of [["IR Operasional", "operasional"], ["IR Facility", "facility"]] as const) {
    drawSectionTitle(section);
    const irRows = data.irs.filter((ir) => ir.ir_type === type);
    drawTable(
      ["No IR", "Tanggal", "Tujuan", "Expense", "Personal", "IP", "Paid", "Outstanding", "PTJB", "Status"],
      irRows.map((ir) => {
        const transactionIds = new Set(data.irTransactions.filter((transaction) => transaction.ir_record_id === ir.id).map((transaction) => transaction.id));
        const expenseIds = new Set(data.expenses.filter((expense) => expense.ir_transaction_id && transactionIds.has(expense.ir_transaction_id)).map((expense) => expense.id));
        const postedExpenseIds = new Set(data.expenses
          .filter((expense) => expenseIds.has(expense.id) && expense.status === "posted")
          .map((expense) => expense.id));
        const allocations = data.allocations.filter((allocation) =>
          postedExpenseIds.has(allocation.expense_id) && allocation.status === "active",
        );
        const total = data.expenses.filter((expense) => expenseIds.has(expense.id) && expense.status === "posted").reduce((sum, expense) => sum + expense.amount, 0);
        const personal = allocations.filter((allocation) => allocation.source_type === "personal").reduce((sum, allocation) => sum + allocation.amount, 0);
        const fromIP = allocations.filter((allocation) => allocation.source_type === "ip").reduce((sum, allocation) => sum + allocation.amount, 0);
        return [
          ir.reference_code ?? ir.id, date(ir.submitted_on), ir.title, money(total), money(personal),
          money(fromIP),           money(data.payments.filter((payment) => payment.ir_record_id === ir.id && payment.status === "paid")
            .reduce((sum, payment) => sum + payment.amount, 0)),
          money(ir.outstanding_amount), ir.ptjb_status, ir.status,
        ];
      }),
      [67, 55, 99, 62, 59, 49, 55, 68, 61, 59],
      { statusColumn: 9, compact: true },
    );
    const transactions = data.expenses.filter((expense) =>
      expense.ir_transaction_id &&
      data.irTransactions.some((transaction) =>
        transaction.id === expense.ir_transaction_id && irRows.some((ir) => ir.id === transaction.ir_record_id),
      ),
    );
    if (transactions.length) {
      drawTable(
        ["Tanggal", "No IR", "Deskripsi", "Kategori", "Nominal", "Expense Status", "IP Usage", "Evidence"],
        transactions.map((expense) => {
          const transaction = data.irTransactions.find((item) => item.id === expense.ir_transaction_id);
          const ir = irRows.find((item) => item.id === transaction?.ir_record_id);
          return [
            date(expense.expense_date), ir?.reference_code ?? "—", expense.description,
            data.categories.find((category) => category.id === expense.category_id)?.name ?? "—",
            money(expense.amount), expense.status, expense.ip_usage_status,
            data.evidence.filter((file) => file.expense_id === expense.id).map((file) => file.original_file_name).join(", ") || "BELUM ADA",
          ];
        }),
        [50, 57, 98, 58, 50, 59, 64, 88],
        { statusColumn: 5, compact: true },
      );
    }
  }

  drawSectionTitle("Balance Report");
  drawTable(
    ["Jenis", "Referensi", "Deskripsi", "Principal", "Realisasi/Personal", "Return/Paid", "Saldo", "Outstanding", "Status", "Keterangan"],
    data.balances.map((row) => [
      row.entity_type === "ip" ? "IP" : row.entity_subtype === "facility" ? "IR Facility" : "IR Operasional",
      row.reference_code ?? "—", row.description, money(row.principal_amount),
      money(row.entity_type === "ip" ? row.realized_amount : row.personal_funded_amount),
      money(row.entity_type === "ip" ? row.returned_amount : row.reimbursement_paid_amount),
      money(row.balance_amount), money(row.outstanding_amount),
      row.reconciliation_status, row.discrepancy_detail ?? "—",
    ]),
    [59, 65, 85, 67, 70, 63, 64, 69, 70, 72],
    { statusColumn: 8, compact: true },
  );

  drawSectionTitle("Outstanding Report");
  const outstanding = data.balances.filter((row) => row.outstanding_amount > 0);
  drawTable(
    ["Jenis", "Referensi", "Deskripsi", "Outstanding", "Status", "Keterangan"],
    outstanding.map((row) => [
      row.entity_type === "ip" ? "IP" : row.entity_subtype === "facility" ? "IR Facility" : "IR Operasional",
      row.reference_code ?? "—", row.description, money(row.outstanding_amount),
      row.reconciliation_status, row.discrepancy_detail ?? "—",
    ]),
    [78, 80, 130, 85, 78, 101],
    { statusColumn: 4, compact: true },
  );

  drawSectionTitle("Evidence Appendix");
  const imageFiles = data.evidence.filter((file) =>
    file.base64 && (file.mime_type === "image/jpeg" || file.mime_type === "image/png"),
  );
  const pdfFiles = data.evidence.filter((file) => file.base64 && file.mime_type === "application/pdf");
  drawTable(
    ["Evidence Ref", "File", "Kategori", "Tanggal", "Transaksi", "Lampiran"],
    data.evidence.map((file, index) => [
      `EV-${String(index + 1).padStart(5, "0")}`, file.original_file_name,
      file.evidence_category, date(file.uploaded_at.slice(0, 10)),
      file.parent_reference ?? file.parent_description ?? "Belum berelasi",
      file.mime_type === "application/pdf" ? "PDF pages appended" : file.base64 ? "Image embedded" : "Metadata only",
    ]),
    [66, 117, 90, 60, 120, 99],
    { compact: true },
  );
  for (const [index, file] of imageFiles.entries()) {
    newPage("Evidence Appendix - Images");
    const evidenceIndex = data.evidence.indexOf(file) + 1;
    page.drawText(`EV-${String(evidenceIndex).padStart(5, "0")}  ${safeText(file.original_file_name)}`, {
      x: left, y: cursorY - 10, size: 11, font: bold, color: navy,
    });
    cursorY -= 27;
    drawText(`Kategori: ${file.evidence_category}`, left, cursorY - 8, 8);
    cursorY -= 15;
    drawText(`Transaksi: ${file.parent_reference ?? file.parent_description ?? "Belum berelasi"}`, left, cursorY - 8, 8);
    cursorY -= 24;
    const imageBytes = Uint8Array.from(Buffer.from(file.base64!, "base64"));
    const image = file.mime_type === "image/png"
      ? await document.embedPng(imageBytes)
      : await document.embedJpg(imageBytes);
    const dims = image.scale(Math.min(500 / image.width, 600 / image.height));
    page.drawImage(image, {
      x: (pageWidth - dims.width) / 2,
      y: Math.max(70, cursorY - dims.height),
      width: dims.width,
      height: dims.height,
    });
    if (index + 1 < imageFiles.length) cursorY = 60;
  }

  for (const file of pdfFiles) {
    const pdfBytes = Uint8Array.from(Buffer.from(file.base64!, "base64"));
    let source: PDFDocument;
    try {
      source = await PDFDocument.load(pdfBytes);
    } catch (error) {
      throw new Error(`PDF evidence ${file.original_file_name} tidak dapat dibaca: ${error instanceof Error ? error.message : "format tidak valid"}`);
    }
    newPage("Evidence Appendix - PDF");
    const evidenceIndex = data.evidence.indexOf(file) + 1;
    page.drawText(`EV-${String(evidenceIndex).padStart(5, "0")}  ${safeText(file.original_file_name)}`, {
      x: left, y: cursorY - 10, size: 11, font: bold, color: navy,
    });
    cursorY -= 26;
    drawText(`Kategori: ${file.evidence_category}`, left, cursorY - 8, 8);
    cursorY -= 15;
    drawText(`Transaksi: ${file.parent_reference ?? file.parent_description ?? "Belum berelasi"}`, left, cursorY - 8, 8);
    const copiedPages = await document.copyPages(source, source.getPageIndices());
    for (const copiedPage of copiedPages) {
      document.addPage(copiedPage);
      pages.push(copiedPage);
      pageSections.set(copiedPage, `Evidence PDF - ${file.original_file_name}`);
    }
  }

  pages.forEach((item, index) => {
    const { width, height } = item.getSize();
    const footerX = Math.min(left, width * 0.08);
    const footerRight = width - footerX;
    const footerY = Math.max(12, Math.min(38, height * 0.045));
    item.drawLine({
      start: { x: footerX, y: footerY },
      end: { x: footerRight, y: footerY },
      thickness: 0.5,
      color: pale,
    });
    item.drawText(`FAAMS  |  ${safeText(pageSections.get(item) ?? "Report")}`, {
      x: footerX, y: Math.max(2, footerY - 15), size: 7, font: regular, color: muted,
    });
    item.drawText(`Halaman ${index + 1} dari ${pages.length}`, {
      x: Math.max(footerX + 5, footerRight - 110), y: Math.max(2, footerY - 15), size: 7, font: regular, color: muted,
    });
  });

  return document.save();
}

export async function GET(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    if (!await verifyReportAdministrator(supabase)) {
      return NextResponse.json({ error: "Akses administrator diperlukan." }, { status: 403 });
    }
    const filters = parseReportFilters(new URL(request.url).searchParams);
    const dataset = await getReportDataset(supabase, filters, true);
    const bytes = await buildPdf(dataset);
    const filename = `FAAMS-Report-${filters.from ?? "all"}-${filters.to ?? "period"}.pdf`;
    const body = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(body).set(bytes);
    return new Response(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Could not export FAAMS PDF report.", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "PDF report gagal dibuat." },
      { status: 400 },
    );
  }
}
