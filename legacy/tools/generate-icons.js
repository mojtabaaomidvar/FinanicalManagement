/* ═══════════════════════════════════════════════
   تولید آیکون‌های PNG — بدون وابستگی خارجی
   یک آیکون ساده: پس‌زمینه گرادیانی سبز + علامت تومان
   خروجی: icons/icon-192.png, icon-512.png, icon-maskable-512.png
   اجرا: node tools/generate-icons.js
   ═══════════════════════════════════════════════ */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

/* ── PNG encoder (RGBA, بدون فیلتر) ── */
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
  for (let i = 0; i < buf.length; i++)
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
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
  ihdr[9] = 6; /* color type RGBA */
  /* فیلتر صفر برای هر سطر */
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ── رسم آیکون ── */
function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function drawIcon(size, maskable) {
  const rgba = Buffer.alloc(size * size * 4);

  /* ناحیه امن برای maskable: ۸۰٪ مرکز */
  const cx = size / 2,
    cy = size / 2;
  const R = size / 2;

  /* گرادیان شعاعی سبز تیره → روشن */
  const cInner = [52, 211, 153]; /* emerald-400 */
  const cOuter = [6, 78, 59]; /* emerald-900 */

  /* شکل علامت "ت" ساده‌شده (نماد تومان) — با مستطیل‌های گرد */
  /* مختصات نسبی */
  const put = (x, y, c, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    /* alpha blend */
    const na = a + (rgba[i + 3] / 255) * (255 - a);
    if (na === 0) return;
    rgba[i] = Math.round(
      (c[0] * a + rgba[i] * (rgba[i + 3] / 255) * (255 - a)) / na,
    );
    rgba[i + 1] = Math.round(
      (c[1] * a + rgba[i + 1] * (rgba[i + 3] / 255) * (255 - a)) / na,
    );
    rgba[i + 2] = Math.round(
      (c[2] * a + rgba[i + 2] * (rgba[i + 3] / 255) * (255 - a)) / na,
    );
    rgba[i + 3] = Math.round(na);
  };

  /* پس‌زمینه: دایره (any) یا مربع کامل (maskable) */
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx,
        dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const t = Math.min(dist / R, 1);
      const c = mix(cInner, cOuter, t * t);

      if (maskable) {
        const i = (y * size + x) * 4;
        rgba[i] = c[0];
        rgba[i + 1] = c[1];
        rgba[i + 2] = c[2];
        rgba[i + 3] = 255;
      } else {
        /* گوشه‌های گرد: radius = 22% */
        const r = R * 0.44;
        let inside = true;
        const corners = [
          [r, r],
          [size - r, r],
          [r, size - r],
          [size - r, size - r],
        ];
        for (const [qx, qy] of corners) {
          const inQuad =
            (qx === r && x < r) || (qx === size - r && x >= size - r)
              ? (qy === r && y < r) || (qy === size - r && y >= size - r)
              : false;
          if (inQuad) {
            const ddx = x - qx,
              ddy = y - qy;
            if (ddx * ddx + ddy * ddy > r * r) inside = false;
          }
        }
        if (inside) {
          const i = (y * size + x) * 4;
          rgba[i] = c[0];
          rgba[i + 1] = c[1];
          rgba[i + 2] = c[2];
          rgba[i + 3] = 255;
        }
      }
    }
  }

  /* ── رسم "ت" (تومان) با ضخامت خط ── */
  const white = [255, 255, 255];
  const u = size / 100; /* واحد نسبی */

  /* ضخامت خط */
  const w = 11 * u;

  /* میله افقی بالا: x از ۲۸ تا ۷۲، y حدود ۳۰ */
  const hTop = 30 * u;
  for (let x = 28 * u; x <= 72 * u; x++) {
    for (let d = 0; d < w; d++) {
      put(Math.round(x), Math.round(hTop + d), white);
    }
  }

  /* میله عمودی: x حدود ۴۷، y از ۳۰ تا ۷۵ */
  const vX = 47 * u;
  for (let y = hTop; y <= 75 * u; y++) {
    for (let d = 0; d < w; d++) {
      put(Math.round(vX + d), Math.round(y), white);
    }
  }

  /* دنباله افقی وسط: x از ۴۷ تا ۷۲، y حدود ۵۲ */
  const hMid = 52 * u;
  for (let x = vX; x <= 72 * u; x++) {
    for (let d = 0; d < w; d++) {
      put(Math.round(x), Math.round(hMid + d), white);
    }
  }

  /* نقطه‌های تومان: دو نقطه بالا */
  const dotR = 5.5 * u;
  const dots = [
    [30 * u, 52 * u],
    [30 * u, 66 * u],
  ];
  for (const [dxp, dyp] of dots) {
    for (let y = -dotR; y <= dotR; y++) {
      for (let x = -dotR; x <= dotR; x++) {
        if (x * x + y * y <= dotR * dotR) {
          put(Math.round(dxp + x), Math.round(dyp + y), white);
        }
      }
    }
  }

  return encodePNG(size, size, rgba);
}

/* ── اجرا ── */
const outDir = path.join(__dirname, "..", "icons");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const targets = [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["icon-maskable-512.png", 512, true],
];

for (const [name, size, maskable] of targets) {
  const png = drawIcon(size, maskable);
  fs.writeFileSync(path.join(outDir, name), png);
  console.log(
    `✓ ${name} (${size}x${size}${maskable ? ", maskable" : ""}) — ${(png.length / 1024).toFixed(1)} KB`,
  );
}

console.log("\nDone. Icons written to personal-finance-pwa/icons/");
