/* رله محلی Maven v4 — استریم مستقیم curl → Gradle
   یافته‌ها: فقط curl پایدار است؛ بافر کامل باعث می‌شد فایل‌های بزرگ
   (>20MB با ~100KB/s) از max-time بگذرند و ناقص «موفق» شوند.
   v4: stdout کِرل مستقیم به سوکت Gradle استریم می‌شود — داده دائماً
   جریان دارد (سوکت‌تایم‌اوت گرتل نمی‌سوزد) و اگر کِرل وسط راه بمیرد،
   سوکت destroy می‌شود تا گرتل خودش retry کند (SHA را خودش چک می‌کند).

   اجرا: node scripts/maven-relay.js  (پیش از gradlew) */

import http from "node:http";
import { spawn } from "node:child_process";

const UPSTREAMS = [
  "https://mirrors.cloud.tencent.com/nexus/repository/maven-public",
  "https://maven.aliyun.com/repository/google",
];
const PORT = 8081;

let served = 0;
let failed = 0;
let inflight = 0;

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405).end();
    return;
  }

  inflight++;

  /* HEAD → فقط curl -I و پاسخ کد وضعیت */
  if (req.method === "HEAD") {
    const p = spawn(
      "curl",
      [
        "-sIL",
        "--max-time",
        "60",
        "-o",
        "NUL",
        "-w",
        "%{http_code}",
        UPSTREAMS[0] + req.url,
      ],
      { windowsHide: true },
    );
    let out = "";
    p.stdout.on("data", (c) => (out += c));
    p.on("close", () => {
      const code = parseInt(out.trim(), 10) || 502;
      res.writeHead(code).end();
      inflight--;
    });
    return;
  }

  let settled = false;
  let curl = null;
  const finish = (ok) => {
    if (settled) return;
    settled = true;
    inflight--;
    if (ok) served++;
    else failed++;
  };

  /* کلاینت قطع کرد → curl را بکش */
  res.on("close", () => {
    if (!settled && curl) curl.kill();
    finish(false);
  });

  const tryStream = (urlIdx) => {
    if (settled) return;
    const url = UPSTREAMS[urlIdx % UPSTREAMS.length] + req.url;
    console.error(`[relay→] ${req.method} ${url}`);

    curl = spawn(
      "curl",
      [
        "-sLv", /* v = دیاگ روی stderr */
        "--fail", /* 404/4xx/5xx → بدون بدنه + exit 22 → میرور بعدی */
        "--max-time",
        "1800", /* ۳۰ دقیقه — فایل‌های بزرگ با ~100KB/s */
        "--connect-timeout",
        "20",
        url,
      ],
      { windowsHide: true },
    );

    let headerSent = false;
    let bytes = 0;
    let meta = null;

    curl.stdout.on("data", (chunk) => {
      if (settled) return;

      if (!headerSent) {
        /* هنوز هدر نفرستادیم — دنبال مارکر نمی‌گردیم چون هنوز همه‌چیز بدنه است
           (curl -w فقط در پایان می‌آید) */
        headerSent = true;
        res.writeHead(200, {
          "Content-Type": /\.pom$|\.xml$/
            ? "application/xml"
            : /\.module$/
              ? "application/json"
              : "application/octet-stream",
        });
      }
      bytes += chunk.length;
      res.write(chunk);
    });

    let dbg = "";
    curl.stderr.on("data", (c) => {
      dbg += c.toString("utf8");
    });
    curl.on("close", (code) => {
      /* فقط خطوط پروتکل — بدنه دیاگ */
      const lines = dbg
        .split(/\r?\n/)
        .filter((l) => /^[*<>]/.test(l) && !/^[*]  [sc]/.test(l));
      console.error(`[curl-v] exit=${code} bytes=${bytes}`);
      for (const l of lines.slice(0, 14)) console.error(`[curl-v] ${l}`);
    });

    curl.on("close", (code) => {
      if (settled) return;

      /* مارکر فقط وقتی معتبر است که stdout فقط متادیتا باشد (0 bytes بدنه) */
      /* استریم کرده‌ایم — اگر کِرل با کد ناصفر مرده و چیزی نفرستاده → میرور بعدی */
      if (code !== 0 && bytes === 0) {
        if (urlIdx + 1 < UPSTREAMS.length * 2) {
          tryStream(urlIdx + 1);
        } else {
          finish(false);
          if (!res.headersSent) res.writeHead(502);
          res.end();
        }
        return;
      }
      /* موفق (یا ناقص — گرتل با SHA خودش متوجه می‌شود و retry می‌کند) */
      finish(true);
      res.end();
    });

    curl.on("error", () => {
      if (!settled) {
        finish(false);
        if (!res.headersSent) res.writeHead(502);
        res.end();
      }
    });
  };

  tryStream(0);
});

server.headersTimeout = 1_800_000;
server.requestTimeout = 1_800_000;

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `[relay] Maven relay v4 (stream) http://127.0.0.1:${PORT} → ${UPSTREAMS[0]}`,
  );
  setInterval(() => {
    console.log(
      `[relay] alive — served=${served} failed=${failed} inflight=${inflight}`,
    );
  }, 30_000).unref();
});
