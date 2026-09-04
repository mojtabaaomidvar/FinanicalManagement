/* شیت ثبت/ویرایش تراکنش — بازطراحی v8 (مطابق پرامپت طراحی)
   شیت تمام‌قد با تم رنگی دسته: تب نوع + دایره آیکون دسته + مبلغ درشت
   + کارت توضیحات با تگ‌های سریع + گرید دسته ۴ستونه (پیش از انتخاب دسته)
   + ردیف چیپ تاریخ/تکرار/حساب + کیپد ماشین‌حساب + دکمه اسکن رسید */

import { useMemo, useRef, useState, type CSSProperties } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import type { TxFormModel } from "../model/useTxFormModel";
import {
  CalcKeypad,
  evaluateExpression,
  JalaliDateInput,
  Modal,
  Select,
  TextInput,
} from "@/shared/ui";
import {
  categoriesFor,
  CUSTOM_CATEGORY_ICON,
  type Category,
} from "@/domain/category/category.catalog";
import { categoryColor } from "@/domain/category/category.colors";
import { TX_REPEATS, type TxRepeat } from "@/domain/transaction/transaction.types";
import { maskCardNumber } from "@/domain/account/account.rules";
import { formatAmount } from "@/shared/lib/format";

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

/* تگ‌های پیشنهادی لیبل — پیش‌فرض عمومی؛ سابقه خانواده هنگام اجرا اضافه می‌شود */
const QUICK_LABELS: Record<"expense" | "income", string[]> = {
  expense: [
    "خرید روزانه",
    "نان",
    "میوه",
    "تاکسی",
    "بنزین",
    "قبض",
    "دارو",
  ],
  income: ["حقوق", "پاداش", "عیدی", "فروش", "سود سرمایه", "هدیه"],
};

const TYPE_TABS: { value: "expense" | "income" | "transfer"; label: string }[] = [
  { value: "expense", label: "هزینه" },
  { value: "income", label: "درآمد" },
  { value: "transfer", label: "انتقال" },
];

/** رنگ تم شیت — رنگ دسته؛ خنثی قبل از انتخاب؛ منت برای انتقال */
function sheetBaseColor(type: string, categoryId: string): string {
  if (type === "transfer") return categoryColor("transfer");
  return categoryId ? categoryColor(categoryId) : "#D1D5DB";
}

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
  const [tagInput, setTagInput] = useState(false);
  const [tagText, setTagText] = useState("");
  const photoFileRef = useRef<HTMLInputElement>(null);

  const isTransfer = m.form.type === "transfer";
  /* فاز گرید = هنوز دسته‌ای انتخاب نشده (فقط هزینه/درآمد) */
  const showGrid = !isTransfer && !m.form.categoryId;

  /* دسته‌های قابل نمایش: ثابت + سفارشی همین نوع */
  const cats: Category[] = useMemo(
    () =>
      isTransfer
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
          ],
    [isTransfer, m.form.type, customCategories],
  );

  const activeCat = cats.find((c) => c.id === m.form.categoryId);
  const base = sheetBaseColor(m.form.type, m.form.categoryId);
  /* رنگ اکشن (کیپد/ذخیره/تگ فعال) — خنثی = اکشن برند */
  const catColor = m.form.categoryId || isTransfer ? base : "var(--accent)";

  /* آیکون و برچسب دایره بالای شیت */
  const headerIcon = isTransfer
    ? "i-swap"
    : (activeCat?.icon ?? "i-grid4");
  const headerLabel = isTransfer
    ? "انتقال وجه"
    : (activeCat?.name ?? (m.form.type === "income" ? "درآمد" : "هزینه"));

  /* تگ‌های پیشنهادی = سابقه لیبل‌های خانواده برای این دسته + پیش‌فرض‌ها */
  const tags = useMemo(() => {
    const own = subcategories
      .filter((s) => s.category === m.form.categoryId)
      .map((s) => s.name);
    const baseTags = QUICK_LABELS[m.form.type === "income" ? "income" : "expense"];
    return [...new Set([...own, ...baseTags])].slice(0, 9);
  }, [subcategories, m.form.categoryId, m.form.type]);

  /* نتیجه زنده عبارت ریاضی «۱۲+۵» زیر مبلغ */
  const exprResult = useMemo(() => {
    if (!/[+\-×÷]/.test(m.form.amount)) return null;
    const r = evaluateExpression(m.form.amount);
    return r === null ? null : formatAmount(r);
  }, [m.form.amount]);

  function pickCategory(catId: string) {
    if (catId !== m.form.categoryId) {
      m.setForm({ ...m.form, categoryId: catId, label: "" });
    }
  }

  /* بازگشت به گرید انتخاب دسته — تپ روی دایره */
  function backToGrid() {
    if (!isTransfer && m.form.categoryId) {
      m.setForm({ ...m.form, categoryId: "", label: "" });
    }
  }

  function applyCustomLabel() {
    const t = tagText.trim();
    if (t) m.setForm({ ...m.form, label: t.slice(0, 30) });
    setTagText("");
    setTagInput(false);
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

  const accountOpts = [
    {
      value: "",
      label: accounts.length ? "انتخاب حساب…" : "حسابی ثبت نشده",
    },
    ...accounts.map((a) => ({
      value: a.id,
      label: accountLabel(a.title, a.bank, a.cardNumber),
    })),
  ];

  return (
    <Modal
      open={m.open}
      onClose={m.close}
      padded={false}
      dragToClose
      sheetClassName="tx-sheet"
    >
      <div
        className="tx-form"
        style={{ "--cat-color": catColor, "--sheet-tint": base } as CSSProperties}
      >
        {/* ── هدر: بستن / عنوان / حذف + ذخیره ── */}
        <div className="tx-head">
          <button
            type="button"
            className="tx-head-btn tx-close-btn"
            aria-label="بستن"
            onClick={m.close}
          >
            <svg>
              <use href="#i-x" />
            </svg>
          </button>
          <span className="tx-head-title">
            {m.editing ? "ویرایش تراکنش" : "تراکنش جدید"}
          </span>
          <span className="tx-head-actions">
            {m.editing &&
            (member?.role === "owner" || m.editing.memberId === member?.id) ? (
              <button
                type="button"
                className="tx-head-btn tx-trash-btn"
                aria-label="حذف تراکنش"
                onClick={() => m.remove(refreshData)}
              >
                <svg>
                  <use href="#i-trash" />
                </svg>
              </button>
            ) : null}
            <button
              type="button"
              className="tx-head-btn tx-save-btn"
              aria-label={m.editing ? "ذخیره تغییرات" : "ثبت تراکنش"}
              disabled={m.busy}
              onClick={() => m.save(refreshData, accounts.length)}
            >
              {m.busy ? "…" : <svg><use href="#i-check" /></svg>}
            </button>
          </span>
        </div>

        {/* ── تب نوع تراکنش ── */}
        <div className="tx-tabs" role="tablist" aria-label="نوع تراکنش">
          {TYPE_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={m.form.type === t.value}
              className={`tx-tab ${m.form.type === t.value ? "on" : ""}`}
              onClick={() => m.setType(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── دایره آیکون دسته + برچسب ── */}
        <button
          type="button"
          className="tx-icon-wrap"
          onClick={backToGrid}
          aria-label={
            !isTransfer && m.form.categoryId ? "تغییر دسته‌بندی" : undefined
          }
        >
          <span
            className="tx-icon-circle"
            style={{
              background: `color-mix(in srgb, ${base} 45%, var(--card))`,
              color: `color-mix(in srgb, ${base} 80%, var(--text))`,
            }}
          >
            <svg>
              <use href={`#${headerIcon}`} />
            </svg>
          </span>
          <span className="tx-icon-label">{headerLabel}</span>
        </button>

        {/* ── ردیف حساب‌های انتقال (فقط تب انتقال) ── */}
        {isTransfer ? (
          <div className="tx-transfer-row">
            <label className="tx-pill">
              <svg>
                <use href="#i-card" />
              </svg>
              <Select
                className="tx-pill-select"
                value={m.form.accountId}
                onChange={(v) => m.setForm({ ...m.form, accountId: v })}
                options={accountOpts}
              />
            </label>
            <button
              type="button"
              className="tx-swap-btn"
              aria-label="جابه‌جایی مبدأ و مقصد"
              title="جابه‌جایی مبدأ و مقصد"
              onClick={() =>
                m.setForm({
                  ...m.form,
                  accountId: m.form.toAccountId,
                  toAccountId: m.form.accountId,
                })
              }
            >
              <svg>
                <use href="#i-swap" />
              </svg>
            </button>
            <label className="tx-pill">
              <svg>
                <use href="#i-wallet" />
              </svg>
              <Select
                className="tx-pill-select"
                value={m.form.toAccountId}
                onChange={(v) => m.setForm({ ...m.form, toAccountId: v })}
                options={[
                  { value: "", label: "حساب مقصد…" },
                  ...accounts
                    .filter((a) => a.id !== m.form.accountId)
                    .map((a) => ({
                      value: a.id,
                      label: accountLabel(a.title, a.bank, a.cardNumber),
                    })),
                ]}
              />
            </label>
          </div>
        ) : null}

        {/* ── مبلغ درشت + واحد ارز ── */}
        <div className="tx-amount-zone">
          {isTransfer ? (
            <span className="tx-amount-cap">انتقال وجه</span>
          ) : null}
          <div className="tx-amount" dir="ltr">
            {m.form.amount || <span className="tx-amount-zero">۰</span>}
          </div>
          {exprResult ? (
            <div className="tx-amount-expr" dir="ltr">
              = {exprResult}
            </div>
          ) : null}
          <button
            type="button"
            className="tx-currency-btn"
            onClick={() =>
              m.switchEntryCurrency(
                m.entryCurrency === "تومان" ? "ریال" : "تومان",
              )
            }
            title="تغییر واحد ورودی مبلغ"
          >
            {m.entryCurrency}
            <svg style={{ transform: "rotate(90deg)" }}>
              <use href="#i-arrow-r" />
            </svg>
          </button>
        </div>

        {/* ── کارت توضیحات: متن + دوربین + تگ‌های سریع ── */}
        <div className="tx-desc-card">
          <textarea
            className="tx-desc-input"
            rows={2}
            placeholder="توضیح تراکنش…"
            value={m.form.note}
            onChange={(e) => m.setForm({ ...m.form, note: e.target.value })}
          />
          <div className="tx-desc-foot">
            <button
              type="button"
              className="tx-cam-btn"
              aria-label="افزودن تصویر رسید"
              title="افزودن تصویر رسید"
              onClick={() => photoFileRef.current?.click()}
            >
              <svg>
                <use href="#i-image" />
              </svg>
            </button>
            {!isTransfer ? (
              <div className="tx-tags">
                {/* لیبل فعلی خارج از پیشنهادها → چیپ انتخاب‌شده */}
                {m.form.label && !tags.includes(m.form.label) ? (
                  <button
                    type="button"
                    className="tx-tag on"
                    onClick={() => m.setForm({ ...m.form, label: "" })}
                  >
                    <svg>
                      <use href="#i-check" />
                    </svg>
                    {m.form.label}
                  </button>
                ) : null}
                {tags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`tx-tag ${m.form.label === t ? "on" : ""}`}
                    onClick={() =>
                      m.setForm({
                        ...m.form,
                        label: m.form.label === t ? "" : t,
                      })
                    }
                  >
                    <svg>
                      <use href={m.form.label === t ? "#i-check" : "#i-plus"} />
                    </svg>
                    {t}
                  </button>
                ))}
                {tagInput ? (
                  <span className="tx-tag tx-tag-field">
                    <TextInput
                      value={tagText}
                      onChange={(v) => setTagText(v.slice(0, 30))}
                      placeholder="لیبل جدید…"
                      maxLength={30}
                      autoFocus
                    />
                    <button
                      type="button"
                      aria-label="ثبت لیبل"
                      onClick={applyCustomLabel}
                    >
                      <svg>
                        <use href="#i-check" />
                      </svg>
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="tx-tag tx-tag-add"
                    aria-label="لیبل جدید"
                    onClick={() => setTagInput(true)}
                  >
                    <svg>
                      <use href="#i-plus" />
                    </svg>
                    لیبل
                  </button>
                )}
              </div>
            ) : null}
          </div>
        </div>

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

        {/* نوار تصاویر پیوست */}
        {m.photos.length ? (
          <div className="tx-photos-strip">
            {m.photos.map((p) => (
              <div className="tx-photo-mini" key={p.key}>
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
                  aria-label="حذف تصویر"
                  onClick={() => void m.removePhoto(p.key)}
                >
                  <svg>
                    <use href="#i-x" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {showGrid ? (
          /* ── فاز ۱: گرید انتخاب دسته ── */
          <>
            <p className="tx-grid-title">انتخاب دسته</p>
            <div className="tx-cat-grid">
              {cats.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="tx-cat"
                  onClick={() => pickCategory(c.id)}
                >
                  <span
                    className="tx-cat-ico"
                    style={{ color: categoryColor(c.id) }}
                  >
                    <svg>
                      <use href={`#${c.icon}`} />
                    </svg>
                  </span>
                  <span className="tx-cat-name">{c.name}</span>
                </button>
              ))}
              <button
                type="button"
                className="tx-cat"
                onClick={() => setShowAddCat((v) => !v)}
              >
                <span className="tx-cat-ico tx-cat-ico-add">
                  <svg>
                    <use href="#i-plus" />
                  </svg>
                </span>
                <span className="tx-cat-name">دسته جدید</span>
              </button>
            </div>
            {showAddCat ? (
              <div className="tx-add-cat">
                <TextInput
                  value={newCatName}
                  onChange={setNewCatName}
                  placeholder="نام دسته مورد نظر شما"
                  autoFocus
                />
                <button
                  type="button"
                  className="btn-primary"
                  disabled={addingCat}
                  onClick={addCategory}
                >
                  {addingCat ? "…" : "ثبت"}
                </button>
              </div>
            ) : null}
          </>
        ) : (
          /* ── فاز ۲: چیپ‌های تاریخ/تکرار/حساب + کیپد + اسکن ── */
          <>
            <div className="tx-chips">
              {!isTransfer ? (
                <label className="tx-pill" title="حساب تراکنش">
                  <svg>
                    <use href="#i-card" />
                  </svg>
                  <Select
                    className="tx-pill-select"
                    value={m.form.accountId}
                    onChange={(v) => m.setForm({ ...m.form, accountId: v })}
                    options={accountOpts}
                  />
                </label>
              ) : null}
              <span className="tx-pill tx-pill-date" title="تاریخ و ساعت">
                <svg>
                  <use href="#i-bill" />
                </svg>
                <JalaliDateInput
                  value={m.form.date}
                  onChange={m.setDate}
                  time={m.form.time}
                  onTimeChange={m.setTime}
                />
              </span>
              <label className="tx-pill" title="تکرار">
                <svg>
                  <use href="#i-repeat" />
                </svg>
                <Select
                  className="tx-pill-select"
                  value={m.form.repeat}
                  onChange={(v) => m.setRepeat(v as TxRepeat)}
                  options={TX_REPEATS.map((r) => ({
                    value: r.value,
                    label: r.label,
                  }))}
                />
              </label>
            </div>

            {m.form.repeat !== "none" ? (
              <div className="tx-chips">
                <span className="tx-pill tx-pill-date" title="تاریخ پایان تکرار (الزامی)">
                  <svg>
                    <use href="#i-clock" />
                  </svg>
                  <JalaliDateInput
                    value={m.form.repeatEnd}
                    onChange={m.setRepeatEnd}
                    placeholder="تاریخ پایان…"
                  />
                </span>
                <span className="tx-chip-hint">
                  {TX_REPEATS.find((r) => r.value === m.form.repeat)?.label} تا{" "}
                  {m.form.repeatEnd || "…"}
                </span>
              </div>
            ) : null}

            <div className="tx-keypad-zone">
              <CalcKeypad value={m.form.amount} onChange={m.setAmount} />
              <button
                type="button"
                className="tx-scan-btn"
                onClick={() => photoFileRef.current?.click()}
              >
                <svg>
                  <use href="#i-image" />
                </svg>
                اسکن رسید
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
