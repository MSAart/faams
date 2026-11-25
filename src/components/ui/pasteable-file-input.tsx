"use client";

import { useState } from "react";

type PasteableFileInputProps = Omit<React.ComponentProps<"input">, "type">;

export function PasteableFileInput({
  accept,
  multiple = false,
  onChange,
  ...props
}: PasteableFileInputProps) {
  const [pasteMessage, setPasteMessage] = useState("");

  function handlePaste(event: React.ClipboardEvent<HTMLInputElement>) {
    const pastedImages = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && ["image/jpeg", "image/png"].includes(item.type))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);

    if (pastedImages.length === 0) return;

    event.preventDefault();
    const input = event.currentTarget;
    const transfer = new DataTransfer();
    const existingFiles = multiple ? Array.from(input.files ?? []) : [];
    [...existingFiles, ...pastedImages].forEach((file) => transfer.items.add(file));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    setPasteMessage(
      `${pastedImages.length} gambar ditempel${pastedImages.length === 1 ? "" : "kan"}.`,
    );
  }

  return (
    <>
      <input
        {...props}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={(event) => {
          setPasteMessage("");
          onChange?.(event);
        }}
        onPaste={handlePaste}
      />
      <span className="block text-[10px] font-normal text-slate-500">
        Pilih file atau fokuskan kolom ini lalu tekan Ctrl+V untuk menempelkan gambar.
      </span>
      {pasteMessage && <span role="status" className="sr-only">{pasteMessage}</span>}
    </>
  );
}
