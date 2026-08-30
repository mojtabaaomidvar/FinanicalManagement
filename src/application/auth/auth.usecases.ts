/* Use-caseهای احراز هویت — orchestration بدون UI و بدون state */

import type { AuthRepository, SessionStore } from "@/domain/auth/auth.repository";
import type {
  AuthResult,
  InviteAcceptInput,
  InviteInfo,
  OtpRequestResult,
  RegisterInput,
  ValidatedSession,
} from "@/domain/auth/auth.types";
import type { StoredSession } from "@/domain/auth/auth.types";

export class RequestOtpUseCase {
  constructor(private readonly auth: AuthRepository) {}
  execute(phone: string): Promise<OtpRequestResult> {
    return this.auth.requestOtp(phone);
  }
}

export class CheckPasswordUseCase {
  constructor(private readonly auth: AuthRepository) {}
  execute(phone: string, password: string): Promise<boolean> {
    return this.auth.checkPassword(phone, password);
  }
}

export class LoginWithOtpUseCase {
  constructor(private readonly auth: AuthRepository) {}
  async execute(phone: string, code: string): Promise<AuthResult> {
    const r = await this.auth.loginWithOtp(phone, code);
    return r;
  }
}

export class RegisterUseCase {
  constructor(private readonly auth: AuthRepository) {}
  execute(input: RegisterInput, otpCode: string): Promise<AuthResult> {
    return this.auth.register(input, otpCode);
  }
}

export class AcceptInviteUseCase {
  constructor(private readonly auth: AuthRepository) {}
  execute(input: InviteAcceptInput, otpCode: string): Promise<AuthResult> {
    return this.auth.acceptInvite(input, otpCode);
  }
}

export class GetInviteUseCase {
  constructor(private readonly auth: AuthRepository) {}
  execute(token: string): Promise<InviteInfo> {
    return this.auth.getInvite(token);
  }
}

export class CreateInviteUseCase {
  constructor(private readonly auth: AuthRepository) {}
  execute(): Promise<string> {
    return this.auth.createInvite();
  }
}

/** ذخیره نشست پس از ورود/ثبت‌نام/دعوت */
export class SaveSessionUseCase {
  constructor(private readonly session: SessionStore) {}
  async execute(r: AuthResult): Promise<StoredSession> {
    const stored: StoredSession = {
      member: r.member,
      family: r.family,
      token: r.sessionToken,
    };
    await this.session.save(stored);
    return stored;
  }
}

/** بازیابی و اعتبارسنجی نشست ذخیره‌شده هنگام باز شدن اپ */
export class RestoreSessionUseCase {
  constructor(
    private readonly session: SessionStore,
    private readonly auth: AuthRepository,
  ) {}

  async execute(): Promise<ValidatedSession | null> {
    const stored = await this.session.load();
    if (!stored?.token) return null;
    try {
      return await this.auth.validateSession(stored.token);
    } catch {
      await this.session.clear();
      return null;
    }
  }
}

export class LogoutUseCase {
  constructor(
    private readonly session: SessionStore,
    private readonly auth: AuthRepository,
  ) {}
  async execute(): Promise<void> {
    const stored = await this.session.load();
    if (stored?.token) await this.auth.logout(stored.token);
    await this.session.clear();
  }
}
