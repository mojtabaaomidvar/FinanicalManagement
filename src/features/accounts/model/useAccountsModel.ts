/* مدل مشترک کارت‌ها و کیف‌پول‌ها — تنها منبع منطق برای صفحه «کیف پول‌ها»
   و زیرصفحه‌ی تنظیمات. هر دو محل همین هوک را صدا می‌زنند تا داده و
   رفتارشان همیشه یکی باشد (قبلاً دو پیاده‌سازی جدا و ناهمگون بودند). */

import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { useHoldings } from "@/features/holdings";
import { bankOfCard, cardMatchesBank } from "@/shared/lib/banks";
import { digitsOf, formatCardFa, parseAccountBalance } from "@/domain/account/account.rules";
import type { Account, AccountKind } from "@/domain/account/account.types";
import { accountBalances } from "@/domain/report/report.rules";
import { balanceAdjustCategory } from "@/domain/category/category.catalog";
import { formatAmount, nowTime } from "@/shared/lib/format";
import { toDisplay } from "@/shared/lib/currency";
import { MAX_AMOUNT } from "@/domain/transaction/transaction.rules";
import { jalaliToIso, today } from "@/shared/lib/jalali";

export const WALLET_PRESETS = [
  "کیف پول نقدی",
  "پس‌انداز",
  "هزینه سفر",
  "پروژه خاص",
];

/** حالت فرم — مشترک بین افزودن و ویرایش */
interface FormState {
  kind: AccountKind;
  title: string;
  bank: string;
  cardNo: string;
  /** رشته‌ی نمایشی فارسی و بدون علامت؛ در افزودن = موجودی اولیه، در ویرایش = موجودی فعلی */
  balance: string;
  /** علامت موجودی جدا نگه داشته می‌شود چون ورودی مبلغ فقط رقم می‌پذیرد
      (parseAmountInput هر چیز غیر رقم را حذف می‌کند و منها گم می‌شد) */
  negative: boolean;
}

const EMPTY: FormState = {
  kind: "bank",
  title: "",
  bank: "",
  cardNo: "",
  balance: "",
  negative: false,
};

export function useAccountsModel() {
  const { useCases, accounts, members, member, txs, cur, refreshData } =
    useApp();
  const { show } = useToast();

  const [open, setOpen] = useState(false);
  /* null = افزودن، Account = ویرایش همان حساب */
  const [editing, setEditing] = useState<Account | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const smsWriting = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reviewedBalance, setReviewedBalance] = useState<number | null>(null);
  /* تأیید صریح کاربر برای تغییر دستی موجودی */
  const [balanceAck, setBalanceAck] = useState(false);
  const [balanceTouched, setBalanceTouched] = useState(false);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  /* کلید تشخیص تراکنش از پیامک — وضعیتش از خود حساب می‌آید و مودال فقط
     آینه‌ی آن است. از فرم جدا نگه داشته می‌شود چون «ذخیره»ی فرم نباید
     رضایت بسازد یا لغو کند؛ هر بار زدن کلید یک تصمیم مستقل است. */
  const [smsOn, setSmsOn] = useState(false);
  const [smsBusy, setSmsBusy] = useState(false);
  /* کلید پیامک عوض شده و فهرست حساب‌ها هنوز کهنه است؟
     عمداً ref است نه state: نباید رندر بدهد، فقط باید یادمان بماند که
     هنگام بستن مودال یک‌بار داده را تازه کنیم. */
  const smsDirty = useRef(false);

  /* موجودی هر حساب = موجودی اولیه + اثر تراکنش‌ها */
  const balances = useMemo(
    () => accountBalances(txs, accounts),
    [txs, accounts],
  );
  const balanceOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of balances) m.set(b.account.id, b.balance);
    return m;
  }, [balances]);

  /* جمع نقد حساب‌ها و کیف‌پول‌ها — همان چیزی که نمودار روند رسم می‌کند */
  const cashWealth = useMemo(
    () => balances.reduce((s, b) => s + b.balance, 0),
    [balances],
  );

  /* ارزش امروز دارایی‌های بازاری (طلا/ارز/رمزارز/سهم).
     سرور همیشه تومان برمی‌گرداند، یعنی همان واحد پایه‌ی balance‌ها، پس
     جمعشان مستقیم درست است و toDisplay یک‌بار روی حاصل اعمال می‌شود. */
  const holdings = useHoldings();

  /* ⚠️ ناسازگاری عمدی — عدد و نمودار از دو منبع متفاوت‌اند:

     «دارایی کل» = نقد + ارزش امروز دارایی‌های بازاری
     «نمودار روند» = فقط نقد (از روی تاریخچه‌ی تراکنش‌ها)

     دلیل: از قیمت‌ها هیچ تاریخچه‌ای ذخیره نمی‌کنیم، فقط قیمت همین لحظه
     را داریم. برای رسم نمودار درست باید می‌دانستیم دو ماه پیش سکه چند
     بود؛ نداریم. تنها جایگزین‌ها این بود که قیمت امروز را به کل گذشته
     تعمیم دهیم (نموداری بسازد که هرگز اتفاق نیفتاده) یا دارایی‌ها را از
     عدد کل هم بیرون بگذاریم (عددی که کاربر می‌داند غلط است). این گزینه
     انتخاب صریح کاربر بود: «در عدد بله، در نمودار نه».

     پس اگر روزی نمودار با عدد بالای همان کارت جور در نیامد، این باگ
     نیست. با ذخیره‌ی اسنپ‌شات روزانه‌ی قیمت می‌شود درستش کرد. */
  const totalWealth = cashWealth + holdings.total;

  const banks = balances.filter((b) => b.account.kind !== "wallet");
  const wallets = balances.filter((b) => b.account.kind === "wallet");

  /** آیا این کاربر اجازه‌ی ویرایش/حذف این حساب را دارد؟
      مدیر خانواده همه را، عضو عادی فقط حساب‌های خودش را. */
  function canEdit(acc: Account): boolean {
    return member?.role === "owner" || member?.role === "admin" || acc.memberId === member?.id;
  }

  /* خطای هم‌خوانی کارت با بانک — زنده هنگام تایپ */
  const binError = useMemo(() => {
    const digits = digitsOf(form.cardNo);
    if (
      digits.length < 6 ||
      !form.bank ||
      form.bank === "سایر" ||
      form.kind === "wallet"
    ) {
      return "";
    }
    if (!cardMatchesBank(digits, form.bank)) {
      return `این شماره کارت متعلق به «${bankOfCard(digits) ?? "بانک دیگری"}» است، نه «${form.bank}»`;
    }
    return "";
  }, [form.cardNo, form.bank, form.kind]);

  /* موجودی فعلی حساب در حال ویرایش، به واحد پایه */
  const editingBalance = editing ? (reviewedBalance ?? balanceOf.get(editing.id) ?? 0) : 0;
  const parsedBalance = parseAccountBalance(form.balance, cur);
  const targetBalance = parsedBalance === null ? null : form.negative ? -parsedBalance : parsedBalance;

  /** کاربر عدد موجودی را دست زده؟ — تعیین‌کننده‌ی نمایش هشدار
      مقایسه با علامت انجام می‌شود؛ وگرنه موجودی منفی همان لحظه‌ی
      باز شدن فرم «تغییر کرده» به نظر می‌رسید و ذخیره آن را مثبت می‌کرد. */
  const balanceChanged = useMemo(() => {
    if (!editing || !balanceTouched || targetBalance === null) return false;
    return targetBalance !== editingBalance;
  }, [editing, targetBalance, editingBalance, balanceTouched]);

  /* اگر کاربر عدد را به مقدار اولیه برگرداند، تأیید قبلی باید باطل شود */
  useEffect(() => {
    if (!balanceChanged && balanceAck) setBalanceAck(false);
  }, [balanceChanged, balanceAck]);

  function openNew(kind: AccountKind, title = "") {
    if (writing.current || smsWriting.current) return;
    setNotice(null);
    setReviewedBalance(null);
    setEditing(null);
    setForm({ ...EMPTY, kind, title });
    setBalanceAck(false);
    setBalanceTouched(false);
    /* حساب تازه هنوز شناسه‌ای ندارد، پس کلید پیامک اینجا معنا ندارد */
    setSmsOn(false);
    setOpen(true);
  }

  function openEdit(acc: Account) {
    if (writing.current || smsWriting.current || !canEdit(acc)) return;
    setNotice(null);
    setReviewedBalance(null);
    /* موجودی فعلی (نه اولیه) — چیزی که کاربر روی کارت می‌بیند.
       با ارقام فارسی و جداکنندهٔ هزار، مثل بقیه‌ی فیلدهای مبلغ. */
    const shown = Math.round(toDisplay(balanceOf.get(acc.id) ?? 0, cur));
    setEditing(acc);
    setForm({
      kind: acc.kind,
      title: acc.title,
      bank: acc.bank ?? "",
      cardNo: acc.cardNumber ?? "",
      balance: shown === 0 ? "" : formatAmount(shown),
      negative: (balanceOf.get(acc.id) ?? 0) < 0,
    });
    setBalanceAck(false);
    setBalanceTouched(false);
    setSmsOn(acc.smsEnabled);
    setOpen(true);
  }

  function close() {
    if (writing.current || smsWriting.current) return;
    finishClose();
  }

  function finishClose() {
    setOpen(false);
    setEditing(null);
    setBalanceAck(false);
    setBalanceTouched(false);
    setSmsOn(false);
    /* اگر کلید پیامک عوض شده بود، تازه‌سازی تا همین‌جا عقب انداخته شده.
       چرا نه همان لحظه‌ی زدن کلید: refreshData موجودی‌ها را از نو می‌سازد،
       ولی فیلدِ «موجودی فعلی»ِ فرم دوباره پر نمی‌شود. پس اگر عضو دیگری
       همان لحظه تراکنشی ثبت کرده باشد، عدد داخل فرم ناگهان «تغییر کرده»
       به نظر می‌رسد و «ذخیره» یک تراکنشِ «تغییر دستی موجودی» می‌سازد که
       تراکنش آن عضو را بی‌صدا خنثی می‌کند. */
    if (smsDirty.current) {
      smsDirty.current = false;
      void refreshData();
    }
  }

  /** تغییر علامت موجودی (فقط در حالت ویرایش معنا دارد) */
  function setNegative(v: boolean) {
    if (writing.current || smsWriting.current) return;
    setBalanceTouched(true);
    setBalanceAck(false);
    setNotice(null);
    setForm((f) => ({ ...f, negative: v }));
  }

  function patch(p: Partial<FormState>) {
    if (writing.current || smsWriting.current) return;
    setNotice(null);
    if (p.balance !== undefined) {
      setBalanceTouched(true);
      setBalanceAck(false);
    }
    setForm((f) => ({ ...f, ...p }));
  }

  /** روشن/خاموش کردن تشخیص تراکنش از پیامک — فقط برای همین حساب.
      بی‌درنگ ذخیره می‌شود (نه با «ذخیره»ی فرم): رضایت کاربر یک تصمیم
      مستقل است و نباید عارضه‌ی جانبیِ ویرایش عنوان یا ساختن حساب شود.
      به همین دلیل «انصراف» هم آن را برنمی‌گرداند. */
  async function toggleSms(next: boolean) {
    const acc = editing;
    if (!useCases || !acc || acc.kind !== "bank" || writing.current || smsWriting.current) return;
    smsWriting.current = true;
    setSmsBusy(true);
    try {
      const updated = await useCases.setAccountSmsEnabled.execute(acc, next);
      /* هرچه سرور گفت همان نمایش داده می‌شود، نه آنچه کاربر کلیک کرد */
      setSmsOn(updated.smsEnabled);
      show(
        updated.smsEnabled
          ? "تشخیص از پیامک برای این حساب روشن شد"
          : "تشخیص از پیامک برای این حساب خاموش شد",
      );
      /* تازه‌سازی به «بستن مودال» موکول می‌شود تا موجودیِ زیرِ دستِ کاربر
         وسطِ کار عوض نشود — توضیح کامل در close */
      smsDirty.current = true;
    } catch (e) {
      show((e as Error).message || "خطا در تغییر وضعیت پیامک");
    } finally {
      smsWriting.current = false;
      setSmsBusy(false);
    }
  }

  /** تغییر شماره کارت + تشخیص خودکار بانک از ۶ رقم اول */
  function setCardNo(v: string) {
    if (writing.current || smsWriting.current) return;
    setNotice(null);
    const digits = digitsOf(v);
    const detected = bankOfCard(digits);
    setForm((f) => ({
      ...f,
      cardNo: digits,
      bank: detected ?? f.bank,
    }));
  }

  async function save() {
    if (!useCases || !open || writing.current || smsWriting.current) return;
    if (binError) return notify(binError);
    if (targetBalance === null) return notify("موجودی معتبر وارد کنید");

    /* تغییر موجودی تراکنش اصلاحی می‌سازد و نیاز به تأیید همان مبلغ دارد. */
    if (editing && balanceChanged && !balanceAck) {
      return notify("تأیید تغییر موجودی را بزنید");
    }

    writing.current = true;
    setBusy(true);
    setNotice(null);
    let metadataSaved = false;
    let committed = false;
    try {
      if (editing) {
        let delta = targetBalance - editingBalance;
        if (balanceChanged) {
          const [freshAccounts, freshTransactions] = await Promise.all([
            useCases.listAccounts.execute(),
            useCases.listTransactions.execute(),
          ]);
          if (!freshAccounts.some(account => account.id === editing.id)) {
            return notify("این حساب در دسترس نیست؛ فهرست حساب‌ها را تازه کنید");
          }
          const current = accountBalances(freshTransactions, freshAccounts).find(row => row.account.id === editing.id)!.balance;
          if (current !== editingBalance) {
            setReviewedBalance(current);
            setBalanceAck(false);
            return notify("موجودی حساب تغییر کرده؛ مبلغ اصلاح را دوباره بررسی و تأیید کنید");
          }
          delta = targetBalance - current;
          if (Math.abs(delta) > MAX_AMOUNT) return notify("مبلغ اصلاح موجودی از سقف مجاز تراکنش بیشتر است");
        }
        /* فیلدهای متنی حساب ذخیره می‌شوند؛ «موجودی اولیه» دست نمی‌خورد.
           تغییر موجودی دیگر initialBalance را بازنویسی نمی‌کند — به‌جایش
           یک تراکنش «تغییر دستی موجودی» به تاریخ/ساعت همین لحظه ثبت
           می‌شود تا در فهرست تراکنش‌ها، گزارش‌ها و موجودی دیده شود. چون
           موجودی = اولیه + اثر تراکنش‌ها، افزودن تراکنشی به‌اندازهٔ تفاوت،
           موجودی را دقیقاً به عدد هدف می‌رساند. */
        await useCases.updateAccount.execute({
          id: editing.id,
          kind: editing.kind,
          title: form.title.trim(),
          bank: editing.kind === "bank" ? form.bank || null : null,
          cardNumber:
            editing.kind === "bank" ? form.cardNo.trim() || null : null,
        });
        metadataSaved = true;

        if (balanceChanged) {
          /* هدف به واحد پایه تبدیل می‌شود؛ گردکردن ماندهٔ فعلی، بخشی از
             موجودی منفی اعشاری را پس از اصلاح در حساب باقی می‌گذارد. */
          if (delta !== 0) {
            await useCases.addTransaction.execute({
              memberId: editing.memberId || member?.id || "",
              type: delta >= 0 ? "income" : "expense",
              amount: Math.abs(delta),
              category: balanceAdjustCategory(delta),
              date: jalaliToIso(today()),
              time: nowTime(),
              accountId: editing.id,
              note: null,
            });
          }
        }
      } else {
        await useCases.addAccount.execute({
          memberId: member?.id || "",
          title: form.title.trim(),
          kind: form.kind,
          bank: form.kind === "bank" ? form.bank || null : null,
          cardNumber: form.kind === "bank" ? form.cardNo.trim() || null : null,
          initialBalance: targetBalance,
        });
      }
      committed = true;
      show(editing ? "ذخیره شد" : form.kind === "wallet" ? "کیف‌پول اضافه شد" : "حساب بانکی اضافه شد");
      /* این مسیر خودش تازه‌سازی می‌کند؛ پرچم پاک می‌شود تا close دوباره نکند */
      smsDirty.current = false;
      finishClose();
      await refreshData();
    } catch (e) {
      if (committed) show("حساب ذخیره شد؛ اطلاعات صفحه تازه نشد. صفحه را بازخوانی کنید");
      else if (metadataSaved) notify("اطلاعات حساب ذخیره شد، اما اصلاح موجودی انجام نشد؛ دوباره تلاش کنید");
      else notify((e as Error).message || "خطا در ذخیره");
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  async function remove(acc: Account) {
    if (!useCases || writing.current || smsWriting.current || !canEdit(acc)) return;
    if (!confirm(`«${acc.title}» حذف شود؟`)) return;
    writing.current = true;
    setBusy(true);
    let deleted = false;
    try {
      await useCases.deleteAccount.execute(acc.id);
      deleted = true;
      show("حذف شد");
      await refreshData();
    } catch (e) {
      show(deleted ? "حساب حذف شد؛ اطلاعات صفحه تازه نشد. صفحه را بازخوانی کنید" : (e as Error).message || "خطا در حذف");
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  function notify(message: string) {
    setNotice(message);
  }

  function toggleReveal(id: string) {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return {
    /* داده */
    accounts,
    members,
    member,
    cur,
    balances,
    banks,
    wallets,
    cashWealth,
    totalWealth,
    holdings,
    balanceOf,
    canEdit,
    /* نمایش شماره کارت */
    revealed,
    toggleReveal,
    cardText: (acc: Account) =>
      acc.cardNumber ? formatCardFa(acc.cardNumber) : "",
    /* فرم */
    open,
    editing,
    form,
    patch,
    setCardNo,
    binError,
    busy,
    locked: busy || smsBusy,
    notice,
    /* کلید تشخیص از پیامک */
    smsOn,
    smsBusy,
    toggleSms,
    balanceChanged,
    editingBalance,
    balanceAck,
    setBalanceAck,
    setNegative,
    openNew,
    openEdit,
    close,
    save,
    remove,
  };
}

export type AccountsModel = ReturnType<typeof useAccountsModel>;
