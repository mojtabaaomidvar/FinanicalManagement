/* مخزن احراز هویت — اندپوینت‌های REST بک‌اندِ اختصاصی (/auth/*) + نشست امن.
   نکته: نامِ کلاس با پیشوندِ «Supabase» صرفاً میراثی است و برای کم‌کردنِ دامنهٔ تغییر
   حفظ شده؛ این مخزن دیگر با Supabase کار نمی‌کند و از RestClient استفاده می‌کند.
   توکن به‌صورتِ خودکار از هدرِ Authorization توسط RestClient می‌رود؛ مسیرهای boot
   (validateSession/logout/logout-all/change-password) توکن را صریح override می‌کنند. */

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
import { AppError } from "@/shared/lib/appError";
import type { RestClient } from "@/infrastructure/api/restClient";
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
  constructor(private readonly client: RestClient) {}

  private mapAuth(r: AuthResultRow): AuthResult {
    return {
      member: mapMember(r.member),
      family: mapFamily(r.family),
      sessionToken: r.session_token,
    };
  }

  async getPublicConfig(): Promise<PublicAppConfig> {
    const r = await this.client.get<{ otp_enabled?: boolean }>("/auth/config");
    return { otpEnabled: !!r?.otp_enabled };
  }

  async checkPreRegistered(phone: string): Promise<{
    preRegistered: boolean;
    familyName: string | null;
  }> {
    const r = await this.client.post<{
      pre_registered?: boolean;
      family_name?: string | null;
    }>("/auth/pre-registered", { phone });
    return {
      preRegistered: !!r?.pre_registered,
      familyName: r?.family_name ?? null,
    };
  }

  async uploadAvatar(dataUrl: string): Promise<string> {
    /* آپلود به استوریجِ خصوصیِ سرور؛ توکن خودکار از هدر می‌رود. مهلتِ بلندتر برای
       تصویرِ حجیم. خطاها (INVALID_IMAGE/IMAGE_TOO_LARGE/SERVER_NOT_CONFIGURED/
       SESSION_EXPIRED) در RestClient به پیامِ فارسی نگاشته می‌شوند. */
    const r = await this.client.post<{ ok?: boolean; url?: string }>(
      "/uploads/avatar",
      { image: dataUrl },
      { timeoutMs: 60000 },
    );
    if (!r?.url) throw new AppError("SERVER", "آپلود ناموفق بود — دوباره تلاش کنید");
    return r.url;
  }

  async requestOtp(phone: string): Promise<OtpRequestResult> {
    /* اندپوینتِ dev کدِ ساخته‌شده را برمی‌گرداند؛ اگر ارسالِ پیامک تنظیم نشده باشد،
       سرور OTP_API_ONLY می‌دهد که RestClient به پیامِ فارسی نگاشته و پرتاب می‌کند. */
    const r = await this.client.post<{ code?: string | null }>(
      "/auth/otp/request",
      { phone },
    );
    return { sent: true, devCode: r?.code ?? null };
  }

  async checkPassword(phone: string, password: string): Promise<boolean> {
    /* رمز خام روی HTTPS می‌رود؛ تطبیق (Argon2id/ارتقا) سمت سرور انجام می‌شود */
    const r = await this.client.post<{ ok?: boolean }>("/auth/check-password", {
      phone,
      password,
    });
    return !!r?.ok;
  }

  async loginWithOtp(
    phone: string,
    password: string,
    code: string | null,
  ): Promise<AuthResult> {
    const r = await this.client.post<AuthResultRow>("/auth/login", {
      phone,
      password,
      code,
    });
    return this.mapAuth(r);
  }

  async register(input: RegisterInput, otpCode: string | null): Promise<AuthResult> {
    const r = await this.client.post<AuthResultRow>("/auth/register", {
      family_name: input.familyName,
      member_name: input.memberName,
      phone: input.phone,
      password: input.password,
      otp_code: otpCode,
      relation: input.relation ?? "خودم",
    });
    return this.mapAuth(r);
  }

  async acceptInvite(
    input: InviteAcceptInput,
    otpCode: string | null,
  ): Promise<AuthResult> {
    const r = await this.client.post<AuthResultRow>("/auth/accept-invite", {
      invite_token: input.inviteToken,
      member_name: input.memberName,
      phone: input.phone,
      password: input.password,
      otp_code: otpCode,
      relation: input.relation ?? "سایر",
    });
    return this.mapAuth(r);
  }

  async getInvite(token: string): Promise<InviteInfo> {
    const r = await this.client.get<{ family_name: string }>(
      `/auth/invite/${encodeURIComponent(token)}`,
    );
    return { familyName: r.family_name };
  }

  async createInvite(): Promise<string> {
    const r = await this.client.post<{ token: string }>("/auth/invite");
    return r.token;
  }

  async validateSession(token: string): Promise<ValidatedSession> {
    const r = await this.client.get<{
      member: MemberRow;
      family: FamilyRow;
      members: MemberRow[];
    }>("/auth/session", { bearer: token });
    return {
      member: mapMember(r.member),
      family: mapFamily(r.family),
      members: (r.members ?? []).map(mapMember),
    };
  }

  async logout(token: string): Promise<void> {
    try {
      await this.client.post("/auth/logout", undefined, { bearer: token });
    } catch {
      /* بی‌صدا — نشست سمت سرور خودش منقضی می‌شود */
    }
  }

  async logoutAll(token: string): Promise<void> {
    await this.client.post("/auth/logout-all", undefined, { bearer: token });
  }

  async changePassword(
    token: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    await this.client.post(
      "/auth/change-password",
      { current_password: currentPassword, new_password: newPassword },
      { bearer: token },
    );
  }
}
