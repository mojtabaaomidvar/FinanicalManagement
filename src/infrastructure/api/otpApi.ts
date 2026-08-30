/* تابع سرورless ارسال OTP (Vercel: /api/send-otp) */

import { AppError } from "@/shared/lib/appError";

export interface OtpServerlessResult {
  ok: boolean;
  devCode: string | null;
}

/** ارسال OTP از طریق تابع سرورless؛ در دسترس نبودن → unavailable=true */
export async function sendOtpViaServerless(
  phone: string,
): Promise<OtpServerlessResult & { unavailable: boolean }> {
  try {
    const res = await fetch("api/send-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      devCode?: string;
      error?: string;
    };

    if (res.ok && data.ok) {
      return { ok: true, devCode: data.devCode ?? null, unavailable: false };
    }
    if (res.status === 429 || /TOO_SOON/.test(data.error ?? "")) {
      throw new AppError("TOO_SOON", "کد قبلاً ارسال شده — یک دقیقه صبر کنید");
    }
    return { ok: false, devCode: null, unavailable: true };
  } catch (e) {
    if (e instanceof AppError) throw e;
    /* شبکه/۴۰۴ → سرورless در دسترس نیست */
    return { ok: false, devCode: null, unavailable: true };
  }
}
