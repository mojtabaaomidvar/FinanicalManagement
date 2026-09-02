/* مدل فرم تراکنش — افزودن/ویرایش با اعتبارسنجی */

import { useEffect, useState } from "react";
import type { Transaction } from "@/domain/transaction/transaction.types";
import type { UseCases } from "@/application/useCases";
import type { Member } from "@/domain/family/family.types";
import {
  categoriesFor,
  defaultCategoryOf,
} from "@/domain/category/category.catalog";
import { parse } from "@/shared/lib/jalali";
import { jalaliToIso } from "@/shared/lib/jalali";
import {
  formatAmount,
  liveFormatAmount,
  liveFormatJalaliDate,
  nowTime,
  parseAmountInput,
} from "@/shared/lib/format";
import { compressImage } from "@/shared/lib/image";
import { fromDisplay, toDisplay } from "@/shared/lib/currency";
import { isoToJalali, today, formatISO } from "@/shared/lib/jalali";

export interface TxFormState {
  type: "expense" | "income";
  amount: string;
  categoryId: string;
  date: string;
  /** ساعت ثبت — "HH:MM" یا "" */
  time: string;
  memberId: string;
  note: string;
  /** حساب منشا/مقصد — الزامی */
  accountId: string;
  /** زیردسته — الزامی (متفرقه هم یک زیردسته است) */
  subcategoryId: string;
}

/** تصویر پیوست در فرم — موجود (سمت سرور) یا در صف آپلود */
export interface TxPhotoItem {
  key: string;
  existing?: { id: string; url: string; caption: string | null };
  dataUrl?: string;
  caption: string;
}

const MAX_PHOTOS = 8;

export function useTxFormModel(
  useCases: UseCases,
  members: Member[],
  currentMemberId: string,
  notify: (m: string) => void,
  currency: string = "تومان",
) {
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<TxFormState>(defaults());
  const [photos, setPhotos] = useState<TxPhotoItem[]>([]);
  const [busy, setBusy] = useState(false);

  function defaults(): TxFormState {
    return {
      type: "expense",
      amount: "",
      categoryId: defaultCategoryOf("expense").id,
      date: formatISO(today()),
      time: nowTime(),
      memberId: currentMemberId,
      note: "",
      accountId: "",
      subcategoryId: "",
    };
  }

  function openNew() {
    setEditing(null);
    setForm(defaults());
    setPhotos([]);
    setOpen(true);
  }

  function openEdit(tx: Transaction) {
    setEditing(tx);
    setForm({
      type: tx.type,
      amount: formatAmount(toDisplay(tx.amount, currency)),
      categoryId: tx.category,
      date: formatISO(isoToJalali(tx.date)),
      time: tx.time ?? "",
      memberId: tx.memberId,
      note: tx.note ?? "",
      accountId: tx.accountId ?? "",
      subcategoryId: tx.subcategoryId ?? "",
    });
    setPhotos(
      tx.photos.map((p) => ({
        key: p.id,
        existing: { id: p.id, url: p.url, caption: p.caption },
        caption: p.caption ?? "",
      })),
    );
    setOpen(true);
  }

  function setType(type: "expense" | "income") {
    setForm((f) => ({
      ...f,
      type,
      categoryId: categoriesFor(type)[0].id,
      subcategoryId: "", /* دسته عوض شد — زیردسته نامعتبر می‌شود */
    }));
  }

  async function save(
    onDone: () => Promise<void>,
    accountsCount: number,
  ) {
    if (busy) return;
    const amount = parseAmountInput(form.amount);
    if (!amount || amount <= 0) return notify("لطفاً مبلغ معتبر وارد کنید");

    /* زیردسته الزامی — متفرقه هم یک زیردسته است */
    if (!form.subcategoryId) {
      return notify(
        "انتخاب زیردسته الزامی است — روی دسته‌بندی بزنید و یکی را انتخاب کنید (یا «متفرقه»)",
      );
    }

    /* حساب الزامی — با پیام دقیق */
    if (!form.accountId) {
      if (!accountsCount) {
        return notify(
          "هنوز هیچ کارت/حسابی ثبت نشده — ابتدا از تب «کارت‌ها» یک حساب اضافه کنید",
        );
      }
      return notify(
        form.type === "expense"
          ? "انتخاب حساب الزامی است — این هزینه از کدام حساب پرداخت شد؟"
          : "انتخاب حساب الزامی است — این درآمد به کدام حساب واریز شد؟",
      );
    }

    const parsedDate = parse(form.date) ?? today();

    const input = {
      memberId: form.memberId || currentMemberId,
      type: form.type,
      amount: fromDisplay(amount, currency),
      category: form.categoryId,
      date: jalaliToIso(parsedDate),
      time: form.time || null,
      note: form.note.trim() || null,
      accountId: form.accountId,
      subcategoryId: form.subcategoryId || null,
    };

    setBusy(true);
    try {
      let txId = editing?.id ?? "";
      if (editing) {
        await useCases.updateTransaction.execute(editing.id, input);
        notify("تراکنش ویرایش شد");
      } else {
        const created = await useCases.addTransaction.execute(input);
        txId = created.id;
        notify("تراکنش ثبت شد");
      }

      /* تصاویر: کپن‌های ویرایش‌شده + صف آپلود */
      if (txId) {
        for (const p of photos) {
          if (p.existing && p.caption.trim() !== (p.existing.caption ?? "")) {
            await useCases.updateTxPhotoCaption.execute(
              p.existing.id,
              p.caption.trim() || null,
            );
          }
        }
        for (const p of photos) {
          if (!p.existing && p.dataUrl) {
            const url = await useCases.uploadTxPhoto.execute(p.dataUrl);
            await useCases.addTxPhoto.execute(
              txId,
              url,
              p.caption.trim() || null,
            );
          }
        }
      }

      setOpen(false);
      await onDone();
    } catch (e) {
      notify((e as Error).message || "خطا در ذخیره");
    } finally {
      setBusy(false);
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
    photos,
    busy,
    openNew,
    openEdit,
    setType,
    save,
    remove,
    close: () => setOpen(false),
    setAmount: (v: string) => setForm((f) => ({ ...f, amount: liveFormatAmount(v) })),
    setDate: (v: string) => setForm((f) => ({ ...f, date: liveFormatJalaliDate(v) })),
    setTime: (v: string) => setForm((f) => ({ ...f, time: v })),
    /* انتخاب فایل‌های تصویر → فشرده‌سازی و افزودن به صف آپلود */
    addPhotoFiles: async (files: File[]) => {
      const room = MAX_PHOTOS - photos.length;
      if (room <= 0) {
        return notify(`حداکثر ${MAX_PHOTOS} تصویر برای هر تراکنش`);
      }
      const items: TxPhotoItem[] = [];
      for (const file of files.slice(0, room)) {
        try {
          /* رسید/عکس محصول — ۱۰۲۴px برای خوانایی متن رسید */
          const dataUrl = await compressImage(file, 1024, 0.85);
          items.push({
            key: Math.random().toString(36).slice(2),
            dataUrl,
            caption: "",
          });
        } catch {
          /* فایل خراب — رد می‌شود */
        }
      }
      if (items.length) setPhotos((ps) => [...ps, ...items]);
    },
    setPhotoCaption: (key: string, v: string) =>
      setPhotos((ps) =>
        ps.map((p) => (p.key === key ? { ...p, caption: v.slice(0, 100) } : p)),
      ),
    /* حذف: عکس موجود فوراً از سرور؛ عکس صف فقط از لیست */
    removePhoto: async (key: string) => {
      const item = photos.find((p) => p.key === key);
      if (!item) return;
      if (item.existing) {
        if (!confirm("این تصویر حذف شود؟")) return;
        try {
          await useCases.deleteTxPhoto.execute(item.existing.id);
        } catch (e) {
          return notify((e as Error).message || "خطا در حذف تصویر");
        }
      }
      setPhotos((ps) => ps.filter((p) => p.key !== key));
    },
  };
}

export type TxFormModel = ReturnType<typeof useTxFormModel>;
