/* httpClient مرکزی — تنها نقطه خروج درخواست‌های API
   - دو مسیر: مستقیم به Supabase (خارج از ایران / با VPN) و
     پروکسی سرورلس /api/rpc (عبور از مسدودسازی دامنه supabase.co در ایران)
   - مسیر موفق کش می‌شود؛ خطای شبکه → مسیر دیگر به‌صورت خودکار امتحان می‌شود
   - HTTPS اجباری (به‌جز localhost)
   - نرمال‌سازی خطاها به AppError با پیام فارسی
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
    throw new AppError("NETWORK", "اتصال مستقیم به سرور ممکن نشد");
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
    throw new AppError("NETWORK", "سرور میانی در دسترس نیست");
  }
  const text = await res.text();
  /* پاسخ HTML = تابع سرورلس اجرا نشده (vite dev بدون vercel dev) */
  if (text.startsWith("<")) {
    throw new AppError(
      "SERVER",
      "سرور میانی در دسترس نیست — برای اجرای محلی یا VPN را روشن کنید یا از «npx vercel dev» استفاده کنید",
    );
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
    const msg =
      (data as { message?: string } | null)?.message ?? raw.text ?? "";
    throw mapRpcError(msg, raw.status);
  }
  return data as T;
}

/* ── انتخاب مسیر: اولین درخواست هر دو را می‌سنجد و مسیر سالم را نگه می‌دارد ── */

type RpcMode = "direct" | "proxy";
let cachedMode: RpcMode | null = null;

const PROBE_TIMEOUT_MS = 6000;
const RUN_TIMEOUT_MS = 15000;

function isNetworkError(e: unknown): boolean {
  return e instanceof AppError && e.code === "NETWORK";
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

  if (cachedMode === "proxy") {
    try {
      return parseRpcResult<T>(await rpcProxy(fn, params, RUN_TIMEOUT_MS));
    } catch (e) {
      /* مسیر پروکسی قطع شد (مثلاً VPN روشن شد) → مسیر مستقیم */
      if (!isNetworkError(e)) throw e;
      cachedMode = null;
    }
  } else if (cachedMode === "direct") {
    try {
      return parseRpcResult<T>(await rpcDirect(fn, params, RUN_TIMEOUT_MS));
    } catch (e) {
      if (!isNetworkError(e)) throw e;
      cachedMode = null;
    }
  }

  /* مسیر کش نشده — سنجش مستقیم با مهلت کوتاه، سپس پروکسی */
  try {
    const raw = await rpcDirect(fn, params, PROBE_TIMEOUT_MS);
    cachedMode = "direct";
    return parseRpcResult<T>(raw);
  } catch (e) {
    if (!isNetworkError(e)) throw e;
  }

  try {
    const raw = await rpcProxy(fn, params, RUN_TIMEOUT_MS);
    cachedMode = "proxy";
    return parseRpcResult<T>(raw);
  } catch (e) {
    if (isNetworkError(e)) {
      throw new AppError(
        "NETWORK",
        "اتصال به سرور ممکن نیست — اینترنت یا VPN خود را بررسی کنید",
      );
    }
    throw e;
  }
}
