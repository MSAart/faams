import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";
import { NextResponse } from "next/server";
import { getIPApplicationExportData, type ExportImage, type IPApplicationExportData } from "@/lib/ip-application-export";
import { verifyIPRecordOwnerOrAdmin } from "@/lib/report-auth";
import { createExportFilename } from "@/lib/export-filename";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pageWidth = 841.89;
const pageHeight = 595.28;
const margin = 30;
const navy = rgb(0.09, 0.19, 0.31);
const text = rgb(0.08, 0.1, 0.13);
const grid = rgb(0.69, 0.72, 0.76);
const pale = rgb(0.95, 0.96, 0.97);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeText(value: unknown) {
  return String(value ?? "—")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "—";
}

function date(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
      .format(new Date(`${value.slice(0, 10)}T00:00:00.000Z`))
    : "—";
}

function money(value: number) {
  return `Rp ${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(value)}`;
}

function wrap(value: string, maxLength: number) {
  const words = safeText(value).split(" ");
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

async function embedImage(document: PDFDocument, image: ExportImage | null) {
  if (!image) return null;
  return image.mimeType === "image/png"
    ? document.embedPng(image.bytes)
    : document.embedJpg(image.bytes);
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
  const width = options.maxWidth ?? pageWidth - x - margin;
  const textWidth = font.widthOfTextAtSize(content, size);
  const drawX = options.align === "right" ? x + width - textWidth : options.align === "center" ? x + (width - textWidth) / 2 : x;
  page.drawText(content, { x: drawX, y, size, font, color: options.color ?? text, maxWidth: width });
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
    borderColor: grid,
    borderWidth: 0.55,
    color: options.fill ? pale : rgb(1, 1, 1),
  });
  const lines = wrap(safeText(value), Math.max(8, Math.floor((width - 10) / 4.5)));
  const size = options.size ?? 8.5;
  const visibleLines = Math.min(lines.length, Math.max(1, Math.floor((height - 4) / (size + 2))));
  for (let index = 0; index < visibleLines; index++) {
    drawText(page, lines[index], x + 5, y + height - size - 4 - index * (size + 2), size, font, {
      maxWidth: width - 10,
      align: options.align,
    });
  }
}

async function buildForm(data: IPApplicationExportData) {
  const document = await PDFDocument.create();
  document.setTitle(`Form Pengajuan ${data.record.reference_code ?? "IP"}`);
  document.setAuthor("FAAMS");
  document.setSubject("Internal Prepayment application form");
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedImage(document, data.images.logo);
  const submitterSignature = await embedImage(document, data.images.submitterSignature);
  const approverSignature = await embedImage(document, data.images.approverSignature);
  const pages: PDFPage[] = [];

  const addPage = () => {
    const page = document.addPage([pageWidth, pageHeight]);
    pages.push(page);
    return page;
  };
  const drawPageTitle = (page: PDFPage, title: string) => {
    page.drawText(safeText(title), {
      x: margin, y: pageHeight - 28, size: 13, font: bold, color: text,
    });
    page.drawLine({
      start: { x: margin, y: pageHeight - 34 },
      end: { x: pageWidth - margin, y: pageHeight - 34 },
      thickness: 2, color: navy,
    });
  };
  const drawTableHeader = (page: PDFPage, y: number) => {
    const widths = [54, 425, 92, 210];
    const labels = ["NOMOR", "DESKRIPSI", "JUMLAH", "BIAYA"];
    let x = margin;
    labels.forEach((label, index) => {
      drawCell(page, x, y - 22, widths[index], 22, label, bold, {
        align: "center", fill: true, size: 8.2,
      });
      x += widths[index];
    });
    return y - 22;
  };
  const drawItems = (page: PDFPage, startIndex: number, startY: number, bottomLimit: number) => {
    let y = startY;
    let index = startIndex;
    for (; index < data.items.length; index++) {
      const item = data.items[index];
      const lines = wrap(item.description, 92);
      const height = Math.max(14, lines.length * 10 + 4);
      if (y - height < bottomLimit) break;
      const widths = [54, 425, 92, 210];
      const values = [String(index + 1), item.description, item.quantity.toFixed(2), money(item.unit_cost)];
      let x = margin;
      values.forEach((value, column) => {
        drawCell(page, x, y - height, widths[column], height, value, regular, {
          align: column === 0 || column === 2 ? "center" : column === 3 ? "right" : "left",
          size: 8,
        });
        x += widths[column];
      });
      y -= height;
    }
    return { endY: y, nextIndex: index };
  };

  const firstPage = addPage();
  drawPageTitle(firstPage, "FORM PENGAJUAN IP");
  drawText(firstPage, data.record.reference_code ?? "IP", margin, 542, 8, bold, { color: navy });

  const details: Array<[string, string]> = [
    ["TANGGAL PENGAJUAN", date(data.record.requested_on)],
    ["NAMA PROJECT / TUJUAN", `${data.record.title} - ${data.record.purpose}`],
    ["TGL PEKERJAAN", date(data.record.project_start_date)],
    ["SELESAI PEKERJAAN", date(data.record.project_end_date)],
    ["LOKASI PROJECT", data.record.project_location ?? ""],
    ["PIC / DEPARTEMEN", [data.record.pic_name, data.record.department_area].filter(Boolean).join(" / ")],
  ];
  details.forEach(([label, value], index) => {
    const y = 520 - index * 19;
    drawCell(firstPage, margin, y - 17, 150, 19, label, bold, { size: 8 });
    drawCell(firstPage, margin + 150, y - 17, 400, 19, value, regular, { size: 8.3 });
  });

  if (logo) {
    const scale = Math.min(140 / logo.width, 68 / logo.height);
    const width = logo.width * scale;
    const height = logo.height * scale;
    firstPage.drawImage(logo, {
      x: pageWidth - margin - 190 + (190 - width) / 2,
      y: 475 + (68 - height) / 2,
      width,
      height,
    });
  } else {
    drawText(firstPage, data.settings.company_name || "LOGO ORGANISASI", pageWidth - margin - 190, 510, 11, bold, {
      maxWidth: 190, align: "center", color: navy,
    });
  }
  [
    data.settings.company_name,
    data.settings.regional_name,
    data.settings.department_name,
    data.settings.area_name,
  ]
    .filter(Boolean)
    .forEach((label, index) => {
      drawText(firstPage, label, pageWidth - margin - 190, 461 - index * 15, 8, bold, {
        maxWidth: 190, align: "center",
      });
    });

  const summaryRows: Array<[string, string]> = [
    ["PERMOHONAN", money(data.record.requested_amount)],
    ["PEMAKAIAN", data.record.disbursement_date ? money(data.directRealizationAmount) : "—"],
    ["SISA / KURANG", data.directUnsettledBalance === null ? "—" : money(data.directUnsettledBalance)],
  ];
  summaryRows.forEach(([label, value], index) => {
    const y = 387 - index * 18;
    drawCell(firstPage, margin, y - 17, 150, 18, label, bold, { size: 8.2 });
    drawCell(firstPage, margin + 150, y - 17, 400, 18, value, bold, { align: "right", size: 8.5 });
  });

  const startY = drawTableHeader(firstPage, 325);
  let { endY, nextIndex: nextItemIndex } = drawItems(firstPage, 0, startY, 35);

  const addContinuationPage = () => {
    const page = addPage();
    drawPageTitle(page, `FORM PENGAJUAN IP - ${data.record.reference_code ?? "IP"} (LANJUTAN)`);
    return page;
  };

  if (nextItemIndex < data.items.length) {
    let page = addContinuationPage();
    let result = drawItems(page, nextItemIndex, drawTableHeader(page, 535), 45);
    endY = result.endY;
    nextItemIndex = result.nextIndex;
    while (nextItemIndex < data.items.length) {
      page = addContinuationPage();
      result = drawItems(page, nextItemIndex, drawTableHeader(page, 535), 45);
      if (result.nextIndex === nextItemIndex) {
        throw new Error("Item anggaran terlalu panjang untuk ditampilkan pada halaman PDF.");
      }
      endY = result.endY;
      nextItemIndex = result.nextIndex;
    }
  }

  let finalPage = pages[pages.length - 1];
  if (endY < 156) {
    finalPage = addContinuationPage();
    endY = 535;
  }
  const total = data.items.reduce((sum, item) => sum + item.requested_amount, 0);
  const totalY = endY - 21;
  drawCell(finalPage, pageWidth - margin - 302, totalY, 104, 20, "TOTAL", bold, { align: "center", size: 8.5 });
  drawCell(finalPage, pageWidth - margin - 198, totalY, 198, 20, money(total), bold, { align: "right", size: 8.5 });

  const signatureTop = totalY - 31;
  const blockWidth = 350;
  const leftX = margin + 55;
  const rightX = pageWidth - margin - blockWidth - 55;
  drawText(finalPage, "Mengajukan", leftX, signatureTop, 9, bold, { maxWidth: blockWidth, align: "center" });
  drawText(finalPage, "Menyetujui", rightX, signatureTop, 9, bold, { maxWidth: blockWidth, align: "center" });
  drawText(finalPage, data.settings.submitter_title, leftX, signatureTop - 14, 8, regular, { maxWidth: blockWidth, align: "center" });
  drawText(finalPage, data.settings.approver_title, rightX, signatureTop - 14, 8, regular, { maxWidth: blockWidth, align: "center" });
  const signatureImages = [
    [submitterSignature, leftX, blockWidth],
    [approverSignature, rightX, blockWidth],
  ] as const;
  for (const [image, x, width] of signatureImages) {
    if (!image) continue;
    const scale = Math.min(width * 0.5 / image.width, 42 / image.height);
    const imageWidth = image.width * scale;
    const imageHeight = image.height * scale;
    finalPage.drawImage(image, {
      x: x + (width - imageWidth) / 2,
      y: signatureTop - 61 + (42 - imageHeight) / 2,
      width: imageWidth,
      height: imageHeight,
    });
  }
  drawText(finalPage, data.settings.submitter_name, leftX, signatureTop - 70, 8, bold, { maxWidth: blockWidth, align: "center" });
  drawText(finalPage, data.settings.approver_name, rightX, signatureTop - 70, 8, bold, { maxWidth: blockWidth, align: "center" });
  drawText(finalPage, data.settings.submitter_employee_id, leftX, signatureTop - 82, 8, regular, { maxWidth: blockWidth, align: "center" });
  drawText(finalPage, data.settings.approver_employee_id, rightX, signatureTop - 82, 8, regular, { maxWidth: blockWidth, align: "center" });

  pages.forEach((page, index) => {
    page.drawLine({
      start: { x: margin, y: 17 },
      end: { x: pageWidth - margin, y: 17 },
      thickness: 0.4,
      color: grid,
    });
    drawText(page, `FAAMS | ${data.record.reference_code ?? "IP"}`, margin, 7, 6.5, regular, { color: navy });
    drawText(page, `Halaman ${index + 1} dari ${pages.length}`, pageWidth - margin - 100, 7, 6.5, regular, {
      maxWidth: 100, align: "right", color: navy,
    });
  });
  return document.save();
}

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/internal-prepayment/[ipId]/export/pdf">,
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
    const bytes = await buildForm(data);
    const filename = createExportFilename("PUM", data.record.title, data.record.requested_on, "pdf");
    const body = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(body).set(bytes);
    return new Response(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": filename.contentDisposition,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Could not export IP application form to PDF.", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Export PDF pengajuan IP gagal." },
      { status: 400 },
    );
  }
}
