/* کارت مدیریت کارت‌ها و حساب‌ها — داخل تنظیمات مالی */

import { useMemo, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { Card, Field, Modal, Select, TextInput } from "@/shared/ui";
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
import type { Account } from "@/domain/account/account.types";

export function AccountsCard() {
  const { useCases, accounts, members, member, refreshData } = useApp();
  const { show } = useToast();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [converting, setConverting] = useState(false);
  const [title, setTitle] = useState("");
  const [bank, setBank] = useState("");
  const [cardNo, setCardNo] = useState("");
  const [accountNo, setAccountNo] = useState("");
  const [sheba, setSheba] = useState("");
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  /* خطای هم‌خوانی کارت با بانک — زنده هنگام تایپ */
  const binError = useMemo(() => {
    const digits = digitsOf(cardNo);
    if (digits.length < 6 || !bank || bank === "سایر") return "";
    if (!cardMatchesBank(digits, bank)) {
      return `این شماره کارت متعلق به «${bankOfCard(digits) ?? "بانک دیگری"}» است، نه «${bank}»`;
    }
    return "";
  }, [cardNo, bank]);

  function openNew() {
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
        bank: bank || null,
        cardNumber: cardNo.trim() || null,
        accountNumber: accountNo.trim() || null,
        sheba: sheba.trim() || null,
      });
      setOpen(false);
      show("کارت/حساب اضافه شد");
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
    <>
      <Card
        title="کارت‌ها و حساب‌ها"
        action={
          <button
            className="icon-btn"
            aria-label="افزودن کارت"
            onClick={openNew}
          >
            <svg>
              <use href="#i-plus" />
            </svg>
          </button>
        }
      >
        {accounts.length ? (
          accounts.map((acc) => {
            const owner = members.find((m) => m.id === acc.memberId);
            const isRevealed = revealed.has(acc.id);
            return (
              <div className="account-card" key={acc.id}>
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

                {acc.cardNumber ? (
                  <AccountRow
                    label="شماره کارت"
                    hiddenText={maskCardNumber(acc.cardNumber)}
                    shownText={formatCardFa(acc.cardNumber)}
                    revealed={isRevealed}
                    onToggle={() => toggleReveal(acc.id)}
                    onCopy={() => copy(acc.cardNumber!, "شماره کارت")}
                  />
                ) : null}

                {acc.accountNumber ? (
                  <AccountRow
                    label="شماره حساب"
                    hiddenText={"•".repeat(
                      Math.min(acc.accountNumber.length, 8),
                    )}
                    shownText={acc.accountNumber}
                    revealed={isRevealed}
                    onToggle={() => toggleReveal(acc.id)}
                    onCopy={() => copy(acc.accountNumber!, "شماره حساب")}
                  />
                ) : null}

                {acc.sheba ? (
                  <AccountRow
                    label="شبا"
                    hiddenText="IR•• •••• •••• •••• •••• ••••"
                    shownText={formatSheba(acc.sheba)}
                    revealed={isRevealed}
                    onToggle={() => toggleReveal(acc.id)}
                    onCopy={() => copy(acc.sheba!, "شماره شبا")}
                  />
                ) : null}
              </div>
            );
          })
        ) : (
          <div className="empty-state">
            <div className="empty-icon">
              <svg>
                <use href="#i-card" />
              </svg>
            </div>
            <p>هنوز کارتی ثبت نشده</p>
            <p style={{ fontSize: 11.5, marginTop: 4 }}>
              شماره کارت، حساب یا شبای اعضای خانواده را اضافه کنید
            </p>
          </div>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="کارت/حساب جدید"
      >
        <div className="form-grid" style={{ marginTop: 8 }}>
          <div className="form-row full">
            <Field label="شماره کارت">
              <div className="convert-row">
                <TextInput
                  value={cardNo}
                  onChange={(v) => {
                    const digits = v.replace(/[^\d۰-۹]/g, "");
                    setCardNo(digits);
                    /* تشخیص خودکار بانک از ۶ رقم اول */
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
            <Field label="عنوان کارت">
              <TextInput
                value={title}
                onChange={setTitle}
                placeholder="مثال: کارت اصلی"
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
                  /* تشخیص خودکار بانک از کد بانک در شبا */
                  const detected = bankOfSheba(v);
                  if (detected) setBank(detected);
                }}
                placeholder="IR + ۲۴ رقم"
                dir="ltr"
              />
            </Field>
          </div>

          <p className="modal-sub full" style={{ gridColumn: "1 / -1" }}>
            تنها یکی از فیلدهای کارت، حساب یا شبا کافی است — لازم نیست همه را پر
            کنید.
          </p>
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
    </>
  );
}

function AccountRow({
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
