/* مدل زیرصفحه‌ی «تشخیص تراکنش از پیامک» — اجازه‌ها، نه پیامک‌ها.

   این هوک هیچ پیامکی نمی‌خواند و هیچ تراکنشی ثبت نمی‌کند؛ فقط سه چیز را
   اداره می‌کند: کدام حساب زیر نظر است، کدام فرستنده به کدام حساب بسته
   شده، و کدام شماره‌ی موبایل «منبع مجاز» است.

   قاعده‌ی حاکم: هیچ‌جا حساب یا کارتی ساخته نمی‌شود. کاربر فقط از میان
   حساب‌هایی انتخاب می‌کند که از قبل در خانه‌یار ثبت کرده است. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import type { Account } from "@/domain/account/account.types";
import type { SmsNumber, SmsSender } from "@/domain/sms/sms-settings.types";

/** جای‌گذاری ردیف بر اساس id (نبود → افزودن به ته فهرست).
    لازم است چون افزودنِ فرستنده و شماره روی سرور idempotent است: اگر همان
    مقدار از قبل ثبت شده باشد، ردیفِ موجود برگردانده می‌شود نه ردیفِ نو. */
function upsertById<T extends { id: string }>(list: T[], row: T): T[] {
  return list.some((x) => x.id === row.id)
    ? list.map((x) => (x.id === row.id ? row : x))
    : [...list, row];
}

export function useSmsSettingsModel() {
  const { useCases, accounts, member, refreshData } = useApp();
  const { show } = useToast();

  const [senders, setSenders] = useState<SmsSender[]>([]);
  const [numbers, setNumbers] = useState<SmsNumber[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  /* قفل سراسریِ نوشتن: تا پاسخ یک درخواست نیامده هیچ تغییر دیگری شروع
     نمی‌شود، چون هر تغییر ممکن است refreshData را هم صدا بزند و دو
     تازه‌سازیِ هم‌زمان ترتیب را به‌هم می‌ریزد. مقدارش شناسه‌ی ردیفِ درگیر
     است تا UI بتواند «کدام ردیف» را در حال کار نشان دهد. */
  const [busyId, setBusyId] = useState<string | null>(null);

  /* فرم افزودن فرستنده — مقدارش شناسه‌ی حسابی است که فرم برایش باز است */
  const [senderFor, setSenderFor] = useState<string | null>(null);
  const [senderText, setSenderText] = useState("");

  /* فرم افزودن شماره‌ی مجاز */
  const [numberOpen, setNumberOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [label, setLabel] = useState("");

  /* کیف‌پول عمداً بیرون است: پیامک بانکی ندارد و کلید برایش معنا هم ندارد.
     شرط «مثبت» نوشته شده (=== bank) نه منفی (!== wallet)، چون نگهبان‌های
     پایین‌دست — یوزکیس و سرویسِ سرور — هر دو مثبت‌اند. اگر روزی نوعِ سومی
     اضافه شود، با شرطِ منفی در فهرست ظاهر می‌شد و کلیدش خطای سرور می‌گرفت. */
  const bankAccounts = useMemo(
    () => accounts.filter((a) => a.kind === "bank"),
    [accounts],
  );

  const enabledCount = useMemo(
    () => bankAccounts.filter((a) => a.smsEnabled).length,
    [bankAccounts],
  );

  /* فرستنده‌های هر حساب — یک‌بار گروه می‌شوند تا هر ردیف filter نزند */
  const sendersOf = useMemo(() => {
    const m = new Map<string, SmsSender[]>();
    for (const s of senders) {
      const list = m.get(s.accountId);
      if (list) list.push(s);
      else m.set(s.accountId, [s]);
    }
    return m;
  }, [senders]);

  const load = useCallback(async () => {
    if (!useCases) return;
    try {
      const [s, n] = await Promise.all([
        useCases.listSmsSenders.execute(),
        useCases.listSmsNumbers.execute(),
      ]);
      setSenders(s);
      setNumbers(n);
      /* فقط در مسیر موفق «بارگذاری‌شده» می‌شود. اگر در finally بود، خطای
         شبکه هم loaded=true می‌کرد و صفحه به‌دروغ «هیچ شماره‌ای ثبت نشده»
         نشان می‌داد — یعنی نبودِ داده با نیامدنِ داده یکی گرفته می‌شد. */
      setLoadError(null);
      setLoaded(true);
    } catch (e) {
      setLoadError((e as Error).message || "خطا در خواندن تنظیمات پیامک");
    }
  }, [useCases]);

  useEffect(() => {
    void load();
  }, [load]);

  /** روشن/خاموش کردن تشخیص برای یک حساب — همان یوزکیسی که فرم ویرایش
      حساب هم صدا می‌زند، پس قاعده‌ی «کیف‌پول نه» یک‌جا نگه‌داری می‌شود. */
  async function toggleAccount(acc: Account, next: boolean) {
    if (!useCases || busyId) return;
    setBusyId(acc.id);
    try {
      await useCases.setAccountSmsEnabled.execute(acc, next);
      /* فهرست حساب‌ها منبعِ وضعیتِ کلید است، پس اول باید تازه شود و بعد
         پیام موفقیت داده شود؛ وگرنه اگر تازه‌سازی شکست بخورد کاربر «روشن
         شد» می‌بیند در حالی که کلید هنوز خاموش نشان داده می‌شود. */
      await refreshData();
      show(
        next
          ? `تشخیص از پیامک برای «${acc.title}» روشن شد`
          : `تشخیص از پیامک برای «${acc.title}» خاموش شد`,
      );
    } catch (e) {
      show((e as Error).message || "خطا در تغییر وضعیت");
    } finally {
      setBusyId(null);
    }
  }

  /** پاک‌کردن کل تنظیمات پیامکِ یک حساب — خود حساب و تراکنش‌ها دست‌نخورده */
  async function resetAccount(acc: Account) {
    if (!useCases || busyId) return;
    if (
      !confirm(
        `تنظیمات پیامکِ «${acc.title}» پاک شود؟ کلید خاموش و فرستنده‌های مجازش حذف می‌شوند. خود حساب و تراکنش‌ها دست‌نخورده می‌مانند.`,
      )
    ) {
      return;
    }
    setBusyId(acc.id);
    try {
      await useCases.resetAccountSms.execute(acc.id);
      setSenders((prev) => prev.filter((s) => s.accountId !== acc.id));
      await refreshData();
      show("تنظیمات پیامک این حساب پاک شد");
    } catch (e) {
      show((e as Error).message || "خطا در پاک‌کردن تنظیمات");
    } finally {
      setBusyId(null);
    }
  }

  function openSenderForm(accountId: string) {
    setSenderFor(accountId);
    setSenderText("");
  }

  function closeSenderForm() {
    setSenderFor(null);
    setSenderText("");
  }

  async function addSender() {
    if (!useCases || !senderFor || busyId) return;
    setBusyId(senderFor);
    try {
      const row = await useCases.addSmsSender.execute(senderFor, senderText);
      /* پاسخِ سرور جای متنِ تایپ‌شده می‌نشیند، نه در کنارش: نرمال‌سازی سمت
         سرور انجام می‌شود و باید همان چیزی دیده شود که مقایسه می‌شود. و
         چون افزودن روی سرور idempotent است و ردیفِ موجود را برمی‌گرداند،
         با append ساده یک چیپِ تکراری با همان id ساخته می‌شد. */
      setSenders((prev) => upsertById(prev, row));
      closeSenderForm();
      show("فرستنده‌ی مجاز اضافه شد");
    } catch (e) {
      show((e as Error).message || "خطا در افزودن فرستنده");
    } finally {
      setBusyId(null);
    }
  }

  async function removeSender(s: SmsSender) {
    if (!useCases || busyId) return;
    if (!confirm(`فرستنده‌ی «${s.sender}» از فهرست مجاز حذف شود؟`)) return;
    setBusyId(s.id);
    try {
      await useCases.removeSmsSender.execute(s.id);
      setSenders((prev) => prev.filter((x) => x.id !== s.id));
      show("حذف شد");
    } catch (e) {
      show((e as Error).message || "خطا در حذف فرستنده");
    } finally {
      setBusyId(null);
    }
  }

  function openNumberForm() {
    setNumberOpen(true);
    setPhone("");
    setLabel("");
  }

  function closeNumberForm() {
    setNumberOpen(false);
    setPhone("");
    setLabel("");
  }

  async function addNumber() {
    if (!useCases || busyId) return;
    setBusyId("new-number");
    try {
      const row = await useCases.addSmsNumber.execute({ phone, label });
      /* مثل فرستنده‌ها: سرور idempotent است و ممکن است ردیفِ موجود را
         برگرداند، پس جای append از upsert استفاده می‌شود */
      setNumbers((prev) => upsertById(prev, row));
      closeNumberForm();
      show("شماره به فهرست منابع مجاز اضافه شد");
    } catch (e) {
      show((e as Error).message || "خطا در افزودن شماره");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleNumber(n: SmsNumber, next: boolean) {
    if (!useCases || busyId) return;
    setBusyId(n.id);
    try {
      const row = await useCases.setSmsNumberActive.execute(n.id, next);
      setNumbers((prev) => prev.map((x) => (x.id === row.id ? row : x)));
    } catch (e) {
      show((e as Error).message || "خطا در تغییر وضعیت شماره");
    } finally {
      setBusyId(null);
    }
  }

  async function removeNumber(n: SmsNumber) {
    if (!useCases || busyId) return;
    if (!confirm(`شماره‌ی ${n.phone} از فهرست منابع مجاز حذف شود؟`)) return;
    setBusyId(n.id);
    try {
      await useCases.removeSmsNumber.execute(n.id);
      setNumbers((prev) => prev.filter((x) => x.id !== n.id));
      show("حذف شد");
    } catch (e) {
      show((e as Error).message || "خطا در حذف شماره");
    } finally {
      setBusyId(null);
    }
  }

  return {
    /* داده */
    bankAccounts,
    enabledCount,
    sendersOf,
    numbers,
    /** شماره‌ی ثبت‌نام — منبع پیش‌فرض و همیشگی (بند ۷)؛ افزودنی نیست */
    primaryPhone: member?.phone ?? null,
    loaded,
    loadError,
    reload: load,
    busyId,
    /* حساب‌ها */
    toggleAccount,
    resetAccount,
    /* فرستنده‌ها */
    senderFor,
    senderText,
    setSenderText,
    openSenderForm,
    closeSenderForm,
    addSender,
    removeSender,
    /* شماره‌ها */
    numberOpen,
    phone,
    setPhone,
    label,
    setLabel,
    openNumberForm,
    closeNumberForm,
    addNumber,
    toggleNumber,
    removeNumber,
  };
}

export type SmsSettingsModel = ReturnType<typeof useSmsSettingsModel>;
