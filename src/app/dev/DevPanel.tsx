/* پنلِ توسعه‌دهنده — فقط در حالتِ dev.

   چرا وجود دارد: با بازنشسته‌شدنِ تب‌بار و منتقل‌شدنِ آنبوردینگ به پیش از
   ورود، بعضی صفحه‌ها به‌سختی در دسترس‌اند — مثلاً برای دیدنِ دوباره‌ی قیفِ
   آغازین باید فلگِ localStorage را پاک کنی و برای دیدنِ فرمِ ثبت‌نام باید
   خارج شوی. این پنل همه را یک‌کلیکه می‌کند.

   در بیلدِ production کاملاً حذف می‌شود: تنها جایی که صدا زده می‌شود پشتِ
   شرطِ import.meta.env.DEV است و ویت آن را به false تبدیل می‌کند، پس
   rollup کلِ این ماژول را کنار می‌گذارد. */

import { useEffect, useState } from "react";
import type { Route } from "../router";

/* حالت‌هایی که خارج از جریانِ عادی نمایش داده می‌شوند */
export type DevOverride =
  | null
  | "intro"
  | "auth-login"
  | "auth-register"
  | "invite";

const ROUTE_LABELS: { route: Route; label: string }[] = [
  { route: "hub", label: "هاب (خانه)" },
  { route: "dashboard", label: "داشبوردِ مالی" },
  { route: "transactions", label: "تراکنش‌ها" },
  { route: "reports", label: "نمای کلی" },
  { route: "accounts", label: "کیف پول" },
  { route: "budgets", label: "بودجه‌ها" },
  { route: "market", label: "ارز و بورس" },
  { route: "settings", label: "تنظیمات" },
];

const OVERRIDE_LABELS: { value: Exclude<DevOverride, null>; label: string }[] = [
  { value: "intro", label: "قیفِ آغازین (آنبوردینگ)" },
  { value: "auth-login", label: "فرمِ ورود" },
  { value: "auth-register", label: "فرمِ ثبت‌نام" },
  { value: "invite", label: "پذیرشِ دعوت" },
];

export function DevPanel({
  route,
  onNav,
  override,
  onOverride,
}: {
  route: Route;
  onNav: (r: Route) => void;
  override: DevOverride;
  onOverride: (o: DevOverride) => void;
}) {
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState(() => `${window.innerWidth}×${window.innerHeight}`);

  /* اندازه‌ی ویوپورت — برای وارسیِ سریعِ چیدمانِ موبایل */
  useEffect(() => {
    const onResize = () => setSize(`${window.innerWidth}×${window.innerHeight}`);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /* میان‌بر: Ctrl+Shift+D */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "D" || e.key === "d")) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* پاک‌کردنِ فقطِ کلیدهای قیف — عمداً localStorage.clear() نیست تا از
     اپ بیرون نیفتی و نشستت حفظ شود */
  function resetIntro() {
    try {
      localStorage.removeItem("khaneyar.intro.seen");
      localStorage.removeItem("khaneyar.intro.draft");
    } catch {
      /* بی‌خطر */
    }
    location.reload();
  }

  if (!open) {
    return (
      <button
        type="button"
        className="dev-fab"
        onClick={() => setOpen(true)}
        title="پنل توسعه (Ctrl+Shift+D)"
      >
        DEV
      </button>
    );
  }

  return (
    <div className="dev-panel">
      <div className="dev-head">
        <b>پنلِ توسعه</b>
        <span className="dev-size">{size}</span>
        <button type="button" className="dev-x" onClick={() => setOpen(false)}>
          ✕
        </button>
      </div>

      <div className="dev-group">
        <span className="dev-label">صفحه‌ها</span>
        <div className="dev-chips">
          {ROUTE_LABELS.map((r) => (
            <button
              key={r.route}
              type="button"
              className={`dev-chip${
                !override && route === r.route ? " active" : ""
              }`}
              onClick={() => {
                onOverride(null);
                onNav(r.route);
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="dev-group">
        <span className="dev-label">حالت‌های خارج از جریان</span>
        <div className="dev-chips">
          {OVERRIDE_LABELS.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`dev-chip${override === o.value ? " active" : ""}`}
              onClick={() => onOverride(override === o.value ? null : o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
        {override ? (
          <button
            type="button"
            className="dev-btn"
            onClick={() => onOverride(null)}
          >
            بازگشت به جریانِ عادی
          </button>
        ) : null}
      </div>

      <div className="dev-group">
        <span className="dev-label">ابزار</span>
        <button type="button" className="dev-btn" onClick={resetIntro}>
          پاک‌کردنِ فلگِ آنبوردینگ و بارگذاری دوباره
        </button>
      </div>
    </div>
  );
}
