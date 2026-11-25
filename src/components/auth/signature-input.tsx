"use client";

import { useRef, useState } from "react";

type SignatureMode = "upload" | "draw";

export function SignatureInput({ required }: { required: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hasStrokesRef = useRef(false);
  const [mode, setMode] = useState<SignatureMode>("upload");
  const [hasDrawing, setHasDrawing] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawingData, setDrawingData] = useState("");

  function getPoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * (canvas.width / bounds.width),
      y: (event.clientY - bounds.top) * (canvas.height / bounds.height),
    };
  }

  function startDrawing(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const point = getPoint(event);
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !point) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    context.beginPath();
    context.moveTo(point.x, point.y);
    context.lineWidth = 5;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#172B4D";
    setIsDrawing(true);
  }

  function draw(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawing) return;
    const context = canvasRef.current?.getContext("2d");
    const point = getPoint(event);
    if (!context || !point) return;
    event.preventDefault();
    context.lineTo(point.x, point.y);
    context.stroke();
    hasStrokesRef.current = true;
    setHasDrawing(true);
  }

  function stopDrawing(event: React.PointerEvent<HTMLCanvasElement>) {
    if (hasStrokesRef.current && canvasRef.current) {
      setDrawingData(canvasRef.current.toDataURL("image/png"));
    }
    if (canvasRef.current?.hasPointerCapture(event.pointerId)) {
      canvasRef.current.releasePointerCapture(event.pointerId);
    }
    setIsDrawing(false);
  }

  function clearDrawing() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    hasStrokesRef.current = false;
    setDrawingData("");
    setHasDrawing(false);
  }

  return (
    <div className="space-y-3">
      <input type="hidden" name="signature_mode" value={mode} />
      <input type="hidden" name="signature_drawn" value={mode === "draw" ? drawingData : ""} />
      <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
        <button
          type="button"
          onClick={() => setMode("upload")}
          aria-pressed={mode === "upload"}
          className={`rounded-md px-3 py-1.5 text-xs font-medium ${mode === "upload" ? "bg-white text-[#17365D] shadow-sm" : "text-slate-600"}`}
        >
          Unggah gambar
        </button>
        <button
          type="button"
          onClick={() => setMode("draw")}
          aria-pressed={mode === "draw"}
          className={`rounded-md px-3 py-1.5 text-xs font-medium ${mode === "draw" ? "bg-white text-[#17365D] shadow-sm" : "text-slate-600"}`}
        >
          Gambar tanda tangan
        </button>
      </div>
      {mode === "upload" ? (
        <input
          name="signature"
          type="file"
          accept="image/jpeg,image/png,.jpg,.jpeg,.png"
          required={required}
          className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5"
        />
      ) : (
        <div className="space-y-2">
          <canvas
            ref={canvasRef}
            width={900}
            height={240}
            aria-label="Area untuk menggambar tanda tangan"
            className="block w-full touch-none rounded-lg border border-slate-300 bg-white"
            onPointerDown={startDrawing}
            onPointerMove={draw}
            onPointerUp={stopDrawing}
            onPointerCancel={stopDrawing}
            onLostPointerCapture={() => setIsDrawing(false)}
          />
          <button
            type="button"
            onClick={clearDrawing}
            disabled={!hasDrawing}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 disabled:opacity-50"
          >
            Hapus gambar
          </button>
          <p className="text-xs text-slate-500">Gambar tanda tangan di area putih menggunakan mouse atau layar sentuh.</p>
        </div>
      )}
      <p className="text-xs text-slate-500">Gambar tanda tangan diunggah sebagai PNG dan disimpan secara privat.</p>
    </div>
  );
}
