/* مدل فرم تراکنش — افزودن/ویرایش با اعتبارسنجی */

import { useEffect, useState } from "react";
import type { Subcategory } from "@/domain/category/subcategory.types";
import type { Transaction, TxRepeat } from "@/domain/transaction/transaction.types";
import type { UseCases } from "@/application/useCases";
import type { Member } from "@/domain/family/family.types";
import {
  defaultCategoryOf,
} from "@/domain/category/category.catalog";
import { parse } from "@/shared/lib/jalali";
import { jalaliToIso } from "@/shared/lib/jalali";
import {
  formatAmount,
  liveFormatJalaliDate,
  nowTime,
  parseAmountInput,
} from "@/shared/lib/format";
import { toEn, toFa } from "@/shared/lib/digits";
import { evaluateExpression } from "@/shared/ui";
import { compressImage } from "@/shared/lib/image";
import { fromDisplay, toDisplay } from "@/shared/lib/currency";
import { isoToJalali, today, formatISO } from "@/shared/lib/jalali";

export interface TxFormState {
  type: "expense" | "income" | "transfer";
  amount: string;
  categoryId: string;
  date: string;
  /** ساعت ثبت — "HH:MM" یا "" */
  time: string;
  memberId: string;
  note: string;
  /** حساب منشا (هزینه/انتقال) یا مقصد واریز (درآمد) — الزامی */
  accountId: string;
  /** حساب مقصد انتقال — الزامی برای type=transfer */
  toAccountId: string;
  /** لیبل آزاد (زیردسته) — اختیاری؛ در صورت پر بودن ساخته/یافته می‌شود */
  label: string;
  /** دوره تکرار */
  repeat: TxRepeat;
  /** تاریخ پایان تکرار — الزامی وقتی repeat ≠ none ("۱۴۰۴/۰۶/۱۵") */
  repeatEnd: string;
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
  subcategories: Subcategory[] = [],
) {
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<TxFormState>(defaults());
  const [photos, setPhotos] = useState<TxPhotoItem[]>([]);
  const [busy, setBusy] = useState(false);
  /** ارز ورودی مبلغ — مستقل از ارز اصلی، همان لحظه ثبت */
  const [entryCurrency, setEntryCurrency] = useState<string>(currency);

  function defaults(): TxFormState {
    return {
      type: "expense",
      amount: "",
      categoryId: "", /* بدون دسته → گرید انتخاب دسته نمایش داده می‌شود */
      date: formatISO(today()),
      time: nowTime(),
      memberId: currentMemberId,
      note: "",
      accountId: "",
      toAccountId: "",
      label: "",
      repeat: "none",
      repeatEnd: "",
    };
  }

  function openNew() {
    setEditing(null);
    setForm(defaults());
    setPhotos([]);
    setEntryCurrency(currency);
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
      toAccountId: tx.toAccountId ?? "",
      label:
        subcategories.find((s) => s.id === tx.subcategoryId)?.name ?? "",
      repeat: tx.repeat,
      repeatEnd: tx.repeatEnd ? formatISO(isoToJalali(tx.repeatEnd)) : "",
    });
    setPhotos(
      tx.photos.map((p) => ({
        key: p.id,
        existing: { id: p.id, url: p.url, caption: p.caption },
        caption: p.caption ?? "",
      })),
    );
    setEntryCurrency(currency);
    setOpen(true);
  }

  function setType(type: "expense" | "income" | "transfer") {
    setForm((f) => ({
      ...f,
      type,
      /* انتقال دسته ثابت دارد؛ هزینه/درآمد دوباره از گرید انتخاب می‌شوند */
      categoryId: type === "transfer" ? defaultCategoryOf("transfer").id : "",
      label: "", /* دسته عوض شد — لیبل قبلی نامعتبر می‌شود */
    }));
  }

  /** تعویض ارز ورودی — مقدار تایپ‌شده (حتی عبارت ریاضی) به واحد جدید تبدیل می‌شود */
  function switchEntryCurrency(next: string) {
    const v = evaluateExpression(form.amount) ?? parseAmountInput(form.amount);
    setForm((f) => ({
      ...f,
      amount: v ? formatAmount(toDisplay(fromDisplay(v, entryCurrency), next)) : "",
    }));
    setEntryCurrency(next);
  }

  async function save(
    onDone: () => Promise<void>,
    accountsCount: number,
  ) {
    if (busy) return;
    /* مبلغ می‌تواند عبارت ریاضی باشد — همان‌جا ارزیابی می‌شود */
    const amount = evaluateExpression(form.amount) ?? parseAmountInput(form.amount);
    if (!amount || amount <= 0) return notify("لطفاً مبلغ معتبر وارد کنید");

    const isTransfer = form.type === "transfer";

    /* هزینه/درآمد بدون دسته مجاز نیست (گرید انتخاب دسته) */
    if (!isTransfer && !form.categoryId) {
      return notify("دسته‌بندی را انتخاب کنید");
    }

    /* حساب الزامی — با پیام دقیق */
    if (!form.accountId) {
      if (!accountsCount) {
        return notify(
          "هنوز هیچ کارت/حسابی ثبت نشده — ابتدا از تب «حساب‌ها» یک حساب اضافه کنید",
        );
      }
      return notify(
        isTransfer
          ? "حساب مبدأ را انتخاب کنید — انتقال از کدام حساب انجام شود؟"
          : form.type === "expense"
            ? "انتخاب حساب الزامی است — این هزینه از کدام حساب پرداخت شد؟"
            : "انتخاب حساب الزامی است — این درآمد به کدام حساب واریز شد؟",
      );
    }

    /* انتقال: مقصد الزامی و متفاوت از مبدأ */
    if (isTransfer) {
      if (!form.toAccountId) {
        return notify("حساب مقصد را انتخاب کنید — پول به کدام حساب/کیف‌پول برود؟");
      }
      if (form.toAccountId === form.accountId) {
        return notify("حساب مبدأ و مقصد نباید یکی باشد");
      }
    }

    /* تراکنش تکرارشونده حتماً تاریخ پایان معتبر دارد */
    const repeat = form.repeat;
    let repeatEndIso: string | null = null;
    if (repeat !== "none") {
      const parsedEnd = parse(form.repeatEnd);
      if (!parsedEnd) {
        return notify(
          "تاریخ پایان تکرار را انتخاب کنید — این تراکنش تا چه زمانی تکرار شود؟",
        );
      }
      const parsedDate = parse(form.date) ?? today();
      const endIso = jalaliToIso(parsedEnd);
      if (endIso < jalaliToIso(parsedDate)) {
        return notify("تاریخ پایان تکرار نمی‌تواند قبل از تاریخ تراکنش باشد");
      }
      repeatEndIso = endIso;
    }

    /* لیبل اختیاری → زیردسته (یافته یا ساخته می‌شود) */
    let subcategoryId: string | null = null;
    const label = form.label.trim();
    if (!isTransfer && label) {
      try {
        const sub = await useCases.addSubcategory.execute(
          form.categoryId,
          label,
        );
        subcategoryId = sub.id;
      } catch (e) {
        return notify((e as Error).message || "خطا در ثبت لیبل");
      }
    }

    const parsedDate = parse(form.date) ?? today();

    const input = {
      memberId: form.memberId || currentMemberId,
      type: form.type,
      amount: fromDisplay(amount, entryCurrency),
      category: isTransfer ? "transfer" : form.categoryId,
      date: jalaliToIso(parsedDate),
      time: form.time || null,
      note: form.note.trim() || null,
      accountId: form.accountId,
      toAccountId: isTransfer ? form.toAccountId : null,
      subcategoryId: isTransfer ? null : subcategoryId,
      repeat,
      repeatEnd: repeatEndIso,
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
    setAmount: (v: string) =>
      /* فقط ارقام و چهار عمل اصلی می‌مانند — پشتیبانی عبارت «۱۲+۵» */
      setForm((f) => ({
        ...f,
        amount: toFa(toEn(v).replace(/[^\d+\-×÷]/g, "")),
      })),
    setDate: (v: string) => setForm((f) => ({ ...f, date: liveFormatJalaliDate(v) })),
    setTime: (v: string) => setForm((f) => ({ ...f, time: v })),
    setRepeat: (v: TxRepeat) => setForm((f) => ({ ...f, repeat: v })),
    setRepeatEnd: (v: string) =>
      setForm((f) => ({ ...f, repeatEnd: liveFormatJalaliDate(v) })),
    /* ارز ورودی مبلغ */
    entryCurrency,
    switchEntryCurrency,
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
