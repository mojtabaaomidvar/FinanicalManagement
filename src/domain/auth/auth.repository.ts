/* اینترفیس مخزن احراز هویت — پیاده‌سازی در infrastructure/repositories */

import type {
  AuthResult,
  InviteAcceptInput,
  InviteInfo,
  OtpRequestResult,
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
  /** درخواست کد OTP (سرورless، با fallback حالت توسعه) */
  requestOtp(phone: string): Promise<OtpRequestResult>;
  /** مرحله ۱ ورود: بررسی شماره + رمز */
  checkPassword(phone: string, password: string): Promise<boolean>;
  /** مرحله ۲ ورود: تأیید OTP → نشست */
  loginWithOtp(phone: string, code: string): Promise<AuthResult>;
  /** ثبت‌نام — OTP سمت سرور اعتبارسنجی می‌شود */
  register(input: RegisterInput, otpCode: string): Promise<AuthResult>;
  /** پذیرش دعوت — OTP سمت سرور اعتبارسنجی می‌شود */
  acceptInvite(input: InviteAcceptInput, otpCode: string): Promise<AuthResult>;
  /** اطلاعات دعوت‌نامه (نام خانواده) */
  getInvite(token: string): Promise<InviteInfo>;
  /** ساخت لینک دعوت جدید برای خانواده نشست فعلی */
  createInvite(): Promise<string>;
  /** اعتبارسنجی توکن نشست */
  validateSession(token: string): Promise<ValidatedSession>;
  /** خروج — حذف نشست سمت سرور */
  logout(token: string): Promise<void>;
}
