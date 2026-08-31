/* UI فرم تراکنش — مودال افزودن/ویرایش (حساب الزامی + زیردسته) */

import { useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
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
  const { accounts, subcategories, useCases, refreshData } = useApp();
  const { show } = useToast();

  const [showAddSub, setShowAddSub] = useState(false);
  const [newSubName, setNewSubName] = useState("");
  const [addingSub, setAddingSub] = useState(false);

  /* زیردسته‌های همین دسته انتخابی */
  const subsOfCategory = subcategories.filter(
    (s) => s.category === m.form.categoryId,
  );

  async function addSubcategory() {
    const name = newSubName.trim();
    if (!name) return show("نام زیردسته را وارد کنید");
    setAddingSub(true);
    try {
      const created = await useCases!.addSubcategory.execute(
        m.form.categoryId,
        name,
      );
      await refreshData();
      m.setForm({ ...m.form, subcategoryId: created.id });
      setShowAddSub(false);
      setNewSubName("");
      show("زیردسته اضافه شد");
    } catch (e) {
      show((e as Error).message || "خطا در افزودن زیردسته");
    } finally {
      setAddingSub(false);
    }
  }

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

        <div className="form-grid" style={{ marginTop: 16 }}>
          <div className="form-row full">
            <Field label="مبلغ (تومان)">
              <AmountInput value={m.form.amount} onChange={m.setAmount} big />
            </Field>
          </div>

          <div className="form-row full">
            <Field label="دسته‌بندی">
              <div className="cat-grid">
                {categoriesFor(m.form.type).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`cat-cell ${m.form.categoryId === c.id ? "active" : ""}`}
                    onClick={() =>
                      m.setForm({ ...m.form, categoryId: c.id, subcategoryId: "" })
                    }
                  >
                    <svg>
                      <use href={`#${c.icon}`} />
                    </svg>
                    <span>{c.name}</span>
                  </button>
                ))}
              </div>
            </Field>
          </div>

          <div className="form-row">
            <Field label="زیردسته (اختیاری)">
              <div className="convert-row">
                <Select
                  value={m.form.subcategoryId}
                  onChange={(v) => m.setForm({ ...m.form, subcategoryId: v })}
                  options={[
                    { value: "", label: "بدون زیردسته" },
                    ...subsOfCategory.map((s) => ({
                      value: s.id,
                      label: s.name,
                    })),
                  ]}
                />
                <button
                  type="button"
                  className="action-btn convert-btn"
                  onClick={() => setShowAddSub((v) => !v)}
                  title="افزودن زیردسته جدید برای این دسته"
                >
                  +
                </button>
              </div>
            </Field>
          </div>

          <div className="form-row">
            <Field
              label={m.form.type === "expense" ? "از حساب (الزامی)" : "به حساب (الزامی)"}
            >
              <Select
                value={m.form.accountId}
                onChange={(v) => m.setForm({ ...m.form, accountId: v })}
                options={[
                  { value: "", label: accounts.length ? "انتخاب کنید…" : "کارتی ثبت نشده" },
                  ...accounts.map((a) => ({
                    value: a.id,
                    label: accountLabel(a.title, a.bank, a.cardNumber),
                  })),
                ]}
              />
            </Field>
          </div>

          {showAddSub ? (
            <div className="form-row full">
              <Field label="نام زیردسته جدید">
                <div className="convert-row">
                  <TextInput
                    value={newSubName}
                    onChange={setNewSubName}
                    placeholder="مثلاً رستوران"
                    autoFocus
                  />
                  <button
                    type="button"
                    className="action-btn convert-btn"
                    disabled={addingSub}
                    onClick={addSubcategory}
                  >
                    {addingSub ? "…" : "ثبت"}
                  </button>
                </div>
              </Field>
            </div>
          ) : null}

          <div className="form-row">
            <Field label="تاریخ">
              <JalaliDateInput value={m.form.date} onChange={m.setDate} />
            </Field>
          </div>

          <div className="form-row">
            <Field label="شرح (اختیاری)">
              <TextInput
                value={m.form.note}
                onChange={(v) => m.setForm({ ...m.form, note: v })}
                placeholder="مثلاً ناهار با دوستان"
              />
            </Field>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn-secondary" onClick={m.close}>
            انصراف
          </button>
          <button
            className="btn-primary"
            onClick={() => m.save(refreshData, accounts.length)}
          >
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
