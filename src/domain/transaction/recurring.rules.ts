/* قواعد تراکنش‌های تکرارشونده — محاسبه‌ی سررسیدها (بخش ۳.۲)
   ──────────────────────────────────────────────────────
   تراکنش تکرارشونده یک ردیف واحد است (بدون تولید خودکار رخدادها). تاریخ
   شروع آن = «اولین رخداد واقعی» که همان لحظه ثبت شده و در خرج ماه هم
   شمرده می‌شود. پس سررسیدهایی که باید از مدیر پرسیده شوند، رخدادهای
   «بعد از» تاریخ شروع‌اند: شروع + n دوره (n ≥ ۱).

   همه‌ی محاسبه در تقویم جلالی انجام می‌شود چون کاربر «پانزدهم هر ماه
   شمسی» را می‌فهمد، نه معادل میلادی‌اش. هر سررسید مستقیماً از تاریخ
   شروع با گام n ساخته می‌شود (نه پله‌به‌پله از رخداد قبلی) تا در ماه‌های
   کوتاه‌تر «رانش روز» رخ ندهد: ۳۱ام همیشه از ۳۱ اصل clamp می‌شود، پس در
   ماه ۳۱روزه دوباره ۳۱ برمی‌گردد. */

import type { JDate } from "@/shared/lib/jalali";
import {
  addDays,
  cmp,
  daysInMonth,
  isoToJalali,
  isTodayOrTomorrow,
  jalaliToIso,
} from "@/shared/lib/jalali";
import type { TxRepeat } from "./transaction.types";
import type { Transaction, TransactionInput } from "./transaction.types";
import { moneyFits, parseMoneyInput, type Money } from "@/shared/lib/money";
import { MAX_AMOUNT } from "./transaction.rules";

/** Parse the complete amount without dropping invalid characters. */
export function parseScheduledAmount(raw: string, currency: string): Money | null {
  const amount = parseMoneyInput(raw, currency);
  return amount !== null && moneyFits(amount, { scale: 2, min: "0.01", max: MAX_AMOUNT }) ? amount : null;
}

/** Stopping future reminders preserves the existing financial transaction. */
export function stoppedRecurringInput(tx: Transaction): TransactionInput {
  return { memberId: tx.memberId, type: tx.type, amount: tx.amount, category: tx.category,
    date: tx.date, time: tx.time, note: tx.note, accountId: tx.accountId, toAccountId: tx.toAccountId,
    subcategoryId: tx.subcategoryId, repeat: "none", repeatEnd: null };
}

export function occurrenceStatus(tx: Transaction, dueIso: string): "pending" | "handled" | "invalid" {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueIso) || !Number.isFinite(Date.parse(dueIso))) return "invalid";
  if (tx.repeat === "none" || !transactionDueOccurrences(tx, isoToJalali(dueIso)).includes(dueIso)) return "invalid";
  return tx.handledOccurrences.includes(dueIso) ? "handled" : "pending";
}

/* سقف دفاعی برای جلوگیری از حلقه‌ی بی‌پایان؛ عملاً شرط شکست خیلی زودتر
   فعال می‌شود (هفتگی ۱۰ سال ≈ ۵۲۰، ماهانه ≈ ۱۲۰). */
const MAX_OCCURRENCES = 1200;

/**
 * تاریخ جلالی را n دوره جلو می‌برد.
 * - هفتگی: ۷n روز
 * - ماهانه: n ماه با clamp روز (۳۱ام → آخرین روز ماه کوتاه‌تر)
 * - سالانه: n سال با clamp روز (۳۰ اسفند سال کبیسه → ۲۹ در سال عادی)
 */
export function stepJalali(date: JDate, repeat: TxRepeat, n: number): JDate {
  if (n <= 0 || repeat === "none") return date;
  const [jy, jm, jd] = date;

  if (repeat === "weekly") {
    return addDays(date, 7 * n);
  }

  if (repeat === "monthly") {
    /* اندیس ماه صفرمبنا برای جمع بدون خطای مرز سال */
    const idx = jy * 12 + (jm - 1) + n;
    const ny = Math.floor(idx / 12);
    const nm = (idx % 12) + 1;
    return [ny, nm, Math.min(jd, daysInMonth(ny, nm))];
  }

  /* yearly */
  const ny = jy + n;
  return [ny, jm, Math.min(jd, daysInMonth(ny, jm))];
}

/**
 * همه‌ی سررسیدهای «بعد از» تاریخ شروع تا سقف min(today, repeatEnd).
 * خروجی: فهرست تاریخ میلادی ISO به ترتیب صعودی. شروع خودش نمی‌آید.
 */
export function dueOccurrences(
  startIso: string,
  repeat: TxRepeat,
  repeatEndIso: string | null,
  todayJ: JDate,
  includeStart = false,
): string[] {
  if (repeat === "none") return [];

  const start = isoToJalali(startIso);
  const end = repeatEndIso ? isoToJalali(repeatEndIso) : null;
  /* سقف = هرکدام زودتر است: امروز یا پایان تکرار */
  const limit = end && cmp(end, todayJ) < 0 ? end : todayJ;

  const out: string[] = [];
  for (let n = includeStart ? 0 : 1; n <= MAX_OCCURRENCES; n++) {
    const occ = stepJalali(start, repeat, n);
    if (cmp(occ, limit) > 0) break;
    out.push(jalaliToIso(occ));
  }
  return out;
}

/** Future plan fields never replace the original transaction in financial reports. */
export function recurringTemplate(tx: Transaction): Transaction {
  const plan = tx.recurringPlan;
  return plan ? { ...tx, amount: plan.amount, category: plan.category, note: plan.note,
    subcategoryId: plan.category === tx.category ? tx.subcategoryId : null } : tx;
}
export function transactionDueOccurrences(tx: Transaction, horizon: JDate): string[] {
  return dueOccurrences(tx.recurringPlan?.startDate ?? tx.date, tx.repeat, tx.repeatEnd, horizon,
    !!tx.recurringPlan?.startDate);
}
export function nextPendingOccurrence(tx: Transaction): string | null {
  if (tx.repeat === "none") return null;
  const horizon = isoToJalali(tx.repeatEnd ?? jalaliToIso(addDays(isoToJalali(tx.date), 365 * 30)));
  return transactionDueOccurrences(tx, horizon).find(due => !tx.handledOccurrences.includes(due)) ?? null;
}

/**
 * سررسیدهایی که هنوز رسیدگی نشده‌اند — یعنی نه ثبت شده‌اند و نه رد.
 * `handled` مجموعه‌ی تاریخ‌های میلادی ISOی رسیدگی‌شده است.
 */
export function pendingOccurrences(
  allDue: string[],
  handled: Set<string>,
): string[] {
  return allDue.filter((d) => !handled.has(d));
}

/** یک سررسیدِ رسیدگی‌نشده، همراهِ تراکنشی که از آن آمده. */
export interface DueOccurrence {
  tx: Transaction;
  /** تاریخ میلادی ISO — "YYYY-MM-DD" */
  dueIso: string;
}

/**
 * همه‌ی سررسیدهای رسیدگی‌نشده‌ی همه‌ی تراکنش‌های تکرارشونده تا `horizonJ`.
 *
 * ── چرا این تابع وجود دارد ──
 * این حلقه (برای هر تراکنش → dueOccurrences → pendingOccurrences →
 * تخت‌کردن → مرتب‌سازی) در دو جا لازم است: ویجتِ `widgets/due-recurring`
 * (صفِ کارِ مدیر) و هسته‌ی اعلانِ §۷. دو نسخه‌ی جداگانه‌اش می‌توانست درّه
 * بردارد — مثلاً اگر روزی رفتارِ `repeatEnd` عوض شود و فقط یکی به‌روز شود،
 * کاربر موردی را در یک صفحه می‌دید و در صفحه‌ی دیگر نه. پس خودِ دامنه‌ای که
 * مالکِ این مفهوم است آن را یک‌جا می‌دهد.
 *
 * `horizonJ` معمولاً «امروز» است (فقط سررسیدهای رسیده). هسته‌ی اعلان آن را
 * به اندازه‌ی زمانِ پیش‌هنگامِ §۷.۴ جلوتر می‌برد تا «نزدیک» هم در بیاید، و
 * خودش روی امروز به دو شدت می‌شکند. این تابع درباره‌ی شدت نظری ندارد.
 *
 * ترتیب: تاریخِ صعودی، و در تساوی شناسه‌ی تراکنش — تا فهرست بین دو رندر
 * جابه‌جا نشود.
 */
export function pendingDueList(
  txs: Transaction[],
  horizonJ: JDate,
): DueOccurrence[] {
  const out: DueOccurrence[] = [];
  for (const tx of txs) {
    if (tx.repeat === "none") continue;
    const due = transactionDueOccurrences(tx, horizonJ);
    const handled = new Set(tx.handledOccurrences);
    for (const dueIso of pendingOccurrences(due, handled)) {
      out.push({ tx: recurringTemplate(tx), dueIso });
    }
  }
  out.sort((a, b) => {
    if (a.dueIso !== b.dueIso) return a.dueIso < b.dueIso ? -1 : 1;
    return a.tx.id < b.tx.id ? -1 : a.tx.id > b.tx.id ? 1 : 0;
  });
  return out;
}

/** Visible reminders cover today and tomorrow without handling older occurrences. */
export function reminderDueList(txs: Transaction[], todayJ: JDate): DueOccurrence[] {
  return pendingDueList(txs, addDays(todayJ, 1)).filter(item => isTodayOrTomorrow(item.dueIso, todayJ));
}
