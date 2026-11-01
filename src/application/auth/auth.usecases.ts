/* Use-caseهای احراز هویت — orchestration بدون UI و بدون state */

import type {
  AuthRepository,
  OfflineCacheStore,
  SessionStore,
} from "@/domain/auth/auth.repository";
import type {
  AuthResult,
  InviteAcceptInput,
  InviteInfo,
  JoinByCodeInput,
  JoinPendingResult,
  OtpRequestResult,
  PublicAppConfig,
  RegisterInput,
  ValidatedSession,
} from "@/domain/auth/auth.types";
import type { StoredSession } from "@/domain/auth/auth.types";

export class GetPublicConfigUseCase {
  constructor(private readonly auth: AuthRepository) {}
  execute(): Promise<PublicAppConfig> {
    return this.auth.getPublicConfig();
  }
}

export class CheckPreRegisteredUseCase {
  constructor(private readonly auth: AuthRepository) {}
  execute(phone: string): Promise<{
    preRegistered: boolean;
    familyName: string | null;
  }> {
    return this.auth.checkPreRegistered(phone);
  }
}

export class UploadAvatarUseCase {
  constructor(private readonly auth: AuthRepository) {}
  execute(dataUrl: string): Promise<string> {
    return this.auth.uploadAvatar(dataUrl);
  }
}

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
  async execute(
    phone: string,
    password: string,
    code: string | null,
  ): Promise<AuthResult> {
    const r = await this.auth.loginWithOtp(phone, password, code);
    return r;
  }
}

export class RegisterUseCase {
  constructor(private readonly auth: AuthRepository) {}
  execute(input: RegisterInput, otpCode: string | null): Promise<AuthResult> {
    return this.auth.register(input, otpCode);
  }
}

/** پذیرش دعوت — §۲.۶: خروجی «در انتظار تأیید» است، نه نشست.
    عمداً به SaveSessionUseCase وصل نمی‌شود. */
export class AcceptInviteUseCase {
  constructor(private readonly auth: AuthRepository) {}
  execute(
    input: InviteAcceptInput,
    otpCode: string | null,
  ): Promise<JoinPendingResult> {
    return this.auth.acceptInvite(input, otpCode);
  }
}

/** پیوستن با کدِ خانواده — §۲.۶، دوقلوی AcceptInviteUseCase.
    مثل آن، عمداً به SaveSessionUseCase وصل نمی‌شود. */
export class JoinByCodeUseCase {
  constructor(private readonly auth: AuthRepository) {}
  execute(
    input: JoinByCodeInput,
    otpCode: string | null,
  ): Promise<JoinPendingResult> {
    return this.auth.joinByCode(input, otpCode);
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

/** بازیابی و اعتبارسنجی نشست ذخیره‌شده هنگام باز شدن نرم‌افزار */
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
      /* §۸.۵ عمداً این‌جا اجرا *نمی‌شود*، هرچند این مسیر هم نشست را پاک
         می‌کند. دلیل: این catch بینِ «توکن باطل شده» و «شبکه قطع بود»
         تفکیک نمی‌کند، و این کد در لحظهٔ بالا‌آمدنِ نرم‌افزار اجرا می‌شود.
         اگر کش را هم پاک می‌کرد، یک قطعیِ لحظه‌ایِ شبکه هنگامِ باز‌کردنِ
         نرم‌افزار پوستهٔ آفلاین را می‌بُرد — یعنی دقیقاً وقتی کاربر آفلاین
         است، صفحهٔ سفید می‌دید نه پیامِ «اتصال نیست». پاک‌کردنِ کش فقط به
         خروجِ *خواسته‌شده* گره خورده است. */
      await this.session.clear();
      return null;
    }
  }
}

/* §۸.۵ — خروج = بستنِ نشست + پاک‌کردنِ کشِ دستگاه.
   پاک‌کردن *بعد از* session.clear() می‌آید تا ترتیب معنادار بماند: اگر
   مرحلهٔ کش به هر دلیلی کُند یا ناموفق بود، نشست از قبل بسته شده است.
   OfflineCacheStore هم طبق قراردادش throw نمی‌کند، پس نیازی به try نیست —
   اما همین‌جا نوشته شد تا کسی که بعداً پیاده‌سازی را عوض می‌کند بداند
   خروج به سالم‌بودنِ آن تکیه کرده است. */
export class LogoutUseCase {
  constructor(
    private readonly session: SessionStore,
    private readonly auth: AuthRepository,
    private readonly cache: OfflineCacheStore,
  ) {}
  async execute(): Promise<void> {
    const stored = await this.session.load();
    if (stored?.token) {
      try {
        await this.auth.logout(stored.token);
      } catch {
        /* §۸.۵ — پیش از این، خطای سرور این‌جا پرتاب می‌شد و دو خطِ بعدی
           هرگز اجرا نمی‌شدند؛ یعنی «خروج» می‌توانست نه نشست را ببندد و نه
           کش را پاک کند. UI هم خطا را بی‌صدا می‌گرفت و صفحه را rebuild
           می‌کرد، پس کاربر «خارج شدم» می‌دید در حالی که توکن سرِ جایش بود
           و یک ۵۰۰ گذرا کافی بود تا بعدِ reload دوباره وارد شود.
           LogoutAllUseCase از اول همین گارد را داشت — این نبودنش
           ناهم‌خوانی بود، نه تصمیم. برچیدنِ محلی باید قطعی باشد. */
      }
    }
    await this.session.clear();
    await this.cache.clear();
  }
}

/** خروج از همه دستگاه‌ها — همه نشست‌های این عضو باطل می‌شوند */
export class LogoutAllUseCase {
  constructor(
    private readonly session: SessionStore,
    private readonly auth: AuthRepository,
    private readonly cache: OfflineCacheStore,
  ) {}
  async execute(): Promise<void> {
    const stored = await this.session.load();
    if (stored?.token) {
      try {
        await this.auth.logoutAll(stored.token);
      } catch {
        /* حتی اگر سرور پاسخ ندهد، نشست محلی پاک می‌شود */
      }
    }
    await this.session.clear();
    /* همان دلیلِ LogoutUseCase — این هم یک خروجِ تمام‌عیار است، پس §۸.۵
       باید این‌جا هم اجرا شود. اگر فقط در LogoutUseCase می‌بود، روزی که
       این مسیر به UI وصل شود بی‌صدا از تضمین جا می‌ماند. */
    await this.cache.clear();
  }
}

/** تغییر رمز عبور — نشست فعلی باقی می‌ماند، بقیه باطل می‌شوند */
export class ChangePasswordUseCase {
  constructor(
    private readonly session: SessionStore,
    private readonly auth: AuthRepository,
  ) {}
  async execute(currentPassword: string, newPassword: string): Promise<void> {
    const stored = await this.session.load();
    if (!stored?.token) throw new Error("NO_SESSION");
    await this.auth.changePassword(stored.token, currentPassword, newPassword);
  }
}

/** §۹.۵ گام ۱ — درخواست کد بازیابی رمز (بدون احراز هویت).
 *
 *  خروجی عمداً `void` است: پاسخِ سرور برای شمارهٔ ثبت‌شده و ثبت‌نشده یکسان است،
 *  پس هیچ چیزی برای برگرداندن وجود ندارد که UI بتواند رویش شاخه بزند. */
export class RequestPasswordResetUseCase {
  constructor(private readonly auth: AuthRepository) {}
  execute(phone: string): Promise<void> {
    return this.auth.requestPasswordReset(phone);
  }
}

/** §۹.۵ گام ۲ — تأیید کد و نشاندن رمز تازه.
 *
 *  سرور همهٔ نشست‌های آن عضو را باطل می‌کند و نشستِ تازه‌ای نمی‌دهد. پس اگر روی
 *  همین دستگاه نشستی ذخیره بود، دیگر مرده است و پاک می‌شود — وگرنه اپ با یک
 *  توکنِ باطل باز می‌ماند تا اولین درخواست SESSION_EXPIRED بدهد. */
export class ConfirmPasswordResetUseCase {
  constructor(
    private readonly session: SessionStore,
    private readonly auth: AuthRepository,
  ) {}
  async execute(
    phone: string,
    code: string,
    newPassword: string,
  ): Promise<void> {
    await this.auth.confirmPasswordReset(phone, code, newPassword);
    await this.session.clear();
  }
}
