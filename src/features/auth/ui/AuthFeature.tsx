/* UI احراز هویت — کارت دوپنلی (الگوی Login4، RTL)
   چپ: پنل تصویری hero با سوییچ · راست: فرم ورود/ثبت‌نام · OTP تمام‌کارت */

import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { useAuthModel } from "../model/useAuthModel";
import { toFa } from "@/shared/lib/digits";

export function AuthFeature() {
  const { useCases, onAuthenticated, refreshData } = useApp();
  const { show } = useToast();
  const m = useAuthModel(useCases!, show);

  const otpStep = m.step === "otp";

  async function finish() {
    const restored = await useCases!.restoreSession.execute();
    if (restored) onAuthenticated(restored);
    await refreshData();
  }

  return (
    <section className="page active login4-page">
      <div className={`login4-card ${otpStep ? "otp-mode" : ""}`}>

        {/* نیمه تصویری (چپ) — hero فعال مطابق حالت مقابل */}
        <div className="half half-hero">
          <div className="card-bg" />

          {/* نمایان وقتی فرمِ ورود سمت راست است — دعوت به ثبت‌نام */}
          <div className={`hero ${m.mode === "login" ? "active" : ""}`}>
            <h2>سلام!</h2>
            <p>
              هنوز خانواده‌ای نساخته‌ای؟ همین حالا شروع کن و مدیریت مالی خانواده
              را ساده و مشترک کن.
            </p>
            <button type="button" onClick={() => m.setMode("register")}>
              ثبت‌نام
            </button>
          </div>

          {/* نمایان وقتی فرمِ ثبت‌نام سمت راست است — دعوت به ورود */}
          <div className={`hero ${m.mode === "register" ? "active" : ""}`}>
            <h2>خوش برگشتی!</h2>
            <p>
              برای دیدن تراکنش‌ها، کارت‌ها و گزارش‌های خانواده، با شماره موبایل و
              رمزت وارد شو.
            </p>
            <button type="button" onClick={() => m.setMode("login")}>
              ورود
            </button>
          </div>
        </div>

        {/* نیمه فرم (راست) */}
        <div className="half half-form">

          {/* فرم ورود */}
          <div className={`form login ${m.mode === "login" && !otpStep ? "active" : ""}`}>
            <h2>ورود</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                m.submitLogin(finish);
              }}
            >
              <input
                type="tel"
                placeholder="شماره موبایل (۰۹۱۲...)"
                dir="ltr"
                inputMode="tel"
                autoComplete="tel"
                value={m.loginPhone}
                onChange={(e) => m.setLoginPhone(e.target.value)}
              />
              <input
                type="password"
                placeholder="رمز عبور"
                dir="ltr"
                autoComplete="current-password"
                value={m.loginPassword}
                onChange={(e) => m.setLoginPassword(e.target.value)}
              />
              <button type="submit" disabled={m.busy}>
                {m.busy ? "…" : "ورود"}
              </button>
            </form>
            <p className="form-note">
              با شماره موبایل و رمز عبور وارد شوید
              {m.otpEnabled ? " — سپس کد پیامکی تأیید می‌شود" : ""}
            </p>
          </div>

          {/* فرم ثبت‌نام */}
          <div className={`form register ${m.mode === "register" && !otpStep ? "active" : ""}`}>
            <h2>ثبت‌نام</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                m.submitRegister(finish);
              }}
            >
              <input
                type="text"
                placeholder="نام خانواده (مثلاً خانواده احمدی)"
                value={m.regFamily}
                onChange={(e) => m.setRegFamily(e.target.value)}
              />
              <input
                type="text"
                placeholder="نام شما"
                value={m.regName}
                onChange={(e) => m.setRegName(e.target.value)}
              />
              <input
                type="tel"
                placeholder="شماره موبایل (۰۹۱۲...)"
                dir="ltr"
                inputMode="tel"
                autoComplete="tel"
                value={m.regPhone}
                onChange={(e) => m.setRegPhone(e.target.value)}
              />
              <input
                type="password"
                placeholder="رمز عبور (حداقل ۴ کاراکتر)"
                dir="ltr"
                autoComplete="new-password"
                value={m.regPassword}
                onChange={(e) => m.setRegPassword(e.target.value)}
              />
              <button type="submit" disabled={m.busy}>
                {m.busy ? "…" : "ساخت خانواده"}
              </button>
            </form>
            <p className="form-note">
              شما مدیر خانواده می‌شوید و می‌توانید بقیه اعضا را با لینک دعوت کنید
            </p>
          </div>

          {/* مرحله OTP — تمام عرض کارت */}
          {otpStep ? (
            <div className="form otp-panel active">
              <h2>کد تأیید</h2>
              <p className="form-note">
                کد ۶ رقمی ارسال‌شده به <b>{toFa(m.flow?.phone ?? "")}</b> را وارد
                کنید
              </p>
              {m.devCode ? (
                <div className="otp-hint">
                  حالت توسعه — کد تأیید: {toFa(m.devCode)}
                </div>
              ) : null}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  m.verifyOtp(finish);
                }}
              >
                <input
                  type="text"
                  className="otp-input"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="••••••"
                  autoComplete="one-time-code"
                  dir="ltr"
                  autoFocus
                  value={m.otpCode}
                  onChange={(e) => m.setOtpCode(e.target.value)}
                />
                <button type="submit" disabled={m.busy}>
                  {m.busy ? "…" : "تأیید"}
                </button>
              </form>
              <div style={{ display: "flex", gap: 12 }}>
                <button type="button" className="back-btn" onClick={m.resetOtp}>
                  بازگشت
                </button>
                <button
                  type="button"
                  className="back-btn"
                  onClick={m.resendOtp}
                  disabled={m.busy}
                >
                  ارسال مجدد کد
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
