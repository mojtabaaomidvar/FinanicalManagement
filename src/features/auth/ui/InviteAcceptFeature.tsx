/* UI پذیرش دعوت — عضویت در خانواده با لینک/QR */

import { useEffect } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { useAuthModel } from "../model/useAuthModel";
import { Field, TextInput } from "@/shared/ui";
import { toFa } from "@/shared/lib/digits";

export function InviteAcceptFeature({ token }: { token: string }) {
  const { useCases, onAuthenticated, refreshData } = useApp();
  const { show } = useToast();
  const m = useAuthModel(useCases!, show);

  /* بارگذاری اطلاعات دعوت — فقط یک‌بار */
  useEffect(() => {
    void m.loadInvite(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

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
            <use href="#i-users" />
          </svg>
        </div>
        <h1>دعوت به خانواده</h1>
        <p className="auth-sub">
          {m.inviteToken
            ? `شما به خانواده «${m.inviteFamilyName}» دعوت شده‌اید`
            : "—"}
        </p>

        <form
          className="auth-form"
          onSubmit={(e) => {
            e.preventDefault();
            m.submitInvite(finish);
          }}
        >
          <Field label="نام شما">
            <TextInput
              value={m.invName}
              onChange={m.setInvName}
              placeholder="مثلاً سارا"
            />
          </Field>
          <Field label="شماره موبایل">
            <TextInput
              value={m.invPhone}
              onChange={m.setInvPhone}
              placeholder="۰۹۱۲۳۴۵۶۷۸۹"
              dir="ltr"
              inputMode="tel"
              autoComplete="tel"
            />
          </Field>
          <Field label="رمز عبور">
            <TextInput
              type="password"
              value={m.invPassword}
              onChange={m.setInvPassword}
              placeholder="حداقل ۴ کاراکتر"
              dir="ltr"
              autoComplete="new-password"
            />
          </Field>
          <button type="submit" className="btn-primary btn-block" disabled={m.busy}>
            عضویت در خانواده
          </button>
        </form>

        {m.step === "otp" ? (
          <form
            className="auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              m.verifyOtp(finish);
            }}
          >
            <p className="otp-desc">
              کد ۶ رقمی ارسال‌شده به <b>{toFa(m.flow?.phone ?? "")}</b> را وارد کنید
            </p>
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
                onChange={(e) => m.setOtpCode(e.target.value)}
              />
            </div>
            {m.devCode ? (
              <div className="otp-dev-hint">
                حالت توسعه — کد تأیید: {m.devCode}
              </div>
            ) : null}
            <button type="submit" className="btn-primary btn-block">
              تأیید
            </button>
          </form>
        ) : (
          <p className="auth-hint">
            {m.otpEnabled === false
              ? "با ثبت اطلاعات، عضو خانواده می‌شوید."
              : "بعد از ثبت‌نام، کد تأیید پیامکی برای شما ارسال می‌شود."}
          </p>
        )}
      </div>
    </section>
  );
}
