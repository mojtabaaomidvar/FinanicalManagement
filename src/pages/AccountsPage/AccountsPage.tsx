/* صفحه حساب‌ها — دارایی کل + نمودار روند + لیست حساب‌ها/کیف‌پول‌ها
   لیست و فرم از features/accounts می‌آید؛ همان کامپوننت در تنظیمات هم
   رندر می‌شود، پس نمایش دو محل هرگز از هم جدا نمی‌افتد. */

import { useMemo, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { Field, JalaliDateInput, Modal, FitText } from "@/shared/ui";
import { AccountsFeature, useAccountsModel } from "@/features/accounts";
import {
  wealthSeries,
  wealthSeriesBetween,
} from "@/domain/report/report.rules";
import type { WealthRange } from "@/domain/report/report.types";
import {
  addDays,
  cmp,
  formatISO,
  isoToJalali,
  parse,
  today,
} from "@/shared/lib/jalali";
import { formatAmount } from "@/shared/lib/format";
import { toDisplay } from "@/shared/lib/currency";

/* بازه‌های آماده نمودار دارایی — کنار دکمه سه‌نقطه (بازه دلخواه) */
const RANGE_OPTIONS: { value: WealthRange; label: string }[] = [
  { value: "7d", label: "۷ روز" },
  { value: "1m", label: "۱ ماه" },
  { value: "1y", label: "۱ سال" },
];

export function AccountsPage() {
  const { accounts, txs } = useApp();
  const { show } = useToast();
  const m = useAccountsModel();

  const [range, setRange] = useState<WealthRange | "custom">("1m");
  /* بازه دلخواه — رشته‌های جلالی نمایشی */
  const [customFrom, setCustomFrom] = useState(() =>
    formatISO(addDays(today(), -29)),
  );
  const [customTo, setCustomTo] = useState(() => formatISO(today()));
  const [customOpen, setCustomOpen] = useState(false);

  /* مبنای نمودار دارایی = جمع موجودی اولیه همه حساب‌ها */
  const initialTotal = useMemo(
    () => accounts.reduce((s, a) => s + (a.initialBalance ?? 0), 0),
    [accounts],
  );

  const wealth = useMemo(() => {
    if (range === "custom") {
      const from = parse(customFrom);
      const to = parse(customTo);
      if (from && to && cmp(from, to) <= 0) {
        return wealthSeriesBetween(txs, from, to, initialTotal);
      }
      return [];
    }
    return wealthSeries(txs, range, today(), initialTotal);
  }, [txs, range, customFrom, customTo, initialTotal]);

  /** اعمال بازه دلخواه از مودال سه‌نقطه */
  function applyCustomRange() {
    const from = parse(customFrom);
    const to = parse(customTo);
    if (!from || !to) return show("هر دو تاریخ را انتخاب کنید");
    if (cmp(from, to) > 0)
      return show("تاریخ شروع باید قبل از تاریخ پایان باشد");
    setRange("custom");
    setCustomOpen(false);
  }

  return (
    <section className="page active">
      <header className="app-header">
        <div className="header-title">
          <h1>کیف پول‌ها</h1>
          <p>حساب‌های بانکی و کیف‌پول‌های خانواده</p>
        </div>
      </header>

      <div className="content">
        {/* کارت دارایی کل — فشرده: مبلغ در همان ردیف عنوان، بازه زیر نمودار */}
        <div className="balance-card wealth-card">
          <div className="wealth-top">
            <p className="balance-label">دارایی کل خانواده</p>
            <b
              className={`wealth-total ${m.totalWealth < 0 ? "neg" : ""}`}
              dir="ltr"
            >
              <FitText>
                {formatAmount(toDisplay(m.totalWealth, m.cur))}
                <span>{m.cur}</span>
              </FitText>
            </b>
          </div>

          <div className="wealth-chart">
            <svg
              viewBox="0 0 340 100"
              className="wealth-svg"
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="wealth-area" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    style={{ stopColor: "var(--accent)", stopOpacity: 0.2 }}
                  />
                  <stop
                    offset="100%"
                    style={{ stopColor: "var(--accent)", stopOpacity: 0 }}
                  />
                </linearGradient>
              </defs>
              <WealthPath points={wealth.map((p) => p.value)} />
            </svg>
            {wealth.length >= 2 ? (
              <div className="wealth-dates" dir="ltr">
                <span>{formatISO(isoToJalali(wealth[0].date))}</span>
                <span>
                  {formatISO(isoToJalali(wealth[wealth.length - 1].date))}
                </span>
              </div>
            ) : null}
          </div>

          {/* بازه زمانی + سه‌نقطه بازه دلخواه — در یک ردیف زیر نمودار */}
          <div className="range-row">
            <div className="range-chips">
              {RANGE_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={`range-chip ${range === o.value ? "active" : ""}`}
                  onClick={() => setRange(o.value)}
                >
                  {o.label}
                </button>
              ))}
              {range === "custom" ? (
                <button
                  type="button"
                  className="range-chip active"
                  onClick={() => setCustomOpen(true)}
                >
                  دلخواه
                </button>
              ) : null}
            </div>
            <button
              type="button"
              className={`range-more ${range === "custom" ? "active" : ""}`}
              aria-label="انتخاب بازه دلخواه"
              title="انتخاب بازه دلخواه"
              onClick={() => setCustomOpen(true)}
            >
              <svg>
                <use href="#i-more" />
              </svg>
            </button>
          </div>
        </div>

        {/* لیست حساب‌ها و کیف‌پول‌ها + فرم افزودن/ویرایش — کامپوننت مشترک */}
        <AccountsFeature m={m} />
      </div>

      {/* بازه دلخواه نمودار دارایی — از طریق سه‌نقطه */}
      <Modal
        open={customOpen}
        onClose={() => setCustomOpen(false)}
        title="بازه دلخواه"
      >
        <div className="form-grid" style={{ marginTop: 8 }}>
          <div className="form-row">
            <Field label="از تاریخ">
              <JalaliDateInput
                value={customFrom}
                onChange={setCustomFrom}
                placeholder="شروع بازه"
              />
            </Field>
          </div>
          <div className="form-row">
            <Field label="تا تاریخ">
              <JalaliDateInput
                value={customTo}
                onChange={setCustomTo}
                placeholder="پایان بازه"
              />
            </Field>
          </div>
          <p className="modal-sub full" style={{ gridColumn: "1 / -1" }}>
            نمودار دارایی از اولین تا آخرین روزِ این بازه رسم می‌شود.
          </p>
        </div>
        <div className="modal-actions">
          <button
            className="btn-secondary"
            onClick={() => setCustomOpen(false)}
          >
            انصراف
          </button>
          <button className="btn-primary" onClick={applyCustomRange}>
            اعمال
          </button>
        </div>
      </Modal>
    </section>
  );
}

/* مسیر SVG دارایی — خط + ناحیه گرادیانی + نقطه پایان */
function WealthPath({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const w = 340;
  const h = 100;
  const pad = 6;
  const min = Math.min(...points, 0);
  const max = Math.max(...points, 1);
  const span = max - min || 1;
  const x = (i: number) => (i / (points.length - 1)) * w;
  const y = (v: number) => pad + (1 - (v - min) / span) * (h - pad * 2);
  const d = points
    .map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`)
    .join(" ");
  const area = `${d} L${w},${h} L0,${h} Z`;
  const last = points[points.length - 1];
  const zeroY = y(0);
  return (
    <>
      <path d={area} fill="url(#wealth-area)" />
      {min < 0 ? (
        <line
          x1="0"
          y1={zeroY}
          x2={w}
          y2={zeroY}
          stroke="var(--border)"
          strokeDasharray="3 4"
        />
      ) : null}
      <path
        d={d}
        fill="none"
        stroke={last >= 0 ? "var(--income)" : "var(--expense)"}
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        cx={x(points.length - 1)}
        cy={y(last)}
        r="4"
        fill="var(--card)"
        stroke={last >= 0 ? "var(--income)" : "var(--expense)"}
        strokeWidth="2"
      />
    </>
  );
}
