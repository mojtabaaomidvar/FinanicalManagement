/* مدل مشترک کارت‌ها و کیف‌پول‌ها — تنها منبع منطق برای صفحه «کیف پول‌ها»
   و زیرصفحه‌ی تنظیمات. هر دو محل همین هوک را صدا می‌زنند تا داده و
   رفتارشان همیشه یکی باشد (قبلاً دو پیاده‌سازی جدا و ناهمگون بودند). */

import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { useHoldings } from "@/features/holdings";
import { bankOfCard, cardMatchesBank } from "@/shared/lib/banks";
import { digitsOf, formatCardFa } from "@/domain/account/account.rules";
import type { Account, AccountKind } from "@/domain/account/account.types";
import { accountBalances } from "@/domain/report/report.rules";
import { balanceAdjustCategory } from "@/domain/category/category.catalog";
import { formatAmount, nowTime, parseAmountInput } from "@/shared/lib/format";
import { fromDisplay, toDisplay } from "@/shared/lib/currency";
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

/** مقدار عددی فیلد موجودی با علامت، در واحد نمایش */
function signedAmount(f: FormState): number {
  const n = parseAmountInput(f.balance);
  return f.negative ? -n : n;
}

export function useAccountsModel() {
  const { useCases, accounts, members, member, txs, cur, refreshData } =
    useApp();
  const { show } = useToast();

  const [open, setOpen] = useState(false);
  /* null = افزودن، Account = ویرایش همان حساب */
  const [editing, setEditing] = useState<Account | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  /* تأیید صریح کاربر برای تغییر دستی موجودی */
  const [balanceAck, setBalanceAck] = useState(false);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

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

  /* جمعِ نقدِ حساب‌ها و کیف‌پول‌ها — همان چیزی که نمودارِ روند رسم می‌کند */
  const cashWealth = useMemo(
    () => balances.reduce((s, b) => s + b.balance, 0),
    [balances],
  );

  /* ارزشِ امروزِ دارایی‌های بازاری (طلا/ارز/رمزارز/سهم).
     سرور همیشه تومان برمی‌گرداند، یعنی همان واحدِ پایه‌ی balance‌ها، پس
     جمعشان مستقیم درست است و toDisplay یک‌بار روی حاصل اعمال می‌شود. */
  const holdings = useHoldings();

  /* ⚠️ ناسازگاریِ عمدی — عدد و نمودار از دو منبعِ متفاوت‌اند:

     «دارایی کل» = نقد + ارزشِ امروزِ دارایی‌های بازاری
     «نمودارِ روند» = فقط نقد (از روی تاریخچه‌ی تراکنش‌ها)

     دلیل: از قیمت‌ها هیچ تاریخچه‌ای ذخیره نمی‌کنیم، فقط قیمتِ همین لحظه
     را داریم. برای رسمِ نمودارِ درست باید می‌دانستیم دو ماهِ پیش سکه چند
     بود؛ نداریم. تنها جایگزین‌ها این بود که قیمتِ امروز را به کلِ گذشته
     تعمیم دهیم (نموداری بسازد که هرگز اتفاق نیفتاده) یا دارایی‌ها را از
     عددِ کل هم بیرون بگذاریم (عددی که کاربر می‌داند غلط است). این گزینه
     انتخابِ صریحِ کاربر بود: «در عدد بله، در نمودار نه».

     پس اگر روزی نمودار با عددِ بالای همان کارت جور در نیامد، این باگ
     نیست. با ذخیره‌ی اسنپ‌شاتِ روزانه‌ی قیمت می‌شود درستش کرد. */
  const totalWealth = cashWealth + holdings.total;

  const banks = balances.filter((b) => b.account.kind !== "wallet");
  const wallets = balances.filter((b) => b.account.kind === "wallet");

  /** آیا این کاربر اجازه‌ی ویرایش/حذف این حساب را دارد؟
      مدیر خانواده همه را، عضو عادی فقط حساب‌های خودش را. */
  function canEdit(acc: Account): boolean {
    return member?.role === "owner" || acc.memberId === member?.id;
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

  /* موجودی فعلی حسابِ در حال ویرایش، به واحد نمایش */
  const editingBalance = editing ? (balanceOf.get(editing.id) ?? 0) : 0;

  /** کاربر عدد موجودی را دست زده؟ — تعیین‌کننده‌ی نمایش هشدار
      مقایسه با علامت انجام می‌شود؛ وگرنه موجودی منفی همان لحظه‌ی
      باز شدن فرم «تغییر کرده» به نظر می‌رسید و ذخیره آن را مثبت می‌کرد. */
  const balanceChanged = useMemo(() => {
    if (!editing) return false;
    return signedAmount(form) !== Math.round(toDisplay(editingBalance, cur));
  }, [editing, form, editingBalance, cur]);

  /* اگر کاربر عدد را به مقدار اولیه برگرداند، تأیید قبلی باید باطل شود */
  useEffect(() => {
    if (!balanceChanged && balanceAck) setBalanceAck(false);
  }, [balanceChanged, balanceAck]);

  function openNew(kind: AccountKind, title = "") {
    setEditing(null);
    setForm({ ...EMPTY, kind, title });
    setBalanceAck(false);
    setOpen(true);
  }

  function openEdit(acc: Account) {
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
      negative: shown < 0,
    });
    setBalanceAck(false);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setEditing(null);
    setBalanceAck(false);
  }

  /** تغییر علامت موجودی (فقط در حالت ویرایش معنا دارد) */
  function setNegative(v: boolean) {
    setForm((f) => ({ ...f, negative: v }));
  }

  function patch(p: Partial<FormState>) {
    setForm((f) => ({ ...f, ...p }));
  }

  /** تغییر شماره کارت + تشخیص خودکار بانک از ۶ رقم اول */
  function setCardNo(v: string) {
    const digits = v.replace(/[^\d۰-۹]/g, "");
    const detected = bankOfCard(digits);
    setForm((f) => ({
      ...f,
      cardNo: digits,
      bank: detected ?? f.bank,
    }));
  }

  async function save() {
    if (binError) return show(binError);

    /* ویرایش موجودی باید صریحاً تأیید شود — تغییرش تراکنش نمی‌سازد */
    if (editing && balanceChanged && !balanceAck) {
      return show("تأیید تغییر موجودی را بزنید");
    }

    setBusy(true);
    try {
      if (editing) {
        /* فیلدهای متنی حساب ذخیره می‌شوند؛ «موجودی اولیه» دست نمی‌خورد.
           تغییرِ موجودی دیگر initialBalance را بازنویسی نمی‌کند — به‌جایش
           یک تراکنش «تغییر دستی موجودی» به تاریخ/ساعتِ همین لحظه ثبت
           می‌شود تا در فهرست تراکنش‌ها، گزارش‌ها و موجودی دیده شود. چون
           موجودی = اولیه + اثر تراکنش‌ها، افزودن تراکنشی به‌اندازهٔ تفاوت،
           موجودی را دقیقاً به عددِ هدف می‌رساند. */
        await useCases!.updateAccount.execute({
          id: editing.id,
          kind: editing.kind,
          title: form.title.trim(),
          bank: editing.kind === "bank" ? form.bank || null : null,
          cardNumber:
            editing.kind === "bank" ? form.cardNo.trim() || null : null,
        });

        if (balanceChanged) {
          /* تفاوت در واحدِ نمایش گرفته می‌شود تا با آنچه کاربر می‌بیند مو
             نزند، بعد به واحد پایه تبدیل می‌شود. */
          const currentDisplay = Math.round(toDisplay(editingBalance, cur));
          const deltaDisplay = signedAmount(form) - currentDisplay;
          if (deltaDisplay !== 0) {
            await useCases!.addTransaction.execute({
              memberId: editing.memberId || member?.id || "",
              type: deltaDisplay >= 0 ? "income" : "expense",
              amount: fromDisplay(Math.abs(deltaDisplay), cur),
              category: balanceAdjustCategory(deltaDisplay),
              date: jalaliToIso(today()),
              time: nowTime(),
              accountId: editing.id,
              note: null,
            });
          }
        }
        show("ذخیره شد");
      } else {
        await useCases!.addAccount.execute({
          memberId: member?.id || "",
          title: form.title.trim(),
          kind: form.kind,
          bank: form.kind === "bank" ? form.bank || null : null,
          cardNumber: form.kind === "bank" ? form.cardNo.trim() || null : null,
          initialBalance: fromDisplay(parseAmountInput(form.balance), cur),
        });
        show(form.kind === "wallet" ? "کیف‌پول اضافه شد" : "حساب بانکی اضافه شد");
      }
      close();
      await refreshData();
    } catch (e) {
      show((e as Error).message || "خطا در ذخیره");
    } finally {
      setBusy(false);
    }
  }

  async function remove(acc: Account) {
    if (!confirm(`«${acc.title}» حذف شود؟`)) return;
    try {
      await useCases!.deleteAccount.execute(acc.id);
      show("حذف شد");
      await refreshData();
    } catch (e) {
      show((e as Error).message || "خطا در حذف");
    }
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
    balanceChanged,
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
