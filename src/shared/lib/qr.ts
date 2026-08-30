/* ساخت و رسم QR Code روی canvas (کتابخانه qrcode-generator — vendored) */

import qrcode from "./vendor/qrcode.min.js";

export interface QRMatrix {
  count: number;
  isDark(row: number, col: number): boolean;
}

export function createQr(text: string): QRMatrix {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return { count: qr.getModuleCount(), isDark: (r, c) => qr.isDark(r, c) };
}

export function drawQrToCanvas(
  canvas: HTMLCanvasElement,
  text: string,
  size = 220,
): void {
  const dpr = window.devicePixelRatio || 1;
  const qr = createQr(text);
  const count = qr.count;

  const cell = Math.floor((size * dpr) / (count + 4)); /* +quiet zone */
  const offset = Math.floor((size * dpr - cell * count) / 2);

  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = size + "px";
  canvas.style.height = size + "px";

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0b0d12";
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) {
        ctx.fillRect(offset + c * cell, offset + r * cell, cell, cell);
      }
    }
  }
}
