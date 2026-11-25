import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";
import { NextResponse } from "next/server";
import { getIRDetailExportData, type IRExportEvidence } from "@/lib/ir-detail-export";
import { verifyIRRecordOwnerOrAdmin } from "@/lib/report-auth";
import { createExportFilename } from "@/lib/export-filename";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pageWidth = 841.89;
const pageHeight = 595.28;
const margin = 30;
const navy = rgb(0.09, 0.19, 0.31);
const text = rgb(0.08, 0.1, 0.13);
const muted = rgb(0.39, 0.45, 0.52);
const line = rgb(0.69, 0.72, 0.76);
const pale = rgb(0.94, 0.96, 0.98);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeText(value: unknown) {
  return String(value ?? "—")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "—";
}

function money(value: number) {
  return `Rp ${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(value)}`;
}

function ledgerMoney(value: number) {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(value);
}

type EvidenceGroup = "transfer" | "receipt" | "documentation";

function evidenceGroup(type: string): EvidenceGroup {
  if (type === "bank_transfer" || type === "transfer_proof") return "transfer";
  if (type === "receipt" || type === "purchase_receipt" || type === "invoice") return "receipt";
  return "documentation";
}

function evidenceGroupLabel(group: EvidenceGroup) {
  return {
    transfer: "BUKTI TRANSFER",
    receipt: "NOTA / INVOICE",
    documentation: "DOKUMENTASI PENDUKUNG",
  }[group];
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

function wrap(value: unknown, maxLength: number) {
  const words = safeText(value).split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawText(
  page: PDFPage,
  value: unknown,
  x: number,
  y: number,
  size: number,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  options: { maxWidth?: number; color?: ReturnType<typeof rgb>; align?: "left" | "center" | "right" } = {},
) {
  const content = safeText(value);
  const { width: currentPageWidth } = page.getSize();
  const maxWidth = options.maxWidth ?? currentPageWidth - margin - x;
  const width = font.widthOfTextAtSize(content, size);
  const drawX = options.align === "right"
    ? x + maxWidth - width
    : options.align === "center"
      ? x + (maxWidth - width) / 2
      : x;
  page.drawText(content, { x: drawX, y, size, font, color: options.color ?? text, maxWidth });
}

function drawCell(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  height: number,
  value: unknown,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  options: { bold?: boolean; align?: "left" | "center" | "right"; fill?: boolean; size?: number } = {},
) {
  page.drawRectangle({
    x, y, width, height,
    borderColor: line,
    borderWidth: 0.55,
    color: options.fill ? pale : rgb(1, 1, 1),
  });
  const lines = wrap(value, Math.max(8, Math.floor((width - 10) / 4.4)));
  const size = options.size ?? 7.5;
  const visibleLines = Math.min(lines.length, Math.max(1, Math.floor((height - 5) / (size + 2))));
  for (let index = 0; index < visibleLines; index++) {
    drawText(page, lines[index], x + 5, y + height - size - 4 - index * (size + 2), size, font, {
      maxWidth: width - 10,
      align: options.align,
    });
  }
}

async function buildPdf(
  data: Awaited<ReturnType<typeof getIRDetailExportData>> & {},
  irType: "operasional" | "facility",
) {
  const document = await PDFDocument.create();
  document.setTitle(`Laporan Internal Reimbursement ${data.record.reference_code ?? ""}`);
  document.setAuthor("FAAMS");
  document.setSubject("Rincian transaksi dan evidence Internal Reimbursement");
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const pages: PDFPage[] = [];
  const reportTitle = irType === "operasional"
    ? "LAPORAN REIMBURSEMENT INTERNAL OPERASIONAL"
    : "LAPORAN REIMBURSEMENT INTERNAL FACILITY MANAGEMENT";
  const addPage = () => {
    const page = document.addPage([pageWidth, pageHeight]);
    pages.push(page);
    return page;
  };
  const drawHeader = (page: PDFPage, continuation = false) => {
    const { width: currentPageWidth, height: currentPageHeight } = page.getSize();
    page.drawRectangle({ x: 0, y: currentPageHeight - 8, width: currentPageWidth, height: 8, color: navy });
    drawText(
      page,
      continuation ? `${reportTitle} - LANJUTAN` : reportTitle,
      margin,
      currentPageHeight - 31,
      12,
      bold,
      { color: navy, maxWidth: currentPageWidth - margin * 2 },
    );
    page.drawLine({
      start: { x: margin, y: currentPageHeight - 39 },
      end: { x: currentPageWidth - margin, y: currentPageHeight - 39 },
      thickness: 0.8,
      color: line,
    });
  };

  let page = addPage();
  drawHeader(page);
  drawText(page, data.settings.company_name || "FAAMS", margin, pageHeight - 55, 8, bold, { color: muted });
  drawText(page, `No. IR: ${data.record.reference_code ?? "—"}`, margin, pageHeight - 78, 9, bold);
  drawText(page, `Keperluan: ${data.record.purpose}`, margin, pageHeight - 94, 8.5, regular, { maxWidth: 550 });
  drawText(page, `Pelaksana / PIC: ${data.record.pic_name ?? "—"}`, margin, pageHeight - 110, 8.5, regular);
  const tableWidth = pageWidth - margin * 2;
  const widths = [70, tableWidth - 370, 100, 100, 100];
  const headers = ["TANGGAL", "KETERANGAN", "DEBIT", "KREDIT", "TOTAL"];
  const drawTableHeader = (target: PDFPage, top: number) => {
    let x = margin;
    headers.forEach((label, index) => {
      drawCell(target, x, top - 25, widths[index], 25, label, bold, { align: "center", fill: true, size: 8 });
      x += widths[index];
    });
    return top - 25;
  };
  let cursorY = drawTableHeader(page, pageHeight - 132);
  const expenseRows = data.transactions.flatMap((transaction) =>
    transaction.expenses.map((expense) => ({ transaction, expense })),
  ).sort((left, right) =>
    left.expense.date.localeCompare(right.expense.date) ||
    left.expense.id.localeCompare(right.expense.id),
  );
  const addContinuation = () => {
    page = addPage();
    drawHeader(page, true);
    return drawTableHeader(page, pageHeight - 54);
  };
  let totalDebit = 0;
  let balance = 0;
  for (let index = 0; index < expenseRows.length; index++) {
    const { transaction, expense } = expenseRows[index];
    const active = expense.status === "posted" && transaction.status === "active";
    const allocated = active
      ? expense.allocations.reduce((sum, allocation) => sum + allocation.amount, 0)
      : 0;
    const sourceDescription = expense.allocations.map((allocation) =>
      allocation.sourceType === "personal"
        ? `Personal ${ledgerMoney(allocation.amount)}`
        : `IP ${allocation.ipReference ?? "tanpa referensi"} ${ledgerMoney(allocation.amount)}`,
    ).join("; ") || "Belum dialokasikan";
    const notes = [
      expense.category,
      expense.paymentMethod ? `Metode ${expense.paymentMethod}` : "",
      `Sumber dana: ${sourceDescription}`,
      !active ? "VOID - tidak dihitung" : "",
      active && Math.round(allocated * 100) !== Math.round(expense.amount * 100) ? "ALOKASI TIDAK SESUAI" : "",
      expense.ipUsageStatus === "pending_review" ? "PERLU VERIFIKASI" : "",
      expense.evidence.length ? `Evidence ${expense.evidence.length} file` : "Evidence belum tersedia",
    ].filter(Boolean).join(" | ");
    const description = `${expense.description}${notes ? `\n${notes}` : ""}`;
    const rowHeight = Math.max(28, Math.min(54, 14 + wrap(description, 88).length * 9));
    if (cursorY - rowHeight < 155) cursorY = addContinuation();
    const debit = active ? expense.amount : 0;
    totalDebit += debit;
    balance += debit;
    const values = [
      date(expense.date),
      description,
      debit ? ledgerMoney(debit) : "—",
      "—",
      ledgerMoney(balance),
    ];
    let x = margin;
    values.forEach((value, column) => {
      drawCell(page, x, cursorY - rowHeight, widths[column], rowHeight, value, regular, {
        align: column === 0 ? "center" : column >= 2 ? "right" : "left",
        size: 7.5,
      });
      x += widths[column];
    });
    cursorY -= rowHeight;
  }

  const totalHeight = 24;
  if (cursorY - totalHeight < 145) {
    cursorY = addContinuation();
  }
  const totalY = cursorY - totalHeight;
  const totalValues = ["—", "TOTAL", ledgerMoney(totalDebit), "—", ledgerMoney(balance)];
  let totalX = margin;
  totalValues.forEach((value, column) => {
    drawCell(page, totalX, totalY, widths[column], totalHeight, value, bold, {
      align: column === 1 ? "right" : column === 0 ? "center" : "right",
      fill: true,
      size: 8,
    });
    totalX += widths[column];
  });
  const signatureWidth = 210;
  const signatureX = pageWidth - margin - signatureWidth;
  const signatureTop = totalY - 22;
  drawText(page, "MELAPORKAN", signatureX, signatureTop, 8, bold, {
    maxWidth: signatureWidth,
    align: "center",
  });
  if (data.images.submitterSignature) {
    const signature = data.images.submitterSignature;
    const image = signature.mimeType === "image/png"
      ? await document.embedPng(signature.bytes)
      : await document.embedJpg(signature.bytes);
    const scale = Math.min(120 / image.width, 32 / image.height);
    page.drawImage(image, {
      x: signatureX + (signatureWidth - image.width * scale) / 2,
      y: signatureTop - 58,
      width: image.width * scale,
      height: image.height * scale,
    });
  }
  drawText(page, data.settings.submitter_name || "____________________", signatureX, signatureTop - 72, 8, bold, {
    maxWidth: signatureWidth,
    align: "center",
  });
  drawText(page, `NIK: ${data.settings.submitter_employee_id}`, signatureX, signatureTop - 84, 7.5, regular, {
    maxWidth: signatureWidth,
    align: "center",
  });

  const expenseLabels = new Map(expenseRows.map(({ expense }) => [
    expense.id,
    `${expense.description} (${date(expense.date)})`,
  ]));
  const paymentLabels = new Map(data.payments.map((payment) => [
    payment.id,
    `Pembayaran ${date(payment.date)} - ${money(payment.amount)}`,
  ]));
  const attachments: Array<{ evidence: IRExportEvidence; relation: string; groupKey: string }> = [
    ...expenseRows.flatMap(({ expense }) =>
      expense.evidence.map((evidence) => ({
        evidence,
        relation: expenseLabels.get(expense.id) ?? "Pengeluaran IR",
        groupKey: `expense:${expense.id}`,
      })),
    ),
    ...data.payments.flatMap((payment) =>
      payment.evidence.map((evidence) => ({
        evidence,
        relation: paymentLabels.get(payment.id) ?? "Pembayaran IR",
        groupKey: `payment:${payment.id}`,
      })),
    ),
    ...data.irEvidence.map((evidence) => ({
      evidence,
      relation: "Dokumen IR / PTJB",
      groupKey: "ir",
    })),
  ];
  const seenEvidence = new Set<string>();
  const uniqueAttachments = attachments.filter(({ evidence }) => {
    if (seenEvidence.has(evidence.id)) return false;
    seenEvidence.add(evidence.id);
    return true;
  });

  const attachmentGroups = new Map<string, {
    group: EvidenceGroup;
    items: Array<{ evidence: IRExportEvidence; relation: string }>;
  }>();
  for (const { evidence, relation, groupKey } of uniqueAttachments) {
    const category = evidenceGroup(evidence.documentType);
    const key = `${groupKey}:${category}`;
    const current = attachmentGroups.get(key);
    attachmentGroups.set(key, {
      group: category,
      items: [...(current?.items ?? []), { evidence, relation }],
    });
  }

  for (const { evidence } of uniqueAttachments) {
    await document.attach(
      evidence.bytes,
      `${evidence.id.slice(0, 8)}-${evidence.originalFileName}`,
      {
        mimeType: evidence.mimeType,
        description: evidence.documentType,
      },
    );
  }

  for (const { group, items } of attachmentGroups.values()) {
    const relation = items[0]?.relation ?? "Dokumen IR";
    const contentWidth = pageHeight - margin * 2;
    const gap = 9;
    const addEvidencePage = (title: string, detail: string) => {
      const attachmentPage = document.addPage([pageHeight, pageWidth]);
      pages.push(attachmentPage);
      drawHeader(attachmentPage, true);
      drawText(
        attachmentPage,
        `${evidenceGroupLabel(group)} · ${relation}`,
        margin,
        pageWidth - 62,
        10,
        bold,
        { color: navy, maxWidth: contentWidth },
      );
      drawText(attachmentPage, detail, margin, pageWidth - 81, 8.5, regular, {
        maxWidth: contentWidth,
        color: muted,
      });
      return attachmentPage;
    };

    const images = items.filter(({ evidence }) => evidence.mimeType !== "application/pdf");
    const pdfs = items.filter(({ evidence }) => evidence.mimeType === "application/pdf");
    if (images.length > 0) {
      const top = pageWidth - 128;
      const bottom = 35;
      const availableHeight = top - bottom;
      const columns = images.length === 1 ? 1 : images.length <= 4 ? 2 : 3;
      const rows = Math.ceil(images.length / columns);
      const cardWidth = (contentWidth - gap * (columns - 1)) / columns;
      const cardHeight = (availableHeight - gap * (rows - 1)) / rows;
      const attachmentPage = addEvidencePage(
        `${evidenceGroupLabel(group)} · ${relation}`,
        `Dokumentasi gambar (${images.length} file)`,
      );

      for (const [index, { evidence }] of images.entries()) {
        const row = Math.floor(index / columns);
        const column = index % columns;
        const x = margin + column * (cardWidth + gap);
        const y = top - (row + 1) * cardHeight - row * gap;
        const cardHeaderHeight = Math.min(42, Math.max(32, cardHeight * 0.15));
        attachmentPage.drawRectangle({
          x,
          y,
          width: cardWidth,
          height: cardHeight,
          borderColor: line,
          borderWidth: 0.7,
          color: rgb(1, 1, 1),
        });
        attachmentPage.drawRectangle({
          x,
          y: y + cardHeight - cardHeaderHeight,
          width: cardWidth,
          height: cardHeaderHeight,
          color: pale,
        });
        drawText(attachmentPage, evidence.documentType, x + 7, y + cardHeight - 13, 7.5, bold, {
          color: navy,
          maxWidth: cardWidth - 14,
        });
        drawText(attachmentPage, evidence.originalFileName, x + 7, y + cardHeight - 27, 6.5, regular, {
          color: muted,
          maxWidth: cardWidth - 14,
        });
        const preview = evidence.mimeType === "image/png"
          ? await document.embedPng(evidence.bytes)
          : await document.embedJpg(evidence.bytes);
        const imageArea = {
          x: x + 7,
          y: y + 7,
          width: cardWidth - 14,
          height: cardHeight - cardHeaderHeight - 14,
        };
        const scale = Math.min(imageArea.width / preview.width, imageArea.height / preview.height);
        const width = preview.width * scale;
        const height = preview.height * scale;
        attachmentPage.drawImage(preview, {
          x: imageArea.x + (imageArea.width - width) / 2,
          y: imageArea.y + (imageArea.height - height) / 2,
          width,
          height,
        });
      }
    }

    for (const { evidence } of pdfs) {
      const source = await PDFDocument.load(evidence.bytes);
      const pageCount = source.getPageCount();
      if (pageCount === 0) {
        throw new Error(`Evidence PDF "${evidence.originalFileName}" tidak memiliki halaman.`);
      }
      for (let sourcePageIndex = 0; sourcePageIndex < pageCount; sourcePageIndex++) {
        const attachmentPage = addEvidencePage(
          `${evidenceGroupLabel(group)} · ${relation}`,
          `${evidence.originalFileName} · Halaman ${sourcePageIndex + 1} dari ${pageCount}`,
        );
        const [preview] = await document.embedPdf(evidence.bytes, [sourcePageIndex]);
        if (!preview) {
          throw new Error(
            `Halaman ${sourcePageIndex + 1} pada evidence "${evidence.originalFileName}" gagal dimuat.`,
          );
        }
        const area = {
          x: margin,
          y: 35,
          width: contentWidth,
          height: pageWidth - 130,
        };
        const scale = Math.min(area.width / preview.width, area.height / preview.height);
        const width = preview.width * scale;
        const height = preview.height * scale;
        attachmentPage.drawPage(preview, {
          x: area.x + (area.width - width) / 2,
          y: area.y + (area.height - height) / 2,
          width,
          height,
        });
      }
    }
  }

  pages.forEach((currentPage, index) => {
    const { width } = currentPage.getSize();
    currentPage.drawLine({
      start: { x: Math.min(margin, width * 0.06), y: 18 },
      end: { x: width - Math.min(margin, width * 0.06), y: 18 },
      thickness: 0.4,
      color: line,
    });
    currentPage.drawText(safeText(`FAAMS | ${data.record.reference_code ?? "IR"}`), {
      x: Math.min(margin, width * 0.06), y: 7, size: 6.5, font: regular, color: navy,
    });
    const footer = safeText(`Halaman ${index + 1} dari ${pages.length}`);
    const footerWidth = regular.widthOfTextAtSize(footer, 6.5);
    currentPage.drawText(footer, {
      x: width - Math.min(margin, width * 0.06) - footerWidth,
      y: 7,
      size: 6.5,
      font: regular,
      color: navy,
      maxWidth: width,
    });
  });
  return document.save();
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

    const bytes = await buildPdf(data, irType);
    const filename = createExportFilename("IR", data.record.title, data.record.submitted_on, "pdf");
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": filename.contentDisposition,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Could not export IR details to PDF.", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Export PDF IR gagal." },
      { status: 500 },
    );
  }
}
