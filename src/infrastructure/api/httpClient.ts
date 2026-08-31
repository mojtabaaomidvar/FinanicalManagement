/* httpClient مرکزی — تنها نقطه خروج درخواست‌های API
   - HTTPS اجباری (به‌جز localhost)
   - هدرهای Supabase (apikey / Authorization)
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
  { re: /INVALID_TITLE/, code: "INVALID_ACCOUNT", msg: "نام کارت/حساب معتبر نیست (حداکثر ۴۰ کاراکتر)" },
  { re: /INVALID_CARD/, code: "INVALID_ACCOUNT", msg: "شماره کارت باید ۱۶ رقم باشد" },
  { re: /INVALID_SHEBA/, code: "INVALID_ACCOUNT", msg: "شماره شبا معتبر نیست (IR + ۲۴ رقم)" },
  { re: /INVALID_ACCOUNT_NO/, code: "INVALID_ACCOUNT", msg: "شماره حساب معتبر نیست (۵ تا ۲۰ رقم)" },
  { re: /EMPTY_ACCOUNT/, code: "INVALID_ACCOUNT", msg: "حداقل یکی از شماره کارت، حساب یا شبا را وارد کنید" },
  { re: /INVALID_ACCOUNT_ID/, code: "INVALID_ACCOUNT", msg: "حساب انتخاب‌شده معتبر نیست" },
  { re: /ACCOUNT_REQUIRED/, code: "INVALID_ACCOUNT", msg: "انتخاب حساب برای ثبت تراکنش الزامی است" },
  { re: /INVALID_SUBCATEGORY/, code: "INVALID_TX", msg: "زیردسته انتخاب‌شده معتبر نیست" },
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

  const url = `${supabaseConfig.url.replace(/\/$/, "")}/rest/v1/rpc/${fn}`;
  assertHttps(url);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        apikey: supabaseConfig.anonKey,
        Authorization: "Bearer " + supabaseConfig.anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    });
  } catch {
    throw new AppError("NETWORK", "خطای شبکه — اتصال اینترنت را بررسی کنید");
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* بدنه غیر JSON */
  }

  if (!res.ok) {
    const msg =
      (data as { message?: string } | null)?.message ?? text ?? "";
    throw mapRpcError(msg, res.status);
  }
  return data as T;
}
