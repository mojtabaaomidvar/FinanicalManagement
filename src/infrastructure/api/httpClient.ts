/* httpClient مرکزی — تنها نقطه خروج درخواست‌های API
   - دو مسیر: مستقیم به Supabase و پروکسی سرورلس /api/rpc (عبور از مسدودسازی supabase.co در ایران)
   - مسیر برنده با یک سنجش همزمان (RPC فقط-خواندنی) پیدا و در localStorage ذخیره می‌شود
     → بدون انتظار تکراری برای کاربرانی که مسیر مستقیم برایشان مسدود است
   - خطای شبکه هر مسیر → یک‌بار مسیر دیگر امتحان می‌شود (مثلاً وسط نشست VPN روشن/خاموش شود)
   - HTTPS اجباری (به‌جز localhost) · نرمال‌سازی خطاها به AppError با پیام فارسی
   هیچ fetch مستقیمی خارج از این فایل مجاز نیست. */

import { supabaseConfig, isSupabaseConfigured } from "@/shared/config/supabase";
import { AppError, type AppErrorCode } from "@/shared/lib/appError";

const RPC_ERROR_MAP: { re: RegExp; code: AppErrorCode; msg: string }[] = [
  { re: /SESSION_EXPIRED/, code: "SESSION_EXPIRED", msg: "نشست منقضی شده — لطفاً دوباره وارد شوید" },
  { re: /TOO_SOON/, code: "TOO_SOON", msg: "کد قبلاً ارسال شده — یک دقیقه صبر کنید" },
  { re: /TOO_MANY_ATTEMPTS/, code: "TOO_MANY_ATTEMPTS", msg: "تلاش‌های ناموفق زیاد بوده — ۱۵ دقیقه بعد امتحان کنید" },
  { re: /PHONE_EXISTS/, code: "PHONE_EXISTS", msg: "این شماره قبلاً ثبت‌نام کرده است" },
  { re: /INVALID_OTP/, code: "INVALID_OTP", msg: "کد وارد شده صحیح نیست یا منقضی شده" },
  { re: /INVALID_INVITE/, code: "INVALID_INVITE", msg: "لینک دعوت نامعتبر یا منقضی شده است" },
  { re: /NO_MEMBER/, code: "NO_MEMBER", msg: "کاربری با این شماره یافت نشد" },
  { re: /INVALID_MEMBER/, code: "INVALID_MEMBER", msg: "عضو انتخاب‌شده معتبر نیست" },
  { re: /CANNOT_REMOVE_OWNER/, code: "CANNOT_REMOVE_OWNER", msg: "مدیر خانواده قابل حذف نیست" },
  { re: /FORBIDDEN/, code: "FORBIDDEN", msg: "اجازه انجام این کار را ندارید" },
  { re: /INVALID_(TYPE|AMOUNT|CATEGORY|DATE)/, code: "INVALID_TX", msg: "اطلاعات تراکنش معتبر نیست" },
  { re: /INVALID_TIME/, code: "INVALID_TX", msg: "ساعت انتخاب‌شده معتبر نیست" },
  { re: /REPEAT_END_REQUIRED/, code: "INVALID_TX", msg: "تراکنش تکرارشونده باید تاریخ پایان داشته باشد" },
  { re: /INVALID_REPEAT_END/, code: "INVALID_TX", msg: "تاریخ پایان تکرار باید بعد از تاریخ تراکنش باشد" },
  { re: /INVALID_REPEAT/, code: "INVALID_TX", msg: "دوره تکرار معتبر نیست" },
  { re: /INVALID_TRANSFER/, code: "INVALID_TX", msg: "برای انتقال، حساب مبدأ و مقصد (متفاوت) را انتخاب کنید" },
  { re: /INVALID_TITLE/, code: "INVALID_ACCOUNT", msg: "نام کارت/حساب معتبر نیست (حداکثر ۴۰ کاراکتر)" },
  { re: /INVALID_CARD/, code: "INVALID_ACCOUNT", msg: "شماره کارت باید ۱۶ رقم باشد" },
  { re: /INVALID_SHEBA/, code: "INVALID_ACCOUNT", msg: "شماره شبا معتبر نیست (IR + ۲۴ رقم)" },
  { re: /INVALID_ACCOUNT_NO/, code: "INVALID_ACCOUNT", msg: "شماره حساب معتبر نیست (۵ تا ۲۰ رقم)" },
  { re: /EMPTY_ACCOUNT/, code: "INVALID_ACCOUNT", msg: "حداقل یکی از شماره کارت، حساب یا شبا را وارد کنید" },
  { re: /INVALID_KIND/, code: "INVALID_ACCOUNT", msg: "نوع حساب معتبر نیست" },
  { re: /INVALID_ACCOUNT_ID/, code: "INVALID_ACCOUNT", msg: "حساب انتخاب‌شده معتبر نیست" },
  { re: /ACCOUNT_REQUIRED/, code: "INVALID_ACCOUNT", msg: "انتخاب حساب برای ثبت تراکنش الزامی است" },
  { re: /INVALID_SUBCATEGORY/, code: "INVALID_TX", msg: "زیردسته انتخاب‌شده معتبر نیست" },
  { re: /EVENT_DUPLICATE/, code: "INVALID_TX", msg: "این رویداد قبلاً ثبت شده است" },
  { re: /INVALID_RELATION/, code: "INVALID_TX", msg: "نسبت با مدیر خانواده را انتخاب کنید" },
  { re: /BANK_MISMATCH/, code: "INVALID_ACCOUNT", msg: "شماره کارت با بانک انتخاب‌شده هم‌خوانی ندارد" },
  { re: /NOT_FOUND/, code: "NOT_FOUND", msg: "مورد یافت نشد" },
  { re: /OTP_API_ONLY/, code: "OTP_API_ONLY", msg: "ارسال پیامک تنظیم نشده است" },
  { re: /UPSTREAM_UNREACHABLE/, code: "NETWORK", msg: "سرور میانی به دیتابیس دسترسی ندارد" },
  { re: /SERVER_NOT_CONFIGURED/, code: "SERVER", msg: "تنظیمات سرور ناقص است (SUPABASE_URL/KEY)" },
];

function mapRpcError(message: string, status: number): AppError {
  for (const m of RPC_ERROR_MAP) {
    if (m.re.test(message)) return new AppError(m.code, m.msg);
  }
  return new AppError("SERVER", message || `خطا در ارتباط با سرور (${status})`);
}

function assertHttps(url: string): void {
  const isLocal =
    typeof location !== "undefined" &&
    /^(localhost|127\.0\.0\.1)/.test(location.hostname);
  if (!url.startsWith("https://") && !isLocal) {
    throw new AppError("SERVER", "اتصال باید رمزنگاری‌شده (HTTPS) باشد");
  }
}

function isLocalHost(): boolean {
  return (
    typeof location !== "undefined" &&
    /^(localhost|127\.0\.0\.1)/.test(location.hostname)
  );
}

/** پیام خطای شبکه — در اجرای محلی راهنمایی دقیق‌تر */
function networkFailMessage(): string {
  return isLocalHost()
    ? "اتصال به دیتابیس ممکن نیست — برای تست محلی VPN را روشن کنید (یا از نسخه دپلوی‌شده استفاده کنید)"
    : "اتصال به سرور ممکن نیست — اینترنت خود را بررسی کنید";
}

/* ── دو مسیر ارتباط ── */

type RawResponse = { ok: boolean; status: number; text: string };

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** مستقیم به PostgREST ساپابیس (مسیر پیش‌فرض — خارج از ایران) */
async function rpcDirect(
  fn: string,
  params: Record<string, unknown>,
  timeoutMs: number,
): Promise<RawResponse> {
  const url = `${supabaseConfig.url.replace(/\/$/, "")}/rest/v1/rpc/${fn}`;
  assertHttps(url);
  let res: Response;
  try {
    res = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        apikey: supabaseConfig.anonKey,
        Authorization: "Bearer " + supabaseConfig.anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    }, timeoutMs);
  } catch {
    throw new AppError("NETWORK", networkFailMessage());
  }
  return { ok: res.ok, status: res.status, text: await res.text() };
}

/** از طریق تابع سرورلس /api/rpc روی همان دامنه (عبور از مسدودسازی) */
async function rpcProxy(
  fn: string,
  params: Record<string, unknown>,
  timeoutMs: number,
): Promise<RawResponse> {
  let res: Response;
  try {
    res = await fetchWithTimeout("/api/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fn, params }),
    }, timeoutMs);
  } catch {
    throw new AppError("NETWORK", networkFailMessage());
  }
  const text = await res.text();

  /* پاسخ HTML = تابع سرورلس اجرا نشده (vite dev بدون vercel dev) */
  if (text.startsWith("<")) {
    throw new AppError(
      "NETWORK",
      "سرور میانی در دسترس نیست — برای اجرای محلی «npx vercel dev» یا VPN لازم است",
    );
  }

  /* پروکسی به دیتابیس نرسید (مثلاً تابع محلی بدون VPN در ایران) */
  if (!res.ok && text.includes("UPSTREAM_UNREACHABLE")) {
    throw new AppError("NETWORK", networkFailMessage());
  }

  return { ok: res.ok, status: res.status, text };
}

/** تبدیل پاسخ خام به نتیجه یا خطای فارسی */
function parseRpcResult<T>(raw: RawResponse): T {
  let data: unknown = null;
  try {
    data = raw.text ? JSON.parse(raw.text) : null;
  } catch {
    /* بدنه غیر JSON */
  }
  if (!raw.ok) {
    const err = data as { message?: string; error?: string } | null;
    const msg = err?.message ?? err?.error ?? raw.text ?? "";
    throw mapRpcError(msg, raw.status);
  }
  return data as T;
}

/* ── انتخاب مسیر: سنجش همزمان + ذخیره مسیر برنده ── */

type RpcMode = "direct" | "proxy";

const MODE_STORAGE_KEY = "mali-man.rpcMode";
const PROBE_TIMEOUT_MS = 5000;
const RUN_TIMEOUT_MS = 15000;

let cachedMode: RpcMode | null = null;
let modeLoaded = false;
let probePromise: Promise<RpcMode> | null = null;

function loadMode(): RpcMode | null {
  if (!modeLoaded) {
    modeLoaded = true;
    try {
      const saved = localStorage.getItem(MODE_STORAGE_KEY);
      if (saved === "direct" || saved === "proxy") cachedMode = saved;
    } catch {
      /* حالت خصوصی مرورگر */
    }
  }
  return cachedMode;
}

function saveMode(m: RpcMode | null): void {
  cachedMode = m;
  try {
    if (m) localStorage.setItem(MODE_STORAGE_KEY, m);
    else localStorage.removeItem(MODE_STORAGE_KEY);
  } catch {
    /* بی‌صدا */
  }
}

function isNetworkError(e: unknown): boolean {
  return e instanceof AppError && e.code === "NETWORK";
}

/**
 * سنجش همزمان دو مسیر با get_public_config — فقط-خواندنی و بدون توکن،
 * پس اجرای موازی آن عارضه‌ای ندارد. هر پاسخ HTTP (حتی خطای 4xx) یعنی
 * مسیر زنده است؛ فقط شکست fetch (مسدودی/تایم‌اوت) یعنی مسیر مرده.
 */
function probeMode(): Promise<RpcMode> {
  if (!probePromise) {
    probePromise = (async () => {
      const attempt = async (via: RpcMode): Promise<RpcMode> => {
        if (via === "direct") {
          await rpcDirect("get_public_config", {}, PROBE_TIMEOUT_MS);
        } else {
          await rpcProxy("get_public_config", {}, PROBE_TIMEOUT_MS);
        }
        return via;
      };
      try {
        const winner = await Promise.any([attempt("direct"), attempt("proxy")]);
        saveMode(winner);
        return winner;
      } finally {
        probePromise = null;
      }
    })();
  }
  return probePromise;
}

async function runVia<T>(
  mode: RpcMode,
  fn: string,
  params: Record<string, unknown>,
): Promise<T> {
  const raw =
    mode === "direct"
      ? await rpcDirect(fn, params, RUN_TIMEOUT_MS)
      : await rpcProxy(fn, params, RUN_TIMEOUT_MS);
  return parseRpcResult<T>(raw);
}

/** فراخوانی تابع RPC ساپابیس — تنها مسیر مجاز دسترسی به داده */
export async function rpc<T>(
  fn: string,
  params: Record<string, unknown>,
): Promise<T> {
  if (!isSupabaseConfigured()) {
    throw new AppError(
      "NOT_CONFIGURED",
      "اتصال Supabase تنظیم نشده — متغیرهای VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY را در .env.local قرار دهید",
    );
  }

  let mode = loadMode();
  if (!mode) {
    try {
      mode = await probeMode();
    } catch {
      throw new AppError("NETWORK", networkFailMessage());
    }
  }

  /* اجرا با مسیر فعلی؛ خطای شبکه → یک‌بار مسیر دیگر */
  try {
    return await runVia<T>(mode, fn, params);
  } catch (e) {
    if (!isNetworkError(e)) throw e;
  }

  const other: RpcMode = mode === "direct" ? "proxy" : "direct";
  try {
    const result = await runVia<T>(other, fn, params);
    saveMode(other);
    return result;
  } catch (e) {
    if (isNetworkError(e)) {
      saveMode(null);
      throw new AppError("NETWORK", networkFailMessage());
    }
    throw e;
  }
}
