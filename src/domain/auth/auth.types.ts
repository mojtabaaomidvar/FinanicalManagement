/* انتیتی‌های احراز هویت و نشست */

import type { Family, Member } from "../family/family.types";

export type OtpFlowMode = "login" | "register" | "invite";

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
}

export interface StoredSession {
  member: Member;
  family: Family;
  token: string;
}

/** تنظیمات عمومی اپ — بدون نیاز به احراز هویت (مثل فعال بودن OTP) */
export interface PublicAppConfig {
  otpEnabled: boolean;
}
