/* UI فرم تراکنش — مودال افزودن/ویرایش
   (حساب الزامی + انتخاب دسته با مودال زیردسته‌ها + افزودن دسته) */

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
import {
  categoriesFor,
  CUSTOM_CATEGORY_ICON,
  categoryById,
} from "@/domain/category/category.catalog";
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
  const {
    accounts,
    subcategories,
    customCategories,
    useCases,
    family,
    member,
    refreshData,
  } = useApp();
  const { show } = useToast();

  const [subModalOpen, setSubModalOpen] = useState(false);
  const [showAddCat, setShowAddCat] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [addingCat, setAddingCat] = useState(false);
  const [newSubName, setNewSubName] = useState("");
  const [addingSub, setAddingSub] = useState(false);

  /* دسته‌های قابل نمایش: ثابت + سفارشی همین نوع */
  const cats = [
    ...categoriesFor(m.form.type),
    ...customCategories
      .filter((c) => c.type === m.form.type)
      .map((c) => ({
        id: c.id,
        name: c.name,
        icon: CUSTOM_CATEGORY_ICON,
        type: c.type,
      })),
  ];

  const activeCat = categoryById(m.form.categoryId);
  const selectedSub = subcategories.find((s) => s.id === m.form.subcategoryId);
  const subsOfCategory = subcategories.filter(
    (s) => s.category === m.form.categoryId,
  );

  function pickCategory(catId: string) {
    if (catId !== m.form.categoryId) {
      /* انتخاب دسته جدید → ریست زیردسته */
      m.setForm({ ...m.form, categoryId: catId, subcategoryId: "" });
    }
    /* همیشه مودال زیردسته‌ها باز شود */
    setSubModalOpen(true);
  }

  async function addCategory() {
    const name = newCatName.trim();
    if (!name) return show("نام دسته را وارد کنید");
    setAddingCat(true);
    try {
      const created = await useCases!.addCustomCategory.execute(
        m.form.type,
        name,
      );
      await refreshData();
      m.setForm({ ...m.form, categoryId: created.id, subcategoryId: "" });
      setShowAddCat(false);
      setNewCatName("");
      show("دسته اضافه شد");
    } catch (e) {
      show((e as Error).message || "خطا در افزودن دسته");
    } finally {
      setAddingCat(false);
    }
  }

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
            <Field label={`مبلغ (${family?.currency ?? "تومان"})`}>
              <AmountInput value={m.form.amount} onChange={m.setAmount} big />
            </Field>
          </div>

          <div className="form-row full">
            <Field label="دسته‌بندی">
              <div className="cat-grid">
                {cats.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`cat-cell ${m.form.categoryId === c.id ? "active" : ""}`}
                    onClick={() => pickCategory(c.id)}
                  >
                    <svg>
                      <use href={`#${c.icon}`} />
                    </svg>
                    <span>{c.name}</span>
                  </button>
                ))}
                <button
                  type="button"
                  className="cat-cell cat-add"
                  onClick={() => setShowAddCat((v) => !v)}
                  title="افزودن دسته جدید"
                >
                  <svg>
                    <use href="#i-plus" />
                  </svg>
                  <span>دسته جدید</span>
                </button>
              </div>
            </Field>
          </div>

          {showAddCat ? (
            <div className="form-row full">
              <Field label="نام دسته جدید">
                <div className="convert-row">
                  <TextInput
                    value={newCatName}
                    onChange={setNewCatName}
                    placeholder="مثلاً کمک‌های والدین"
                    autoFocus
                  />
                  <button
                    type="button"
                    className="action-btn convert-btn"
                    disabled={addingCat}
                    onClick={addCategory}
                  >
                    {addingCat ? "…" : "ثبت"}
                  </button>
                </div>
              </Field>
            </div>
          ) : null}

          <div className="form-row full">
            <Field label="زیردسته (الزامی)">
              <button
                type="button"
                className="subcat-trigger"
                onClick={() => setSubModalOpen(true)}
              >
                {selectedSub ? (
                  <>
                    <span>{activeCat.name}</span>
                    <b>{selectedSub.name}</b>
                  </>
                ) : (
                  <span className="subcat-empty">
                    انتخاب زیردسته برای «{activeCat.name}»…
                  </span>
                )}
                <svg>
                  <use href="#i-arrow-l" />
                </svg>
              </button>
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

          <div className="form-row">
            <Field label="تاریخ">
              <JalaliDateInput value={m.form.date} onChange={m.setDate} />
            </Field>
          </div>

          <div className="form-row full">
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
        {m.editing &&
        (member?.role === "owner" || m.editing.memberId === member?.id) ? (
          <button className="btn-danger-block" onClick={() => m.remove(refreshData)}>
            حذف تراکنش
          </button>
        ) : null}
      </Modal>

      {/* مودال انتخاب زیردسته برای دسته فعلی */}
      <Modal
        open={subModalOpen}
        onClose={() => setSubModalOpen(false)}
        title={`زیردسته‌های «${activeCat.name}»`}
      >
        <div className="subchips">
          {subsOfCategory.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`chip ${m.form.subcategoryId === s.id ? "active" : ""}`}
              onClick={() => {
                m.setForm({ ...m.form, subcategoryId: s.id });
                setSubModalOpen(false);
              }}
            >
              {s.name}
            </button>
          ))}
        </div>

        <div className="form-row" style={{ marginTop: 16 }}>
          <Field label="زیردسته جدید برای همین دسته">
            <div className="convert-row">
              <TextInput
                value={newSubName}
                onChange={setNewSubName}
                placeholder="مثلاً رستوران"
              />
              <button
                type="button"
                className="action-btn convert-btn"
                disabled={addingSub}
                onClick={addSubcategory}
              >
                {addingSub ? "…" : "افزودن"}
              </button>
            </div>
          </Field>
        </div>

        {!subsOfCategory.length ? (
          <p className="modal-sub">
            هنوز زیردسته‌ای برای این دسته ثبت نشده — اولین را بسازید.
          </p>
        ) : null}
      </Modal>
    </>
  );
}
