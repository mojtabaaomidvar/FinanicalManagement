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
  jalaliToIso,
} from "@/shared/lib/jalali";
import type { TxRepeat } from "./transaction.types";
import type { Transaction } from "./transaction.types";

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
): string[] {
  if (repeat === "none") return [];

  const start = isoToJalali(startIso);
  const end = repeatEndIso ? isoToJalali(repeatEndIso) : null;
  /* سقف = هرکدام زودتر است: امروز یا پایان تکرار */
  const limit = end && cmp(end, todayJ) < 0 ? end : todayJ;

  const out: string[] = [];
  for (let n = 1; n <= MAX_OCCURRENCES; n++) {
    const occ = stepJalali(start, repeat, n);
    if (cmp(occ, limit) > 0) break;
    out.push(jalaliToIso(occ));
  }
  return out;
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
    const due = dueOccurrences(tx.date, tx.repeat, tx.repeatEnd, horizonJ);
    const handled = new Set(tx.handledOccurrences);
    for (const dueIso of pendingOccurrences(due, handled)) {
      out.push({ tx, dueIso });
    }
  }
  out.sort((a, b) => {
    if (a.dueIso !== b.dueIso) return a.dueIso < b.dueIso ? -1 : 1;
    return a.tx.id < b.tx.id ? -1 : a.tx.id > b.tx.id ? 1 : 0;
  });
  return out;
}
