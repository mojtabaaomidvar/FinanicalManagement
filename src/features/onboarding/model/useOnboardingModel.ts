/* مدل قیفِ آغازین (intro) — پیش از ورود اجرا می‌شود.

   بازطراحیِ ۱۴۰۵/۰۶/۲۰: پیش‌تر این فلو «بعد از لاگین» اجرا می‌شد که غلط بود؛
   کاربرِ تازه اول باید محصول را ببیند، بعد تصمیم بگیرد. حالا:

     نصب/اولین باز شدن → «شروع کنیم» یا «ورود»
       • ورود   → مستقیم به فرمِ ورود (روالِ عادی، بدون مزاحمت)
       • شروع   → معرفی → چند پرسشِ سبک → فرمِ ثبت‌نامِ از‌پیش‌پرشده

   یعنی قیف در انتها به ثبت‌نام می‌رسد و همان‌جا تمام می‌شود؛ هیچ گامِ
   اضافه‌ای بعد از ورود نمی‌ماند (دعوتِ اعضا را بنرِ هاب پوشش می‌دهد).

   ذخیره‌سازی «دستگاهی» است نه per-member — چون در این مرحله هنوز هیچ عضوی
   وجود ندارد که کلید به نامش باشد. */

import { useMemo, useState } from "react";

export type OnbCurrency = "تومان" | "ریال";

/** تمرکزهای مالی — همه به قابلیتِ موجودِ امروز نگاشت می‌شوند (بدون وعده‌ی نساخته) */
export const FOCUS_OPTIONS = [
  { id: "spend", label: "کنترلِ هزینه‌ها", icon: "i-cart" },
  { id: "budget", label: "پس‌انداز و بودجه", icon: "i-piggy" },
  { id: "accounts", label: "کارت‌ها و حساب‌ها", icon: "i-wallet" },
  { id: "sms", label: "ثبت از پیامکِ بانک", icon: "i-sms" },
] as const;
export type FocusId = (typeof FOCUS_OPTIONS)[number]["id"];

/** اندازه‌های خانوار — مقدار ذخیره‌شده رشته است تا «۵+» هم بگنجد */
export const SIZE_OPTIONS = ["1", "2", "3", "4", "5+"] as const;
export type HouseholdSize = (typeof SIZE_OPTIONS)[number];

/** گام‌های قیف — گامِ آخر تحویل به فرمِ ثبت‌نام است و خودش صفحه ندارد */
export type OnbStep = "welcome" | "value" | "questions";

const SEEN_KEY = "khaneyar.intro.seen";
const DRAFT_KEY = "khaneyar.intro.draft";

/** پاسخ‌های جمع‌آوری‌شده پیش از ثبت‌نام — پس از ساختِ حساب اعمال و پاک می‌شوند */
export interface IntroDraft {
  familyName: string;
  householdSize: HouseholdSize;
  focus: FocusId[];
  currency: OnbCurrency;
  at: string;
}

/** آیا این دستگاه قیفِ آغازین را دیده است؟ (گیت در App.tsx از این استفاده می‌کند) */
export function isIntroSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

/** ثبتِ «دیده شد» — هم مسیرِ «ورود» و هم مسیرِ «شروع» آن را می‌زنند */
export function markIntroSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* حافظه‌ی دستگاه در دسترس نبود — دفعه‌ی بعد دوباره نشان داده می‌شود */
  }
}

/** خواندنِ پاسخ‌های ذخیره‌شده (برای پیش‌پرکردنِ فرم و اعمالِ واحدِ پول) */
export function readIntroDraft(): IntroDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<IntroDraft>;
    if (!d || typeof d !== "object") return null;
    return {
      familyName: typeof d.familyName === "string" ? d.familyName : "",
      householdSize: (SIZE_OPTIONS as readonly string[]).includes(
        d.householdSize as string,
      )
        ? (d.householdSize as HouseholdSize)
        : "2",
      focus: Array.isArray(d.focus) ? (d.focus as FocusId[]) : [],
      currency: d.currency === "ریال" ? "ریال" : "تومان",
      at: typeof d.at === "string" ? d.at : "",
    };
  } catch {
    return null;
  }
}

/** پاک‌کردنِ پیش‌نویس — بعد از اینکه روی حسابِ تازه اعمال شد */
export function clearIntroDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* بی‌خطر */
  }
}

export function useOnboardingModel({
  onLogin,
  onRegister,
}: {
  /** کاربر گفت «قبلاً حساب دارم» → مستقیم به فرمِ ورود */
  onLogin: () => void;
  /** پایانِ قیف → فرمِ ثبت‌نام با پاسخ‌های جمع‌آوری‌شده */
  onRegister: (draft: IntroDraft) => void;
}) {
  const steps = useMemo<OnbStep[]>(() => ["welcome", "value", "questions"], []);

  const [index, setIndex] = useState(0);
  const [familyName, setFamilyName] = useState("");
  const [householdSize, setHouseholdSize] = useState<HouseholdSize>("2");
  const [focus, setFocus] = useState<FocusId[]>([]);
  const [currency, setCurrency] = useState<OnbCurrency>("تومان");

  const step = steps[index];
  const isFirst = index === 0;
  const isLast = index === steps.length - 1;

  /* نامِ خانواده تنها ورودیِ اجباریِ قیف است؛ ثبت‌نام بدونش ممکن نیست */
  const canContinue = !isLast || familyName.trim().length > 0;

  function toggleFocus(id: FocusId) {
    setFocus((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function buildDraft(): IntroDraft {
    return {
      familyName: familyName.trim(),
      householdSize,
      focus,
      currency,
      at: new Date().toISOString(),
    };
  }

  function persist(draft: IntroDraft) {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* اگر ذخیره نشد، فقط پیش‌پرکردن از دست می‌رود — فرم دستی پر می‌شود */
    }
    markIntroSeen();
  }

  function next() {
    if (!canContinue) return;
    if (isLast) {
      const draft = buildDraft();
      persist(draft);
      onRegister(draft);
      return;
    }
    setIndex((i) => Math.min(i + 1, steps.length - 1));
  }

  function back() {
    setIndex((i) => Math.max(i - 1, 0));
  }

  /** «قبلاً حساب دارم» — قیف را دیده‌شده علامت می‌زند و به ورود می‌رود */
  function goLogin() {
    markIntroSeen();
    onLogin();
  }

  /** «فعلاً رد کن» — بدون جمع‌آوریِ داده به فرمِ ثبت‌نام/ورود می‌رود */
  function skip() {
    markIntroSeen();
    onLogin();
  }

  return {
    steps,
    index,
    step,
    isFirst,
    isLast,
    canContinue,
    familyName,
    setFamilyName,
    householdSize,
    setHouseholdSize,
    focus,
    toggleFocus,
    currency,
    setCurrency,
    next,
    back,
    goLogin,
    skip,
  };
}
