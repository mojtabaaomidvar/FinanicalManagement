/* اینترفیس مخزن احراز هویت — پیاده‌سازی در infrastructure/repositories */

import type {
  AuthResult,
  InviteAcceptInput,
  InviteInfo,
  OtpRequestResult,
  PublicAppConfig,
  RegisterInput,
  StoredSession,
  ValidatedSession,
} from "./auth.types";

/** ذخیره‌سازی امن نشست (توکن) — پیاده‌سازی در infrastructure */
export interface SessionStore {
  load(): Promise<StoredSession | null>;
  save(session: StoredSession): Promise<void>;
  clear(): Promise<void>;
}

export interface AuthRepository {
  /** تنظیمات عمومی (فعال بودن OTP و…) — بدون احراز هویت */
  getPublicConfig(): Promise<PublicAppConfig>;
  /** آیا این شماره توسط مدیری به‌عنوان عضو (pending) معرفی شده؟ */
  checkPreRegistered(phone: string): Promise<{
    preRegistered: boolean;
    familyName: string | null;
    memberName: string | null;
  }>;
  /** آپلود عکس پروفایل (سرورless) → URL عمومی */
  uploadAvatar(dataUrl: string): Promise<string>;
  /** درخواست کد OTP (سرورless، با fallback حالت توسعه) */
  requestOtp(phone: string): Promise<OtpRequestResult>;
  /** مرحله ۱ ورود: بررسی شماره + رمز */
  checkPassword(phone: string, password: string): Promise<boolean>;
  /** مرحله ۲ ورود: تأیید OTP → نشست (code=null وقتی OTP غیرفعال است) */
  loginWithOtp(phone: string, code: string | null): Promise<AuthResult>;
  /** ثبت‌نام — OTP سمت سرور اعتبارسنجی می‌شود (null = OTP غیرفعال) */
  register(input: RegisterInput, otpCode: string | null): Promise<AuthResult>;
  /** پذیرش دعوت — OTP سمت سرور اعتبارسنجی می‌شود (null = OTP غیرفعال) */
  acceptInvite(input: InviteAcceptInput, otpCode: string | null): Promise<AuthResult>;
  /** اطلاعات دعوت‌نامه (نام خانواده) */
  getInvite(token: string): Promise<InviteInfo>;
  /** ساخت لینک دعوت جدید برای خانواده نشست فعلی */
  createInvite(): Promise<string>;
  /** اعتبارسنجی توکن نشست */
  validateSession(token: string): Promise<ValidatedSession>;
  /** خروج — حذف نشست سمت سرور */
  logout(token: string): Promise<void>;
}
