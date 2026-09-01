/* ═══════════════════════════════════════════════
   تولید آیکون‌های PNG خانه یار — بدون وابستگی خارجی
   نسخه solid: نشان سفید روی مربع گوشه‌گرد سبز زمردی (rx ≈ ۲۲٪)
   خروجی: public/icons/icon-192.png, icon-512.png, icon-maskable-512.png
   اجرا: node tools/generate-icons.js
   ═══════════════════════════════════════════════ */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

/* ── PNG encoder (RGBA) ── */
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; /* bit depth */
  ihdr[9] = 6; /* RGBA */
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; /* no filter */
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

/* ── هندسه نشان (مختصات ۰..۹۶) ── */
const GREEN = [16, 185, 129, 255];
const WHITE = [255, 255, 255, 255];

function inRoundedRect(px, py, x, y, w, h, r) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const cx = Math.max(x + r, Math.min(px, x + w - r));
  const cy = Math.max(y + r, Math.min(py, y + h - r));
  const dx = px - cx, dy = py - cy;
  return dx * dx + dy * dy <= r * r || (px >= x + r && px <= x + w - r) || (py >= y + r && py <= y + h - r);
}

function inCircle(px, py, cx, cy, r) {
  const dx = px - cx, dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const s1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  const s2 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
  const s3 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
  return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
}

/** فاصله تا بزیه درجه ۲ */
function quadDist(px, py, x0, y0, x1, y1, x2, y2) {
  let best = Infinity;
  for (let i = 0; i <= 64; i++) {
    const t = i / 64;
    const mt = 1 - t;
    const qx = mt * mt * x0 + 2 * t * mt * x1 + t * t * x2;
    const qy = mt * mt * y0 + 2 * t * mt * y1 + t * t * y2;
    const dx = px - qx, dy = py - qy;
    const d = dx * dx + dy * dy;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** آیا نقطه داخل نشان سفید است؟ (مختصات ۰..۹۶) */
function inMark(px, py) {
  if (inTriangle(px, py, 48, 6, 82, 34, 14, 34)) return true; /* بام */
  if (px >= 20 && px <= 76 && py >= 34 && py <= 56) return true; /* بدنه خانه */
  if (inCircle(px, py, 32, 64, 5) || inRoundedRect(px, py, 26, 70, 12, 16, 6)) return true;
  if (inCircle(px, py, 48, 66, 4.5) || inRoundedRect(px, py, 43, 72, 11, 14, 5.5)) return true;
  if (inCircle(px, py, 60, 68, 3.5) || inRoundedRect(px, py, 56, 74, 9, 12, 4.5)) return true;
  if (quadDist(px, py, 12, 86, 48, 98, 84, 86) <= 2.75) return true; /* قوس */
  return false;
}

/** رندر آیکون با SS×SS فوق‌نمونه‌گیری */
function renderIcon(size, markScale) {
  const SS = 3;
  const W = size * SS;
  const buf = Buffer.alloc(size * size * 4);
  const cornerR = 0.22 * size * SS;
  /* ناحیه نشان در فضای فوق‌نمونه */
  const m = markScale * size * SS;
  const off = (W - m) / 2;
  const s = m / 96;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x * SS + sx + 0.5;
          const py = y * SS + sy + 0.5;
          let c;
          if (inRoundedRect(px, py, 0, 0, W, W, cornerR)) {
            /* داخل کاشی سبز — نشان سفید؟ */
            const mx = (px - off) / s;
            const my = (py - off) / s;
            c = inMark(mx, my) ? WHITE : GREEN;
          } else {
            c = [0, 0, 0, 0];
          }
          r += c[0]; g += c[1]; b += c[2]; a += c[3];
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      buf[i] = Math.round(r / n);
      buf[i + 1] = Math.round(g / n);
      buf[i + 2] = Math.round(b / n);
      buf[i + 3] = Math.round(a / n);
    }
  }
  return buf;
}

/* ── تولید خروجی‌ها ── */
const outDir = path.join(__dirname, "..", "public", "icons");
fs.mkdirSync(outDir, { recursive: true });

const targets = [
  { name: "icon-192.png", size: 192, mark: 0.62 },
  { name: "icon-512.png", size: 512, mark: 0.62 },
  /* maskable: ناحیه امن ۸۰٪ — نشان کوچک‌تر */
  { name: "icon-maskable-512.png", size: 512, mark: 0.52 },
];

for (const t of targets) {
  const png = encodePNG(t.size, t.size, renderIcon(t.size, t.mark));
  fs.writeFileSync(path.join(outDir, t.name), png);
  console.log("OK:", t.name, Math.round(png.length / 1024) + "KB");
}
console.log("DONE");
