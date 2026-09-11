/* UI قیفِ آغازین — پیش از ورود (فارسی، RTL، برند «روشن و آرام»)

   مسیرِ کاربرِ تازه: «شروع کنیم» → معرفی → چند پرسشِ سبک → فرمِ ثبت‌نامِ
   از‌پیش‌پرشده. کاربرِ قدیمی روی «قبلاً حساب دارم؟ ورود» می‌زند و مستقیم
   به فرمِ ورود می‌رود.

   صادق نسبت به قابلیت‌های امروز؛ بدون تیزرِ ماژول‌های نساخته. */

import { Icon, Segmented } from "@/shared/ui";
import { toFa } from "@/shared/lib/digits";
import {
  useOnboardingModel,
  FOCUS_OPTIONS,
  SIZE_OPTIONS,
  type IntroDraft,
  type OnbCurrency,
} from "../model/useOnboardingModel";

/* چهار قابلیتِ آماده‌ی امروز — همان چیزی که واقعاً کار می‌کند */
const VALUE_POINTS: { icon: string; title: string; desc: string }[] = [
  {
    icon: "i-users",
    title: "خرج و درآمدِ همه، یکجا",
    desc: "هر عضو تراکنش‌هایش را ثبت می‌کند و همه در یک نگاه دیده می‌شود.",
  },
  {
    icon: "i-sms",
    title: "ثبتِ خودکار از پیامکِ بانک",
    desc: "پیامکِ تراکنش را می‌خوانَد و خودش هزینه را برایت ثبت می‌کند.",
  },
  {
    icon: "i-piggy",
    title: "بودجه‌ی ماهانه",
    desc: "برای هر دسته سقف بگذار و جلوی خرجِ اضافه را بگیر.",
  },
  {
    icon: "i-chart",
    title: "گزارش و تقویمِ شمسی",
    desc: "نمودارها و گزارشِ ماهانه، بر پایه‌ی تاریخِ شمسی.",
  },
];

export function OnboardingFeature({
  onLogin,
  onRegister,
}: {
  onLogin: () => void;
  onRegister: (draft: IntroDraft) => void;
}) {
  const m = useOnboardingModel({ onLogin, onRegister });

  const primaryLabel = m.isFirst
    ? "شروع کنیم"
    : m.isLast
      ? "ساختِ حساب"
      : "ادامه";

  return (
    <div className="onb-page">
      <div className="onb-top">
        <div className="onb-dots" aria-hidden="true">
          {m.steps.map((s, i) => (
            <span
              key={s}
              className={`onb-dot${i === m.index ? " active" : ""}${
                i < m.index ? " done" : ""
              }`}
            />
          ))}
        </div>
        {m.index >= 1 ? (
          <button type="button" className="onb-skip" onClick={m.skip}>
            رد کردن
          </button>
        ) : null}
      </div>

      <div key={m.step} className="onb-screen">
        {m.step === "welcome" ? (
          <div className="onb-hero">
            <span className="onb-logo" aria-hidden="true">
              <Icon name="i-home" size={40} />
            </span>
            <h1 className="onb-title onb-title-hero">به خانه‌یار خوش آمدی</h1>
            <p className="onb-sub onb-sub-hero">
              مدیریتِ پولِ خانواده، با آرامش و با هم؛ همه‌ی خرج‌ها، درآمدها و
              بودجه‌ها یکجا.
            </p>
          </div>
        ) : null}

        {m.step === "value" ? (
          <>
            <div className="onb-head">
              <h2 className="onb-title">خانه‌یار چه کار می‌کند؟</h2>
              <p className="onb-sub">همین حالا این‌ها آماده‌اند:</p>
            </div>
            <ul className="onb-list">
              {VALUE_POINTS.map((p) => (
                <li key={p.icon} className="onb-item">
                  <span className="onb-item-ic" aria-hidden="true">
                    <Icon name={p.icon} size={22} />
                  </span>
                  <span className="onb-item-txt">
                    <b>{p.title}</b>
                    <span>{p.desc}</span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {m.step === "questions" ? (
          <>
            <div className="onb-head">
              <h2 className="onb-title">خانه‌ی شما را بسازیم</h2>
              <p className="onb-sub">
                چند پرسشِ کوتاه تا اپ را مطابقِ خانه‌ی شما تنظیم کنیم.
              </p>
            </div>

            <div className="onb-field">
              <label className="onb-label" htmlFor="onb-family">
                نامِ خانواده
              </label>
              <input
                id="onb-family"
                className="input"
                type="text"
                value={m.familyName}
                onChange={(e) => m.setFamilyName(e.target.value)}
                placeholder="مثلاً خانواده‌ی محمدی"
                autoComplete="off"
              />
              <p className="onb-hint">
                همین نام بالای صفحه‌ی خانه دیده می‌شود.
              </p>
            </div>

            <div className="onb-field">
              <span className="onb-label">چند نفر در خانه هستید؟</span>
              <div className="onb-chips">
                {SIZE_OPTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`onb-chip${m.householdSize === s ? " active" : ""}`}
                    onClick={() => m.setHouseholdSize(s)}
                  >
                    {s === "5+" ? `${toFa("5")}+` : toFa(s)}
                  </button>
                ))}
              </div>
            </div>

            <div className="onb-field">
              <span className="onb-label">بیشتر روی چه چیزی تمرکز داری؟</span>
              <div className="onb-chips onb-chips-wrap">
                {FOCUS_OPTIONS.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    className={`onb-chip${m.focus.includes(o.id) ? " active" : ""}`}
                    onClick={() => m.toggleFocus(o.id)}
                  >
                    <Icon name={o.icon} size={18} />
                    {o.label}
                  </button>
                ))}
              </div>
              <p className="onb-hint">می‌توانی چندتا را با هم انتخاب کنی.</p>
            </div>

            <div className="onb-field">
              <span className="onb-label">واحدِ پول</span>
              <Segmented<OnbCurrency>
                value={m.currency}
                onChange={m.setCurrency}
                options={[
                  { value: "تومان", label: "تومان" },
                  { value: "ریال", label: "ریال" },
                ]}
              />
            </div>
          </>
        ) : null}
      </div>

      <div className="onb-actions">
        {!m.isFirst ? (
          <button
            type="button"
            className="onb-btn onb-btn-ghost"
            onClick={m.back}
          >
            برگشت
          </button>
        ) : null}
        <button
          type="button"
          className="onb-btn onb-btn-primary"
          onClick={m.next}
          disabled={!m.canContinue}
        >
          {primaryLabel}
        </button>
      </div>

      {/* کاربرِ قدیمی — همیشه در دسترس، در همه‌ی گام‌ها */}
      <button type="button" className="onb-login" onClick={m.goLogin}>
        قبلاً حساب دارم؟ <b>ورود</b>
      </button>
    </div>
  );
}
