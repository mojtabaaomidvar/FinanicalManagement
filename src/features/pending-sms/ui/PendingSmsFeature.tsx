/* UI مودال پیامک‌های ثبت‌نشده — رسیدگی یکی‌یکی */

import { useEffect } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { usePendingSmsModel } from "../model/usePendingSmsModel";
import { AmountInput, Field, JalaliDateInput, Modal, Select } from "@/shared/ui";
import { categoriesFor } from "@/domain/category/category.catalog";
import { toFa } from "@/shared/lib/digits";

export function PendingSmsFeature({ refreshKey }: { refreshKey: number }) {
  const { useCases, members, member, refreshData } = useApp();
  const { show } = useToast();
  const m = usePendingSmsModel(useCases!, member?.id ?? "", show);

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
          <div className="pending-fields">
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
            <Field label="مبلغ (تومان)">
              <AmountInput value={m.amount} onChange={m.setAmount} />
            </Field>
            <Field label="دسته‌بندی">
              <Select
                value={m.categoryId}
                onChange={m.setCategoryId}
                options={categoriesFor(m.type).map((c) => ({
                  value: c.id,
                  label: c.name,
                }))}
              />
            </Field>
            <Field label="عضو">
              <Select
                value={m.memberId}
                onChange={m.setMemberId}
                options={members.map((x) => ({ value: x.id, label: x.name }))}
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
        <button className="btn-primary" onClick={() => m.record(refreshData)}>
          ثبت
        </button>
      </div>
    </Modal>
  );
}
