/* پلاگین dev ویته — اجرای توابع سرورلس api/*.js روی سرور توسعه
   تا تغییرات فرانت‌اند با «npm run dev» بدون دپلوی قابل مشاهده باشد.

   - درخواست‌های /api/* با همان فایل‌های api/*.js (امضای سازگار با Vercel) اجرا می‌شوند
   - متغیرهای ‎.env‎/‎.env.local‎ پیش از اجرا داخل process.env تزریق می‌شوند
   - اگر Supabase از این شبکه در دسترس نباشد (ایران بدون VPN) یا اجرای محلی
     با خطای سرور متوقف شود، همان درخواست به نسخه‌ی دپلوی‌شده فوروارد
     می‌شود (DEV_API_FALLBACK در ‎.env‎) — یعنی همان مسیر production،
     فقط فرانت‌اند محلی و زنده است. */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ServerResponse } from "node:http";
import type { Connect, Plugin, ViteDevServer } from "vite";
import { loadEnv } from "vite";

/* امضای توابع سرورلس Vercel: (req, res) با http خام */
type ServerlessHandler = (req: unknown, res: unknown) => Promise<void> | void;

/* پاسخ بافر‌شده‌ی اجرای محلی — در صورت نیاز به فوروارد، هیچ‌چیز روی
   سوکت واقعی نوشته نشده باشد */
interface MockRes {
  statusCode: number;
  headers: Record<string, string>;
  chunks: Buffer[];
  writeHead(status: number, headers?: Record<string, string>): MockRes;
  end(chunk?: string | Buffer): MockRes;
}

/* این توابع برای اجرای محلی به SUPABASE_URL وصل می‌شوند؛ پیش از اجرا
   دسترسی شبکه سنجیده می‌شود. card-convert سرویس ایرانی صدا می‌زند و
   همیشه اول محلی اجرا می‌شود. */
const SUPABASE_FNS = new Set([
  "rpc",
  "send-otp",
  "upload-photo",
  "upload-avatar",
  "sms-webhook",
]);

const LOCAL_TIMEOUT_MS = 15_000; /* هم‌اندازه‌ی تایم‌اوت httpClient */
const PROBE_TTL_MS = 30_000; /* نتیجه‌ی سنجش دسترسی، ۳۰ ثانیه کش */
const PROBE_TIMEOUT_MS = 2_500;

export function devApiPlugin(): Plugin {
  return {
    name: "dev-api",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      const apiDir = path.resolve(server.config.root, "api");
      const log = server.config.logger;

      /* توابع سرورلس از process.env می‌خوانند؛ envهای فایل‌ها را تزریق
         می‌کنیم (فقط وقتی در shell تعیین نشده باشند) */
      const env = loadEnv(server.config.mode, server.config.root, "");
      for (const [k, v] of Object.entries(env)) {
        if (v !== undefined && process.env[k] === undefined) process.env[k] = v;
      }

      const fallbackBase = (process.env.DEV_API_FALLBACK ?? "")
        .trim()
        .replace(/\/+$/, "");
      if (!fallbackBase) {
        log.warn(
          "[dev-api] DEV_API_FALLBACK تنظیم نشده — اگر Supabase در این شبکه در دسترس نباشد، /api/* محلی کار نمی‌کند",
        );
      }

      /* سنجش دسترسی به Supabase با کش کوتاه — در ایرانِ بدون VPN اتصال
         به supabase.co به‌جای خطای سریع معمولاً هنگ می‌کند؛ نتیجه‌ی کش‌شده
         مانع انتظار تکراری در هر درخواست است */
      let supabaseOk: boolean | null = null;
      let probedAt = 0;

      async function supabaseReachable(): Promise<boolean> {
        if (supabaseOk !== null && Date.now() - probedAt < PROBE_TTL_MS) {
          return supabaseOk;
        }
        const base = (
          process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ""
        ).replace(/\/$/, "");
        let ok = false;
        if (base) {
          const ctl = new AbortController();
          const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
          try {
            /* هر پاسخ HTTP (حتی 4xx/5xx) یعنی شبکه باز است */
            await fetch(base + "/rest/v1/", {
              method: "HEAD",
              signal: ctl.signal,
            });
            ok = true;
          } catch {
            ok = false;
          } finally {
            clearTimeout(timer);
          }
        }
        supabaseOk = ok;
        probedAt = Date.now();
        return ok;
      }

      server.middlewares.use("/api", (req, res, next) => {
        void handle(req, res).catch((e) => {
          log.error(`[dev-api] ${String((e as Error)?.stack ?? e)}`);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "DEV_API_ERROR" }));
          } else {
            res.destroy();
          }
        });

        async function handle(
          req: Connect.IncomingMessage,
          res: ServerResponse,
        ): Promise<void> {
          const name = (req.url ?? "")
            .split("?")[0]
            .replace(/^\/+|\/+$/g, "");
          const file = name ? path.join(apiDir, `${name}.js`) : "";
          if (!file || !fs.existsSync(file)) return next(); /* api نیست → خود ویته */

          const body = await readBody(req);

          /* ۱) اجرای محلی تابع سرورلس */
          let local: MockRes | null = null;
          let localError: string | null = null;
          const tryLocal =
            !SUPABASE_FNS.has(name) || (await supabaseReachable());
          if (tryLocal) {
            try {
              local = await runLocal(file, req, body);
            } catch (e) {
              localError = String((e as Error)?.message ?? e);
            }
          }

          /* موفق = هر پاسخی غیر از خطای سرور (5xx) */
          if (local && local.statusCode < 500) {
            return sendMock(res, local);
          }

          /* ۲) فوروارد به نسخه‌ی دپلوی‌شده — همان مسیر production */
          if (fallbackBase) {
            try {
              return await forward(fallbackBase, name, req, body, res);
            } catch (e) {
              log.error(`[dev-api] فوروارد ${name} هم ناموفق: ${String(e)}`);
            }
          }

          /* ۳) هیچ مسیری جواب نداد — پاسخ خطای محلی را برگردان */
          if (local) return sendMock(res, local);
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "UPSTREAM_UNREACHABLE",
              detail: localError ?? "no route available",
            }),
          );
        }
      });

      /* ── اجرای api/*.js با req/res ساختگی — بدنه از قبل خوانده شده ── */

      async function runLocal(
        file: string,
        req: Connect.IncomingMessage,
        body: Buffer,
      ): Promise<MockRes> {
        /* import با کلید mtime → پس از ویرایش فایل، نسخه‌ی تازه بارگذاری می‌شود */
        const mtime = fs.statSync(file).mtimeMs;
        const mod = (await import(
          `${pathToFileURL(file).href}?t=${mtime}`
        )) as { default?: ServerlessHandler };
        const handler = mod.default;
        if (typeof handler !== "function") {
          throw new Error("ماژول default export ندارد");
        }

        const mockRes: MockRes = {
          statusCode: 200,
          headers: {},
          chunks: [],
          writeHead(status, headers) {
            mockRes.statusCode = status;
            if (headers) Object.assign(mockRes.headers, headers);
            return mockRes;
          },
          end(chunk) {
            if (chunk != null) {
              mockRes.chunks.push(
                typeof chunk === "string" ? Buffer.from(chunk) : chunk,
              );
            }
            return mockRes;
          },
        };

        /* توابع api فقط method/headers می‌خوانند و بدنه را با on("data") جمع می‌کنند */
        const mockReq = {
          method: req.method,
          headers: req.headers,
          on(event: string, cb: (arg?: unknown) => void) {
            if (event === "data") {
              if (body.length) cb(body);
            } else if (event === "end") {
              cb();
            }
            return mockReq;
          },
        };

        await withTimeout(
          Promise.resolve(handler(mockReq, mockRes)),
          LOCAL_TIMEOUT_MS,
          `timeout در ${path.basename(file)}`,
        );
        return mockRes;
      }

      function sendMock(res: ServerResponse, m: MockRes): void {
        const headers = { ...m.headers };
        if (!headers["Content-Type"] && !headers["content-type"]) {
          headers["Content-Type"] = "application/json";
        }
        res.writeHead(m.statusCode, headers);
        res.end(m.chunks.length ? Buffer.concat(m.chunks) : undefined);
      }

      async function forward(
        base: string,
        name: string,
        req: Connect.IncomingMessage,
        body: Buffer,
        res: ServerResponse,
      ): Promise<void> {
        const method = (req.method ?? "POST").toUpperCase();
        const headers: Record<string, string> = {};
        const ct = req.headers["content-type"];
        if (ct) headers["Content-Type"] = ct;

        const init: RequestInit = {
          method,
          headers,
          signal: AbortSignal.timeout(20_000),
        };
        if (method !== "GET" && method !== "HEAD" && body.length) {
          init.body = body.toString("utf8");
        }

        const r = await fetch(`${base}/api/${name}`, init);
        const text = await r.text();
        res.writeHead(r.status, {
          "Content-Type": r.headers.get("content-type") ?? "application/json",
          "Cache-Control": "no-store",
        });
        res.end(text);
      }
    },
  };
}

function readBody(req: Connect.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("error", () => resolve(Buffer.concat(chunks)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(msg)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
