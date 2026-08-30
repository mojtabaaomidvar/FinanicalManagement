/* مدل رسیدگی به پیامک‌های pending — کارت‌به‌کارت */

import { useState } from "react";
import type { BankSms } from "@/domain/sms/sms.types";
import type { UseCases } from "@/application/useCases";
import { smsDraftDefaults } from "@/domain/sms/sms.rules";
import { parseAmountInput, liveFormatJalaliDate } from "@/shared/lib/format";
import { parse, formatISO, today, jalaliToIso } from "@/shared/lib/jalali";
import { categoriesFor } from "@/domain/category/category.catalog";

export function usePendingSmsModel(
  useCases: UseCases,
  currentMemberId: string,
  notify: (m: string) => void,
) {
  const [list, setList] = useState<BankSms[]>([]);
  const [idx, setIdx] = useState(0);
  const [open, setOpen] = useState(false);

  const [type, setType] = useState<"expense" | "income">("expense");
  const [categoryId, setCategoryId] = useState("food");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [memberId, setMemberId] = useState(currentMemberId);

  async function load() {
    try {
      const pending = await useCases.listPendingSms.execute();
      if (!pending.length) return;
      setList(pending);
      setIdx(0);
      hydrate(pending[0]);
      setOpen(true);
    } catch {
      /* بی‌صدا رد شو */
    }
  }

  function hydrate(sms: BankSms) {
    const d = smsDraftDefaults(sms, currentMemberId);
    setType(d.type);
    setCategoryId(d.categoryId);
    setAmount(d.amount ? String(d.amount) : "");
    setDate(formatISO(d.jalaliDate));
    setMemberId(d.memberId);
  }

  function close() {
    setOpen(false);
  }

  async function record(onDone: () => Promise<void>) {
    const sms = list[idx];
    if (!sms) return;

    const amt = parseAmountInput(amount);
    if (!amt || amt <= 0) return notify("لطفاً مبلغ معتبر وارد کنید");

    const parsedDate = parse(date) ?? today();
    try {
      await useCases.recordSms.execute(sms, {
        memberId: memberId || currentMemberId,
        type,
        amount: amt,
        category: categoryId,
        date: jalaliToIso(parsedDate),
        note:
          (sms.bank ? sms.bank + " — " : "پیامک — ") +
          String(sms.rawText || "").slice(0, 50),
      });
      const next = idx + 1;
      if (next >= list.length) {
        close();
        notify("همه پیامک‌ها رسیدگی شدند");
      } else {
        setIdx(next);
        hydrate(list[next]);
      }
      await onDone();
    } catch (e) {
      notify((e as Error).message || "خطا در ثبت پیامک");
    }
  }

  async function ignore() {
    const sms = list[idx];
    if (!sms) return;
    try {
      await useCases.ignoreSms.execute(sms.id);
      const next = idx + 1;
      if (next >= list.length) {
        close();
        notify("همه پیامک‌ها رسیدگی شدند");
      } else {
        setIdx(next);
        hydrate(list[next]);
      }
    } catch (e) {
      notify((e as Error).message || "خطا");
    }
  }

  function changeType(t: "expense" | "income") {
    setType(t);
    setCategoryId(categoriesFor(t)[0].id);
  }

  return {
    list,
    idx,
    open,
    type,
    categoryId,
    amount,
    date,
    memberId,
    setCategoryId,
    setMemberId,
    setAmount,
    changeType,
    setDate: (v: string) => setDate(liveFormatJalaliDate(v)),
    load,
    close,
    record,
    ignore,
    raw: list[idx]?.rawText ?? "",
  };
}
