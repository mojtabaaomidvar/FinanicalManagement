/* صفحه‌ی هابِ خانه — خانه‌ی جدیدِ اپ.

   ساختار: هدرِ خانواده → بنرِ زمینه‌ایِ چرخشی → دکمه‌ی ثبتِ سریع →
   شبکه‌ی دوستونه‌ی ماژول‌ها (فعال + به‌زودی).

   «مالی» دیگر کلِ اپ نیست؛ یکی از کاشی‌هاست. زیرنویسِ کاشی‌های فعال
   از داده‌ی واقعیِ همین لحظه ساخته می‌شود (نه متنِ تزئینی). */

import { useMemo, useRef, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { Icon } from "@/shared/ui";
import { toFa } from "@/shared/lib/digits";
import { formatAmount } from "@/shared/lib/format";
import { toDisplay } from "@/shared/lib/currency";
import { txsInJalaliMonth } from "@/domain/transaction/transaction.rules";
import { monthTotals, totalBalance } from "@/domain/report/report.rules";
import { monthCategorySpend, budgetStatus } from "@/domain/budget/budget.rules";
import { buildCategoryResolver } from "@/domain/category/resolve";
import { today } from "@/shared/lib/jalali";
import type { Route } from "@/app/router";
import { ACTIVE_MODULES, SOON_MODULES, type HubModule } from "./modules";

type Banner = {
  id: string;
  title: string;
  desc: string;
  icon: string;
  tone: string;
  cta: string;
  route: Route;
};

export function HubPage({
  onNav,
  onAddTransaction,
}: {
  onNav: (r: Route) => void;
  onAddTransaction: () => void;
}) {
  const { member, family, members, txs, accounts, budgets, customCategories, cur } =
    useApp();

  /* ارقامِ زنده‌ی همین ماه — یک‌بار حساب می‌شوند و بینِ زیرنویس‌ها و بنرها مشترک‌اند */
  const stats = useMemo(() => {
    const [jy, jm] = today();
    const monthTxs = txsInJalaliMonth(txs, jy, jm);
    const totals = monthTotals(monthTxs);
    const spend = monthCategorySpend(txs, jy, jm);
    const resolve = buildCategoryResolver(customCategories);

    let overBudget: string | null = null;
    let warnBudget: string | null = null;
    for (const b of budgets) {
      const st = budgetStatus(b.amount, spend.get(b.category) ?? 0);
      if (st.level === "over" && !overBudget) overBudget = resolve(b.category).name;
      else if (st.level === "warn" && !warnBudget) warnBudget = resolve(b.category).name;
    }

    return {
      monthCount: monthTxs.length,
      monthExpense: totals.expense,
      balance: totalBalance(txs),
      overBudget,
      warnBudget,
    };
  }, [txs, budgets, customCategories]);

  const money = (n: number) => `${formatAmount(toDisplay(n, cur))} ${cur}`;

  /* زیرنویسِ زنده‌ی هر کاشیِ فعال */
  const liveSub: Record<string, string> = {
    finance: `خرجِ این ماه ${money(stats.monthExpense)}`,
    transactions: stats.monthCount
      ? `${toFa(stats.monthCount)} تراکنش در این ماه`
      : "هنوز تراکنشی ثبت نشده",
    accounts: accounts.length
      ? `${toFa(accounts.length)} حساب · ${money(stats.balance)}`
      : "حساب یا کارت اضافه کن",
    budgets: budgets.length
      ? `${toFa(budgets.length)} بودجه‌ی فعال`
      : "هنوز بودجه‌ای نداری",
    reports: "نمودار و گزارشِ ماهانه",
  };

  /* بنرها — فقط وقتی واقعاً موضوعی هست؛ هیچ‌کدام تزئینی نیست */
  const banners = useMemo<Banner[]>(() => {
    const list: Banner[] = [];
    if (members.length < 2) {
      list.push({
        id: "invite",
        title: "خانواده‌ات را دعوت کن",
        desc: "با هم ثبت کنید تا تصویرِ کاملِ خرجِ خانه را ببینید.",
        icon: "i-users",
        tone: "indigo",
        cta: "دعوت از اعضا",
        route: "settings",
      });
    }
    if (!accounts.length) {
      list.push({
        id: "account",
        title: "اولین حساب را بساز",
        desc: "کارت یا کیف پولت را اضافه کن تا موجودی درست حساب شود.",
        icon: "i-wallet",
        tone: "emerald",
        cta: "افزودن حساب",
        route: "accounts",
      });
    }
    if (stats.overBudget) {
      list.push({
        id: "over",
        title: `بودجه‌ی ${stats.overBudget} تمام شد`,
        desc: "مصرفِ این ماه از سقفی که گذاشته‌ای بیشتر شده است.",
        icon: "i-alert",
        tone: "rose",
        cta: "دیدنِ بودجه‌ها",
        route: "budgets",
      });
    } else if (stats.warnBudget) {
      list.push({
        id: "warn",
        title: `بودجه‌ی ${stats.warnBudget} نزدیکِ سقف`,
        desc: "بیش از ۸۰٪ بودجه‌ی این ماه مصرف شده است.",
        icon: "i-piggy",
        tone: "amber",
        cta: "دیدنِ بودجه‌ها",
        route: "budgets",
      });
    }
    if (!budgets.length) {
      list.push({
        id: "budget",
        title: "برای خرجِ ماه سقف بگذار",
        desc: "بودجه‌ی دسته‌ها را تعیین کن تا جلوی خرجِ اضافه گرفته شود.",
        icon: "i-piggy",
        tone: "amber",
        cta: "ساختنِ بودجه",
        route: "budgets",
      });
    }
    return list.slice(0, 3);
  }, [members.length, accounts.length, budgets.length, stats]);

  /* نقطه‌های کاروسل — در RTL مقدارِ scrollLeft منفی می‌شود، پس قدرِمطلق */
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [slide, setSlide] = useState(0);
  function onStripScroll() {
    const el = stripRef.current;
    if (!el || !el.clientWidth) return;
    const i = Math.round(Math.abs(el.scrollLeft) / el.clientWidth);
    setSlide(Math.max(0, Math.min(i, banners.length - 1)));
  }

  const initial = (member?.name ?? "؟").trim().charAt(0);

  return (
    <section className="page active hub-page">
      <header className="hub-head">
        <div className="hub-id">
          <h1>{family?.name ?? "خانه‌ی من"}</h1>
          <p>
            {members.length ? `${toFa(members.length)} عضو` : "خانه‌ی شما"}
            {member ? ` · ${member.name}` : ""}
          </p>
        </div>
        <button
          type="button"
          className="hub-avatar"
          aria-label="تنظیمات"
          onClick={() => onNav("settings")}
        >
          {initial}
        </button>
      </header>

      {banners.length ? (
        <div className="hub-banners">
          <div className="hub-strip" ref={stripRef} onScroll={onStripScroll}>
            {banners.map((b) => (
              <article key={b.id} className={`hub-banner tone-${b.tone}`}>
                <span className="hub-banner-ic" aria-hidden="true">
                  <Icon name={b.icon} size={24} />
                </span>
                <div className="hub-banner-txt">
                  <b>{b.title}</b>
                  <span>{b.desc}</span>
                </div>
                <button
                  type="button"
                  className="hub-banner-cta"
                  onClick={() => onNav(b.route)}
                >
                  {b.cta}
                  <Icon name="i-arrow-l" size={16} />
                </button>
              </article>
            ))}
          </div>
          {banners.length > 1 ? (
            <div className="hub-dots" aria-hidden="true">
              {banners.map((b, i) => (
                <span
                  key={b.id}
                  className={`hub-dot${i === slide ? " active" : ""}`}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <button type="button" className="hub-add" onClick={onAddTransaction}>
        <span className="hub-add-ic" aria-hidden="true">
          <Icon name="i-plus" size={20} />
        </span>
        <span className="hub-add-txt">
          <b>ثبت خرج یا درآمد</b>
          <span>سریع‌ترین راه برای ثبتِ یک تراکنش</span>
        </span>
      </button>

      <h2 className="hub-section">ماژول‌های خانه</h2>
      <div className="hub-grid">
        {ACTIVE_MODULES.map((m) => (
          <Tile key={m.id} m={m} sub={m.sub ?? liveSub[m.id]} onNav={onNav} />
        ))}
      </div>

      <h2 className="hub-section">
        به‌زودی
        <span className="hub-section-note">در حالِ ساخت</span>
      </h2>
      <div className="hub-grid">
        {SOON_MODULES.map((m) => (
          <Tile key={m.id} m={m} soon />
        ))}
      </div>
    </section>
  );
}

function Tile({
  m,
  sub,
  soon,
  onNav,
}: {
  m: HubModule;
  sub?: string;
  soon?: boolean;
  onNav?: (r: Route) => void;
}) {
  if (soon || !m.route) {
    return (
      <div className="hub-tile is-soon" aria-disabled="true">
        <div className="hub-tile-top">
          <b className="hub-tile-title">{m.title}</b>
          <span className="hub-tile-ic" aria-hidden="true">
            <Icon name={m.icon} size={22} />
          </span>
        </div>
        <span className="hub-soon-badge">به‌زودی</span>
      </div>
    );
  }

  const route = m.route;
  return (
    <button
      type="button"
      className={`hub-tile tone-${m.tone}`}
      onClick={() => onNav?.(route)}
    >
      <div className="hub-tile-top">
        <b className="hub-tile-title">{m.title}</b>
        <span className="hub-tile-ic" aria-hidden="true">
          <Icon name={m.icon} size={22} />
        </span>
      </div>
      {sub ? <span className="hub-tile-sub">{sub}</span> : null}
    </button>
  );
}
