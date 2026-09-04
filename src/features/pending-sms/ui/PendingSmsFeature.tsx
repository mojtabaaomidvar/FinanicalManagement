/* UI مودال پیامک‌های ثبت‌نشده — رسیدگی یکی‌یکی */

import { useEffect } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { usePendingSmsModel } from "../model/usePendingSmsModel";
import { AmountInput, Field, JalaliDateInput, Modal, Select, TextInput } from "@/shared/ui";
import { categoriesFor } from "@/domain/category/category.catalog";
import { toFa } from "@/shared/lib/digits";

export function PendingSmsFeature({ refreshKey }: { refreshKey: number }) {
  const { useCases, member, family, accounts, subcategories, refreshData } =
    useApp();
  const { show } = useToast();
  const m = usePendingSmsModel(
    useCases!,
    member?.id ?? "",
    show,
    family?.currency ?? "تومان",
  );

  const subsOfCategory = subcategories.filter(
    (s) => s.category === m.categoryId,
  );

  /* بارگذاری پیامک‌های pending هنگام ورود به اپ و پس از هر تغییر داده */
  useEffect(() => {
    if (!m.open) void m.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  return (
    <Modal open={m.open} onClose={m.close}>
      <div className="pending-head">
        <h3>پیامک‌های ثبت‌نشده</h3>
        <span className="badge">
          {toFa(m.idx + 1)} از {toFa(m.list.length)}
        </span>
      </div>

      <div>
        <div className="pending-progress">
          <div
            className="pending-progress-fill"
            style={{ width: `${((m.idx + 1) / Math.max(m.list.length, 1)) * 100}%` }}
          />
        </div>
        <div className="pending-card">
          <div className="pending-raw">{m.raw}</div>
          <div className="pending-fields form-grid">
            <Field label="نوع تراکنش">
              <Select
                value={m.type}
                onChange={(v) => m.changeType(v as "expense" | "income")}
                options={[
                  { value: "expense", label: "هزینه" },
                  { value: "income", label: "درآمد" },
                ]}
              />
            </Field>
            <Field label="مبلغ">
              <AmountInput
                value={m.amount}
                onChange={m.setAmount}
                currency={family?.currency ?? "تومان"}
              />
            </Field>
            <Field label="دسته‌بندی">
              <Select
                value={m.categoryId}
                onChange={(v) => m.setCategoryId(v)}
                options={categoriesFor(m.type).map((c) => ({
                  value: c.id,
                  label: c.name,
                }))}
              />
            </Field>
            <Field label="لیبل (اختیاری)">
              <TextInput
                value={m.label}
                onChange={m.setLabel}
                placeholder="مثلاً نانوایی، اسنپ، اجاره…"
                maxLength={30}
              />
              {subsOfCategory.length ? (
                <div className="quick-chips">
                  {subsOfCategory.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`chip ${m.label === s.name ? "active" : ""}`}
                      onClick={() => m.setLabel(s.name)}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </Field>
            <Field label="حساب (الزامی)">
              <Select
                value={m.accountId}
                onChange={m.setAccountId}
                options={[
                  { value: "", label: accounts.length ? "انتخاب کنید…" : "کارتی ثبت نشده" },
                  ...accounts.map((a) => ({
                    value: a.id,
                    label: a.title + (a.bank ? " · " + a.bank : ""),
                  })),
                ]}
              />
            </Field>
            <Field label="تاریخ">
              <JalaliDateInput value={m.date} onChange={m.setDate} />
            </Field>
          </div>
        </div>
      </div>

      <div className="pending-actions">
        <button className="btn-ghost-danger" onClick={m.ignore}>
          نادیده
        </button>
        <button className="btn-ghost" onClick={m.close}>
          بعداً
        </button>
        <button
          className="btn-primary"
          onClick={() => m.record(refreshData, accounts.length)}
        >
          ثبت
        </button>
      </div>
    </Modal>
  );
}
