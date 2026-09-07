/* backGuard — بازگشت یکپارچه با دکمهٔ فیزیکی/نرم‌افزاری و سوایپ لبه
   ────────────────────────────────────────────────────────────────
   بدون هیچ وابستگی تازه (@capacitor/app لازم نیست): وب‌ویوی اندروید
   کاپاسیتور و مرورگر، دکمهٔ بازگشت و سوایپ لبه را به history.back()
   می‌سپارند. پس کافی است هر لایهٔ «قابل‌بستن با بازگشت» (مودال، تبِ
   غیرخانه، زیرصفحهٔ تنظیمات) یک ورودی در تاریخچه push کند و یک تابع
   «بستن» ثبت کند؛ با هر بازگشت، بالاترین لایه بسته می‌شود (LIFO).

   چرا پشتهٔ سراسری؟ چون مودال می‌تواند روی مودال، و زیرصفحه روی تب باز
   شود؛ باید دقیقاً همان ترتیبِ بازشدن، معکوس بسته شود — نه همه با هم.

   نکتهٔ ظریف: وقتی لایه‌ای به‌جای بازگشت، برنامه‌ای بسته می‌شود (کلیک
   «انصراف»، بیرونِ مودال، تعویض تب)، باید ورودیِ تاریخچه‌اش هم پس گرفته
   شود تا یک بار بازگشتِ اضافه لازم نشود. این کار با history.back() انجام
   می‌شود، اما چون خودمان آن را باعث شده‌ایم نه کاربر، با پرچم
   internalBack از فراخوانیِ دوبارهٔ close جلوگیری می‌کنیم. */

type Guard = {
  id: symbol;
  close: () => void;
};

const stack: Guard[] = [];
/* شمارندهٔ popstateهایی که خودمان (با بستنِ برنامه‌ایِ لایه) باعثشان
   شده‌ایم و نباید close را صدا بزنند. شمارنده است نه بولین، چون ممکن
   است چند لایه در یک تیک برنامه‌ای بسته شوند (مثلاً شیت تراکنش که شیت
   «ورود پیامک» را هم می‌بندد) و هر کدام یک history.back() بزنند. */
let internalBacks = 0;
let listening = false;

function onPopState() {
  if (internalBacks > 0) {
    internalBacks--;
    return;
  }
  /* کاربر بازگشت زد → بالاترین لایه را ببند */
  const top = stack.pop();
  if (top) top.close();
}

function ensureListening() {
  if (listening) return;
  listening = true;
  window.addEventListener("popstate", onPopState);
}

/** یک لایهٔ قابل‌بستن باز شد: ورودیِ تاریخچه push و close ثبت می‌شود. */
export function pushGuard(close: () => void): symbol {
  ensureListening();
  const id = Symbol("back-guard");
  stack.push({ id, close });
  /* ورودیِ تاریخچه‌ای که بازگشتِ بعدی آن را مصرف می‌کند */
  history.pushState({ backGuard: true, k: stack.length }, "");
  return id;
}

/** لایه به‌شکل برنامه‌ای بسته شد (نه با بازگشت): ورودی‌اش را پس بگیر. */
export function popGuard(id: symbol) {
  const i = stack.findIndex((g) => g.id === id);
  if (i === -1) return;
  stack.splice(i, 1);
  /* ورودیِ متناظر را از تاریخچه پس بگیر تا شمارش هم‌خوان بماند.
     چون بستن از سمت ما بوده، popstate نباید close را دوباره بزند. */
  internalBacks++;
  history.back();
}
