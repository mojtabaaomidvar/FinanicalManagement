/* ═══════════════════════════════════════════════
   تقویم شمسی (جلالی) — تبدیل و قالب‌بندی تاریخ
   الگوریتم استاندارد جلالی (بدون وابستگی)
   ═══════════════════════════════════════════════ */

const Jalali = (() => {
  const MONTHS = [
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
  ];

  const WEEKDAYS = [
    "یکشنبه",
    "دوشنبه",
    "سه‌شنبه",
    "چهارشنبه",
    "پنجشنبه",
    "جمعه",
    "شنبه",
  ];

  /* ── تبدیل میلادی → جلالی ── */
  function toJalali(gy, gm, gd) {
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
      days < 186
        ? 1 + Math.floor(days / 31)
        : 7 + Math.floor((days - 186) / 30);
    const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
    return [jy, jm, jd];
  }

  /* ── تبدیل جلالی → میلادی ── */
  function toGregorian(jy, jm, jd) {
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
    let gm = 0;
    for (gm = 1; gm <= 12; gm++) {
      if (gd <= sal_a[gm]) break;
      gd -= sal_a[gm];
    }
    return [gy, gm, gd];
  }

  /* ── تعداد روزهای ماه جلالی ── */
  function daysInMonth(jy, jm) {
    if (jm <= 6) return 31;
    if (jm <= 11) return 30;
    /* اسفند: کبیسه ۳۰ روز */
    return isLeap(jy) ? 30 : 29;
  }

  function isLeap(jy) {
    /* ۳۳ ساله بودن چرخه کبیسه */
    const mod = jy % 33;
    return [1, 5, 9, 13, 17, 22, 26, 30].includes(mod);
  }

  /* ── تاریخ امروز به جلالی ── */
  function today() {
    const d = new Date();
    return toJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  /* ── ارقام فارسی ── */
  const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

  function toFa(num) {
    return String(num).replace(/\d/g, (d) => FA_DIGITS[+d]);
  }

  function toEn(str) {
    return String(str)
      .replace(/[۰-۹]/g, (d) => FA_DIGITS.indexOf(d))
      .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
  }

  /* ── قالب‌بندی‌ها ── */

  /* "۱۴۰۴/۰۶/۱۵" */
  function formatISO(jy, jm, jd) {
    return `${toFa(jy)}/${toFa(String(jm).padStart(2, "0"))}/${toFa(String(jd).padStart(2, "0"))}`;
  }

  /* "۱۵ شهریور ۱۴۰۴" */
  function formatLong(jy, jm, jd) {
    return `${toFa(jd)} ${MONTHS[jm - 1]} ${toFa(jy)}`;
  }

  /* "شنبه ۱۵ شهریور" */
  function formatWeekday(jy, jm, jd) {
    const [gy, gm, gd] = toGregorian(jy, jm, jd);
    const wd = new Date(gy, gm - 1, gd).getDay();
    return `${WEEKDAYS[wd]} ${toFa(jd)} ${MONTHS[jm - 1]}`;
  }

  /* "شهریور ۱۴۰۴" */
  function formatMonth(jy, jm) {
    return `${MONTHS[jm - 1]} ${toFa(jy)}`;
  }

  /* ── پارس "۱۴۰۴/۰۶/۱۵" یا "1404/6/15" ── */
  function parse(str) {
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

  /* ── کلید ذخیره‌سازی: "1404-06" ── */
  function monthKey(jy, jm) {
    return `${jy}-${String(jm).padStart(2, "0")}`;
  }

  /* ── ماه بعد/قبل ── */
  function nextMonth(jy, jm) {
    return jm === 12 ? [jy + 1, 1] : [jy, jm + 1];
  }
  function prevMonth(jy, jm) {
    return jm === 1 ? [jy - 1, 12] : [jy, jm - 1];
  }

  /* ── مقایسه تاریخ (jdate = [jy,jm,jd]) ── */
  function cmp(a, b) {
    if (a[0] !== b[0]) return a[0] - b[0];
    if (a[1] !== b[1]) return a[1] - b[1];
    return a[2] - b[2];
  }

  return {
    MONTHS,
    WEEKDAYS,
    toJalali,
    toGregorian,
    daysInMonth,
    isLeap,
    today,
    toFa,
    toEn,
    formatISO,
    formatLong,
    formatWeekday,
    formatMonth,
    parse,
    monthKey,
    nextMonth,
    prevMonth,
    cmp,
  };
})();
