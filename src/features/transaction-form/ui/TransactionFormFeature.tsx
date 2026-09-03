/* UI فرم تراکنش — شیت پایینی افزودن/ویرایش
   (سوییچ هزینه/درآمد/انتقال + نمایشگر مبلغ بزرگ + کیپد ماشین‌حساب همیشه‌باز
    + سوییچ ارز ورودی + برچسب‌های سریع + تکرار دوره‌ای با تاریخ پایان + تم رنگی دسته) */

import { useRef, useState, type CSSProperties } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import type { TxFormModel } from "../model/useTxFormModel";
import {
  CalcKeypad,
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
} from "@/domain/category/category.catalog";
import { categoryColor } from "@/domain/category/category.colors";
import { TX_REPEATS, type TxRepeat } from "@/domain/transaction/transaction.types";
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

/* برچسب‌های سریع شرح — یک‌تپی */
const QUICK_LABELS: Record<"expense" | "income", string[]> = {
  expense: [
    "خرید روزانه",
    "نان",
    "میوه",
    "تاکسی",
    "بنزین",
    "قبض",
    "دارو",
    "کیف پول خرد",
  ],
  income: ["حقوق", "پاداش", "عیدی", "فروش", "سود سرمایه", "هدیه"],
};

/* نمونه‌های آماده تکرار — دوره + شرح */
const REPEAT_PRESETS: { label: string; note: string; repeat: TxRepeat }[] = [
  { label: "قسط", note: "قسط ماهانه", repeat: "monthly" },
  { label: "حقوق پرسنل", note: "حقوق پرسنل", repeat: "monthly" },
  { label: "اجاره خانه", note: "اجاره خانه", repeat: "monthly" },
  { label: "شارژ ساختمان", note: "شارژ ساختمان", repeat: "monthly" },
];

export function TransactionFormFeature({ form }: { form: TxFormModel }) {
  const m = form;
  const {
    accounts,
    subcategories,
    customCategories,
    useCases,
    member,
    refreshData,
  } = useApp();
  const { show } = useToast();

  const [showAddCat, setShowAddCat] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [addingCat, setAddingCat] = useState(false);
  const photoFileRef = useRef<HTMLInputElement>(null);

  const isTransfer = m.form.type === "transfer";

  /* دسته‌های قابل نمایش: ثابت + سفارشی همین نوع (انتقال دسته ندارد) */
  const cats = isTransfer
    ? []
    : [
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

  /* پیشنهادهای لیبل = زیردسته‌هایی که این خانواده برای این دسته ساخته */
  const subsOfCategory = subcategories.filter(
    (s) => s.category === m.form.categoryId,
  );

  /* تم رنگی فرم — رنگ پاستل دسته انتخاب‌شده */
  const catColor = categoryColor(
    isTransfer ? "transfer" : m.form.categoryId,
  );

  function pickCategory(catId: string) {
    if (catId !== m.form.categoryId) {
      /* انتخاب دسته جدید → ریست لیبل */
      m.setForm({ ...m.form, categoryId: catId, label: "" });
    }
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
      m.setForm({ ...m.form, categoryId: created.id, label: "" });
      setShowAddCat(false);
      setNewCatName("");
      show("دسته اضافه شد");
    } catch (e) {
      show((e as Error).message || "خطا در افزودن دسته");
    } finally {
      setAddingCat(false);
    }
  }

  return (
    <Modal
      open={m.open}
      onClose={m.close}
      title={m.editing ? "ویرایش تراکنش" : "تراکنش جدید"}
    >
      <div
        className="tx-form"
        style={{ "--cat-color": catColor } as CSSProperties}
      >
        {/* ── سوییچ نوع تراکنش ── */}
        <Segmented
          value={m.form.type}
          onChange={m.setType}
          options={[
            { value: "expense", label: "هزینه" },
            { value: "income", label: "درآمد" },
            { value: "transfer", label: "انتقال" },
          ]}
        />

        {/* ── نمایشگر مبلغ بزرگ + سوییچ ارز + کیپد همیشه‌باز ── */}
        <div className="sheet-amount">
          <span className="sheet-amount-label">
            مبلغ
            <button
              type="button"
              className="amount-currency-toggle"
              onClick={() =>
                m.switchEntryCurrency(
                  m.entryCurrency === "تومان" ? "ریال" : "تومان",
                )
              }
            >
              {m.entryCurrency}
            </button>
          </span>
          <div className="sheet-amount-display" dir="ltr">
            {m.form.amount || <span className="amount-empty">۰</span>}
          </div>
        </div>
        <CalcKeypad
          value={m.form.amount}
          onChange={m.setAmount}
          onDone={m.setAmount}
        />

        <div className="form-grid" style={{ marginTop: 16 }}>
          {isTransfer ? (
            /* ── حالت انتقال: مبدأ و مقصد ── */
            <>
              <div className="form-row full">
                <Field label="از حساب (مبدأ)">
                  <Select
                    value={m.form.accountId}
                    onChange={(v) => m.setForm({ ...m.form, accountId: v })}
                    options={[
                      {
                        value: "",
                        label: accounts.length ? "انتخاب کنید…" : "حسابی ثبت نشده",
                      },
                      ...accounts.map((a) => ({
                        value: a.id,
                        label: accountLabel(a.title, a.bank, a.cardNumber),
                      })),
                    ]}
                  />
                </Field>
              </div>
              <div className="form-row full">
                <Field label="به حساب (مقصد)">
                  <Select
                    value={m.form.toAccountId}
                    onChange={(v) => m.setForm({ ...m.form, toAccountId: v })}
                    options={[
                      {
                        value: "",
                        label: accounts.length ? "انتخاب کنید…" : "حسابی ثبت نشده",
                      },
                      ...accounts
                        .filter((a) => a.id !== m.form.accountId)
                        .map((a) => ({
                          value: a.id,
                          label: accountLabel(a.title, a.bank, a.cardNumber),
                        })),
                    ]}
                  />
                </Field>
              </div>
              <p className="transfer-hint">
                مثال: برداشت نقد از حساب بانکی → انتخاب بانک در «مبدأ» و کیف‌پول
                نقدی در «مقصد». انتقال در گزارش‌های درآمد/هزینه حساب نمی‌شود.
              </p>
            </>
          ) : (
            /* ── هزینه/درآمد: دسته‌بندی + لیبل + حساب ── */
            <>
              <div className="form-row full">
                <Field label="دسته‌بندی">
                  <div className="cat-grid">
                    {cats.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className={`cat-cell ${m.form.categoryId === c.id ? "active" : ""}`}
                        style={{
                          background:
                            m.form.categoryId === c.id
                              ? categoryColor(c.id)
                              : undefined,
                        }}
                        onClick={() => pickCategory(c.id)}
                      >
                        <svg style={{ color: m.form.categoryId === c.id ? "var(--card)" : categoryColor(c.id) }}>
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
                        placeholder="نام دسته مورد نظر شما"
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
                <Field label="لیبل (اختیاری)">
                  <TextInput
                    value={m.form.label}
                    onChange={(v) =>
                      m.setForm({ ...m.form, label: v.slice(0, 30) })
                    }
                    placeholder="مثلاً نانوایی، اسنپ، اجاره…"
                    maxLength={30}
                  />
                  {/* پیشنهادها = لیبل‌هایی که همین خانواده قبلاً برای این دسته تایپ کرده */}
                  {subsOfCategory.length ? (
                    <div className="quick-chips">
                      {subsOfCategory.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className={`chip ${m.form.label === s.name ? "active" : ""}`}
                          onClick={() =>
                            m.setForm({ ...m.form, label: s.name })
                          }
                        >
                          {s.name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </Field>
              </div>

              <div className="form-row full">
                <Field
                  label={
                    m.form.type === "expense"
                      ? "از حساب (الزامی)"
                      : "به حساب (الزامی)"
                  }
                >
                  <Select
                    value={m.form.accountId}
                    onChange={(v) => m.setForm({ ...m.form, accountId: v })}
                    options={[
                      {
                        value: "",
                        label: accounts.length ? "انتخاب کنید…" : "کارتی ثبت نشده",
                      },
                      ...accounts.map((a) => ({
                        value: a.id,
                        label: accountLabel(a.title, a.bank, a.cardNumber),
                      })),
                    ]}
                  />
                </Field>
              </div>

              <div className="form-row full">
                <Field label="تکرار">
                  <Select
                    value={m.form.repeat}
                    onChange={(v) => m.setRepeat(v as TxRepeat)}
                    options={TX_REPEATS.map((r) => ({
                      value: r.value,
                      label: r.label,
                    }))}
                  />
                </Field>
                {m.form.repeat === "none" ? (
                  <div className="quick-chips">
                    {REPEAT_PRESETS.map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        className="chip"
                        onClick={() => {
                          m.setRepeat(p.repeat);
                          if (!m.form.note.trim()) {
                            m.setForm({ ...m.form, note: p.note, repeat: p.repeat });
                          } else {
                            m.setRepeat(p.repeat);
                          }
                        }}
                      >
                        <svg>
                          <use href="#i-repeat" />
                        </svg>
                        {p.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <>
                    {/* تاریخ پایان تکرار — الزامی برای هر تراکنش تکرارشونده */}
                    <Field label="تاریخ پایان تکرار (الزامی)">
                      <JalaliDateInput
                        value={m.form.repeatEnd}
                        onChange={m.setRepeatEnd}
                        placeholder="تا چه تاریخی تکرار شود؟"
                      />
                    </Field>
                    <p className="repeat-hint">
                      این تراکنش به‌صورت{" "}
                      {TX_REPEATS.find((r) => r.value === m.form.repeat)?.label} تا{" "}
                      {m.form.repeatEnd || "…"} تکرار می‌شود و در فهرست
                      «تراکنش‌های زمان‌بندی‌شده» تنظیمات دیده می‌گیرد
                    </p>
                  </>
                )}
              </div>
            </>
          )}

          <div className="form-row full">
            <Field label="تاریخ و ساعت">
              <JalaliDateInput
                value={m.form.date}
                onChange={m.setDate}
                time={m.form.time}
                onTimeChange={m.setTime}
              />
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
            {m.form.type !== "transfer" ? (
              <div className="quick-chips">
                {QUICK_LABELS[m.form.type].map((l) => (
                  <button
                    key={l}
                    type="button"
                    className={`chip ${m.form.note.trim() === l ? "active" : ""}`}
                    onClick={() => m.setForm({ ...m.form, note: l })}
                  >
                    {l}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="form-row full">
            <Field label="تصاویر (رسید خرید، عکس محصول…)">
              <input
                ref={photoFileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                style={{ display: "none" }}
                onChange={(e) => {
                  void m.addPhotoFiles(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
              <div className="tx-photos">
                {m.photos.map((p) => (
                  <div className="tx-photo" key={p.key}>
                    <div className="tx-photo-img">
                      <a
                        href={p.existing?.url ?? p.dataUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="مشاهده تصویر"
                      >
                        <img
                          src={p.existing?.url ?? p.dataUrl}
                          alt={p.caption || "تصویر تراکنش"}
                        />
                      </a>
                      <button
                        type="button"
                        className="tx-photo-del"
                        aria-label="حذف تصویر"
                        onClick={() => void m.removePhoto(p.key)}
                      >
                        <svg>
                          <use href="#i-x" />
                        </svg>
                      </button>
                    </div>
                    <input
                      type="text"
                      className="tx-photo-cap"
                      placeholder="توضیح تصویر…"
                      value={p.caption}
                      maxLength={100}
                      onChange={(e) => m.setPhotoCaption(p.key, e.target.value)}
                    />
                  </div>
                ))}
                <button
                  type="button"
                  className="tx-photo-add"
                  onClick={() => photoFileRef.current?.click()}
                >
                  <svg>
                    <use href="#i-image" />
                  </svg>
                  <span>افزودن تصویر</span>
                </button>
              </div>
            </Field>
          </div>
        </div>

        {/* ── دکمه ذخیره چسبان پایین شیت ── */}
        <div className="sheet-save-row">
          {m.editing &&
          (member?.role === "owner" || m.editing.memberId === member?.id) ? (
            <button
              className="btn-danger-ghost-icon"
              aria-label="حذف تراکنش"
              onClick={() => m.remove(refreshData)}
            >
              <svg>
                <use href="#i-trash" />
              </svg>
            </button>
          ) : null}
          <button
            className="btn-primary sheet-save-btn"
            disabled={m.busy}
            onClick={() => m.save(refreshData, accounts.length)}
          >
            {m.busy ? "…" : m.editing ? "ذخیره تغییرات" : "ثبت تراکنش"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
