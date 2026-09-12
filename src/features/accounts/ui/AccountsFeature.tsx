/* نمایش و مدیریت کارت‌ها/کیف‌پول‌ها — کامپوننت مشترک
   در صفحه‌ی «کیف پول‌ها» و زیرصفحه‌ی «کارت‌ها و حساب‌ها»ی تنظیمات
   عیناً همین کامپوننت رندر می‌شود، پس نمایش هر دو همیشه یکسان است. */

import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { useState } from "react";
import { Card, Icon } from "@/shared/ui";
import { maskCardNumber } from "@/domain/account/account.rules";
import type { Account } from "@/domain/account/account.types";
import { formatAmount } from "@/shared/lib/format";
import { toFa } from "@/shared/lib/digits";
import { toDisplay } from "@/shared/lib/currency";
import { AddHoldingModal } from "@/features/holdings";
import {
  KIND_LABEL,
  KIND_UNIT,
  formatQuantity,
} from "@/domain/holding/holding.rules";
import type { Holding, HoldingKind } from "@/domain/holding/holding.types";
import type { AccountsModel } from "../model/useAccountsModel";
import { WALLET_PRESETS } from "../model/useAccountsModel";
import { AccountFormFeature } from "./AccountFormFeature";

/** جلوی باز شدن فرم ویرایش را می‌گیرد — برای دکمه‌های داخل کارتِ کلیک‌پذیر */
function stop(e: MouseEvent) {
  e.stopPropagation();
}

/** پوسته‌ی کارتِ کلیک‌پذیر — کل کارت دکمه‌ی ویرایش است.
    اگر کاربر اجازه‌ی ویرایش نداشته باشد، کارت ساده و غیرفعال می‌ماند. */
function ClickableCard({
  acc,
  m,
  className,
  children,
}: {
  acc: Account;
  m: AccountsModel;
  className: string;
  children: ReactNode;
}) {
  if (!m.canEdit(acc)) {
    return <div className={className}>{children}</div>;
  }
  /* div با role=button (نه <button>) چون داخلش دکمه‌ی حذف و
     نمایش شماره کارت هست و دکمه تودرتو HTML نامعتبر است */
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      m.openEdit(acc);
    }
  }
  return (
    <div
      className={`${className} tappable`}
      role="button"
      tabIndex={0}
      aria-label={`ویرایش ${acc.title}`}
      onClick={() => m.openEdit(acc)}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}

/** ردیف شماره کارت — نمایش/پنهان (دکمه‌ی کپی حذف شد) */
function CardNumberRow({
  hiddenText,
  shownText,
  revealed,
  onToggle,
}: {
  hiddenText: string;
  shownText: string;
  revealed: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="account-row">
      <span className="account-row-label">شماره کارت</span>
      <div className="account-row-value">
        <b dir="ltr" className={revealed ? "" : "masked"}>
          {revealed ? shownText : hiddenText}
        </b>
      </div>
      <div className="account-row-actions">
        <button
          className="icon-btn small"
          aria-label={revealed ? "پنهان‌کردن" : "نمایش"}
          onClick={(e) => {
            stop(e);
            onToggle();
          }}
        >
          <svg>
            <use href={revealed ? "#i-eye-off" : "#i-eye"} />
          </svg>
        </button>
      </div>
    </div>
  );
}

/** فقط حذف — ویرایش با کلیک روی خود کارت انجام می‌شود */
function RowActions({ acc, m }: { acc: Account; m: AccountsModel }) {
  if (!m.canEdit(acc)) return null;
  return (
    <div className="account-actions">
      <button
        className="icon-btn small danger"
        aria-label={`حذف ${acc.title}`}
        onClick={(e) => {
          stop(e);
          m.remove(acc);
        }}
      >
        <svg>
          <use href="#i-trash" />
        </svg>
      </button>
    </div>
  );
}

/** ظاهرِ هر دستهٔ دارایی — عمداً همان آیکون/رنگِ کاشی‌های صفحهٔ «ارز و بورس»
    است تا کاربر همان قلمی را که آن‌جا زده، این‌جا با همان نشانه بشناسد. */
const KIND_FACE: Record<HoldingKind, { icon: string; tone: string }> = {
  stock: { icon: "i-chart", tone: "rose" },
  gold: { icon: "i-crown", tone: "amber" },
  currency: { icon: "i-swap", tone: "sky" },
  crypto: { icon: "i-grid4", tone: "violet" },
};

/** گروهِ سومِ صفحه — دارایی‌های بازاری (طلا/ارز/رمزارز/سهم).

    چرا جدا از حساب‌ها و کیف‌پول‌ها؟ آن‌ها مبلغِ ثابت دارند و این‌ها مقدار؛
    ارزششان هر روز عوض می‌شود و ردیفِ «۲ سکه» با ردیفِ «۵۰۰٬۰۰۰ تومان نقد»
    در یک فهرست، دو چیزِ ناهم‌جنس را هم‌جنس نشان می‌داد.

    افزودن این‌جا نیست چون برای افزودن باید قیمتِ زندهٔ یک نماد را انتخاب
    کرد؛ آن کار در صفحهٔ «ارز و بورس» انجام می‌شود. این‌جا فقط نمایش،
    ویرایشِ مقدار و حذف است. */
function HoldingsCard({ m }: { m: AccountsModel }) {
  const h = m.holdings;
  /* هدفِ ویرایش — از خودِ ردیف ساخته می‌شود، نه از ردیفِ بازار.
     واحد عمداً «تومان» ثابت است: سرور قیمت را همیشه به تومان یکسان
     می‌کند (holding.types را ببینید) و مودال قیمتِ خامِ همین ردیف را
     نشان می‌دهد، نه عددِ تبدیل‌شده به واحدِ نمایشِ کاربر. */
  const [editing, setEditing] = useState<Holding | null>(null);

  const submit = async (quantity: number) => {
    if (!editing) return;
    const ok = await h.update({ id: editing.id, quantity });
    if (ok) setEditing(null); // فقط در موفقیت می‌بندیم
  };

  const removeOne = async (x: Holding) => {
    if (!confirm(`«${x.name}» از دارایی‌ها حذف شود؟`)) return;
    await h.remove(x.id);
  };

  return (
    <>
      <Card title="دارایی‌ها">
        {h.items.length ? (
          <div className="hold-flat">
            {h.items.map((x) => {
              const face = KIND_FACE[x.kind];
              return (
                <div
                  key={x.id}
                  className="hold-card tappable"
                  role="button"
                  tabIndex={0}
                  aria-label={`ویرایش ${x.name}`}
                  onClick={() => {
                    h.clearError();
                    setEditing(x);
                  }}
                  onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      h.clearError();
                      setEditing(x);
                    }
                  }}
                >
                  <div className="hold-head">
                    <span className={`hold-ic is-${face.tone}`}>
                      <Icon name={face.icon} size={18} />
                    </span>
                    <div className="hold-title">
                      <b>{x.name}</b>
                      <p>
                        {KIND_LABEL[x.kind]} · {formatQuantity(x.quantity)}{" "}
                        {KIND_UNIT[x.kind]}
                      </p>
                    </div>
                    <div className="hold-value">
                      {x.priced ? (
                        <>
                          <b>{formatAmount(toDisplay(x.value, m.cur))}</b>
                          <span>{m.cur}</span>
                        </>
                      ) : (
                        <span className="hold-noprice">قیمت ندارد</span>
                      )}
                    </div>
                  </div>
                  <div className="account-actions">
                    <button
                      className="icon-btn small danger"
                      aria-label={`حذف ${x.name}`}
                      onClick={(e) => {
                        stop(e);
                        void removeOne(x);
                      }}
                    >
                      <svg>
                        <use href="#i-trash" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : h.loading ? (
          <p className="accounts-empty">در حال دریافت…</p>
        ) : (
          <p className="accounts-empty">
            هنوز دارایی‌ای ثبت نشده — از «ارز و بورس» روی هر قیمت بزنید تا به
            این فهرست اضافه شود
          </p>
        )}

        {h.unpriced > 0 ? (
          /* «جمعِ بالا» نمی‌گوییم: این کامپوننت در زیرصفحهٔ تنظیمات هم رندر
             می‌شود و آن‌جا هیچ عددِ جمعی بالایش نیست. */
          <p className="section-hint">
            قیمتِ {toFa(String(h.unpriced))} مورد امروز در دسترس نبود، پس در
            جمعِ دارایی‌ها حساب نشده‌اند.
          </p>
        ) : null}
        {h.stale ? (
          <p className="section-hint">قیمت‌ها از آخرین دادهٔ موجود است.</p>
        ) : null}
        {h.error ? <p className="field-error">{h.error}</p> : null}
      </Card>

      <AddHoldingModal
        target={
          editing
            ? {
                kind: editing.kind,
                symbol: editing.symbol,
                name: editing.name,
                unit: "تومان",
                price: editing.price,
              }
            : null
        }
        existingQuantity={editing?.quantity}
        busy={h.busy}
        error={h.error}
        onClose={() => {
          /* خطا هم پاک می‌شود وگرنه پس از «انصراف»، پیامِ شکستِ ذخیره
             روی کارتِ پشتِ مودال باقی می‌ماند و بی‌ربط به نظر می‌رسد. */
          h.clearError();
          setEditing(null);
        }}
        onSubmit={(q) => void submit(q)}
      />
    </>
  );
}

export function AccountsFeature({ m }: { m: AccountsModel }) {
  return (
    <>
      {/* حساب‌های بانکی */}
      <Card
        title="حساب‌های بانکی"
        action={
          <button className="link-btn" onClick={() => m.openNew("bank")}>
            افزودن
          </button>
        }
      >
        {m.banks.length ? (
          m.banks.map(({ account: acc, balance }) => {
            const owner = m.members.find((x) => x.id === acc.memberId);
            const isRevealed = m.revealed.has(acc.id);
            return (
              <ClickableCard
                key={acc.id}
                acc={acc}
                m={m}
                className="account-card flat"
              >
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
                    <b>{formatAmount(toDisplay(balance, m.cur))}</b>
                    <span>{m.cur}</span>
                  </div>
                </div>

                {acc.cardNumber ? (
                  <CardNumberRow
                    hiddenText={maskCardNumber(acc.cardNumber)}
                    shownText={m.cardText(acc)}
                    revealed={isRevealed}
                    onToggle={() => m.toggleReveal(acc.id)}
                  />
                ) : null}

                <RowActions acc={acc} m={m} />
              </ClickableCard>
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
          <button className="link-btn" onClick={() => m.openNew("wallet")}>
            افزودن
          </button>
        }
      >
        {m.wallets.length ? (
          <div className="wallet-flat">
            {m.wallets.map(({ account: acc, balance }) => {
              const owner = m.members.find((x) => x.id === acc.memberId);
              return (
                <ClickableCard
                  key={acc.id}
                  acc={acc}
                  m={m}
                  className="wallet-card"
                >
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
                    <b>{formatAmount(toDisplay(balance, m.cur))}</b>
                    <span>{m.cur}</span>
                  </div>
                  <RowActions acc={acc} m={m} />
                </ClickableCard>
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
                  onClick={() => m.openNew("wallet", w)}
                >
                  + {w}
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>

      <HoldingsCard m={m} />

      <AccountFormFeature m={m} />
    </>
  );
}
