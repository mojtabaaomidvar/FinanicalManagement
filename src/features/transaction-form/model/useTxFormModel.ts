/* مدل فرم تراکنش — افزودن/ویرایش با اعتبارسنجی */

import { useEffect, useState } from "react";
import type { Transaction } from "@/domain/transaction/transaction.types";
import type { UseCases } from "@/application/useCases";
import type { Member } from "@/domain/family/family.types";
import { categoriesFor } from "@/domain/category/category.catalog";
import { parse } from "@/shared/lib/jalali";
import { jalaliToIso } from "@/shared/lib/jalali";
import {
  formatAmount,
  liveFormatAmount,
  liveFormatJalaliDate,
  parseAmountInput,
} from "@/shared/lib/format";
import { isoToJalali, today, formatISO } from "@/shared/lib/jalali";

export interface TxFormState {
  type: "expense" | "income";
  amount: string;
  categoryId: string;
  date: string;
  memberId: string;
  note: string;
  /** حساب منشا/مقصد — رشته خالی = بدون حساب */
  accountId: string;
}

export function useTxFormModel(
  useCases: UseCases,
  members: Member[],
  currentMemberId: string,
  notify: (m: string) => void,
) {
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<TxFormState>(defaults());

  function defaults(): TxFormState {
    return {
      type: "expense",
      amount: "",
      categoryId: "food",
      date: formatISO(today()),
      memberId: currentMemberId,
      note: "",
      accountId: "",
    };
  }

  function openNew() {
    setEditing(null);
    setForm(defaults());
    setOpen(true);
  }

  function openEdit(tx: Transaction) {
    setEditing(tx);
    setForm({
      type: tx.type,
      amount: formatAmount(tx.amount),
      categoryId: tx.category,
      date: formatISO(isoToJalali(tx.date)),
      memberId: tx.memberId,
      note: tx.note ?? "",
      accountId: tx.accountId ?? "",
    });
    setOpen(true);
  }

  function setType(type: "expense" | "income") {
    setForm((f) => ({
      ...f,
      type,
      categoryId: categoriesFor(type)[0].id,
    }));
  }

  async function save(onDone: () => Promise<void>) {
    const amount = parseAmountInput(form.amount);
    if (!amount || amount <= 0) return notify("لطفاً مبلغ معتبر وارد کنید");

    const parsedDate = parse(form.date) ?? today();

    const input = {
      memberId: form.memberId || currentMemberId,
      type: form.type,
      amount,
      category: form.categoryId,
      date: jalaliToIso(parsedDate),
      note: form.note.trim() || null,
      accountId: form.accountId || null,
    };

    try {
      if (editing) {
        await useCases.updateTransaction.execute(editing.id, input);
        notify("تراکنش ویرایش شد");
      } else {
        await useCases.addTransaction.execute(input);
        notify("تراکنش ثبت شد");
      }
      setOpen(false);
      await onDone();
    } catch (e) {
      notify((e as Error).message || "خطا در ذخیره");
    }
  }

  async function remove(onDone: () => Promise<void>) {
    if (!editing) return;
    if (!confirm("این تراکنش حذف شود؟")) return;
    try {
      await useCases.deleteTransaction.execute(editing.id);
      notify("تراکنش حذف شد");
      setOpen(false);
      await onDone();
    } catch (e) {
      notify((e as Error).message || "خطا در حذف");
    }
  }

  /* همگام‌سازی عضو پیش‌فرض وقتی لیست اعضا آماده شد */
  useEffect(() => {
    if (open && !members.find((m) => m.id === form.memberId)) {
      setForm((f) => ({ ...f, memberId: currentMemberId }));
    }
  }, [members, open, form.memberId, currentMemberId]);

  return {
    open,
    editing,
    form,
    setForm,
    openNew,
    openEdit,
    setType,
    save,
    remove,
    close: () => setOpen(false),
    setAmount: (v: string) => setForm((f) => ({ ...f, amount: liveFormatAmount(v) })),
    setDate: (v: string) => setForm((f) => ({ ...f, date: liveFormatJalaliDate(v) })),
  };
}

export type TxFormModel = ReturnType<typeof useTxFormModel>;
