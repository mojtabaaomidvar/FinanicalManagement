/* کارت مدیریت کارت‌ها و حساب‌ها — داخل تنظیمات مالی */

import { useMemo, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { Card, Field, Modal, Select, TextInput } from "@/shared/ui";
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
import type { Account } from "@/domain/account/account.types";

export function AccountsCard() {
  const { useCases, accounts, members, member, refreshData } = useApp();
  const { show } = useToast();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [bank, setBank] = useState("");
  const [cardNo, setCardNo] = useState("");
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
        bank: bank || null,
        cardNumber: cardNo.trim() || null,
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
              شماره کارت اعضای خانواده را اضافه کنید
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
          {/* شماره کارت + بانک در یک ردیف — فرم فشرده */}
          <div className="form-row">
            <Field label="شماره کارت">
              <TextInput
                value={cardNo}
                onChange={(v) => {
                  const digits = v.replace(/[^\d۰-۹]/g, "");
                  setCardNo(digits);
                  /* تشخیص خودکار بانک از ۶ رقم اول */
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

          <div className="form-row full">
            <Field label="عنوان کارت">
              <TextInput
                value={title}
                onChange={setTitle}
                placeholder="مثال: کارت اصلی"
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
