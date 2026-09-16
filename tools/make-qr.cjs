/* ═══════════════════════════════════════════════════════════════════════
   ساختنِ کد QR صفحهٔ دانلود — یک‌بار اجرا می‌شود، خروجی درون‌مخزنی است
   خروجی: tools/qr-download.svg   (بعد درون site/download/index.html می‌نشیند)
   اجرا:  npm i -D qrcode  &&  node tools/make-qr.cjs

   ── چرا اینجا و نه در زمانِ اجرا؟ ──
   صفحهٔ سایت هیچ JS سنگین و هیچ وابستگیِ شبکه‌ای ندارد؛ همان قاعدهٔ
   نشان‌های درون‌خطی. پس QR هم همین‌جا روی لپ‌تاپ ساخته و به‌صورت SVG
   درون‌خطی در HTML چسبانده می‌شود. اگر نشانی عوض شد، URL پایین را
   عوض کن و همین اسکریپت را دوباره بزن.
   ═══════════════════════════════════════════════════════════════════════ */

const fs = require("fs");
const path = require("path");

const URL = "https://khaanehyar.ir/download/";
const OUT = path.join(__dirname, "qr-download.svg");

async function main() {
  let QRCode;
  try {
    QRCode = require("qrcode");
  } catch {
    console.error("بستهٔ qrcode نصب نیست. اول این را بزن:\n\n  npm i -D qrcode\n");
    process.exit(1);
  }

  /* errorCorrectionLevel: M → تا ۱۵٪ خط‌وخش را تحمل می‌کند؛ برای کدی که
     روی نمایشگر است M کافی است و ماتریس را بی‌خود بزرگ نمی‌کند.
     margin: 2 → حاشیهٔ سفیدِ اجباری داخلِ خودِ SVG می‌آید، پس حتی اگر CSS
     عوض شود، کد اسکن‌شدنی می‌ماند. */
  const raw = await QRCode.toString(URL, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
  });

  const viewBox = (raw.match(/viewBox="([^"]+)"/) || [])[1];
  // مسیرِ دومِ خروجیِ qrcode مسیرِ خودِ ماژول‌هاست (اولی پس‌زمینهٔ سفید است)
  const dark = [...raw.matchAll(/<path[^>]*stroke="[^"]*"[^>]*d="([^"]+)"/g)].map((m) => m[1]);

  if (!viewBox || !dark.length) {
    console.error("خروجیِ qrcode آن شکلی که منتظرش بودم نبود. خودِ خروجی:\n" + raw.slice(0, 400));
    process.exit(1);
  }

  const modules = Number(viewBox.split(" ")[2]);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" shape-rendering="crispEdges" role="img" aria-label="کد QR نشانی دانلود خانه‌یار">\n` +
    `  <path fill="#FFFFFF" d="M0 0h${modules}v${modules}H0z"/>\n` +
    dark.map((d) => `  <path stroke="#0D1B2A" d="${d}"/>`).join("\n") +
    `\n</svg>\n`;

  fs.writeFileSync(OUT, svg, "utf8");

  console.log(`✓ ${path.relative(path.join(__dirname, ".."), OUT)}`);
  console.log(`  نشانی: ${URL}`);
  console.log(`  ماتریس: ${modules}×${modules} ماژول (با حاشیه)`);
  console.log(`  حجم: ${Buffer.byteLength(svg)} بایت`);
  console.log(`\nفایل را در مرورگر باز کن و با دوربینِ گوشی امتحان کن.`);
}

main().catch((e) => {
  console.error("خطا: " + e.message);
  process.exit(1);
});
