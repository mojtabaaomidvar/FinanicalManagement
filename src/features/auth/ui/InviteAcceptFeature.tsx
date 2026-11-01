/* UI پذیرش دعوت — عضویت در خانواده با لینک/QR */

import { useEffect } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { useAuthModel } from "../model/useAuthModel";
import { Field, Select, TextInput } from "@/shared/ui";
import { MEMBER_RELATIONS } from "@/domain/family/family.types";
import { toFa } from "@/shared/lib/digits";

export function InviteAcceptFeature({ token }: { token: string }) {
  const { useCases } = useApp();
  const { show } = useToast();
  const m = useAuthModel(useCases!, show);

  /* بارگذاری اطلاعات دعوت — فقط یک‌بار */
  useEffect(() => {
    void m.loadInvite(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  /* §۲.۶ — درخواست ثبت شد و منتظر تأیید مدیر است. اینجا عمداً هیچ نشستی
     ذخیره نمی‌شود و کاربر وارد نرم‌افزار نمی‌شود؛ پس از تأیید، از مسیر
     عادی «ورود» وارد می‌شود. */
  if (m.step === "pending") {
    return (
      <section className="page auth-page active">
        <div className="auth-wrap auth-pending">
          <div className="auth-logo">
            <svg>
              <use href="#i-clock" />
            </svg>
          </div>
          <h1>درخواست شما ثبت شد</h1>
          <p className="auth-sub">
            درخواست عضویت شما در خانواده «{m.joinPending?.familyName}» برای مدیر
            خانواده فرستاده شد.
          </p>

          <div className="prereg-banner">
            تا وقتی مدیر خانواده تأیید نکند، امکان ورود وجود ندارد.
          </div>

          <p className="auth-hint">
            بعد از تأیید، با همین شماره موبایل و رمزی که انتخاب کردید وارد شوید.
          </p>

          <button
            type="button"
            className="btn-primary btn-block"
            onClick={() => {
              window.location.replace("/");
            }}
          >
            رفتن به صفحه ورود
          </button>
        </div>
      </section>
    );
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
            m.submitInvite();
          }}
        >
          <Field label="نام شما">
            <TextInput
              value={m.invName}
              onChange={m.setInvName}
              placeholder="نام"
            />
          </Field>
          {/* نسبت با مدیر خانواده — بدون آن سرور «سایر» ثبت می‌کرد و
              نسبت همه‌ی اعضای دعوت‌شده اشتباه نمایش داده می‌شد */}
          <Field label="نسبت شما با مدیر خانواده">
            <Select
              value={m.invRelation}
              onChange={m.setInvRelation}
              options={[
                { value: "", label: "انتخاب کنید" },
                ...MEMBER_RELATIONS.filter((r) => r !== "خودم").map((r) => ({
                  value: r,
                  label: r,
                })),
              ]}
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
              placeholder="حداقل ۸ کاراکتر"
              dir="ltr"
              autoComplete="new-password"
            />
          </Field>
          <button
            type="submit"
            className="btn-primary btn-block"
            disabled={m.busy}
          >
            ارسال درخواست عضویت
          </button>
        </form>

        {m.step === "otp" ? (
          <form
            className="auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              /* §۲.۶ — بدون callback: این مسیر نشست نمی‌سازد و به صفحه انتظار می‌رود */
              m.verifyOtp();
            }}
          >
            <p className="otp-desc">
              کد ۶ رقمی ارسال‌شده به <b>{toFa(m.flow?.phone ?? "")}</b> را وارد
              کنید
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
          /* §۲.۶ — صداقتِ متن: ثبتِ فرم عضویت نمی‌دهد، فقط درخواست می‌سازد */
          <p className="auth-hint">
            {m.otpEnabled === false
              ? "درخواست شما برای مدیر خانواده فرستاده می‌شود و پس از تأیید او می‌توانید وارد شوید."
              : "ابتدا کد تأیید پیامکی برای شما ارسال می‌شود؛ سپس درخواست عضویت برای تأیید مدیر خانواده ثبت می‌گردد."}
          </p>
        )}
      </div>
    </section>
  );
}
