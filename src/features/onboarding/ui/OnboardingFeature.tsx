/* UI قیفِ آغازین — پیش از ورود (فارسی، RTL، برند «روشن و آرام»)

   مسیرِ کاربرِ تازه: «شروع» → معرفی → چند پرسشِ سبک → فرمِ ثبت‌نامِ
   از‌پیش‌پرشده. کاربرِ قدیمی روی دکمه‌ی «ورود» می‌زند و مستقیم به فرمِ
   ورود می‌رود.

   صادق نسبت به قابلیت‌های امروز؛ بدون تیزرِ ماژول‌های نساخته. */

import { useMemo, type CSSProperties } from "react";
import { Icon, Segmented } from "@/shared/ui";
import { toFa } from "@/shared/lib/digits";
import {
  useOnboardingModel,
  FOCUS_OPTIONS,
  SIZE_OPTIONS,
  type IntroDraft,
  type OnbCurrency,
} from "../model/useOnboardingModel";

/* ═══ پس‌زمینه‌ی گامِ خوش‌آمد — آیکون‌های خانه و پول که آرام شنا می‌کنند ═══

   جای آیکون‌ها هر بار تصادفی است و دورِ مرکزِ صفحه — یعنی پشتِ لوگو و
   نوشته‌ها. خواناییِ متن با کم‌رنگ بودنِ آیکون‌ها تأمین می‌شود، نه با
   خالی‌گذاشتنِ مرکز. */
const BG_ICONS = [
  "i-home",
  "i-wallet",
  "i-sms",
  "i-cart",
  "i-briefcase",
  "i-chart",
  "i-heart",
  "i-users",
  "i-piggy",
  "i-salary",
  "i-card",
  "i-receipt",
  "i-gift",
  "i-bill",
];

interface BgItem {
  id: number;
  icon: string;
  x: number;
  y: number;
  size: number;
  tilt: number;
  dx: number;
  dy: number;
  dur: number;
  delay: number;
  tone: "accent" | "ink";
}

const rnd = (min: number, max: number) => min + Math.random() * (max - min);

/* چیدمانِ تصادفیِ خوشه‌ای دورِ مرکز.
   مختصات قطبی است نه x/y مستقل: با زاویه‌ی تصادفی و شعاعِ تصادفی، آیکون‌ها
   دورِ مرکز حلقه می‌زنند و کشِ افقی/عمودی نمی‌گیرند. توانِ ۰٫۷ روی شعاع،
   تراکم را از مرکز به بیرون کمی پخش می‌کند تا وسط توده نشود.
   ضریبِ ۰٫۹ روی محورِ y چون صفحه بلندتر از عرض است. */
function makeBgItems(): BgItem[] {
  const shuffled = [...BG_ICONS].sort(() => Math.random() - 0.5);
  return shuffled.map((icon, i) => {
    const angle = rnd(0, Math.PI * 2);
    const radius = Math.pow(rnd(0, 1), 0.7) * 34;
    return {
      id: i,
      icon,
      x: 50 + Math.cos(angle) * radius,
      y: 46 + Math.sin(angle) * radius * 0.9,
      size: Math.round(rnd(26, 50)),
      tilt: Math.round(rnd(6, 18)) * (Math.random() < 0.5 ? -1 : 1),
      dx: Math.round(rnd(8, 22)) * (Math.random() < 0.5 ? -1 : 1),
      dy: Math.round(rnd(8, 22)) * (Math.random() < 0.5 ? -1 : 1),
      dur: Math.round(rnd(20, 30)),
      delay: -Math.round(rnd(0, 20)),
      tone: Math.random() < 0.45 ? "accent" : "ink",
    };
  });
}

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

  /* یک‌بار در هر بار باز شدنِ قیف قرعه می‌خورد — نه در هر رندر، وگرنه با
     هر بار تایپ‌کردن آیکون‌ها می‌پریدند */
  const bgItems = useMemo(makeBgItems, []);

  const primaryLabel = m.isFirst
    ? "شروع"
    : m.isLast
      ? "ساختِ حساب"
      : "ادامه";

  return (
    <>
      {/* فقط گامِ خوش‌آمد — گام‌های بعدی فرم دارند و باید آرام بمانند */}
      {m.isFirst ? (
        <div className="onb-bg" aria-hidden="true">
          {bgItems.map((b) => (
            <span
              key={b.id}
              className={`onb-bg-it onb-bg-${b.tone}`}
              style={
                {
                  "--x": `${b.x}%`,
                  "--y": `${b.y}%`,
                  "--sz": `${b.size}px`,
                  "--tilt": `${b.tilt}deg`,
                  "--dx": `${b.dx}px`,
                  "--dy": `${b.dy}px`,
                  "--dur": `${b.dur}s`,
                  "--delay": `${b.delay}s`,
                } as CSSProperties
              }
            >
              <span className="onb-bg-spin">
                <Icon name={b.icon} size={b.size} />
              </span>
            </span>
          ))}
        </div>
      ) : null}

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

        {/* کاربرِ قدیمی — جعبه‌ی توخالی، آرام‌تر از دکمه‌ی اصلی */}
        <button type="button" className="onb-login" onClick={m.goLogin}>
          ورود
        </button>
      </div>
    </>
  );
}
