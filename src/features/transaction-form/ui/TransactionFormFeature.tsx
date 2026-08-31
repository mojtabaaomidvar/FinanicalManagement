/* UI فرم تراکنش — مودال افزودن/ویرایش (با حساب منشا/مقصد) */

import { useApp } from "@/app/providers/AppProvider";
import type { TxFormModel } from "../model/useTxFormModel";
import {
  AmountInput,
  Field,
  JalaliDateInput,
  Modal,
  Segmented,
  Select,
  TextInput,
} from "@/shared/ui";
import { categoriesFor } from "@/domain/category/category.catalog";
import { maskCardNumber } from "@/domain/account/account.rules";

function accountLabel(
  title: string,
  bank: string | null,
  cardNumber: string | null,
): string {
  const parts = [title];
  if (bank) parts.push(bank);
  if (cardNumber) parts.push(maskCardNumber(cardNumber));
  return parts.join(" · ");
}

export function TransactionFormFeature({ form }: { form: TxFormModel }) {
  const m = form;
  const { members, accounts, refreshData } = useApp();

  return (
    <>
      <Modal open={m.open} onClose={m.close} title={m.editing ? "ویرایش تراکنش" : "تراکنش جدید"}>
        <Segmented
          value={m.form.type}
          onChange={m.setType}
          options={[
            { value: "expense", label: "هزینه" },
            { value: "income", label: "درآمد" },
          ]}
        />

        <div style={{ marginTop: 16 }}>
          <Field label="مبلغ (تومان)">
            <AmountInput
              value={m.form.amount}
              onChange={m.setAmount}
              big
            />
          </Field>

          <Field label="دسته‌بندی">
            <div className="cat-grid">
              {categoriesFor(m.form.type).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`cat-cell ${m.form.categoryId === c.id ? "active" : ""}`}
                  onClick={() => m.setForm({ ...m.form, categoryId: c.id })}
                >
                  <svg>
                    <use href={`#${c.icon}`} />
                  </svg>
                  <span>{c.name}</span>
                </button>
              ))}
            </div>
          </Field>

          <Field label={m.form.type === "expense" ? "از حساب (منشا هزینه)" : "به حساب (مقصد درآمد)"}>
            <Select
              value={m.form.accountId}
              onChange={(v) => m.setForm({ ...m.form, accountId: v })}
              options={[
                { value: "", label: accounts.length ? "بدون حساب مشخص" : "هنوز کارتی ثبت نشده" },
                ...accounts.map((a) => ({
                  value: a.id,
                  label: accountLabel(a.title, a.bank, a.cardNumber),
                })),
              ]}
            />
          </Field>

          <Field label="تاریخ">
            <JalaliDateInput value={m.form.date} onChange={m.setDate} />
          </Field>

          <Field label="عضو">
            <Select
              value={m.form.memberId}
              onChange={(v) => m.setForm({ ...m.form, memberId: v })}
              options={members.map((x) => ({ value: x.id, label: x.name }))}
            />
          </Field>

          <Field label="یادداشت (اختیاری)">
            <TextInput
              value={m.form.note}
              onChange={(v) => m.setForm({ ...m.form, note: v })}
              placeholder="مثلاً ناهار با دوستان"
            />
          </Field>
        </div>

        <div className="modal-actions">
          <button className="btn-secondary" onClick={m.close}>
            انصراف
          </button>
          <button className="btn-primary" onClick={() => m.save(refreshData)}>
            ذخیره
          </button>
        </div>
        {m.editing ? (
          <button className="btn-danger-block" onClick={() => m.remove(refreshData)}>
            حذف تراکنش
          </button>
        ) : null}
      </Modal>
    </>
  );
}
