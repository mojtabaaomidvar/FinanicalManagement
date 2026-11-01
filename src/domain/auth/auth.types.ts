/* انتیتی‌های احراز هویت و نشست */

import type { Family, Member } from "../family/family.types";

/** «invite» = پذیرشِ لینکِ دعوت، «join» = پیوستن با کدِ ۶ رقمیِ خانواده.
    هر دو به یک خروجی می‌رسند (JoinPendingResult) ولی اندپوینتشان جداست، پس
    در جریانِ OTP نباید یکی گرفته شوند. */
export type OtpFlowMode = "login" | "register" | "invite" | "join";

export interface OtpRequestResult {
  sent: boolean;
  /** کد در حالت توسعه (بدون سرویس پیامک) — فقط برای تست */
  devCode: string | null;
}

export interface AuthResult {
  member: Member;
  family: Family;
  sessionToken: string;
}

/** خروجی پذیرش دعوت (و پیوستن با کد) — §۲.۶
 *
 *  عمداً نشست ندارد: از مرحله B به بعد، پذیرش دعوت فقط یک «درخواست عضویت»
 *  می‌سازد و تا تأیید مدیر نه توکنی صادر می‌شود نه دسترسی به داده خانواده.
 *  کاربر پس از تأیید، از مسیر عادی ورود وارد می‌شود. */
export interface JoinPendingResult {
  familyName: string;
  state: "pending";
}

export interface ValidatedSession {
  member: Member;
  family: Family;
  members: Member[];
}

export interface InviteInfo {
  familyName: string;
}

export interface RegisterInput {
  familyName: string;
  memberName: string;
  phone: string;
  password: string;
  /** نسبت با مدیر خانواده — فقط وقتی عضو pending تکمیل می‌کند */
  relation?: string;
}

export interface InviteAcceptInput {
  inviteToken: string;
  memberName: string;
  phone: string;
  password: string;
  /** نسبت با مدیر خانواده — بدون آن سرور «سایر» ثبت می‌کند */
  relation?: string;
}

/** پیوستن با «کدِ خانواده» — راهِ دومِ §۲.۶ در برابرِ لینکِ دعوت.
 *
 *  تفاوتِ مهم با دعوت: کد **تک‌مصرفه نیست** و پاک نمی‌شود، پس این مسیر
 *  از جای ورودِ عمومی (صفحهٔ ورود) در دسترس است و سرور هم سقفِ per-IP
 *  روی آن دارد. خروجی مثل دعوت «در انتظارِ تأیید» است، نه نشست. */
export interface JoinByCodeInput {
  /** ۶ رقم — سرور با الگوی `^\d{6}$` می‌سنجد، پس باید لاتین‌شده باشد */
  code: string;
  memberName: string;
  phone: string;
  password: string;
  /** نسبت با مدیر خانواده — بدون آن سرور «سایر» ثبت می‌کند */
  relation?: string;
}

export interface StoredSession {
  member: Member;
  family: Family;
  token: string;
}

/** تنظیمات عمومی اپ — بدون نیاز به احراز هویت (مثل فعال بودن OTP) */
export interface PublicAppConfig {
  otpEnabled: boolean;
  /** آیا سرور می‌تواند کد بازیابی رمز بفرستد؟ وضعیتِ *سرور* است (کلیدِ درگاهِ
      پیامک)، نه چیزی دربارهٔ کاربر — فقط برای پنهان‌کردنِ دکمهٔ بی‌فایده. */
  passwordResetEnabled: boolean;
}
