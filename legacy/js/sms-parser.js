/* ═══════════════════════════════════════════════
   پارسر پیامک‌های بانکی ایرانی
   تشخیص: نوع (واریز/برداشت)، مبلغ، موجودی، بانک، تاریخ
   ═══════════════════════════════════════════════ */

const SmsParser = (() => {
  /* ── نام بانک‌ها از روی فرستنده/متن ── */
  const BANKS = [
    { re: /ملی|BMI|bank.?melli/i, name: "بانک ملی" },
    { re: /ملت|BMEL|tejarat.?area/i, name: "بانک ملت" },
    { re: /صادرات|BSIR|bsi/i, name: "بانک صادرات" },
    { re: /تجارت|tejarat/i, name: "بانک تجارت" },
    { re: /پاسارگاد|pasargad/i, name: "بانک پاسارگاد" },
    { re: /پارسیان|parsian/i, name: "بانک پارسیان" },
    { re: /سپه|sepah/i, name: "بانک سپه" },
    { re: /کشاورزی|keshavarzi|bki/i, name: "بانک کشاورزی" },
    { re: /رفاه|refah/i, name: "بانک رفاه" },
    { re: /مسکن|maskan/i, name: "بانک مسکن" },
    { re: /development/i, name: "بانک توسعه صادرات" },
    { re: /سامان|saman/i, name: "بانک سامان" },
    { re: /پاسارگاد/i, name: "بانک پاسارگاد" },
    { re: /انصاری|ansari/i, name: "بانک انصاری" },
    { re: /گردشگری|tourism/i, name: "بانک گردشگری" },
    { re: /حکمت|hekmat/i, name: "بانک حکمت" },
    { re: /دی|day/i, name: "بانک دی" },
    { re: /ایران.?زمین|iranzamin/i, name: "بانک ایران‌زمین" },
    { re: /قرض.?الحسنه|qarz|mehr/i, name: "بانک قرض‌الحسنه" },
    { re: /شهر|shahr/i, name: "بانک شهر" },
    { re: /آینده|ayandeh/i, name: "بانک آینده" },
    { re: /سرمایه|sarmayeh/i, name: "بانک سرمایه" },
    { re: /کارآفرین|karafarin/i, name: "بانک کارآفرین" },
    { re: /سینا|sina/i, name: "بانک سینا" },
    { re: /مهر|mehr/i, name: "بانک مهر ایران" },
    { re: /خاورمیانه|khavarmianeh/i, name: "بانک خاورمیانه" },
  ];

  /* ── کلیدواژه‌های نوع تراکنش ── */
  const INCOME_WORDS = [
    "واریز",
    "واریز شد",
    "واریز به",
    "رسید",
    "رسیدید",
    "دریافت",
    "کارمزد واریز",
    "انتقال به حساب شما",
    "به حساب شما واریز",
    "deposit",
    "credited",
  ];

  const EXPENSE_WORDS = [
    "برداشت",
    "برداشت شد",
    "پرداخت",
    "خرید",
    "انتقال",
    "پرداخت اینترنتی",
    "خرید اینترنتی",
    "کارت به کارت",
    "برداشت از",
    "پرداخت قبض",
    "شارژ",
    "withdraw",
    "purchase",
    "payment",
  ];

  /* ── نرمال‌سازی: ارقام فارسی/عربی + حروف عربی → فارسی ── */
  function normalize(s) {
    return String(s)
      .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
      .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
      .replace(/ي/g, "ی") /* yeh عربی → فارسی */
      .replace(/ك/g, "ک") /* kaf عربی → فارسی */
      .replace(/[\u200c\u200f\u200e]/g, ""); /* نویسه‌های نامرئی */
  }
  const toEnDigits = normalize;

  /* ── استخراج مبلغ ── */
  /* الگوها: "مبلغ 1,234,567" / "مبلغ:1234567" / "1,234,567 ریال" */
  function extractAmounts(text) {
    const t = toEnDigits(text);
    /* همه اعداد بزرگ (>= 4 رقم با جداکننده یا بدون) */
    const matches = [...t.matchAll(/(\d{1,3}(?:,\d{3})+|\d{4,})(?:\.\d+)?/g)];
    return matches
      .map((m) => ({
        raw: m[1],
        value: +m[1].replace(/,/g, ""),
      }))
      .filter((m) => m.value >= 1000); /* مبالغ معنادار */
  }

  /* ── تشخیص نوع ── */
  function detectType(text) {
    const t = text.toLowerCase();
    let income = 0,
      expense = 0;
    for (const w of INCOME_WORDS) if (t.includes(w)) income++;
    for (const w of EXPENSE_WORDS) if (t.includes(w)) expense++;
    if (income > expense) return "income";
    if (expense > income) return "expense";
    return null;
  }

  /* ── تشخیص بانک ── */
  function detectBank(text) {
    for (const b of BANKS) {
      if (b.re.test(text)) return b.name;
    }
    return null;
  }

  /* ── استخراج تاریخ ── */
  /* الگوهای رایج: "1404/06/15" یا "15/06/1404" یا "2025-09-06" */
  function extractDate(text) {
    const t = toEnDigits(text);

    /* جلالی: ۱۴۰۴/۰۶/۱۵ */
    let m = t.match(/1[34]\d{2}[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
    if (m) {
      const jy = +m[0].slice(0, 4);
      const jm = +m[1],
        jd = +m[2];
      if (Jalali && Jalali.toGregorian) {
        const [gy, gm, gd] = Jalali.toGregorian(jy, jm, jd);
        return { gy, gm, gd, jalali: [jy, jm, jd] };
      }
    }

    /* میلادی: 2025-09-06 یا 2025/09/06 */
    m = t.match(/(20\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
    if (m) {
      return {
        gy: +m[1],
        gm: +m[2],
        gd: +m[3],
        jalali: Jalali.toJalali(+m[1], +m[2], +m[3]),
      };
    }

    /* میلادی با روز اول: 06/09/2025 */
    m = t.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](20\d{2})/);
    if (m) {
      return {
        gy: +m[3],
        gm: +m[2],
        gd: +m[1],
        jalali: Jalali.toJalali(+m[3], +m[2], +m[1]),
      };
    }

    return null;
  }

  /* ── استخراج موجودی ── */
  function extractBalance(text) {
    const t = toEnDigits(text);
    /* "موجودی: 12,345,678" یا "موجودی شما 12345678" یا "مانده حساب:..." */
    let m = t.match(/موجودی[^0-9]{0,15}(\d{1,3}(?:,\d{3})+|\d{4,})/);
    if (m) return +m[1].replace(/,/g, "");
    m = t.match(/مانده[^0-9]{0,15}(\d{1,3}(?:,\d{3})+|\d{4,})/);
    if (m) return +m[1].replace(/,/g, "");
    return null;
  }

  /* ═══════════ پارس کامل ═══════════ */
  function parse(rawText) {
    /* نرمال‌سازی: ارقام فارسی/عربی و حروف عربی → استاندارد */
    const text = normalize(rawText || "");
    if (!text) return null;

    const type = detectType(text);
    const bank = detectBank(text);
    const date = extractDate(text);
    const balance = extractBalance(text);

    /* مبالغ: بزرگ‌ترین = مبلغ تراکنش (موجودی معمولاً بزرگ‌تر است اما جدا استخراج شد) */
    const amounts = extractAmounts(text);

    /* حذف مبلغ موجودی از لیست اگر دقیقاً همان است */
    const txAmounts = amounts.filter((a) => a.value !== balance);
    const amount = txAmounts.length
      ? txAmounts[0].value
      : (amounts[0]?.value ?? null);

    /* حدس دسته از روی متن */
    const category = guessCategory(text);

    return {
      rawText: text,
      type /* 'income' | 'expense' | null */,
      bank,
      amount /* عدد یا null */,
      balance,
      date /* {gy,gm,gd,jalali} یا null */,
      category,
    };
  }

  /* ── حدس دسته‌بندی از متن پیامک ── */
  function guessCategory(text) {
    const t = text.toLowerCase();
    if (/قبض|برق|آب|گاز|تلفن|شارژ ماهانه/.test(t)) return "bills";
    if (/خرید|پرداخت اینترنتی|درگاه/.test(t)) return "shopping";
    if (/کارت به کارت|انتقال/.test(t)) return "other-e";
    if (/آموزش|شهریه/.test(t)) return "edu";
    if (/دارو|دکتر|بیمارستان|پزشک/.test(t)) return "health";
    if (/حقوق|salary/.test(t)) return "salary";
    return null;
  }

  return {
    parse,
    detectType,
    detectBank,
    extractDate,
    extractBalance,
    toEnDigits,
  };
})();
