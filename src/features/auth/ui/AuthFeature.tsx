/* UI احراز هویت — موبایل‌فرست
   سوییچر قرصی متحرک + اسلاید نرم فرم‌ها + OTP */

import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { useAuthModel, type AuthPrefill } from "../model/useAuthModel";
import { MEMBER_RELATIONS } from "@/domain/family/family.types";
import { toFa } from "@/shared/lib/digits";
import { usePwaUpdateState } from "@/app/pwaUpdate.tsx";

export function AuthFeature({ prefill }: { prefill?: AuthPrefill } = {}) {
  const { useCases, onAuthenticated, refreshData } = useApp();
  const { show } = useToast();
  const m = useAuthModel(useCases!, show, prefill);
  const { updateReady, applyUpdate } = usePwaUpdateState();

  const otpStep = m.step === "otp";
  const isRegister = m.mode === "register";

  async function finish() {
    const restored = await useCases!.restoreSession.execute();
    if (restored) onAuthenticated(restored);
    await refreshData();
  }

  /* ── §۲.۶ پایانِ مسیرِ «پیوستن با کد»: در انتظارِ تأییدِ مدیر ──
     این صفحه باید همین‌جا هم باشد، نه فقط در InviteAcceptFeature: مسیرِ کد از
     همین صفحهٔ ورود شروع می‌شود و بدونِ این شاخه، کاربر پس از ثبتِ موفقِ
     درخواست فقط یک toast می‌دید و همان فرمِ ورود سرِ جایش می‌ماند — یعنی
     «نشد» به نظر می‌رسید در حالی که شده بود. */
  if (m.step === "pending") {
    return (
      <section className="page active auth-screen">
        <div className="auth-hero">
          <div className="auth-art">
            <img src="/khaneyar-mark.svg" alt="" />
          </div>
        </div>

        <div className="auth-otp">
          <h2>درخواست شما ثبت شد</h2>
          <p className="auth-note">
            {m.joinPending?.familyName
              ? `درخواست عضویت شما در خانواده «${m.joinPending.familyName}» برای مدیر خانواده فرستاده شد.`
              : "درخواست عضویت شما برای مدیر خانواده فرستاده شد."}
          </p>
          <div className="prereg-banner">
            تا وقتی مدیر خانواده تأیید نکند، امکان ورود وجود ندارد.
          </div>
          <p className="auth-note">
            بعد از تأیید، با همین شماره موبایل و رمزی که انتخاب کردید وارد شوید.
          </p>
          <button
            type="button"
            className="auth-submit"
            onClick={m.cancelJoinByCode}
          >
            بازگشت به ورود
          </button>
        </div>
      </section>
    );
  }

  /* ── §۲.۶ راهِ سوم: پیوستن به خانوادهٔ موجود با کدِ ۶ رقمی ──
     صفحهٔ جدا است و نه یک پنجرهٔ سومِ سوییچرِ قرصی: آن سوییچر و تراکِ
     اسلایدی‌اش برای دقیقاً دو فرم ساخته شده و افزودنِ سومی، چیدمانِ هر دو
     فرمِ موجود را می‌شکست. */
  if (m.step === "join") {
    return (
      <section className="page active auth-screen">
        <div className="auth-hero">
          <div className="auth-art">
            <img src="/khaneyar-mark.svg" alt="" />
          </div>
        </div>

        <div className="auth-otp">
          <h2>پیوستن به خانواده</h2>
          <p className="auth-note">
            کد ۶ رقمی خانواده را از مدیر خانواده بگیرید. این کد در «تنظیمات ←
            اعضای خانواده» به او نشان داده می‌شود.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              m.submitJoinByCode();
            }}
          >
            <input
              className="auth-input otp-input"
              type="text"
              inputMode="numeric"
              maxLength={6}
              dir="ltr"
              placeholder="••••••"
              autoFocus
              value={m.joinCode}
              onChange={(e) => m.setJoinCode(e.target.value)}
            />
            <input
              className="auth-input"
              type="text"
              placeholder="نام شما"
              value={m.joinName}
              onChange={(e) => m.setJoinName(e.target.value)}
            />
            {/* نسبت لازم است، نه اختیاری: بدون آن سرور «سایر» ثبت می‌کند و
                نسبتِ عضوِ تازه در فهرستِ خانواده اشتباه می‌ماند */}
            <select
              className="auth-input"
              value={m.joinRelation}
              onChange={(e) => m.setJoinRelation(e.target.value)}
            >
              <option value="">نسبت شما با مدیر خانواده</option>
              {MEMBER_RELATIONS.filter((r) => r !== "خودم").map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <input
              className="auth-input"
              type="tel"
              dir="ltr"
              inputMode="tel"
              autoComplete="tel"
              placeholder="شماره موبایل"
              value={m.joinPhone}
              onChange={(e) => m.setJoinPhone(e.target.value)}
            />
            <input
              className="auth-input"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              placeholder="رمز عبور (حداقل ۸ کاراکتر)"
              value={m.joinPassword}
              onChange={(e) => m.setJoinPassword(e.target.value)}
            />
            <button className="auth-submit" type="submit" disabled={m.busy}>
              {m.busy ? "…" : "ارسال درخواست عضویت"}
            </button>
          </form>
          {/* صداقتِ متن: این فرم عضویت نمی‌دهد، فقط درخواست می‌سازد */}
          <p className="auth-note">
            {m.otpEnabled
              ? "ابتدا کد تأیید پیامکی برایتان فرستاده می‌شود؛ سپس درخواست عضویت برای تأیید مدیر خانواده ثبت می‌گردد."
              : "درخواست شما برای مدیر خانواده فرستاده می‌شود و پس از تأیید او می‌توانید وارد شوید."}
          </p>
          <div className="otp-row">
            <button
              type="button"
              className="back-btn"
              onClick={m.cancelJoinByCode}
            >
              بازگشت به ورود
            </button>
          </div>
        </div>
      </section>
    );
  }

  /* ── §۹.۵ فراموشیِ رمز، گامِ ۱: شماره ──
     پیش از مرحلهٔ OTP بررسی می‌شود چون هر دو از یک پوستهٔ `auth-otp` استفاده
     می‌کنند و مسیرهایشان جداست. */
  if (m.step === "reset") {
    return (
      <section className="page active auth-screen">
        <div className="auth-hero">
          <div className="auth-art">
            <img src="/khaneyar-mark.svg" alt="" />
          </div>
        </div>

        <div className="auth-otp">
          <h2>بازیابی رمز عبور</h2>
          <p className="auth-note">
            شماره موبایل حساب خود را بنویسید تا کد بازیابی برایتان پیامک شود
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              m.sendResetCode();
            }}
          >
            <input
              className="auth-input"
              type="tel"
              dir="ltr"
              inputMode="tel"
              autoComplete="tel"
              placeholder="شماره موبایل"
              autoFocus
              value={m.resetPhone}
              onChange={(e) => m.setResetPhone(e.target.value)}
            />
            <button className="auth-submit" type="submit" disabled={m.busy}>
              {m.busy ? "…" : "ارسال کد بازیابی"}
            </button>
          </form>
          <div className="otp-row">
            <button
              type="button"
              className="back-btn"
              onClick={m.cancelPasswordReset}
            >
              بازگشت به ورود
            </button>
          </div>
        </div>
      </section>
    );
  }

  /* ── §۹.۵ فراموشیِ رمز، گامِ ۲: کد + رمزِ تازه ── */
  if (m.step === "reset-code") {
    return (
      <section className="page active auth-screen">
        <div className="auth-hero">
          <div className="auth-art">
            <img src="/khaneyar-mark.svg" alt="" />
          </div>
        </div>

        <div className="auth-otp">
          <h2>رمز تازه</h2>
          {/* متن عمداً شرطی است: سرور برای شمارهٔ ثبت‌نشده هم همین پاسخ را
              می‌دهد، پس «کد فرستادیم» گفتن هم دروغ است و هم می‌گوید این شماره
              ثبت شده. */}
          <p className="auth-note">
            اگر شماره <b>{toFa(m.resetPhone)}</b> ثبت شده باشد، کد ۶ رقمی برایش
            پیامک شده است
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              m.submitPasswordReset();
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
              value={m.resetCode}
              onChange={(e) => m.setResetCode(e.target.value)}
            />
            <input
              className="auth-input"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              placeholder="رمز عبور تازه (حداقل ۸ کاراکتر)"
              value={m.resetPassword}
              onChange={(e) => m.setResetPassword(e.target.value)}
            />
            <button className="auth-submit" type="submit" disabled={m.busy}>
              {m.busy ? "…" : "تغییر رمز"}
            </button>
          </form>
          <p className="auth-note">
            با تغییر رمز، از همه دستگاه‌ها خارج می‌شوید و باید دوباره وارد شوید
          </p>
          <div className="otp-row">
            <button
              type="button"
              className="back-btn"
              onClick={m.cancelPasswordReset}
            >
              انصراف
            </button>
            <button
              type="button"
              className="back-btn"
              onClick={() => m.sendResetCode({ resend: true })}
              disabled={m.busy || m.resetWait > 0}
            >
              {m.resetWait > 0
                ? `ارسال مجدد تا ${toFa(m.resetWait)} ثانیه`
                : "ارسال مجدد کد"}
            </button>
          </div>
        </div>
      </section>
    );
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
              {m.busy
                ? "…"
                : /* §۲.۶ — در مسیرِ «پیوستن با کد» این دکمه وارد نمی‌کند،
                     فقط درخواست می‌فرستد. «تأیید و ورود» گفتن همان وعدهٔ
                     دروغی بود که کلِ جریانِ تأییدِ مدیر را پنهان می‌کرد. */
                  m.flow?.mode === "join"
                    ? "تأیید و ارسال درخواست"
                    : "تأیید و ورود"}
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

      {updateReady ? (
        <div className="update-banner" role="status">
          <div>
            <b>نسخه جدید آماده است</b>
            <p>اول به‌روزرسانی کن، بعد وارد شو</p>
          </div>
          <button type="button" className="btn-primary" onClick={applyUpdate}>
            به‌روزرسانی
          </button>
        </div>
      ) : null}

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
            {/* §۹.۵ — فقط وقتی سرور می‌تواند کد بفرستد. روی سرورِ بی‌درگاهِ
                پیامک این دکمه جز ۵۰۳ چیزی نمی‌داد، پس اصلاً نمایش داده نمی‌شود. */}
            {m.passwordResetEnabled ? (
              <button
                type="button"
                className="auth-forgot"
                onClick={m.startPasswordReset}
              >
                رمز عبور را فراموش کرده‌اید؟
              </button>
            ) : null}
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
            {/* شماره موبایل — اول (تشخیص عضو پیش‌ثبت‌شده) */}
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
                m.checkPreRegistered(e.target.value);
              }}
            />

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
                placeholder="نام خانواده"
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

            {/* نسبت با مدیر — فقط برای عضو پیش‌ثبت‌شده */}
            {m.preReg ? (
              <select
                className="auth-input"
                value={m.regRelation}
                onChange={(e) => m.setRegRelation(e.target.value)}
              >
                <option value="">نسبت شما با مدیر خانواده</option>
                {MEMBER_RELATIONS.filter((r) => r !== "خودم").map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            ) : null}

            <input
              className="auth-input"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              placeholder="رمز عبور (حداقل ۸ کاراکتر)"
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

      {/* ── §۲.۶ راهِ سوم ──
          بیرونِ auth-track است تا در هر دو حالتِ سوییچر دیده شود: کسی که
          خانواده‌اش قبلاً در خانه‌یار هست نباید با «ثبت‌نام» خانوادهٔ دومی
          بسازد، و این تنها نقطه‌ای است که جلوی آن را می‌گیرد. */}
      <div className="auth-third">
        <span>خانواده‌تان قبلاً در خانه‌یار ثبت شده؟</span>
        <button type="button" onClick={m.startJoinByCode}>
          با کد خانواده بپیوندید
        </button>
      </div>
    </section>
  );
}
