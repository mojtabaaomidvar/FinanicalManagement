/* ═══════════════════════════════════════════════════════════════════════
   ساختنِ کد QR صفحهٔ دانلود — یک‌بار اجرا می‌شود، خروجی درون‌مخزنی است
   خروجی: tools/qr-download.svg  +  جای‌گذاری درون‌خطی در site/download/index.html
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
    console.error(
      "بستهٔ qrcode نصب نیست. اول این را بزن:\n\n  npm i -D qrcode\n",
    );
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
  const dark = [
    ...raw.matchAll(/<path[^>]*stroke="[^"]*"[^>]*d="([^"]+)"/g),
  ].map((m) => m[1]);

  if (!viewBox || !dark.length) {
    console.error(
      "خروجیِ qrcode آن شکلی که منتظرش بودم نبود. خودِ خروجی:\n" +
        raw.slice(0, 400),
    );
    process.exit(1);
  }

  const modules = Number(viewBox.split(" ")[2]);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" shape-rendering="crispEdges" role="img" aria-label="کد QR نشانی دانلود خانه‌یار">\n` +
    `  <path fill="#FFFFFF" d="M0 0h${modules}v${modules}H0z"/>\n` +
    dark.map((d) => `  <path stroke="#0D1B2A" d="${d}"/>`).join("\n") +
    `\n</svg>\n`;

  fs.writeFileSync(OUT, svg, "utf8");

  /* ── راستی‌آزمایی، پیش از آن‌که چیزی داخلِ HTML بنشیند ──
     مسیرهای SVG را از روی نقطهٔ جاری راه می‌رود (qrcode بعد از یک M مطلق
     از m نسبی استفاده می‌کند، پس شمردنِ ساده جواب نمی‌دهد) و ماتریسِ
     حاصل را خانه‌به‌خانه با بیت‌مپِ خودِ کتابخانه می‌سنجد. اگر یک ماژول
     هم جابه‌جا باشد یا حاشیه تیره شده باشد، همین‌جا می‌ایستد. */
  const grid = Array.from({ length: modules }, () => new Uint8Array(modules));
  const qr = QRCode.create(URL, { errorCorrectionLevel: "M" });
  for (const d of dark) {
    let x = 0,
      y = 0;
    for (const t of d.matchAll(/([MmHhVv])\s*(-?[\d.]+)(?:\s+(-?[\d.]+))?/g)) {
      const cmd = t[1],
        a = Number(t[2]);
      if (cmd === "M") {
        x = a;
        y = Number(t[3]);
      } else if (cmd === "m") {
        x += a;
        y += Number(t[3]);
      } else if (cmd === "h" || cmd === "H") {
        const to = cmd === "h" ? x + a : a;
        for (let i = Math.min(x, to); i < Math.max(x, to); i++)
          grid[Math.floor(y)][i] = 1;
        x = to;
      } else {
        y = cmd === "v" ? y + a : a;
      }
    }
  }
  const src = qr.modules;
  const margin = (modules - src.size) / 2;
  let bad = 0;
  for (let r = 0; r < src.size; r++)
    for (let c = 0; c < src.size; c++)
      if ((src.data[r * src.size + c] & 1) !== grid[r + margin][c + margin])
        bad++;
  let marginDark = 0;
  for (let r = 0; r < modules; r++)
    for (let c = 0; c < modules; c++)
      if (
        (r < margin ||
          r >= src.size + margin ||
          c < margin ||
          c >= src.size + margin) &&
        grid[r][c]
      )
        marginDark++;
  if (bad || marginDark) {
    console.error(
      `خروجی با ماتریسِ کتابخانه نمی‌خواند (اختلاف ${bad}، حاشیهٔ تیره ${marginDark}).`,
    );
    process.exit(1);
  }

  /* ── جای‌گذاری داخلِ خودِ صفحه ──
     تا SVG درون‌خطی نشود، صفحه یک درخواستِ شبکه‌ای اضافه می‌خواهد و با
     قاعدهٔ «هیچ وابستگیِ زمانِ اجرا» نمی‌خواند. جای‌گذاری بینِ دو نشانه
     است تا اجرای دوبارهٔ این اسکریپت فقط همان تکه را عوض کند. */
  const PAGE = path.join(__dirname, "..", "site", "download", "index.html");
  const BEGIN = "<!-- QR:BEGIN -->";
  const END = "<!-- QR:END -->";
  let html = fs.readFileSync(PAGE, "utf8");
  const i = html.indexOf(BEGIN);
  const j = html.indexOf(END);
  if (i < 0 || j < 0 || j < i) {
    console.error(`نشانه‌های ${BEGIN} و ${END} در ${PAGE} پیدا نشد.`);
    process.exit(1);
  }
  const indent = " ".repeat(html.slice(0, i).split("\n").pop().length);
  const inline = svg
    .trimEnd()
    .split("\n")
    .map((l) => indent + l)
    .join("\n");
  html =
    html.slice(0, i + BEGIN.length) +
    "\n" +
    inline +
    "\n" +
    indent +
    html.slice(j);
  fs.writeFileSync(PAGE, html, "utf8");

  console.log(`✓ ${path.relative(path.join(__dirname, ".."), OUT)}`);
  console.log(
    `✓ ${path.relative(path.join(__dirname, ".."), PAGE)} (بینِ QR:BEGIN و QR:END)`,
  );
  console.log(`  نشانی: ${URL}`);
  console.log(`  ماتریس: ${modules}×${modules} ماژول (با حاشیه)`);
  console.log(`  حجم: ${Buffer.byteLength(svg)} بایت`);
  console.log(
    `  راستی‌آزمایی: ${src.size}×${src.size} ماژول، صفر اختلاف با بیت‌مپِ کتابخانه`,
  );
  console.log(`\nصفحه را باز کن و کد را با دوربینِ گوشی امتحان کن.`);
}

main().catch((e) => {
  console.error("خطا: " + e.message);
  process.exit(1);
});
