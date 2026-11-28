/* نمایش و مدیریت کارت‌ها/کیف‌پول‌ها — کامپوننت مشترک
   در صفحه‌ی «کیف پول‌ها» و زیرصفحه‌ی «کارت‌ها و حساب‌ها»ی تنظیمات
   عیناً همین کامپوننت رندر می‌شود، پس نمایش هر دو همیشه یکسان است. */

import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from "react";
import { useState } from "react";
import { Card, Icon, Modal, TextInput } from "@/shared/ui";
import { maskCardNumber } from "@/domain/account/account.rules";
import type { Account } from "@/domain/account/account.types";
import { formatAmount } from "@/shared/lib/format";
import { toFa } from "@/shared/lib/digits";
import { toDisplay } from "@/shared/lib/currency";
import { AddHoldingModal, HoldingsStatus } from "@/features/holdings";
import {
  KIND_LABEL,
  KIND_UNIT,
  formatQuantity,
} from "@/domain/holding/holding.rules";
import type { Holding, HoldingKind } from "@/domain/holding/holding.types";
import type { AccountsModel } from "../model/useAccountsModel";
import { AccountFormFeature } from "./AccountFormFeature";
import { bankDisplayLabel } from "@/shared/lib/banks";
import { WalletBalanceDisplay } from "./WalletBalanceDisplay";
import { WalletAmount } from "./WalletAmount";
import { WalletCorrectionFeature } from "./WalletCorrectionFeature";
import { bankCardAppearance } from "../model/bankCardAppearance";
import "./AccountsFeature.css";
import { BankCardNumber } from "./BankCardNumber";
import { WalletOwnerFilter } from "./WalletOwnerFilter";

/** جلوی باز شدن فرم ویرایش را می‌گیرد — برای دکمه‌های داخل کارت کلیک‌پذیر */
function stop(e: MouseEvent) {
  e.stopPropagation();
}

/** Card activation opens account actions, including read-only transactions. */
function ClickableCard({
  acc,
  m,
  className,
  style,
  onOpen,
  children,
}: {
  acc: Account;
  m: AccountsModel;
  className: string;
  style?: CSSProperties;
  onOpen: (account: Account) => void;
  children: ReactNode;
}) {
  function open() { if (!m.locked) onOpen(acc); }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  }
  return (
    <div
      className={`${className} tappable`}
      style={style}
      role="button"
      tabIndex={m.locked ? -1 : 0}
      aria-disabled={m.locked}
      aria-label={`جزئیات ${acc.title}`}
      onClick={open}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}

export function AccountAddButton({ m }: { m: AccountsModel }) {
  return (
    <button type="button" className="btn-primary accounts-add-button" disabled={m.locked}
      aria-label="افزودن حساب یا کیف پول" onClick={() => m.openNew("bank")}>
      <Icon name="i-plus" />
      <span>افزودن</span>
    </button>
  );
}

/** ظاهر هر دستهٔ دارایی — عمداً همان آیکون/رنگ کاشی‌های صفحهٔ «ارز و بورس»
    است تا کاربر همان قلمی را که آن‌جا زده، این‌جا با همان نشانه بشناسد. */
const KIND_FACE: Record<HoldingKind, { icon: string; tone: string }> = {
  stock: { icon: "i-chart", tone: "rose" },
  gold: { icon: "i-crown", tone: "amber" },
  currency: { icon: "i-swap", tone: "sky" },
  crypto: { icon: "i-grid4", tone: "violet" },
};

/** گروه سوم صفحه — دارایی‌های بازاری (طلا/ارز/رمزارز/سهم).

    چرا جدا از حساب‌ها و کیف‌پول‌ها؟ آن‌ها مبلغ ثابت دارند و این‌ها مقدار؛
    ارزششان هر روز عوض می‌شود و ردیف «۲ سکه» با ردیف «۵۰۰٬۰۰۰ تومان نقد»
    در یک فهرست، دو چیز ناهم‌جنس را هم‌جنس نشان می‌داد.

    افزودن این‌جا نیست چون برای افزودن باید قیمت زندهٔ یک نماد را انتخاب
    کرد؛ آن کار در صفحهٔ «ارز و بورس» انجام می‌شود. این‌جا فقط نمایش،
    ویرایش مقدار و حذف است. */
function HoldingsCard({ m }: { m: AccountsModel }) {
  const h = m.holdings;
  /* هدف ویرایش — از خود ردیف ساخته می‌شود، نه از ردیف بازار.
     واحد عمداً «تومان» ثابت است: سرور قیمت را همیشه به تومان یکسان
     می‌کند (holding.types را ببینید) و مودال قیمت خام همین ردیف را
     نشان می‌دهد، نه عدد تبدیل‌شده به واحد نمایش کاربر. */
  const [editing, setEditing] = useState<Holding | null>(null);

  const submit = async (quantity: number) => {
    if (!editing) return;
    const ok = await h.update({ id: editing.id, quantity });
    if (ok) setEditing(null); // فقط در موفقیت می‌بندیم
  };

  const removeOne = async (x: Holding) => {
    if (h.isLocked()) return;
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
                  tabIndex={h.locked ? -1 : 0}
                  aria-disabled={h.locked}
                  aria-label={`ویرایش ${x.name}`}
                  onClick={() => {
                    if (h.isLocked()) return;
                    h.clearError();
                    setEditing(x);
                  }}
                  onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
                    if (e.target !== e.currentTarget) return;
                    if (h.isLocked()) return;
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
                        <WalletAmount formattedAmount={formatAmount(toDisplay(x.value, m.cur))} currency={m.cur} />
                      ) : (
                        <span className="hold-noprice">قیمت ندارد</span>
                      )}
                    </div>
                  </div>
                  <div className="account-actions">
                    <button
                      className="icon-btn small danger"
                      disabled={h.locked}
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
        ) : h.loading || h.loadError ? null : (
          <p className="accounts-empty">
            هنوز دارایی‌ای ثبت نشده — از «ارز و بورس» روی هر قیمت بزنید تا به
            این فهرست اضافه شود
          </p>
        )}
        <HoldingsStatus model={h} />

        {h.unpriced > 0 ? (
          /* «جمع بالا» نمی‌گوییم: این کامپوننت در زیرصفحهٔ تنظیمات هم رندر
             می‌شود و آن‌جا هیچ عدد جمعی بالایش نیست. */
          <p className="section-hint">
            قیمت {toFa(String(h.unpriced))} مورد امروز در دسترس نبود، پس در جمع
            دارایی‌ها حساب نشده‌اند.
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
                /* قیمت سرور همیشه تومان است؛ این‌جا باید به واحد کاربر
                   برود وگرنه همین کارت در فهرست «ریال» نشان می‌دهد و
                   مودالش «تومان» — دو عدد ناهمخوان در یک صفحه. */
                unit: m.cur,
                price: toDisplay(editing.price, m.cur),
                /* این مسیر فقط «مقدار» را می‌فرستد و واحد را دست نمی‌زند؛
                   تومان را می‌گذاریم تا اگر روزی این فرم واحد هم بفرستد،
                   همان واحد ذخیره‌سازی سرور باشد نه واحد نمایش. */
                storeUnit: "تومان",
              }
            : null
        }
        existingQuantity={editing?.quantity}
        busy={h.busy}
        error={h.error}
        onClose={() => {
          if (h.isSaving()) return;
          /* خطا هم پاک می‌شود وگرنه پس از «انصراف»، پیام شکست ذخیره
             روی کارت پشت مودال باقی می‌ماند و بی‌ربط به نظر می‌رسد. */
          h.clearError();
          setEditing(null);
        }}
        onSubmit={(q) => void submit(q)}
      />
    </>
  );
}

export function AccountsFeature({ m, showAddAction = true, showOwnerFilter = true, onOpenTransactions }: { m: AccountsModel; showAddAction?: boolean; showOwnerFilter?: boolean; onOpenTransactions: (account: Account) => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedAccount = m.accounts.find(account => account.id === selectedId);
  const [correction, setCorrection] = useState<Account | null>(null);
  const [correctionHistory, setCorrectionHistory] = useState(false);
  const correctionAccount = correction ? m.accounts.find(account => account.id === correction.id && m.canEdit(account)) : undefined;
  const correctionKey = JSON.stringify([m.member?.familyId, m.member?.id, m.member?.role, correctionAccount?.id]);
  return (
    <div className="accounts-feature">
      <Modal open={!!selectedAccount} onClose={() => setSelectedId(null)} title={selectedAccount?.title} sheetClassName="wallet-account-sheet">
        {selectedAccount ? <>
          {selectedAccount.cardNumber ? <p className="account-detail-number" dir="ltr">{maskCardNumber(selectedAccount.cardNumber)}</p> : null}
          <div className="wallet-account-actions">
            <button type="button" className="btn-primary" disabled={m.locked} onClick={() => { setSelectedId(null); onOpenTransactions(selectedAccount); }}>تراکنش‌ها</button>
            {m.canEdit(selectedAccount) ? <>
              <button type="button" className="btn-secondary" disabled={m.locked} onClick={() => { setSelectedId(null); setCorrectionHistory(false); setCorrection(selectedAccount); }}>اصلاح موجودی</button>
              <button type="button" className="btn-secondary" disabled={m.locked} onClick={() => { setSelectedId(null); m.openEdit(selectedAccount); }}>ویرایش حساب</button>
              <button type="button" className="btn-secondary" disabled={m.locked} onClick={() => { setSelectedId(null); setCorrectionHistory(true); setCorrection(selectedAccount); }}>سابقهٔ اصلاح موجودی</button>
            </> : null}
          </div>
          <div className="modal-actions"><button type="button" className="btn-secondary" onClick={() => setSelectedId(null)}>بستن</button></div>
        </> : null}
      </Modal>
      {correctionAccount ? <WalletCorrectionFeature key={correctionKey} account={correctionAccount} historyOnly={correctionHistory} onClose={() => setCorrection(null)} onSaved={m.refreshAfterCorrection} /> : null}
      <Modal open={!!m.deleting} onClose={m.closeDelete} title="بررسی حذف حساب" sheetClassName="account-delete-sheet">
        <p>{m.deleting?.title}</p>
        {m.deleteHasHistory ? <p role="status">این حساب سابقهٔ تراکنش دارد و حذف نمی‌شود؛ سابقهٔ مالی حفظ می‌شود.</p> : <>
          <p>حذف حساب برگشت‌پذیر نیست. برای تأیید، نام حساب را دقیق وارد کنید.</p>
          <TextInput value={m.deleteConfirmation} onChange={m.setDeleteConfirmation} aria-label="نام حساب برای تأیید حذف"
            disabled={m.locked} autoComplete="off" />
        </>}
        <div className="modal-actions">
          <button type="button" className="btn-secondary" disabled={m.locked} onClick={m.closeDelete}>انصراف</button>
          {!m.deleteHasHistory ? <button type="button" className="btn-primary danger" disabled={m.locked || m.deleteConfirmation !== m.deleting?.title}
            onClick={() => void m.confirmDelete()}>{m.busy ? "در حال حذف…" : "حذف حساب"}</button> : null}
        </div>
      </Modal>
      {showOwnerFilter ? <WalletOwnerFilter m={m} /> : null}
      {showAddAction ? <div className="accounts-toolbar"><AccountAddButton m={m} /></div> : null}
      {/* حساب‌های بانکی */}
      <Card title="حساب‌های بانکی" action={<button type="button" className="link-btn wallet-refresh" onClick={m.walletBalances.refresh}>به‌روزرسانی</button>}>
        {m.banks.length ? (
          m.banks.map(({ account: acc }) => {
            const owner = m.members.find((x) => x.id === acc.memberId);
            const appearance = bankCardAppearance(acc.bank, acc.cardNumber);
            return (
              <ClickableCard
                key={acc.id}
                acc={acc}
                m={m}
                onOpen={account => setSelectedId(account.id)}
                className={`account-card flat bank-wallet-card${appearance ? " is-branded" : ""}`}
                style={appearance ? { "--bank-color": appearance.color } as CSSProperties : undefined}
              >
                <div className="account-head">
                  <div className="account-icon">
                    {appearance ? <img src={appearance.logo} alt="" loading="lazy" decoding="async" /> : <svg>
                      <use href="#i-card" />
                    </svg>}
                  </div>
                  <div className="account-title">
                    <h4>{acc.title}</h4>
                    <p>
                      {appearance?.label ?? (acc.bank ? bankDisplayLabel(acc.bank) : "بانک نامشخص")}
                      {owner ? ` · ${owner.name}` : ""}
                    </p>
                  </div>
                  <div className="account-balance-wrap"><WalletBalanceDisplay state={m.walletBalances.rows.get(acc.id)} currency={m.cur} className="account-balance" /></div>
                </div>
                {acc.cardNumber ? <BankCardNumber cardNumber={acc.cardNumber} /> : null}
              </ClickableCard>
            );
          })
        ) : (
          <p className="accounts-empty">{m.selectedOwnerId ? "برای عضو انتخاب‌شده حساب بانکی ثبت نشده" : "هنوز حساب بانکی ثبت نشده"}</p>
        )}
      </Card>

      {/* کیف‌پول‌ها */}
      <Card title="کیف‌پول‌ها">
        {m.wallets.length ? (
          <div className="wallet-flat">
            {m.wallets.map(({ account: acc }) => {
              const owner = m.members.find((x) => x.id === acc.memberId);
              return (
                <ClickableCard
                  key={acc.id}
                  acc={acc}
                  m={m}
                  onOpen={account => setSelectedId(account.id)}
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
                  <WalletBalanceDisplay state={m.walletBalances.rows.get(acc.id)} currency={m.cur} className="wallet-balance" />
                </ClickableCard>
              );
            })}
          </div>
        ) : (
          <div className="wallet-empty">
            <p>
              {m.selectedOwnerId ? "برای عضو انتخاب‌شده کیف‌پولی ثبت نشده" : "برای پول نقد، پس‌انداز یا هزینه‌ی سفر و پروژه یک کیف‌پول بسازید"}
            </p>
          </div>
        )}
      </Card>

      <HoldingsCard key={`${m.member?.familyId}:${m.member?.id}:${m.member?.role}`} m={m} />

      <AccountFormFeature m={m} />
    </div>
  );
}
