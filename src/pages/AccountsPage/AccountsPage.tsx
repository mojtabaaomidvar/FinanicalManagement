/* صفحه حساب‌ها — ثروت کل + نمودار روند + لیست حساب‌ها/کیف‌پول‌ها */

import { useMemo, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { Card, Field, Modal, Segmented, Select, TextInput } from "@/shared/ui";
import {
  BANK_NAMES,
  bankOfCard,
  bankOfSheba,
  cardMatchesBank,
} from "@/shared/lib/banks";
import {
  maskCardNumber,
  formatCardFa,
  formatSheba,
  digitsOf,
} from "@/domain/account/account.rules";
import type { Account, AccountKind } from "@/domain/account/account.types";
import { accountBalances, wealthSeries } from "@/domain/report/report.rules";
import type { WealthRange } from "@/domain/report/report.types";
import { today } from "@/shared/lib/jalali";
import { formatAmount } from "@/shared/lib/format";
import { toDisplay } from "@/shared/lib/currency";

const WALLET_PRESETS = [
  "کیف پول نقدی",
  "پس‌انداز",
  "هزینه سفر",
  "پروژه خاص",
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
  const { useCases, accounts, members, member, txs, family, refreshData } = useApp();
  const { show } = useToast();
  const cur = family?.currency ?? "تومان";

  const [range, setRange] = useState<WealthRange>("1m");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [converting, setConverting] = useState(false);
  const [kind, setKind] = useState<AccountKind>("bank");
  const [title, setTitle] = useState("");
  const [bank, setBank] = useState("");
  const [cardNo, setCardNo] = useState("");
  const [accountNo, setAccountNo] = useState("");
  const [sheba, setSheba] = useState("");
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  /* ثروت کل + سری زمانی + موجودی هر حساب */
  const balances = useMemo(() => accountBalances(txs, accounts), [txs, accounts]);
  const totalWealth = useMemo(
    () => balances.reduce((s, b) => s + b.balance, 0),
    [balances],
  );
  const wealth = useMemo(
    () => wealthSeries(txs, range, today()),
    [txs, range],
  );

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
    setAccountNo("");
    setSheba("");
    setOpen(true);
  }

  /** تبدیل آنلاین کارت → شبا/حساب (best-effort) */
  async function convertCard() {
    const digits = digitsOf(cardNo);
    if (digits.length !== 16) {
      show("اول شماره کارت ۱۶ رقمی را کامل وارد کنید");
      return;
    }
    setConverting(true);
    try {
      const res = await fetch("api/card-convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card: digits }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        if (data.sheba) setSheba(data.sheba);
        if (data.account) setAccountNo(data.account);
        if (data.bank) setBank(data.bank);
        show("اطلاعات حساب دریافت شد");
      } else {
        show(data.message || "سرویس تبدیل در دسترس نیست — دستی وارد کنید");
      }
    } catch {
      show("سرویس تبدیل در دسترس نیست — دستی وارد کنید");
    } finally {
      setConverting(false);
    }
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
        accountNumber: kind === "bank" ? accountNo.trim() || null : null,
        sheba: kind === "bank" ? sheba.trim() || null : null,
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
          <h1>حساب‌ها</h1>
          <p>بانکی و کیف‌پول‌های خانواده</p>
        </div>
        <div className="header-actions">
          <button
            className="icon-btn"
            aria-label="افزودن حساب بانکی"
            title="افزودن حساب بانکی"
            onClick={() => openNew("bank")}
          >
            <svg>
              <use href="#i-plus" />
            </svg>
          </button>
          <button
            className="icon-btn"
            aria-label="افزودن کیف پول"
            title="افزودن کیف پول (نقد، پس‌انداز، سفر)"
            onClick={() => openNew("wallet")}
          >
            <svg>
              <use href="#i-wallet" />
            </svg>
          </button>
        </div>
      </header>

      <div className="content">
        {/* کارت ثروت کل */}
        <div className="balance-card wealth-card">
          <p className="balance-label">ثروت کل خانواده</p>
          <h2 style={totalWealth < 0 ? { color: "var(--danger)" } : undefined}>
            {formatAmount(toDisplay(totalWealth, cur))}
          </h2>
          <p className="balance-sub">{cur}</p>
          <div className="wealth-range">
            <Segmented
              value={range}
              onChange={(v) => setRange(v as WealthRange)}
              options={[
                { value: "7d", label: "۷ روز" },
                { value: "1m", label: "۱ ماه" },
                { value: "1y", label: "۱ سال" },
                { value: "max", label: "حداکثر" },
              ]}
            />
          </div>
          <div className="wealth-chart">
            <svg viewBox="0 0 340 120" className="wealth-svg" preserveAspectRatio="none">
              <WealthPath points={wealth.map((p) => p.value)} />
            </svg>
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
                  {acc.accountNumber ? (
                    <AccountLine
                      label="شماره حساب"
                      hiddenText={"•".repeat(Math.min(acc.accountNumber.length, 8))}
                      shownText={acc.accountNumber}
                      revealed={isRevealed}
                      onToggle={() => toggleReveal(acc.id)}
                      onCopy={() => copy(acc.accountNumber!, "شماره حساب")}
                    />
                  ) : null}
                  {acc.sheba ? (
                    <AccountLine
                      label="شبا"
                      hiddenText="IR•• •••• •••• •••• •••• ••••"
                      shownText={formatSheba(acc.sheba)}
                      revealed={isRevealed}
                      onToggle={() => toggleReveal(acc.id)}
                      onCopy={() => copy(acc.sheba!, "شماره شبا")}
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
              <p>برای پول نقد، پس‌انداز یا هزینه‌ی سفر و پروژه یک کیف‌پول بسازید</p>
              <div className="quick-chips">
                {WALLET_PRESETS.map((w) => (
                  <button
                    key={w}
                    type="button"
                    className="chip"
                    onClick={() => {
                      setKind("wallet");
                      setTitle(w);
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
            <Field label={kind === "wallet" ? "نام کیف‌پول" : "عنوان کارت/حساب"}>
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
              <div className="form-row full">
                <Field label="شماره کارت">
                  <div className="convert-row">
                    <TextInput
                      value={cardNo}
                      onChange={(v) => {
                        const digits = v.replace(/[^\d۰-۹]/g, "");
                        setCardNo(digits);
                        const detected = bankOfCard(digits);
                        if (detected) setBank(detected);
                      }}
                      placeholder="۶۲۱۹ ۸۶۱۰ ..."
                      dir="ltr"
                      inputMode="numeric"
                    />
                    <button
                      type="button"
                      className="action-btn convert-btn"
                      disabled={converting}
                      onClick={convertCard}
                      title="دریافت شبا/حساب از روی شماره کارت"
                    >
                      {converting ? "…" : "تبدیل"}
                    </button>
                  </div>
                </Field>
                {binError ? <p className="field-error">{binError}</p> : null}
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

              <div className="form-row">
                <Field label="شماره حساب">
                  <TextInput
                    value={accountNo}
                    onChange={setAccountNo}
                    placeholder="۱۲۳۴۵۶۷۸۹"
                    dir="ltr"
                    inputMode="numeric"
                  />
                </Field>
              </div>

              <div className="form-row">
                <Field label="شماره شبا">
                  <TextInput
                    value={sheba}
                    onChange={(v) => {
                      setSheba(v);
                      const detected = bankOfSheba(v);
                      if (detected) setBank(detected);
                    }}
                    placeholder="IR + ۲۴ رقم"
                    dir="ltr"
                  />
                </Field>
              </div>

              <p className="modal-sub full" style={{ gridColumn: "1 / -1" }}>
                تنها یکی از فیلدهای کارت، حساب یا شبا کافی است.
              </p>
            </>
          ) : (
            <p className="modal-sub full" style={{ gridColumn: "1 / -1" }}>
              کیف‌پول فقط یک نام دارد (بدون شماره کارت/شبا) — برای نقد، پس‌انداز
              یا جمع‌کردن پول یک هدف مشخص.
            </p>
          )}
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
    </section>
  );
}

/* مسیر SVG ثروت — خط + ناحیه پرشده */
function WealthPath({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const w = 340;
  const h = 120;
  const pad = 6;
  const min = Math.min(...points, 0);
  const max = Math.max(...points, 1);
  const span = max - min || 1;
  const x = (i: number) => (i / (points.length - 1)) * w;
  const y = (v: number) => pad + (1 - (v - min) / span) * (h - pad * 2);
  const d = points.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");
  const area = `${d} L${w},${h} L0,${h} Z`;
  const last = points[points.length - 1];
  const zeroY = y(0);
  return (
    <>
      <path d={area} fill="var(--accent)" opacity="0.1" />
      {min < 0 ? (
        <line x1="0" y1={zeroY} x2={w} y2={zeroY} stroke="var(--border)" strokeDasharray="3 4" />
      ) : null}
      <path d={d} fill="none" stroke={last >= 0 ? "var(--income)" : "var(--expense)"} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(points.length - 1)} cy={y(last)} r="4" fill="var(--card)" stroke={last >= 0 ? "var(--income)" : "var(--expense)"} strokeWidth="2" />
    </>
  );
}
