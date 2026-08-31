/* خطای استاندارد اپ — همه خطاهای لایه‌ها به این شکل تبدیل می‌شوند */

export type AppErrorCode =
  | "NETWORK"
  | "SERVER"
  | "SESSION_EXPIRED"
  | "OTP_API_ONLY"
  | "TOO_SOON"
  | "TOO_MANY_ATTEMPTS"
  | "PHONE_EXISTS"
  | "INVALID_OTP"
  | "INVALID_INVITE"
  | "NO_MEMBER"
  | "INVALID_MEMBER"
  | "INVALID_TX"
  | "INVALID_ACCOUNT"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "CANNOT_REMOVE_OWNER"
  | "NOT_CONFIGURED"
  | "UNKNOWN";

export class AppError extends Error {
  readonly code: AppErrorCode;

  constructor(code: AppErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
