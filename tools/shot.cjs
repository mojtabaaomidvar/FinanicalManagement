/* ═══════════════════════════════════════════════════════════════════════
   عکس‌گرفتن از صفحه‌های site/ برای بازبینی چشمی — Playwright
   خروجی: _shots/<صفحه>-<عرض>x<ارتفاع>.png   (_shots/ در .gitignore است)
   اجرا:  node tools/shot.cjs            ← همهٔ صفحه‌ها، همهٔ عرض‌ها
          node tools/shot.cjs download   ← فقط صفحهٔ دانلود
          node tools/shot.cjs / 390      ← صفحهٔ اصلی، فقط عرضِ موبایل

   ── چرا این شکلی؟ ──
   ۱. مرورگرِ خودِ ویندوز استفاده می‌شود (channel: msedge → chrome)، چون
      `npx playwright install` از ایران به cdn.playwright.dev وصل نمی‌شود.
      پس هیچ چیزی دانلود نمی‌شود؛ همان Edge ای که روی ویندوز ۱۱ هست کافی است.
   ۲. صفحه‌ها روی یک سرورِ کوچکِ محلی سرو می‌شوند، نه با file://، چون
      @font-face زیر file:// در کرومیوم بی‌صدا شکست می‌خورد و عکس با فونتِ
      اشتباه گرفته می‌شد.
   ۳. کلاسِ .in دستی روی .reveal گذاشته می‌شود؛ وگرنه در عکسِ تمام‌صفحه،
      هر چه پایین‌تر از تاشو باشد با opacity:0 نامرئی می‌ماند.
   ═══════════════════════════════════════════════════════════════════════ */

const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SITE = path.join(ROOT, "site");
const OUT = path.join(ROOT, "_shots");

/* ── صفحه‌هایی که عکس گرفته می‌شود؛ کلید = نامِ فایلِ خروجی ── */
const PAGES = {
  home: "/",
  download: "/download/",
};

/* ── عرض‌های بازبینی: موبایلِ کوچک، موبایلِ معمول، تبلت، دسکتاپ ── */
const VIEWPORTS = [
  { w: 360, h: 800 },
  { w: 390, h: 844 },
  { w: 768, h: 1024 },
  { w: 1440, h: 900 },
];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".apk": "application/vnd.android.package-archive",
};

/* ── سرورِ ایستا؛ فقط داخلِ site/ و فقط ۱۲۷.۰.۰.۱ ── */
function serve() {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split("?")[0]);
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.join(SITE, path.normalize(rel));
    // بیرون‌رفتن از site/ با ../ مسدود شود
    if (!file.startsWith(SITE)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    fs.readFile(file, (err, buf) => {
      if (err) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(buf);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

/* ── مرورگر: اول Edge، بعد Chrome، بعد هر کرومیومی که Playwright دارد ── */
async function launch(chromium) {
  const tries = [{ channel: "msedge" }, { channel: "chrome" }, {}];
  for (const opts of tries) {
    try {
      const b = await chromium.launch(opts);
      console.log(`مرورگر: ${opts.channel || "chromium همراهِ playwright"}`);
      return b;
    } catch (e) {
      console.log(`  ${opts.channel || "chromium"} نشد: ${String(e.message).split("\n")[0]}`);
    }
  }
  throw new Error(
    "هیچ مرورگری پیدا نشد. Edge یا Chrome روی ویندوز باید نصب باشد."
  );
}

async function main() {
  const { chromium } = require("playwright");

  const argv = process.argv.slice(2);
  const wantPage = argv.find((a) => !/^\d+$/.test(a));
  const wantWidth = argv.find((a) => /^\d+$/.test(a));

  const pages = Object.entries(PAGES).filter(
    ([name, url]) => !wantPage || name === wantPage || url === wantPage || url === `/${wantPage}/`
  );
  const views = VIEWPORTS.filter((v) => !wantWidth || String(v.w) === wantWidth);

  if (!pages.length) throw new Error(`صفحهٔ «${wantPage}» را نمی‌شناسم. یکی از: ${Object.keys(PAGES).join(", ")}`);
  if (!views.length) throw new Error(`عرضِ ${wantWidth} در فهرست نیست: ${VIEWPORTS.map((v) => v.w).join(", ")}`);

  fs.mkdirSync(OUT, { recursive: true });
  const { server, port } = await serve();
  const browser = await launch(chromium);

  const problems = [];
  try {
    for (const [name, url] of pages) {
      for (const { w, h } of views) {
        const ctx = await browser.newContext({
          viewport: { width: w, height: h },
          deviceScaleFactor: 2,
          locale: "fa-IR",
        });
        const page = await ctx.newPage();
        page.on("console", (m) => {
          if (m.type() === "error") problems.push(`[${name} ${w}] console: ${m.text()}`);
        });
        page.on("requestfailed", (r) => problems.push(`[${name} ${w}] بارنشد: ${r.url()}`));

        await page.goto(`http://127.0.0.1:${port}${url}`, { waitUntil: "load" });
        await page.evaluate(async () => {
          document.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"));
          if (document.fonts) await document.fonts.ready;
        });
        await page.waitForTimeout(450);

        const file = path.join(OUT, `${name}-${w}x${h}.png`);
        await page.screenshot({ path: file, fullPage: true });
        console.log(`✓ ${path.relative(ROOT, file)}`);
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  if (problems.length) {
    console.log("\n── هشدارها ──");
    for (const p of new Set(problems)) console.log("  " + p);
  }
  console.log(`\nعکس‌ها در _shots/ هستند.`);
}

main().catch((e) => {
  console.error("\nخطا: " + e.message);
  process.exit(1);
});
