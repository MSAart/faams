import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import { NextResponse } from "next/server";
import {
  getIPRealizationExportData,
  toIPRealizationLedgerEntry,
  type IPRealizationExportData,
} from "@/lib/ip-realization-export";
import { verifyIPRecordOwnerOrAdmin } from "@/lib/report-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pageWidth = 841.89;
const pageHeight = 595.28;
const margin = 28;
const navy = rgb(0.09, 0.19, 0.31);
const text = rgb(0.08, 0.1, 0.13);
const muted = rgb(0.36, 0.41, 0.48);
const grid = rgb(0.72, 0.76, 0.81);
const pale = rgb(0.93, 0.95, 0.97);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Preview =
  | { kind: "image"; value: PDFImage }
  | { kind: "pdf"; bytes: Uint8Array; pageCount: number };
type Font = Awaited<ReturnType<PDFDocument["embedFont"]>>;

function safeText(value: unknown) {
  return String(value ?? "—")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "—";
}

function date(value: string) {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    timeZone: "UTC",
  }).format(parsed);
}

function money(value: number) {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(value);
}

function fitText(value: string, font: Font, size: number, maxWidth: number) {
  const content = safeText(value);
  if (font.widthOfTextAtSize(content, size) <= maxWidth) return content;
  let shortened = content;
  while (shortened.length > 1 && font.widthOfTextAtSize(`${shortened}…`, size) > maxWidth) {
    shortened = shortened.slice(0, -1);
  }
  return `${shortened}…`;
}

function drawText(
  page: PDFPage,
  value: unknown,
  x: number,
  y: number,
  size: number,
  font: Font,
  options: { maxWidth?: number; color?: ReturnType<typeof rgb>; align?: "left" | "center" | "right" } = {},
) {
  const { width: currentPageWidth } = page.getSize();
  const maxWidth = options.maxWidth ?? currentPageWidth - x - margin;
  const content = fitText(String(value ?? "—"), font, size, maxWidth);
  const contentWidth = font.widthOfTextAtSize(content, size);
  const drawX = options.align === "right"
    ? x + maxWidth - contentWidth
    : options.align === "center"
      ? x + (maxWidth - contentWidth) / 2
      : x;
  page.drawText(content, {
    x: drawX,
    y,
    size,
    font,
    color: options.color ?? text,
    maxWidth,
  });
}

function drawCell(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  height: number,
  value: unknown,
  font: Font,
  options: { size?: number; fill?: boolean; align?: "left" | "center" | "right"; padding?: number } = {},
) {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    borderColor: grid,
    borderWidth: 0.5,
    color: options.fill ? pale : rgb(1, 1, 1),
  });
  const padding = options.padding ?? 5;
  const size = options.size ?? 8;
  drawText(page, value, x + padding, y + (height - size) / 2 + 1, size, font, {
    maxWidth: width - padding * 2,
    align: options.align ?? "left",
  });
}

function documentTypeLabel(type: string) {
  return {
    receipt: "Nota",
    invoice: "Invoice",
    bank_transfer: "Bukti transfer",
    transfer_proof: "Bukti transfer",
    other: "Dokumen lainnya",
    other_supporting_document: "Dokumen lainnya",
    purchase_receipt: "Nota pembelian",
    expense_documentation: "Dokumentasi pengeluaran",
  }[type] ?? type.replaceAll("_", " ");
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

async function loadPreview(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  document: PDFDocument,
  file: IPRealizationExportData["evidence"][number],
  expenseId: string,
): Promise<Preview> {
  const { data, error } = await supabase.storage.from("faams-evidence").download(file.object_path);
  if (error) {
    throw new Error(`Evidence "${file.original_file_name}" gagal dimuat: ${error.message}`);
  }
  const bytes = new Uint8Array(await data.arrayBuffer());
  await document.attach(
    bytes,
    `${expenseId.slice(0, 8)}-${file.original_file_name}`,
    {
      mimeType: file.mime_type,
      description: `${documentTypeLabel(file.document_type)} untuk realisasi ${expenseId}`,
    },
  );
  if (file.mime_type === "image/jpeg") {
    return { kind: "image", value: await document.embedJpg(bytes) };
  }
  if (file.mime_type === "image/png") {
    return { kind: "image", value: await document.embedPng(bytes) };
  }
  const sourceDocument = await PDFDocument.load(bytes);
  const pageCount = sourceDocument.getPageCount();
  if (pageCount === 0) throw new Error(`Evidence PDF "${file.original_file_name}" tidak memiliki halaman.`);
  return { kind: "pdf", bytes, pageCount };
}

function drawPreview(page: PDFPage, preview: Preview, x: number, y: number, width: number, height: number) {
  if (preview.kind !== "image") {
    throw new Error("Preview PDF harus dirender per halaman.");
  }
  const scale = Math.min(width / preview.value.width, height / preview.value.height);
  const drawWidth = preview.value.width * scale;
  const drawHeight = preview.value.height * scale;
  const drawX = x + (width - drawWidth) / 2;
  const drawY = y + (height - drawHeight) / 2;
  page.drawImage(preview.value, { x: drawX, y: drawY, width: drawWidth, height: drawHeight });
}

function drawReportHeader(page: PDFPage, title: string, subtitle: string, bold: Font, regular: Font) {
  const { width: currentPageWidth, height: currentPageHeight } = page.getSize();
  drawText(page, title, margin, currentPageHeight - 28, 13, bold, { color: navy });
  page.drawLine({
    start: { x: margin, y: currentPageHeight - 36 },
    end: { x: currentPageWidth - margin, y: currentPageHeight - 36 },
    thickness: 1.8,
    color: navy,
  });
  drawText(page, subtitle, margin, currentPageHeight - 54, 9, regular);
}

async function embedSignature(
  document: PDFDocument,
  image: IPRealizationExportData["images"]["submitterSignature"],
): Promise<PDFImage | null> {
  if (!image) return null;
  return image.mimeType === "image/png"
    ? document.embedPng(image.bytes)
    : document.embedJpg(image.bytes);
}

function drawSignature(
  page: PDFPage,
  image: PDFImage | null,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  if (!image) return;
  const scale = Math.min(width / image.width, height / image.height);
  const imageWidth = image.width * scale;
  const imageHeight = image.height * scale;
  page.drawImage(image, {
    x: x + (width - imageWidth) / 2,
    y: y + (height - imageHeight) / 2,
    width: imageWidth,
    height: imageHeight,
  });
}

function drawLedgerPage(
  document: PDFDocument,
  data: IPRealizationExportData,
  submitterSignature: PDFImage | null,
  regular: Font,
  bold: Font,
) {
  const page = document.addPage([pageWidth, pageHeight]);
  drawReportHeader(
    page,
    "RINCIAN REALISASI INTERNAL PREPAYMENT",
    data.record.title,
    bold,
    regular,
  );
  drawText(page, `No. IP: ${data.record.reference_code ?? "—"}`, margin, pageHeight - 72, 8, bold);
  drawText(page, `Keperluan: ${data.record.purpose}`, margin, pageHeight - 87, 7.5, regular);
  drawText(page, `Pelaksana: ${data.record.pic_name ?? "—"}`, margin, pageHeight - 102, 7.5, regular);
  drawText(page, "Saldo berjalan dihitung dari Kredit dikurangi Debit.", margin, pageHeight - 117, 7, regular, { color: muted });

  const entries = data.movements
    .map(toIPRealizationLedgerEntry)
    .filter((entry) => entry !== null);
  let totalDebit = 0;
  let totalCredit = 0;
  let balance = 0;
  const rows = entries.map((entry) => {
    totalDebit += entry.debit;
    totalCredit += entry.credit;
    balance += entry.credit - entry.debit;
    return { ...entry, balance };
  });

  const tableX = margin;
  const tableWidth = pageWidth - margin * 2;
  const widths = [70, tableWidth - 70 - 90 * 3, 90, 90, 90];
  const tableTop = pageHeight - 135;
  const headerHeight = 25;
  const totalHeight = 23;
  const footerY = 135;
  const availableRowHeight = (tableTop - footerY - headerHeight - totalHeight) / Math.max(rows.length, 1);
  const rowHeight = Math.min(20, availableRowHeight);
  const fontSize = Math.max(5, Math.min(8, rowHeight * 0.48));
  const headers = ["Tanggal", "Keterangan", "Debit", "Kredit", "Total"];
  let x = tableX;
  headers.forEach((header, index) => {
    drawCell(page, x, tableTop - headerHeight, widths[index], headerHeight, header, bold, {
      size: 8,
      fill: true,
      align: index === 1 ? "left" : "center",
    });
    x += widths[index];
  });

  let y = tableTop - headerHeight - rowHeight;
  if (rows.length === 0) {
    drawCell(page, tableX, y, tableWidth, Math.max(30, rowHeight), "Belum ada transaksi realisasi.", regular, {
      size: 8,
      align: "center",
    });
    y -= Math.max(30, rowHeight);
  } else {
    rows.forEach((entry) => {
      x = tableX;
      const values = [
        date(entry.date),
        entry.description,
        entry.debit ? money(entry.debit) : "",
        entry.credit ? money(entry.credit) : "",
        money(entry.balance),
      ];
      values.forEach((value, index) => {
        drawCell(page, x, y, widths[index], rowHeight, value, regular, {
          size: fontSize,
          align: index === 1 ? "left" : index === 0 ? "center" : "right",
          padding: index === 1 ? 5 : 4,
        });
        x += widths[index];
      });
      y -= rowHeight;
    });
  }

  x = tableX;
  const totalValues = ["", "TOTAL", money(totalDebit), money(totalCredit), money(balance)];
  totalValues.forEach((value, index) => {
    drawCell(page, x, y, widths[index], totalHeight, value, bold, {
      size: 8,
      fill: true,
      align: index === 1 ? "right" : index === 0 ? "center" : "right",
    });
    x += widths[index];
  });
  const signatureWidth = 220;
  const signatureX = pageWidth - margin - signatureWidth;
  const signatureTop = y - 18;
  drawText(page, "MELAPORKAN", signatureX, signatureTop, 8, bold, {
    maxWidth: signatureWidth,
    align: "center",
  });
  drawSignature(page, submitterSignature, signatureX + 40, signatureTop - 48, signatureWidth - 80, 34);
  drawText(page, data.submitter.name, signatureX, signatureTop - 60, 7.5, bold, {
    maxWidth: signatureWidth,
    align: "center",
  });
  drawText(page, `NIK: ${data.submitter.employeeId}`, signatureX, signatureTop - 72, 7, regular, {
    maxWidth: signatureWidth,
    align: "center",
  });
  drawText(page, "FAAMS · Laporan realisasi dan dokumentasi", margin, 16, 6.5, regular, { color: muted });
}

async function drawDocumentationPage(
  document: PDFDocument,
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  data: IPRealizationExportData,
  expense: IPRealizationExportData["expenses"][number],
  index: number,
  regular: Font,
  bold: Font,
): Promise<PDFPage[]> {
  const portraitWidth = pageHeight;
  const portraitHeight = pageWidth;
  const allEvidence = data.evidence.filter((file) => file.expense_id === expense.id);
  const evidence = await Promise.all(allEvidence.map(async (file) => ({
    file,
    preview: await loadPreview(supabase, document, file, expense.id),
  })));
  const groups: EvidenceGroup[] = ["transfer", "receipt", "documentation"];
  const groupedEvidence = groups.map((group) => ({
    group,
    items: evidence.filter(({ file }) => evidenceGroup(file.document_type) === group),
  }));
  const pages: PDFPage[] = [];

  for (const { group, items } of groupedEvidence) {
    if (items.length === 0 && (group !== "documentation" || allEvidence.length > 0)) continue;
    const images = items.filter(
      (item): item is typeof item & { preview: { kind: "image"; value: PDFImage } } =>
        item.preview.kind === "image",
    );
    const pdfs = items.filter(
      (item): item is typeof item & { preview: { kind: "pdf"; bytes: Uint8Array; pageCount: number } } =>
        item.preview.kind === "pdf",
    );
    const addEvidencePage = (title: string, detail: string) => {
      const page = document.addPage([portraitWidth, portraitHeight]);
      pages.push(page);
      drawReportHeader(
        page,
        title,
        `${data.record.reference_code ?? "IP"} | ${data.record.title}`,
        bold,
        regular,
      );
      drawText(
        page,
        `${date(expense.expense_date)} | ${expense.description} | Rp ${money(expense.amount)}`,
        margin,
        portraitHeight - 72,
        8,
        bold,
        { maxWidth: portraitWidth - margin * 2 },
      );
      drawText(page, detail, margin, portraitHeight - 91, 8, regular, {
        color: muted,
        maxWidth: portraitWidth - margin * 2,
      });
      return page;
    };

    if (images.length > 0) {
      const page = addEvidencePage(
        `${evidenceGroupLabel(group)} · REALISASI ${index + 1}`,
        `Dokumentasi gambar (${images.length} file)`,
      );
      const areaTop = portraitHeight - 112;
      const areaBottom = 33;
      const gap = 10;
      const columns = images.length === 1 ? 1 : images.length <= 4 ? 2 : 3;
      const rowCount = Math.ceil(images.length / columns);
      const cardWidth = (portraitWidth - margin * 2 - gap * (columns - 1)) / columns;
      const cardHeight = (areaTop - areaBottom - gap * (rowCount - 1)) / rowCount;

      for (const [fileIndex, { file, preview }] of images.entries()) {
        const column = fileIndex % columns;
        const row = Math.floor(fileIndex / columns);
        const x = margin + column * (cardWidth + gap);
        const y = areaTop - (row + 1) * cardHeight - row * gap;
        page.drawRectangle({
          x,
          y,
          width: cardWidth,
          height: cardHeight,
          borderColor: grid,
          borderWidth: 0.7,
          color: rgb(1, 1, 1),
        });
        const labelHeight = Math.min(42, Math.max(32, cardHeight * 0.15));
        page.drawRectangle({
          x: x + 1,
          y: y + cardHeight - labelHeight - 1,
          width: cardWidth - 2,
          height: labelHeight,
          color: pale,
        });
        drawText(page, documentTypeLabel(file.document_type), x + 7, y + cardHeight - 15, 8, bold, {
          maxWidth: cardWidth - 14,
          color: navy,
        });
        drawText(page, file.original_file_name, x + 7, y + cardHeight - 29, 6.8, regular, {
          maxWidth: cardWidth - 14,
          color: muted,
        });
        const imageMargin = 8;
        drawPreview(
          page,
          preview,
          x + imageMargin,
          y + imageMargin,
          cardWidth - imageMargin * 2,
          Math.max(5, cardHeight - labelHeight - imageMargin * 2),
        );
      }
    }

    if (items.length === 0) {
      const page = addEvidencePage(
        `${evidenceGroupLabel(group)} · REALISASI ${index + 1}`,
        "Dokumen pendukung (0)",
      );
      drawCell(page, margin, portraitHeight - 135, portraitWidth - margin * 2, 34, "Tidak ada file dokumentasi untuk transaksi ini.", regular, {
        size: 8,
        align: "center",
      });
    }

    for (const { file, preview } of pdfs) {
      for (let sourcePageIndex = 0; sourcePageIndex < preview.pageCount; sourcePageIndex++) {
        const page = addEvidencePage(
          `${evidenceGroupLabel(group)} · REALISASI ${index + 1}`,
          `${file.original_file_name} · Halaman ${sourcePageIndex + 1} dari ${preview.pageCount}`,
        );
        const [embeddedPage] = await document.embedPdf(preview.bytes, [sourcePageIndex]);
        if (!embeddedPage) {
          throw new Error(
            `Halaman ${sourcePageIndex + 1} pada evidence "${file.original_file_name}" gagal dimuat.`,
          );
        }
        const area = {
          x: margin,
          y: 33,
          width: portraitWidth - margin * 2,
          height: portraitHeight - 140,
        };
        const scale = Math.min(area.width / embeddedPage.width, area.height / embeddedPage.height);
        const width = embeddedPage.width * scale;
        const height = embeddedPage.height * scale;
        page.drawPage(embeddedPage, {
          x: area.x + (area.width - width) / 2,
          y: area.y + (area.height - height) / 2,
          width,
          height,
        });
      }
    }

    if (items.length === 0 && allEvidence.length === 0 && group === "documentation") {
      continue;
    }
  }
  return pages;
}

async function buildReport(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  data: IPRealizationExportData,
) {
  const document = await PDFDocument.create();
  document.setTitle(`Realisasi ${data.record.reference_code ?? "IP"}`);
  document.setAuthor("FAAMS");
  document.setSubject("Internal Prepayment ledger and evidence");
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);

  const submitterSignature = await embedSignature(document, data.images.submitterSignature);
  drawLedgerPage(document, data, submitterSignature, regular, bold);
  for (const [index, expense] of data.expenses.entries()) {
    await drawDocumentationPage(document, supabase, data, expense, index, regular, bold);
  }
  return document.save();
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

    const bytes = await buildReport(supabase, data);
    const filenameRef = (data.record.reference_code ?? "IP").replace(/[^a-zA-Z0-9_-]/g, "-");
    const body = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(body).set(bytes);
    return new Response(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Realisasi-${filenameRef}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Could not export IP realizations and evidence to PDF.", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Export PDF realisasi IP gagal." },
      { status: 400 },
    );
  }
}
