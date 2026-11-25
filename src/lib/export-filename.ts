const invalidFilenameCharacters = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;

function cleanFilenamePart(value: string) {
  return value
    .normalize("NFC")
    .replace(invalidFilenameCharacters, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
}

function encodeRFC5987Value(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function createExportFilename(
  prefix: string,
  title: string,
  date: string | null,
  extension: "xlsx" | "pdf",
) {
  const safeTitle = Array.from(cleanFilenamePart(title) || "Tanpa Nama Kegiatan")
    .slice(0, 120)
    .join("");
  const safeDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date
    : "Tanggal belum tersedia";
  const filename = `${prefix} - ${safeTitle} - ${safeDate}.${extension}`;
  const asciiFallback = filename
    .replace(/[^\x20-\x7e]/g, "-")
    .replace(/["\\]/g, "-");

  return {
    filename,
    contentDisposition: `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeRFC5987Value(filename)}`,
  };
}
