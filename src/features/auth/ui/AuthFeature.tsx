/* UI احراز هویت — ورود/ثبت‌نام/OTP */

import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { useAuthModel } from "../model/useAuthModel";
import { Field, Segmented, TextInput } from "@/shared/ui";
import { toFa } from "@/shared/lib/digits";

export function AuthFeature() {
  const { useCases, onAuthenticated, refreshData } = useApp();
  const { show } = useToast();
  const m = useAuthModel(useCases!, show);

  async function finish() {
    const restored = await useCases!.restoreSession.execute();
    if (restored) onAuthenticated(restored);
    await refreshData();
  }

  return (
    <section className="page auth-page active">
      <div className="auth-wrap">
        <div className="auth-logo">
          <svg>
            <use href="#i-wallet" />
          </svg>
        </div>
        <h1>مالی من</h1>
        <p className="auth-sub">مدیریت مالی خانواده، ساده و مشترک</p>

        {m.step === "form" ? (
          <div>
            <Segmented
              value={m.mode}
              onChange={m.setMode}
              options={[
                { value: "login", label: "ورود" },
                { value: "register", label: "ثبت‌نام" },
              ]}
            />

            {m.mode === "login" ? (
              <form
                className="auth-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  m.submitLogin(finish);
                }}
              >
                <Field label="شماره موبایل">
                  <TextInput
                    value={m.loginPhone}
                    onChange={m.setLoginPhone}
                    placeholder="۰۹۱۲۳۴۵۶۷۸۹"
                    dir="ltr"
                    inputMode="tel"
                    autoComplete="tel"
                  />
                </Field>
                <Field label="رمز عبور">
                  <TextInput
                    type="password"
                    value={m.loginPassword}
                    onChange={m.setLoginPassword}
                    placeholder="••••••••"
                    dir="ltr"
                    autoComplete="current-password"
                  />
                </Field>
                <button type="submit" className="btn-primary btn-block" disabled={m.busy}>
                  ورود
                </button>
              </form>
            ) : (
              <form
                className="auth-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  m.submitRegister(finish);
                }}
              >
                <Field label="نام خانواده">
                  <TextInput
                    value={m.regFamily}
                    onChange={m.setRegFamily}
                    placeholder="مثلاً خانواده احمدی"
                  />
                </Field>
                <Field label="نام شما">
                  <TextInput
                    value={m.regName}
                    onChange={m.setRegName}
                    placeholder="مثلاً علی"
                  />
                </Field>
                <Field label="شماره موبایل">
                  <TextInput
                    value={m.regPhone}
                    onChange={m.setRegPhone}
                    placeholder="۰۹۱۲۳۴۵۶۷۸۹"
                    dir="ltr"
                    inputMode="tel"
                    autoComplete="tel"
                  />
                </Field>
                <Field label="رمز عبور">
                  <TextInput
                    type="password"
                    value={m.regPassword}
                    onChange={m.setRegPassword}
                    placeholder="حداقل ۴ کاراکتر"
                    dir="ltr"
                    autoComplete="new-password"
                  />
                </Field>
                <button type="submit" className="btn-primary btn-block" disabled={m.busy}>
                  ثبت‌نام و ساخت خانواده
                </button>
              </form>
            )}
          </div>
        ) : (
          <div>
            <p className="otp-desc">
              کد ۶ رقمی ارسال‌شده به <b>{toFa(m.flow?.phone ?? "")}</b> را وارد کنید
            </p>
            <form
              className="auth-form"
              onSubmit={(e) => {
                e.preventDefault();
                m.verifyOtp(finish);
              }}
            >
              <div className="form-row">
                <input
                  type="text"
                  className="num-input big otp-input"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="------"
                  autoComplete="one-time-code"
                  dir="ltr"
                  value={m.otpCode}
                  autoFocus
                  onChange={(e) => m.setOtpCode(e.target.value)}
                />
              </div>
              {m.devCode ? (
                <div className="otp-dev-hint">
                  حالت توسعه — کد تأیید: {toFa(m.devCode)}
                </div>
              ) : null}
              <button type="submit" className="btn-primary btn-block" disabled={m.busy}>
                تأیید
              </button>
              <button
                type="button"
                className="btn-ghost btn-block"
                onClick={m.resetOtp}
              >
                بازگشت
              </button>
              <button
                type="button"
                className="btn-ghost btn-block"
                onClick={m.resendOtp}
              >
                ارسال مجدد کد
              </button>
            </form>
          </div>
        )}

        <p className="auth-hint">
          {m.otpEnabled === false
            ? "ورود با شماره موبایل و رمز عبور کافی است."
            : "ورود دو مرحله‌ای: بعد از رمز عبور، کد تأیید پیامکی برای شما ارسال می‌شود."}
        </p>
      </div>
    </section>
  );
}
