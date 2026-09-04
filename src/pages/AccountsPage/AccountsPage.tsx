/* صفحه حساب‌ها — ثروت کل + نمودار روند + لیست حساب‌ها/کیف‌پول‌ها */

import { useMemo, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import {
  Card,
  Field,
  JalaliDateInput,
  Modal,
  Segmented,
  Select,
  TextInput,
  AmountInput,
} from "@/shared/ui";
import {
  BANK_NAMES,
  bankOfCard,
  cardMatchesBank,
} from "@/shared/lib/banks";
import {
  maskCardNumber,
  formatCardFa,
  digitsOf,
} from "@/domain/account/account.rules";
import type { Account, AccountKind } from "@/domain/account/account.types";
import {
  accountBalances,
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
import { formatAmount, parseAmountInput } from "@/shared/lib/format";
import { toDisplay, fromDisplay } from "@/shared/lib/currency";

const WALLET_PRESETS = ["کیف پول نقدی", "پس‌انداز", "هزینه سفر", "پروژه خاص"];

/* بازه‌های آماده نمودار ثروت — کنار دکمه سه‌نقطه (بازه دلخواه) */
const RANGE_OPTIONS: { value: WealthRange; label: string }[] = [
  { value: "7d", label: "۷ روز" },
  { value: "1m", label: "۱ ماه" },
  { value: "1y", label: "۱ سال" },
  { value: "max", label: "حداکثر" },
];

function AccountLine({
  label,
  hiddenText,
  shownText,
  revealed,
  onToggle,
  onCopy,
}: {
  label: string;
  hiddenText: string;
  shownText: string;
  revealed: boolean;
  onToggle: () => void;
  onCopy: () => void;
}) {
  return (
    <div className="account-row">
      <span className="account-row-label">{label}</span>
      <div className="account-row-value">
        <b dir="ltr" className={revealed ? "" : "masked"}>
          {revealed ? shownText : hiddenText}
        </b>
      </div>
      <div className="account-row-actions">
        <button
          className="icon-btn small"
          aria-label={revealed ? "پنهان‌کردن" : "نمایش"}
          onClick={onToggle}
        >
          <svg>
            <use href={revealed ? "#i-eye-off" : "#i-eye"} />
          </svg>
        </button>
        <button className="icon-btn small" aria-label="کپی" onClick={onCopy}>
          <svg>
            <use href="#i-copy" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export function AccountsPage() {
  const { useCases, accounts, members, member, txs, family, refreshData } =
    useApp();
  const { show } = useToast();
  const cur = family?.currency ?? "تومان";

  const [range, setRange] = useState<WealthRange | "custom">("1m");
  /* بازه دلخواه — رشته‌های جلالی نمایشی */
  const [customFrom, setCustomFrom] = useState(() =>
    formatISO(addDays(today(), -29)),
  );
  const [customTo, setCustomTo] = useState(() => formatISO(today()));
  const [customOpen, setCustomOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<AccountKind>("bank");
  const [title, setTitle] = useState("");
  const [bank, setBank] = useState("");
  const [cardNo, setCardNo] = useState("");
  /* موجودی اولیه کیف‌پول — رشته نمایشی فارسی */
  const [initialBal, setInitialBal] = useState("");
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  /* ثروت کل + سری زمانی + موجودی هر حساب */
  const balances = useMemo(
    () => accountBalances(txs, accounts),
    [txs, accounts],
  );
  const totalWealth = useMemo(
    () => balances.reduce((s, b) => s + b.balance, 0),
    [balances],
  );
  /* مبنای نمودار ثروت = جمع موجودی اولیه همه حساب‌ها */
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

  const banks = balances.filter((b) => b.account.kind !== "wallet");
  const wallets = balances.filter((b) => b.account.kind === "wallet");

  /* خطای هم‌خوانی کارت با بانک — زنده هنگام تایپ */
  const binError = useMemo(() => {
    const digits = digitsOf(cardNo);
    if (digits.length < 6 || !bank || bank === "سایر" || kind === "wallet")
      return "";
    if (!cardMatchesBank(digits, bank)) {
      return `این شماره کارت متعلق به «${bankOfCard(digits) ?? "بانک دیگری"}» است، نه «${bank}»`;
    }
    return "";
  }, [cardNo, bank, kind]);

  function openNew(k: AccountKind) {
    setKind(k);
    setTitle("");
    setBank("");
    setCardNo("");
    setInitialBal("");
    setOpen(true);
  }

  async function save() {
    if (binError) {
      show(binError);
      return;
    }
    setBusy(true);
    try {
      await useCases!.addAccount.execute({
        memberId: member?.id || "",
        title: title.trim(),
        kind,
        bank: kind === "bank" ? bank || null : null,
        cardNumber: kind === "bank" ? cardNo.trim() || null : null,
        initialBalance: fromDisplay(parseAmountInput(initialBal), cur),
      });
      setOpen(false);
      show(kind === "wallet" ? "کیف‌پول اضافه شد" : "حساب بانکی اضافه شد");
      await refreshData();
    } catch (e) {
      show((e as Error).message || "خطا در ذخیره");
    } finally {
      setBusy(false);
    }
  }

  async function remove(acc: Account) {
    if (!confirm(`«${acc.title}» حذف شود؟`)) return;
    try {
      await useCases!.deleteAccount.execute(acc.id);
      show("حذف شد");
      await refreshData();
    } catch (e) {
      show((e as Error).message || "خطا در حذف");
    }
  }

  function toggleReveal(id: string) {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      show(label + " کپی شد");
    } catch {
      show("کپی ناموفق بود");
    }
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
        {/* کارت ثروت کل — فشرده: مبلغ در همان ردیف عنوان، بازه زیر نمودار */}
        <div className="balance-card wealth-card">
          <div className="wealth-top">
            <p className="balance-label">ثروت کل خانواده</p>
            <b
              className={`wealth-total ${totalWealth < 0 ? "neg" : ""}`}
              dir="ltr"
            >
              {formatAmount(toDisplay(totalWealth, cur))}
              <span>{cur}</span>
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

        {/* حساب‌های بانکی */}
        <Card
          title="حساب‌های بانکی"
          action={
            <button className="link-btn" onClick={() => openNew("bank")}>
              افزودن
            </button>
          }
        >
          {banks.length ? (
            banks.map(({ account: acc, balance }) => {
              const owner = members.find((m) => m.id === acc.memberId);
              const isRevealed = revealed.has(acc.id);
              return (
                <div className="account-card flat" key={acc.id}>
                  <div className="account-head">
                    <div className="account-icon">
                      <svg>
                        <use href="#i-card" />
                      </svg>
                    </div>
                    <div className="account-title">
                      <h4>{acc.title}</h4>
                      <p>
                        {acc.bank || "بانک نامشخص"}
                        {owner ? ` · ${owner.name}` : ""}
                      </p>
                    </div>
                    <div className="account-balance">
                      <b>{formatAmount(toDisplay(balance, cur))}</b>
                      <span>{cur}</span>
                    </div>
                  </div>

                  {acc.cardNumber ? (
                    <AccountLine
                      label="شماره کارت"
                      hiddenText={maskCardNumber(acc.cardNumber)}
                      shownText={formatCardFa(acc.cardNumber)}
                      revealed={isRevealed}
                      onToggle={() => toggleReveal(acc.id)}
                      onCopy={() => copy(acc.cardNumber!, "شماره کارت")}
                    />
                  ) : null}

                  {member?.role === "owner" || acc.memberId === member?.id ? (
                    <button
                      className="icon-btn small danger account-del"
                      aria-label="حذف"
                      onClick={() => remove(acc)}
                    >
                      <svg>
                        <use href="#i-trash" />
                      </svg>
                    </button>
                  ) : null}
                </div>
              );
            })
          ) : (
            <p className="accounts-empty">هنوز حساب بانکی ثبت نشده</p>
          )}
        </Card>

        {/* کیف‌پول‌ها */}
        <Card
          title="کیف‌پول‌ها"
          action={
            <button className="link-btn" onClick={() => openNew("wallet")}>
              افزودن
            </button>
          }
        >
          {wallets.length ? (
            <div className="wallet-grid">
              {wallets.map(({ account: acc, balance }) => {
                const owner = members.find((m) => m.id === acc.memberId);
                return (
                  <div className="wallet-card" key={acc.id}>
                    <div className="wallet-head">
                      <span className="wallet-icon">
                        <svg>
                          <use href="#i-wallet" />
                        </svg>
                      </span>
                      <div>
                        <b>{acc.title}</b>
                        <p>{owner?.name ?? "—"}</p>
                      </div>
                    </div>
                    <div className="wallet-balance">
                      <b>{formatAmount(toDisplay(balance, cur))}</b>
                      <span>{cur}</span>
                    </div>
                    {member?.role === "owner" || acc.memberId === member?.id ? (
                      <button
                        className="icon-btn small danger"
                        aria-label="حذف"
                        onClick={() => remove(acc)}
                      >
                        <svg>
                          <use href="#i-trash" />
                        </svg>
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="wallet-empty">
              <p>
                برای پول نقد، پس‌انداز یا هزینه‌ی سفر و پروژه یک کیف‌پول بسازید
              </p>
              <div className="quick-chips">
                {WALLET_PRESETS.map((w) => (
                  <button
                    key={w}
                    type="button"
                    className="chip"
                    onClick={() => {
                      setKind("wallet");
                      setTitle(w);
                      setInitialBal("");
                      setOpen(true);
                    }}
                  >
                    + {w}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={kind === "wallet" ? "کیف‌پول جدید" : "حساب بانکی جدید"}
      >
        <div className="form-grid" style={{ marginTop: 8 }}>
          <div className="form-row full">
            <Field label="نوع">
              <Segmented
                value={kind}
                onChange={(v) => setKind(v as AccountKind)}
                options={[
                  { value: "bank", label: "حساب بانکی" },
                  { value: "wallet", label: "کیف‌پول" },
                ]}
              />
            </Field>
          </div>

          <div className="form-row full">
            <Field
              label={kind === "wallet" ? "نام کیف‌پول" : "عنوان کارت/حساب"}
            >
              <TextInput
                value={title}
                onChange={setTitle}
                placeholder={
                  kind === "wallet" ? "مثال: کیف پول نقدی" : "مثال: کارت اصلی"
                }
                autoFocus
              />
            </Field>
            {kind === "wallet" ? (
              <div className="quick-chips">
                {WALLET_PRESETS.map((w) => (
                  <button
                    key={w}
                    type="button"
                    className={`chip ${title === w ? "active" : ""}`}
                    onClick={() => setTitle(w)}
                  >
                    {w}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {kind === "bank" ? (
            <>
              {/* شماره کارت + بانک در یک ردیف — فرم فشرده */}
              <div className="form-row">
                <Field label="شماره کارت">
                  <TextInput
                    value={cardNo}
                    onChange={(v) => {
                      const digits = v.replace(/[^\d۰-۹]/g, "");
                      setCardNo(digits);
                      const detected = bankOfCard(digits);
                      if (detected) setBank(detected);
                    }}
                    placeholder="۶۲۱۹ ۸۶۱۰ …"
                    dir="ltr"
                    inputMode="numeric"
                  />
                </Field>
              </div>
              <div className="form-row">
                <Field label="بانک">
                  <Select
                    value={bank}
                    onChange={setBank}
                    options={[
                      { value: "", label: "انتخاب کنید" },
                      ...BANK_NAMES.map((b) => ({ value: b, label: b })),
                    ]}
                  />
                </Field>
              </div>

              {binError ? (
                <p className="field-error full" style={{ gridColumn: "1 / -1" }}>
                  {binError}
                </p>
              ) : null}
              <p className="modal-sub full" style={{ gridColumn: "1 / -1" }}>
                کارت ۱۶ رقمی الزامی است — بانک خودکار تشخیص داده می‌شود.
              </p>
            </>
          ) : null}

          {/* موجودی اولیه — مشترک بین حساب بانکی و کیف‌پول */}
          <div className="form-row full">
            <Field label="موجودی اولیه (اختیاری)">
              <AmountInput
                value={initialBal}
                onChange={setInitialBal}
                currency={cur}
              />
            </Field>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn-secondary" onClick={() => setOpen(false)}>
            انصراف
          </button>
          <button className="btn-primary" disabled={busy} onClick={save}>
            ذخیره
          </button>
        </div>
      </Modal>

      {/* بازه دلخواه نمودار ثروت — از طریق سه‌نقطه */}
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
            نمودار ثروت از اولین تا آخرین روزِ این بازه رسم می‌شود.
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

/* مسیر SVG ثروت — خط + ناحیه گرادیانی + نقطه پایان */
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
