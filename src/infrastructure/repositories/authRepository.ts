/* مخزن احراز هویت — RPCهای سرور + نشست امن */

import type { AuthRepository } from "@/domain/auth/auth.repository";
import type {
  AuthResult,
  InviteAcceptInput,
  InviteInfo,
  OtpRequestResult,
  PublicAppConfig,
  RegisterInput,
  ValidatedSession,
} from "@/domain/auth/auth.types";
import { rpc } from "@/infrastructure/api/httpClient";
import { sendOtpViaServerless } from "@/infrastructure/api/otpApi";
import { API_BASE } from "@/shared/config/apiBase";
import type { TokenProvider } from "./sessionRepository";
import {
  mapFamily,
  mapMember,
  type FamilyRow,
  type MemberRow,
} from "./mappers";

interface AuthResultRow {
  member: MemberRow;
  family: FamilyRow;
  session_token: string;
}

export class SupabaseAuthRepository implements AuthRepository {
  constructor(private readonly tokenProvider: TokenProvider) {}

  private mapAuth(r: AuthResultRow): AuthResult {
    return {
      member: mapMember(r.member),
      family: mapFamily(r.family),
      sessionToken: r.session_token,
    };
  }

  async getPublicConfig(): Promise<PublicAppConfig> {
    const r = await rpc<{ otp_enabled?: boolean }>("get_public_config", {});
    return { otpEnabled: !!r?.otp_enabled };
  }

  async checkPreRegistered(phone: string): Promise<{
    preRegistered: boolean;
    familyName: string | null;
  }> {
    const r = await rpc<{
      pre_registered?: boolean;
      family_name?: string | null;
    }>("check_pre_registered", { p_phone: phone });
    return {
      preRegistered: !!r?.pre_registered,
      familyName: r?.family_name ?? null,
    };
  }

  async uploadAvatar(dataUrl: string): Promise<string> {
    const token = await this.tokenProvider.getToken();
    if (!token) throw new Error("NO_SESSION");

    let res: Response;
    try {
      res = await fetch(`${API_BASE}/api/upload-avatar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, image: dataUrl }),
      });
    } catch {
      throw new Error("خطای شبکه — اتصال اینترنت را بررسی کنید");
    }
    const text = await res.text();
    let data: { ok?: boolean; url?: string; error?: string; detail?: string } = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      /* بدنه غیر JSON */
    }
    if (!res.ok || !data.ok || !data.url) {
      if (data.error === "IMAGE_TOO_LARGE") {
        throw new Error("عکس بزرگ است — حداکثر ۱ مگابایت");
      }
      if (data.error === "INVALID_IMAGE") {
        throw new Error("فقط عکس PNG/JPG/WebP پذیرفته می‌شود");
      }
      if (data.error === "SERVER_NOT_CONFIGURED") {
        throw new Error("تنظیمات سرور آپلود ناقص است (SUPABASE_URL/SERVICE_KEY)");
      }
      if (data.error === "INVALID_TOKEN" || data.error === "SESSION_EXPIRED") {
        throw new Error("نشست منقضی شده — دوباره وارد شوید");
      }
      if (!text.startsWith("{")) {
        /* پاسخ HTML → تابع سرور اجرا نشده (مثلاً اجرای محلی بدون vercel dev) */
        throw new Error(
          "سرور آپلود در دسترس نیست — آپلود فقط روی نسخه دپلوی‌شده (یا vercel dev) کار می‌کند",
        );
      }
      if (data.detail) console.error("upload-avatar:", data.detail);
      throw new Error("آپلود ناموفق بود — دوباره تلاش کنید");
    }
    return data.url;
  }

  async requestOtp(phone: string): Promise<OtpRequestResult> {
    /* فقط مسیر سرورless — تابع request_otp_dev در نسخه تولید
       نه در فهرست سفید پروکسی است و نه دسترسی اجرا دارد */
    const r = await sendOtpViaServerless(phone);
    if (!r.ok) throw new Error("ارسال کد پیامکی ممکن نشد — بعداً تلاش کنید");
    return { sent: true, devCode: r.devCode };
  }

  async checkPassword(phone: string, password: string): Promise<boolean> {
    /* رمز خام روی HTTPS می‌رود؛ هش bcrypt سمت سرور ساخته و مقایسه می‌شود */
    return rpc<boolean>("auth_check_password", {
      p_phone: phone,
      p_password: password,
    });
  }

  async loginWithOtp(
    phone: string,
    password: string,
    code: string | null,
  ): Promise<AuthResult> {
    const r = await rpc<AuthResultRow>("auth_login", {
      p_phone: phone,
      p_password: password,
      p_code: code,
    });
    return this.mapAuth(r);
  }

  async register(input: RegisterInput, otpCode: string | null): Promise<AuthResult> {
    const r = await rpc<AuthResultRow>("auth_register", {
      p_family_name: input.familyName,
      p_member_name: input.memberName,
      p_phone: input.phone,
      p_password: input.password,
      p_otp_code: otpCode,
      p_relation: input.relation ?? "خودم",
    });
    return this.mapAuth(r);
  }

  async acceptInvite(
    input: InviteAcceptInput,
    otpCode: string | null,
  ): Promise<AuthResult> {
    const r = await rpc<AuthResultRow>("accept_invite", {
      p_token: input.inviteToken,
      p_member_name: input.memberName,
      p_phone: input.phone,
      p_password: input.password,
      p_otp_code: otpCode,
      p_relation: input.relation ?? "سایر",
    });
    return this.mapAuth(r);
  }

  async getInvite(token: string): Promise<InviteInfo> {
    const r = await rpc<{ family_name: string }>("get_invite", {
      p_token: token,
    });
    return { familyName: r.family_name };
  }

  async createInvite(): Promise<string> {
    const token = await this.tokenProvider.getToken();
    if (!token) throw new Error("NO_SESSION");
    return rpc<string>("create_invite", { p_token: token });
  }

  async validateSession(token: string): Promise<ValidatedSession> {
    const r = await rpc<{
      member: MemberRow;
      family: FamilyRow;
      members: MemberRow[];
    }>("validate_session", { p_token: token });
    return {
      member: mapMember(r.member),
      family: mapFamily(r.family),
      members: (r.members ?? []).map(mapMember),
    };
  }

  async logout(token: string): Promise<void> {
    try {
      await rpc("logout_session", { p_token: token });
    } catch {
      /* بی‌صدا — نشست سمت سرور خودش منقضی می‌شود */
    }
  }

  async logoutAll(token: string): Promise<void> {
    await rpc("logout_all_sessions", { p_token: token });
  }

  async changePassword(
    token: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    await rpc("change_password", {
      p_token: token,
      p_current_password: currentPassword,
      p_new_password: newPassword,
    });
  }
}
