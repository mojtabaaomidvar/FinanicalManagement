/* UI احراز هویت — موبایل‌فرست
   سوییچر قرصی متحرک + اسلاید نرم فرم‌ها + OTP */

import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { useAuthModel } from "../model/useAuthModel";
import { toFa } from "@/shared/lib/digits";

export function AuthFeature() {
  const { useCases, onAuthenticated, refreshData } = useApp();
  const { show } = useToast();
  const m = useAuthModel(useCases!, show);

  const otpStep = m.step === "otp";
  const isRegister = m.mode === "register";

  async function finish() {
    const restored = await useCases!.restoreSession.execute();
    if (restored) onAuthenticated(restored);
    await refreshData();
  }

  /* ── مرحله OTP ── */
  if (otpStep) {
    return (
      <section className="page active auth-screen">
        <div className="auth-hero">
          <div className="auth-art">
            <img src="/khaneyar-mark.svg" alt="" />
          </div>
        </div>

        <div className="auth-otp">
          <h2>کد تأیید</h2>
          <p className="auth-note">
            کد ۶ رقمی ارسال‌شده به <b>{toFa(m.flow?.phone ?? "")}</b> را وارد کنید
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
              className="auth-input otp-input"
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="••••••"
              autoComplete="one-time-code"
              dir="ltr"
              autoFocus
              value={m.otpCode}
              onChange={(e) => m.setOtpCode(e.target.value)}
            />
            <button className="auth-submit" type="submit" disabled={m.busy}>
              {m.busy ? "…" : "تأیید و ورود"}
            </button>
          </form>
          <div className="otp-row">
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
      </section>
    );
  }

  /* ── ورود / ثبت‌نام ── */
  return (
    <section className="page active auth-screen">
      <header className="auth-hero">
        <div className="auth-art">
          <img src="/khaneyar-mark.svg" alt="خانه یار" />
        </div>
        <h1>خانه یار</h1>
        <p>دستیار مالی خانواده</p>
      </header>

      {/* سوییچر قرصی با نشانگر متحرک */}
      <div className={`auth-switch ${isRegister ? "reg" : ""}`}>
        <div className="switch-ind" />
        <button
          type="button"
          className={!isRegister ? "active" : ""}
          onClick={() => m.setMode("login")}
        >
          ورود
        </button>
        <button
          type="button"
          className={isRegister ? "active" : ""}
          onClick={() => m.setMode("register")}
        >
          ثبت‌نام
        </button>
      </div>

      {/* تراک اسلایدی دو فرم */}
      <div className="auth-wrap">
        <div className={`auth-track ${isRegister ? "reg" : ""}`}>
          {/* فرم ورود */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              m.submitLogin(finish);
            }}
          >
            <input
              className="auth-input"
              type="tel"
              dir="ltr"
              inputMode="tel"
              autoComplete="tel"
              placeholder="شماره موبایل"
              value={m.loginPhone}
              onChange={(e) => m.setLoginPhone(e.target.value)}
            />
            <input
              className="auth-input"
              type="password"
              dir="ltr"
              autoComplete="current-password"
              placeholder="رمز عبور"
              value={m.loginPassword}
              onChange={(e) => m.setLoginPassword(e.target.value)}
            />
            <button className="auth-submit" type="submit" disabled={m.busy}>
              {m.busy ? "…" : "ورود"}
            </button>
            <p className="auth-note">
              با شماره موبایل و رمز عبور
              {m.otpEnabled ? " و سپس کد پیامکی" : ""} وارد شوید
            </p>
          </form>

          {/* فرم ثبت‌نام */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              m.submitRegister(finish);
            }}
          >
            {/* بنر عضو پیش‌ثبت‌شده — اطلاعات خانواده قفل */}
            {m.preReg ? (
              <div className="prereg-banner">
                این شماره قبلاً به‌عنوان عضو خانواده «{m.preReg.familyName}»
                معرفی شده — ثبت‌نام شما همین خانواده را کامل می‌کند.
              </div>
            ) : null}

            {m.preReg ? (
              <input
                className="auth-input"
                type="text"
                value={m.preReg.familyName}
                readOnly
                aria-readonly="true"
                style={{ opacity: 0.7 }}
                title="خانواده شما (غیرقابل تغییر)"
              />
            ) : (
              <input
                className="auth-input"
                type="text"
                placeholder="نام خانواده (مثلاً احمدی)"
                value={m.regFamily}
                onChange={(e) => m.setRegFamily(e.target.value)}
              />
            )}
            <input
              className="auth-input"
              type="text"
              placeholder="نام شما"
              value={m.regName}
              onChange={(e) => m.setRegName(e.target.value)}
            />
            <input
              className="auth-input"
              type="tel"
              dir="ltr"
              inputMode="tel"
              autoComplete="tel"
              placeholder="شماره موبایل"
              value={m.regPhone}
              onChange={(e) => {
                m.setRegPhone(e.target.value);
                /* با کامل‌شدن شماره، بررسی عضو پیش‌ثبت‌شده */
                m.checkPreRegistered(e.target.value);
              }}
            />
            <input
              className="auth-input"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              placeholder="رمز عبور (حداقل ۴ کاراکتر)"
              value={m.regPassword}
              onChange={(e) => m.setRegPassword(e.target.value)}
            />
            <button className="auth-submit" type="submit" disabled={m.busy}>
              {m.busy ? "…" : m.preReg ? "تکمیل ثبت‌نام" : "ساخت خانواده"}
            </button>
            <p className="auth-note">
              {m.preReg
                ? "خانواده شما از قبل ساخته شده — با ثبت‌نام، عضو کامل خانواده می‌شوید"
                : "مدیر خانواده می‌شوید و می‌توانید بقیه اعضا را دعوت کنید"}
            </p>
          </form>
        </div>
      </div>
    </section>
  );
}
