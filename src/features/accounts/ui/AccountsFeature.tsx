/* نمایش و مدیریت کارت‌ها/کیف‌پول‌ها — کامپوننت مشترک
   در صفحه‌ی «کیف پول‌ها» و زیرصفحه‌ی «کارت‌ها و حساب‌ها»ی تنظیمات
   عیناً همین کامپوننت رندر می‌شود، پس نمایش هر دو همیشه یکسان است. */

import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { Card } from "@/shared/ui";
import { maskCardNumber } from "@/domain/account/account.rules";
import type { Account } from "@/domain/account/account.types";
import { formatAmount } from "@/shared/lib/format";
import { toDisplay } from "@/shared/lib/currency";
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

      <AccountFormFeature m={m} />
    </>
  );
}
