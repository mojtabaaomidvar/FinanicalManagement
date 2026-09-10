/* کلاینتِ REST — تنها نقطهٔ خروجِ درخواست به بک‌اندِ اختصاصی (فاز ۹).
   جایگزینِ seamِ rpc() در httpClient.ts می‌شود (که بازنشسته شد).

   ویژگی‌ها:
   - مبدأِ واحد از shared/config/apiUrl (بدونِ مسیرِ دوگانه/سنجش/پروکسی).
   - هدرِ Authorization: Bearer به‌صورتِ خودکار از TokenProvider تزریق می‌شود؛ متدهای
     احرازِ boot (validateSession/logout/…) می‌توانند توکن را صریح override کنند.
   - HTTPS اجباری (به‌جز localhost و مسیرِ نسبیِ هم‌مبدأ).
   - نرمال‌سازیِ خطا: «کدِ error» مقدم بر «پیامِ message» خوانده می‌شود (رفعِ یافتهٔ فاز ۷)؛
     UNAUTHORIZED/INVALID_TOKEN → SESSION_EXPIRED تا ورودِ دوباره راه بیفتد.
   هیچ fetch مستقیمی خارج از این فایل مجاز نیست. */

import { API_URL } from "@/shared/config/apiUrl";
import { AppError, type AppErrorCode } from "@/shared/lib/appError";
import type { TokenProvider } from "@/infrastructure/repositories/sessionRepository";

const RUN_TIMEOUT_MS = 15000;

/* ── نگاشتِ کدِ خطای بک‌اند → AppError (کد + پیامِ فارسیِ کنترل‌شده) ──
   بک‌اند پاسخِ خطا را به شکلِ {"error": <کد>, "message": <پیام فارسی>} می‌فرستد. اینجا روی
   «کد» تطبیق می‌دهیم (نه پیام). کدهای نگاشت‌نشده به پیامِ فارسیِ خودِ سرور با کدِ عمومیِ
   SERVER سقوط می‌کنند؛ پس حتی کدِ ناشناخته هم پیامِ درست نشان می‌دهد. UIِ فعلی فقط روی
   NETWORK/TOO_SOON/INVALID_OTP بر اساسِ .code شاخه می‌زند؛ بقیه صرفاً .message را نشان می‌دهند. */
const REST_ERROR_MAP: { re: RegExp; code: AppErrorCode; msg: string }[] = [
  // نشست: UNAUTHORIZED/INVALID_TOKEN هم به SESSION_EXPIRED نگاشته می‌شوند تا ورودِ دوباره راه بیفتد
  { re: /SESSION_EXPIRED|UNAUTHORIZED|INVALID_TOKEN/, code: "SESSION_EXPIRED", msg: "نشست منقضی شده — لطفاً دوباره وارد شوید" },
  { re: /INVALID_CREDENTIALS/, code: "SERVER", msg: "شماره موبایل یا رمز عبور اشتباه است" },
  { re: /WEAK_PASSWORD/, code: "SERVER", msg: "رمز عبور باید حداقل ۸ کاراکتر باشد" },
  { re: /TOO_SOON/, code: "TOO_SOON", msg: "کد قبلاً ارسال شده — یک دقیقه صبر کنید" },
  { re: /TOO_MANY_ATTEMPTS/, code: "TOO_MANY_ATTEMPTS", msg: "تلاش‌های ناموفق زیاد بوده — ۱۵ دقیقه بعد امتحان کنید" },
  { re: /PHONE_EXISTS/, code: "PHONE_EXISTS", msg: "این شماره قبلاً ثبت‌نام کرده است" },
  { re: /INVALID_OTP/, code: "INVALID_OTP", msg: "کد وارد شده صحیح نیست یا منقضی شده" },
  { re: /INVALID_INVITE/, code: "INVALID_INVITE", msg: "لینک دعوت نامعتبر یا منقضی شده است" },
  { re: /NO_MEMBER/, code: "NO_MEMBER", msg: "کاربری با این شماره یافت نشد" },
  { re: /INVALID_MEMBER/, code: "INVALID_MEMBER", msg: "عضو انتخاب‌شده معتبر نیست" },
  { re: /CANNOT_REMOVE_OWNER/, code: "CANNOT_REMOVE_OWNER", msg: "مدیر خانواده قابل حذف نیست" },
  { re: /OWNER_RELATION_FIXED/, code: "FORBIDDEN", msg: "نسبت مدیر خانواده تغییر نمی‌کند — نسبت‌ها نسبت به او سنجیده می‌شوند" },
  { re: /FORBIDDEN/, code: "FORBIDDEN", msg: "اجازه انجام این کار را ندارید" },
  { re: /INVALID_(TYPE|AMOUNT|CATEGORY|DATE)/, code: "INVALID_TX", msg: "اطلاعات تراکنش معتبر نیست" },
  { re: /INVALID_TIME/, code: "INVALID_TX", msg: "ساعت انتخاب‌شده معتبر نیست" },
  { re: /REPEAT_END_REQUIRED/, code: "INVALID_TX", msg: "تراکنش تکرارشونده باید تاریخ پایان داشته باشد" },
  { re: /INVALID_REPEAT_END/, code: "INVALID_TX", msg: "تاریخ پایان تکرار باید بعد از تاریخ تراکنش باشد" },
  { re: /INVALID_REPEAT/, code: "INVALID_TX", msg: "دوره تکرار معتبر نیست" },
  { re: /INVALID_TRANSFER/, code: "INVALID_TX", msg: "برای انتقال، حساب مبدأ و مقصد (متفاوت) را انتخاب کنید" },
  { re: /INVALID_SUBCATEGORY/, code: "INVALID_TX", msg: "زیردسته انتخاب‌شده معتبر نیست" },
  { re: /INVALID_STATUS/, code: "INVALID_TX", msg: "وضعیت پیامک معتبر نیست" },
  { re: /EVENT_DUPLICATE/, code: "INVALID_TX", msg: "این رویداد قبلاً ثبت شده است" },
  { re: /INVALID_EVENT/, code: "INVALID_TX", msg: "اطلاعات رویداد معتبر نیست" },
  { re: /INVALID_RELATION|EMPTY_RELATION/, code: "INVALID_TX", msg: "نسبت با مدیر خانواده را انتخاب کنید" },
  { re: /INVALID_NAME/, code: "INVALID_TX", msg: "نام واردشده معتبر نیست" },
  { re: /INVALID_THEME/, code: "INVALID_TX", msg: "پوستهٔ انتخاب‌شده معتبر نیست" },
  { re: /INVALID_CURRENCY/, code: "INVALID_TX", msg: "واحد پول انتخاب‌شده معتبر نیست" },
  { re: /INVALID_TITLE/, code: "INVALID_ACCOUNT", msg: "نام کارت/حساب معتبر نیست (حداکثر ۴۰ کاراکتر)" },
  { re: /INVALID_CARD/, code: "INVALID_ACCOUNT", msg: "شماره کارت باید ۱۶ رقم باشد" },
  { re: /EMPTY_ACCOUNT/, code: "INVALID_ACCOUNT", msg: "برای حساب بانکی، شماره کارت ۱۶ رقمی الزامی است" },
  { re: /INVALID_KIND/, code: "INVALID_ACCOUNT", msg: "نوع حساب معتبر نیست" },
  { re: /INVALID_INITIAL_BALANCE/, code: "INVALID_ACCOUNT", msg: "موجودی اولیه معتبر نیست" },
  { re: /INVALID_ACCOUNT_ID/, code: "INVALID_ACCOUNT", msg: "حساب انتخاب‌شده معتبر نیست" },
  { re: /BANK_MISMATCH/, code: "INVALID_ACCOUNT", msg: "شماره کارت با بانک انتخاب‌شده هم‌خوانی ندارد" },
  { re: /CATEGORY_IN_USE/, code: "CATEGORY_IN_USE", msg: "این دسته در تراکنش‌های ثبت‌شده به‌کار رفته و حذف نمی‌شود" },
  { re: /IMAGE_TOO_LARGE/, code: "SERVER", msg: "حجم تصویر بیش از حد مجاز است" },
  { re: /INVALID_IMAGE/, code: "SERVER", msg: "تصویر انتخاب‌شده معتبر نیست" },
  { re: /SERVER_NOT_CONFIGURED/, code: "SERVER", msg: "ذخیره‌سازیِ فایل روی سرور پیکربندی نشده است" },
  { re: /NOT_FOUND/, code: "NOT_FOUND", msg: "مورد یافت نشد" },
  { re: /OTP_API_ONLY/, code: "OTP_API_ONLY", msg: "ارسال پیامک تنظیم نشده است" },
];

function isLocalHost(): boolean {
  return (
    typeof location !== "undefined" &&
    /^(localhost|127\.0\.0\.1)/.test(location.hostname)
  );
}

/** HTTPS اجباری؛ استثناها: مسیرِ نسبیِ هم‌مبدأ (شِمای صفحه را می‌گیرد) و اجرای محلی. */
function assertHttps(url: string): void {
  if (url.startsWith("/")) return; // نسبی: هم‌مبدأ
  if (url.startsWith("https://")) return;
  if (isLocalHost()) return; // توسعهٔ محلی: http مجاز
  throw new AppError("SERVER", "اتصال باید رمزنگاری‌شده (HTTPS) باشد");
}

/** پیام خطای شبکه — در اجرای محلی راهنمایی دقیق‌تر (تنظیمِ VITE_API_URL). */
function networkFailMessage(): string {
  return isLocalHost()
    ? "اتصال به سرور ممکن نیست — بک‌اند را اجرا کنید یا VITE_API_URL را در ‎.env.local‎ تنظیم کنید"
    : "اتصال به سرور ممکن نیست — اینترنت خود را بررسی کنید";
}

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

function mapError(code: string, message: string, status: number): AppError {
  const probe = code || message; // کد را مقدم می‌گیریم؛ اگر کدی نبود، روی پیام هم می‌سنجیم
  for (const m of REST_ERROR_MAP) {
    if (m.re.test(probe)) return new AppError(m.code, m.msg);
  }
  // کدِ نگاشت‌نشده ولی پیامِ فارسیِ سرور موجود → همان پیام با کدِ عمومی SERVER
  if (message) return new AppError("SERVER", message);
  return new AppError("SERVER", `خطا در ارتباط با سرور (${status})`);
}

async function parseResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      /* بدنهٔ غیر-JSON (مثلاً صفحهٔ خطای پروکسی) */
    }
  }
  if (!res.ok) {
    const body = data as { error?: string; message?: string } | null;
    const code = typeof body?.error === "string" ? body.error : "";
    const message = typeof body?.message === "string" ? body.message : "";
    throw mapError(code, message, res.status);
  }
  // ۲۰۴/بدنهٔ خالی → null (سازگار با مصرف‌کننده‌های void)
  return data as T;
}

export interface ReqOpts {
  /** override توکن؛ نبودِ این کلید = گرفتنِ خودکار از TokenProvider، مقدارِ null = بدونِ هدرِ Authorization. */
  bearer?: string | null;
  /** مهلتِ سفارشی (میلی‌ثانیه) — مثلاً برای آپلودِ تصویر بزرگ‌تر از پیش‌فرض. */
  timeoutMs?: number;
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

/** کلاینتِ REST که همهٔ مخازن از آن استفاده می‌کنند. یک نمونه در container ساخته می‌شود. */
export class RestClient {
  constructor(private readonly tokenProvider: TokenProvider) {}

  get<T>(path: string, opts?: ReqOpts): Promise<T> {
    return this.request<T>("GET", path, undefined, opts);
  }

  post<T>(path: string, body?: unknown, opts?: ReqOpts): Promise<T> {
    return this.request<T>("POST", path, body, opts);
  }

  patch<T>(path: string, body?: unknown, opts?: ReqOpts): Promise<T> {
    return this.request<T>("PATCH", path, body, opts);
  }

  del<T>(path: string, opts?: ReqOpts): Promise<T> {
    return this.request<T>("DELETE", path, undefined, opts);
  }

  private async request<T>(
    method: Method,
    path: string,
    body: unknown,
    opts?: ReqOpts,
  ): Promise<T> {
    const url = API_URL + path;
    assertHttps(url);

    const hasBearerOverride = opts !== undefined && "bearer" in opts;
    const token = hasBearerOverride
      ? (opts as ReqOpts).bearer ?? null
      : await this.tokenProvider.getToken();

    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;

    let res: Response;
    try {
      res = await fetchWithTimeout(
        url,
        {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
        },
        opts?.timeoutMs ?? RUN_TIMEOUT_MS,
      );
    } catch {
      throw new AppError("NETWORK", networkFailMessage());
    }
    return parseResponse<T>(res);
  }
}
