/* اینترفیس مخزن احراز هویت — پیاده‌سازی در infrastructure/repositories */

import type {
  AuthResult,
  InviteAcceptInput,
  InviteInfo,
  JoinByCodeInput,
  JoinPendingResult,
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

/** §۸.۵ — کشِ آفلاینِ دستگاه (CacheStorage سرویس‌ورکر)
 *
 *  چرا درز (port) شد و چرا همین‌جا کنارِ SessionStore نشست:
 *  §۸.۵ می‌گوید «کشِ دستگاه هنگامِ خروج پاک می‌شود» — این وعده دربارهٔ
 *  *خروج* است، نه دربارهٔ یک دکمهٔ خاص در تنظیمات. اگر پاک‌کردن را مستقیم
 *  داخل هندلرِ آن دکمه می‌نوشتیم، هر مسیرِ خروجِ دیگری (خروج از همهٔ
 *  دستگاه‌ها، یا هر دکمهٔ خروجی که فردا جایی اضافه شود) بی‌صدا از این
 *  تضمین جا می‌ماند؛ همان الگویی که در vite.config قاعدهٔ مُردهٔ supabase
 *  را ساخته بود. پس LogoutUseCase خودش این کار را می‌کند و لایهٔ
 *  application هم پاک می‌ماند (آن لایه هیچ API مرورگری را صدا نمی‌زند).
 *
 *  جایش کنارِ SessionStore است چون هر دو یک جنس‌اند: «آنچه دستگاه از
 *  کاربرِ وارد‌شده نگه می‌دارد». */
export interface OfflineCacheStore {
  /** هرگز throw نمی‌کند — پاک‌نشدنِ کش نباید جلوی بسته‌شدنِ نشست را بگیرد */
  clear(): Promise<void>;
}

export interface AuthRepository {
  /** تنظیمات عمومی (فعال بودن OTP و…) — بدون احراز هویت */
  getPublicConfig(): Promise<PublicAppConfig>;
  /** آیا این شماره توسط مدیری به‌عنوان عضو (pending) معرفی شده؟ */
  checkPreRegistered(phone: string): Promise<{
    preRegistered: boolean;
    familyName: string | null;
  }>;
  /** آپلود عکس پروفایل (سرورless) → URL عمومی */
  uploadAvatar(dataUrl: string): Promise<string>;
  /** درخواست کد OTP (سرورless، با fallback حالت توسعه) */
  requestOtp(phone: string): Promise<OtpRequestResult>;
  /** مرحله ۱ ورود: بررسی شماره + رمز (رمز خام روی HTTPS — هش سمت سرور) */
  checkPassword(phone: string, password: string): Promise<boolean>;
  /** مرحله ۲ ورود: رمز + OTP → نشست (code=null وقتی OTP غیرفعال است)
      رمز دوباره فرستاده می‌شود چون سرور آن را در auth_login هم بررسی می‌کند */
  loginWithOtp(phone: string, password: string, code: string | null): Promise<AuthResult>;
  /** ثبت‌نام — OTP سمت سرور اعتبارسنجی می‌شود (null = OTP غیرفعال) */
  register(input: RegisterInput, otpCode: string | null): Promise<AuthResult>;
  /** پذیرش دعوت — §۲.۶: نشست نمی‌دهد، فقط درخواست عضویت ثبت می‌کند و
      منتظر تأیید مدیر می‌ماند (OTP سمت سرور اعتبارسنجی می‌شود؛ null = خاموش) */
  acceptInvite(
    input: InviteAcceptInput,
    otpCode: string | null,
  ): Promise<JoinPendingResult>;
  /** پیوستن با کدِ خانواده — §۲.۶، راهِ دوم در برابرِ لینکِ دعوت.
      مثل acceptInvite نشست نمی‌دهد و خروجی‌اش «در انتظارِ تأیید» است؛
      بی‌احراز‌هویت صدا زده می‌شود (از صفحهٔ ورود). */
  joinByCode(
    input: JoinByCodeInput,
    otpCode: string | null,
  ): Promise<JoinPendingResult>;
  /** اطلاعات دعوت‌نامه (نام خانواده) */
  getInvite(token: string): Promise<InviteInfo>;
  /** ساخت لینک دعوت جدید برای خانواده نشست فعلی */
  createInvite(): Promise<string>;
  /** اعتبارسنجی توکن نشست */
  validateSession(token: string): Promise<ValidatedSession>;
  /** خروج — حذف نشست سمت سرور */
  logout(token: string): Promise<void>;
  /** خروج از همه دستگاه‌ها — ابطال همه نشست‌های این عضو */
  logoutAll(token: string): Promise<void>;
  /** تغییر رمز عبور — نشست‌های دیگر باطل می‌شوند */
  changePassword(
    token: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void>;
  /** §۹.۵ گام ۱ — درخواست کد بازیابی رمز.
      همیشه موفق است، حتی برای شماره‌ای که ثبت نشده (محافظت از شمارش حساب‌ها)؛
      پس از پاسخِ آن نمی‌توان فهمید شماره وجود دارد یا نه، و متنِ UI هم باید
      همین را بگوید: «اگر این شماره ثبت شده باشد، کد برایش پیامک شد». */
  requestPasswordReset(phone: string): Promise<void>;
  /** §۹.۵ گام ۲ — کد + رمز تازه. همهٔ نشست‌های آن عضو باطل می‌شوند و هیچ
      نشستِ تازه‌ای صادر نمی‌شود؛ کاربر از مسیر عادی ورود می‌آید. */
  confirmPasswordReset(
    phone: string,
    code: string,
    newPassword: string,
  ): Promise<void>;
}
