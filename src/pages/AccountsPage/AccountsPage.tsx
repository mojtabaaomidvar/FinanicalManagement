/* صفحه کارت‌ها و حساب‌های بانکی — لیست + مودال افزودن */

import { useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { Field, Modal, Select, TextInput } from "@/shared/ui";
import { BANK_NAMES } from "@/shared/lib/banks";
import {
  maskCardNumber,
  formatCardFa,
  formatSheba,
} from "@/domain/account/account.rules";
import type { Account } from "@/domain/account/account.types";

export function AccountsPage() {
  const { useCases, accounts, members, member, refreshData } = useApp();
  const { show } = useToast();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [bank, setBank] = useState("");
  const [cardNo, setCardNo] = useState("");
  const [accountNo, setAccountNo] = useState("");
  const [sheba, setSheba] = useState("");
  const [memberId, setMemberId] = useState(member?.id ?? "");
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  function openNew() {
    setTitle("");
    setBank("");
    setCardNo("");
    setAccountNo("");
    setSheba("");
    setMemberId(member?.id ?? "");
    setOpen(true);
  }

  async function save() {
    setBusy(true);
    try {
      await useCases!.addAccount.execute({
        memberId: memberId || member?.id || "",
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
    <section className="page active">
      <header className="app-header">
        <div className="header-title">
          <h1>کارت‌ها و حساب‌ها</h1>
          <p>شماره کارت، حساب و شبا خانواده</p>
        </div>
        <button className="icon-btn" aria-label="افزودن کارت" onClick={openNew}>
          <svg>
            <use href="#i-plus" />
          </svg>
        </button>
      </header>

      <div className="content">
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
                  <button
                    className="icon-btn small danger"
                    aria-label="حذف"
                    onClick={() => remove(acc)}
                  >
                    <svg>
                      <use href="#i-trash" />
                    </svg>
                  </button>
                </div>

                {acc.cardNumber ? (
                  <AccountRow
                    label="شماره کارت"
                    hiddenText={maskCardNumber(acc.cardNumber)}
                    shownText={formatCardFa(acc.cardNumber)}
                    revealed={isRevealed}
                    onToggle={() => toggleReveal(acc.id)}
                    onCopy={() =>
                      copy(acc.cardNumber!, "شماره کارت")
                    }
                  />
                ) : null}

                {acc.accountNumber ? (
                  <AccountRow
                    label="شماره حساب"
                    hiddenText={"•".repeat(Math.min(acc.accountNumber.length, 8))}
                    shownText={acc.accountNumber}
                    revealed={isRevealed}
                    onToggle={() => toggleReveal(acc.id)}
                    onCopy={() =>
                      copy(acc.accountNumber!, "شماره حساب")
                    }
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
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="کارت/حساب جدید">
        <div style={{ marginTop: 8 }}>
          <Field label="نام (مثل: کارت اصلی من)">
            <TextInput
              value={title}
              onChange={setTitle}
              placeholder="کارت اصلی من"
              autoFocus
            />
          </Field>

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

          <Field label="شماره کارت (۱۶ رقم)">
            <TextInput
              value={cardNo}
              onChange={(v) => setCardNo(v)}
              placeholder="۶۲۱۹ ۸۶۱۰ ..."
              dir="ltr"
              inputMode="numeric"
              maxLength={23}
            />
          </Field>

          <Field label="شماره حساب (اختیاری)">
            <TextInput
              value={accountNo}
              onChange={setAccountNo}
              placeholder="مثلاً ۱۲۳۴۵۶۷۸۹"
              dir="ltr"
              inputMode="numeric"
            />
          </Field>

          <Field label="شماره شبا (اختیاری)">
            <TextInput
              value={sheba}
              onChange={setSheba}
              placeholder="IR + ۲۴ رقم"
              dir="ltr"
            />
          </Field>

          <Field label="مالک">
            <Select
              value={memberId || member?.id || ""}
              onChange={setMemberId}
              options={members.map((m) => ({ value: m.id, label: m.name }))}
            />
          </Field>

          <p className="modal-sub">
            حداقل یکی از شماره کارت، حساب یا شبا الزامی است.
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
    </section>
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
        <button
          className="icon-btn small"
          aria-label="کپی"
          onClick={onCopy}
        >
          <svg>
            <use href="#i-copy" />
          </svg>
        </button>
      </div>
    </div>
  );
}
