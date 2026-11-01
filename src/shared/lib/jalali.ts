/* تقویم شمسی (جلالی) — تبدیل و قالب‌بندی تاریخ
   الگوریتم استاندارد جلالی (چرخه کبیسه ۳۳ ساله) — بدون وابستگی */

import { toFa, toEn } from "./digits";

export type JDate = [number, number, number]; /* [jy, jm, jd] */

export const MONTHS = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
] as const;

export const WEEKDAYS = [
  "شنبه",
  "یکشنبه",
  "دوشنبه",
  "سه‌شنبه",
  "چهارشنبه",
  "پنجشنبه",
  "جمعه",
] as const;

/* ── تبدیل میلادی → جلالی ── */
export function toJalali(gy: number, gm: number, gd: number): JDate {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy <= 1600 ? 0 : 979;
  gy -= gy <= 1600 ? 621 : 1600;
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days =
    365 * gy +
    Math.floor((gy2 + 3) / 4) -
    Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400) -
    80 +
    gd +
    g_d_m[gm - 1];
  jy += 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const jm =
    days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return [jy, jm, jd];
}

/* ── تبدیل جلالی → میلادی ── */
export function toGregorian(
  jy: number,
  jm: number,
  jd: number,
): [number, number, number] {
  let gy = jy <= 979 ? 621 : 1600;
  jy -= jy <= 979 ? 0 : 979;
  let days =
    365 * jy +
    Math.floor(jy / 33) * 8 +
    Math.floor(((jy % 33) + 3) / 4) +
    78 +
    jd +
    (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  gy += 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * Math.floor(--days / 36524);
    days %= 36524;
    if (days >= 365) days++;
  }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let gd = days + 1;
  const sal_a = [
    0,
    31,
    (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0 ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  let gm = 1;
  for (gm = 1; gm <= 12; gm++) {
    if (gd <= sal_a[gm]) break;
    gd -= sal_a[gm];
  }
  return [gy, gm, gd];
}

/* ── تعداد روزهای ماه جلالی ── */
export function daysInMonth(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isLeap(jy) ? 30 : 29;
}

export function isLeap(jy: number): boolean {
  const mod = jy % 33;
  return [1, 5, 9, 13, 17, 22, 26, 30].includes(mod);
}

/* ── روزهای باقیمانده تا پایان ماه، شامل خود همان روز ── */
export function daysLeftInMonth([jy, jm, jd]: JDate): number {
  return Math.max(1, daysInMonth(jy, jm) - jd + 1);
}

/* ── تاریخ امروز به جلالی ── */
export function today(): JDate {
  const d = new Date();
  return toJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/* ── قالب‌بندی‌ها ── */

/* "۱۴۰۴/۰۶/۱۵" */
export function formatISO([jy, jm, jd]: JDate): string {
  return `${toFa(jy)}/${toFa(String(jm).padStart(2, "0"))}/${toFa(String(jd).padStart(2, "0"))}`;
}

/* "۱۵ شهریور ۱۴۰۴" */
export function formatLong([jy, jm, jd]: JDate): string {
  return `${toFa(jd)} ${MONTHS[jm - 1]} ${toFa(jy)}`;
}

/* "شنبه ۱۵ شهریور" */
export function formatWeekday([jy, jm, jd]: JDate): string {
  return `${WEEKDAYS[weekdayIndex([jy, jm, jd])]} ${toFa(jd)} ${MONTHS[jm - 1]}`;
}

/* "شهریور ۱۴۰۴" */
export function formatMonth(jy: number, jm: number): string {
  return `${MONTHS[jm - 1]} ${toFa(jy)}`;
}

/* ── پارس "۱۴۰۴/۰۶/۱۵" یا "1404/6/15" ── */
export function parse(str: string): JDate | null {
  const s = toEn(String(str).trim()).replace(/[-.]/g, "/");
  const m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const jy = +m[1],
    jm = +m[2],
    jd = +m[3];
  if (jm < 1 || jm > 12) return null;
  if (jd < 1 || jd > daysInMonth(jy, jm)) return null;
  return [jy, jm, jd];
}

/* ── شناسهٔ «همین ماهِ جلالی» — مثل "1404-06" ──

   نامِ قبلیِ این کامنت «کلید ذخیره‌سازی» بود و گمراه‌کننده: هیچ‌جا ذخیره
   نمی‌شود. نه ستونی در پایگاه‌داده دارد، نه کلیدی در localStorage، نه فیلدی
   در API. فقط در حافظه ساخته می‌شود تا دو تاریخ را با === مقایسه کنیم؛ تنها
   مصرف‌کننده‌اش monthCategorySpend در domain/budget/budget.rules.ts است.
   صفرِ ابتدای ماه هم برای همین مقایسه است، نه برای مرتب‌سازی یا ذخیره.

   تلهٔ اصلی: این رشته شبیهِ هفت نویسهٔ اولِ یک تاریخ است، ولی جایگزینِ
   tx.date.slice(0, 7) نیست. Transaction.date تاریخِ میلادی است، پس آن برش
   ماهِ میلادی را می‌دهد و هر ماهِ میلادی روی دو ماهِ جلالی می‌افتد (نیمهٔ
   ۲۰۲۶-۰۹ شهریور است و نیمهٔ دیگرش مهر). به همین دلیل budget.rules.ts اول
   isoToJalali می‌زند و بعد این تابع را صدا می‌کند.

   خروجی هم با parse خوانده نمی‌شود: parse سه بخش می‌خواهد و برای این رشته
   null می‌دهد. */
export function monthKey(jy: number, jm: number): string {
  return `${jy}-${String(jm).padStart(2, "0")}`;
}

export function nextMonth(jy: number, jm: number): [number, number] {
  return jm === 12 ? [jy + 1, 1] : [jy, jm + 1];
}

export function prevMonth(jy: number, jm: number): [number, number] {
  return jm === 1 ? [jy - 1, 12] : [jy, jm - 1];
}

/* ── مقایسه تاریخ ── */
export function cmp(a: JDate, b: JDate): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
}

/* ── تاریخ میلادی ISO ("2025-09-06") → جلالی ── */
export function isoToJalali(iso: string): JDate {
  const [gy, gm, gd] = iso.split("-").map(Number);
  return toJalali(gy, gm, gd);
}

/* ── مهرِ زمانیِ کاملِ میلادی ("2026-09-30T08:12:34Z") → جلالیِ محلی ──

   با isoToJalali اشتباه نشود. آن عمداً ساده است و فقط "YYYY-MM-DD" می‌گیرد؛
   اگر یک مهرِ زمانیِ کامل به آن بدهید، روزِ ماه را "30T08:12:34Z" می‌خواند و
   بی‌صدا NaN برمی‌گرداند. هر جا فیلدی از سرور «T» دارد، این تابع درست است.

   تبدیل از روی Date انجام می‌شود، پس منطقهٔ زمانیِ دستگاه اعمال می‌گردد —
   مهرِ UTCِ ۲۱:۳۰ در تهران «فردا» است و باید هم همین دیده شود.

   خروجیِ null یعنی رشته تاریخِ معتبری نبود؛ صداکننده باید همین حالت را
   نشان بدهد، نه اینکه با «۰/۰۰/۰۰» بپوشاندش. */
export function timestampToJalali(ts: string): JDate | null {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return toJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/* ── جلالی → تاریخ میلادی ISO ("2025-09-06") ── */
export function jalaliToIso([jy, jm, jd]: JDate): string {
  const [gy, gm, gd] = toGregorian(jy, jm, jd);
  return `${gy}-${String(gm).padStart(2, "0")}-${String(gd).padStart(2, "0")}`;
}

/* ── n روز جابه‌جا (مثبت = آینده، منفی = گذشته) ── */
export function addDays(d: JDate, n: number): JDate {
  const [gy, gm, gd] = toGregorian(d[0], d[1], d[2]);
  const dt = new Date(gy, gm - 1, gd + n);
  return toJalali(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

/* ── روزِ هفته ──

   ⚠️ تلهٔ یکی‌جابه‌جا — اینجا یک باگِ واقعی بود (رفع ۱۴۰۵/۰۷/۱۹).

   `Date.getDay()` صفرش **یکشنبه** است، ولی هفتهٔ ایرانی از **شنبه** شروع
   می‌شود و آرایه‌های `WEEKDAYS`/`WEEKDAYS_SHORT` هم اندیسِ ۰ را شنبه
   گرفته‌اند. پیش از این خروجیِ خامِ `getDay()` مستقیم روی همان آرایه‌ها
   اندیس می‌خورد، پس **نامِ هر روز یکی عقب‌تر** نوشته می‌شد: شنبه «جمعه»
   خوانده می‌شد و جمعه «پنجشنبه».

   سه جا دیده می‌شد: سرستونِ صفحهٔ خرج‌و‌درآمد، برچسبِ گروه‌های تاریخ در
   فهرستِ تراکنش، و محورِ نمودارِ هفتگی (یعنی خرجِ هر روز زیرِ نامِ روزِ
   قبلش می‌نشست).

   هر کدِ تازه‌ای که نامِ روز می‌خواهد باید از همین تابع بگذرد، نه از
   `getDay()` خام. */
export function weekdayIndex(d: JDate): number {
  const [gy, gm, gd] = toGregorian(d[0], d[1], d[2]);
  /* شنبه(۶) → ۰ · یکشنبه(۰) → ۱ · … · جمعه(۵) → ۶ */
  return (new Date(gy, gm - 1, gd).getDay() + 1) % 7;
}

export const WEEKDAYS_SHORT = ["ش", "ی", "د", "س", "چ", "پ", "ج"] as const;

export function shortWeekday(d: JDate): string {
  return WEEKDAYS_SHORT[weekdayIndex(d)];
}
