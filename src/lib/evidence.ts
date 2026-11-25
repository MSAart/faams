import type { createSupabaseServerClient } from "@/lib/supabase/server";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";

export type EvidenceMimeType = "image/jpeg" | "image/png" | "application/pdf";
export type EvidenceDocumentType =
  | "receipt"
  | "invoice"
  | "approval"
  | "settlement"
  | "bank_transfer"
  | "fund_return"
  | "other"
  | "ip_application"
  | "ip_disbursement"
  | "purchase_receipt"
  | "transfer_proof"
  | "expense_documentation"
  | "ptjb_document"
  | "reimbursement_payment"
  | "other_supporting_document";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

const minimumFileSize = 1024 * 1024;
const maximumFileSize = 50 * 1024 * 1024;
const defaultFileSize = 10 * 1024 * 1024;

async function loadConfiguredFileSize(supabase: SupabaseServerClient) {
  const { data, error } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", "evidence_max_file_size_bytes")
    .maybeSingle();
  if (error) throw new Error(`Pengaturan ukuran evidence gagal dimuat: ${error.message}`);
  if (data) return data.value;

  const { data: inserted, error: insertError } = await supabase
    .from("system_settings")
    .insert({
      key: "evidence_max_file_size_bytes",
      value: defaultFileSize,
      description: "Maximum evidence upload size in bytes; configurable from Evidence Center (1–50 MiB).",
    })
    .select("value")
    .maybeSingle();
  if (!insertError && inserted) return inserted.value;

  if (insertError?.code === "23505") {
    const { data: concurrentRow, error: concurrentReadError } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", "evidence_max_file_size_bytes")
      .maybeSingle();
    if (concurrentReadError) {
      throw new Error(`Pengaturan ukuran evidence gagal dimuat: ${concurrentReadError.message}`);
    }
    if (concurrentRow) return concurrentRow.value;
  }

  throw new Error(
    `Pengaturan ukuran evidence tidak ditemukan dan gagal dibuat: ${insertError?.message ?? "baris tidak tersedia setelah insert."}`,
  );
}

export async function getEvidenceMaxFileSize(
  supabase: SupabaseServerClient,
): Promise<number> {
  const value = await loadConfiguredFileSize(supabase);
  const size = Number(value);
  if (
    !Number.isSafeInteger(size) ||
    size < minimumFileSize ||
    size > maximumFileSize
  ) {
    throw new Error("Pengaturan ukuran evidence harus antara 1 dan 50 MiB.");
  }
  return size;
}

export function getEvidenceMimeType(file: File): EvidenceMimeType {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (file.type === "image/jpeg" && ["jpg", "jpeg"].includes(extension ?? "")) {
    return "image/jpeg";
  }
  if (file.type === "image/png" && extension === "png") return "image/png";
  if (file.type === "application/pdf" && extension === "pdf") {
    return "application/pdf";
  }
  throw new Error("Ekstensi file harus sesuai dengan tipe JPG, PNG, atau PDF.");
}

export async function validateEvidenceFile(
  file: File,
  maxFileSize: number,
): Promise<EvidenceMimeType> {
  if (file.size > maxFileSize) {
    throw new Error(`Ukuran file maksimal ${Math.floor(maxFileSize / 1024 / 1024)} MiB.`);
  }
  const mimeType = getEvidenceMimeType(file);
  const signature = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const validSignature =
    (mimeType === "image/jpeg" &&
      signature.length >= 3 &&
      signature[0] === 0xff &&
      signature[1] === 0xd8 &&
      signature[2] === 0xff) ||
    (mimeType === "image/png" &&
      signature.length === 8 &&
      signature[0] === 0x89 &&
      signature[1] === 0x50 &&
      signature[2] === 0x4e &&
      signature[3] === 0x47 &&
      signature[4] === 0x0d &&
      signature[5] === 0x0a &&
      signature[6] === 0x1a &&
      signature[7] === 0x0a) ||
    (mimeType === "application/pdf" &&
      new TextDecoder().decode(signature.slice(0, 5)) === "%PDF-");
  if (!validSignature) {
    throw new Error("Isi file tidak sesuai dengan tipe JPG, PNG, atau PDF yang dipilih.");
  }
  return mimeType;
}

export async function prepareEvidenceForStorage(
  file: File,
  maxFileSize: number,
): Promise<{ bytes: Uint8Array; mimeType: EvidenceMimeType }> {
  const mimeType = await validateEvidenceFile(file, maxFileSize);
  const originalBytes = new Uint8Array(await file.arrayBuffer());
  if (mimeType === "application/pdf") {
    const pdfText = new TextDecoder("latin1").decode(originalBytes);
    // Rewriting a digitally signed PDF would invalidate its signature.
    if (pdfText.includes("/ByteRange")) return { bytes: originalBytes, mimeType };
    try {
      const document = await PDFDocument.load(originalBytes, { updateMetadata: false });
      const compressedBytes = new Uint8Array(await document.save({
        useObjectStreams: true,
        addDefaultPage: false,
        updateFieldAppearances: false,
      }));
      return {
        bytes: compressedBytes.byteLength < originalBytes.byteLength ? compressedBytes : originalBytes,
        mimeType,
      };
    } catch (error) {
      throw new Error(
        `PDF gagal dikompres: ${error instanceof Error ? error.message : "format PDF tidak dapat diproses."}`,
      );
    }
  }

  try {
    const image = sharp(originalBytes, { failOn: "error" });
    const metadata = await image.metadata();
    const resized = () =>
      sharp(originalBytes, { failOn: "error" })
        .rotate()
        .resize({ width: 2560, height: 2560, fit: "inside", withoutEnlargement: true });

    const candidates: Array<{ bytes: Uint8Array; mimeType: EvidenceMimeType }> = [
      { bytes: originalBytes, mimeType },
    ];
    if (mimeType === "image/jpeg") {
      const bytes = await resized().jpeg({ quality: 82, mozjpeg: true }).toBuffer();
      candidates.push({ bytes: new Uint8Array(bytes), mimeType });
    } else {
      const pngBytes = await resized().png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
      candidates.push({ bytes: new Uint8Array(pngBytes), mimeType });
      if (!metadata.hasAlpha) {
        const jpegBytes = await resized().jpeg({ quality: 82, mozjpeg: true }).toBuffer();
        candidates.push({ bytes: new Uint8Array(jpegBytes), mimeType: "image/jpeg" });
      }
    }

    return candidates.reduce((smallest, candidate) =>
      candidate.bytes.byteLength < smallest.bytes.byteLength ? candidate : smallest,
    );
  } catch (error) {
    throw new Error(
      `Gambar gagal dikompres: ${error instanceof Error ? error.message : "format gambar tidak dapat diproses."}`,
    );
  }
}

export function evidenceFileExtension(mimeType: EvidenceMimeType) {
  return {
    "image/jpeg": "jpg",
    "image/png": "png",
    "application/pdf": "pdf",
  }[mimeType];
}

export function evidenceFileName(name: string) {
  return name.slice(-255) || "evidence";
}

export const evidenceMaximumFileSize = maximumFileSize;
