/* backGuard — بازگشت یکپارچه با دکمهٔ فیزیکی/نرم‌افزاری و سوایپ لبه
   ────────────────────────────────────────────────────────────────
   بدون هیچ وابستگی جدید (@capacitor/app لازم نیست): وب‌ویوی اندروید
   کاپاسیتور و مرورگر، دکمهٔ بازگشت و سوایپ لبه را به history.back()
   می‌سپارند. پس کافی است هر لایهٔ «قابل‌بستن با بازگشت» (مودال، تب
   غیرخانه، زیرصفحهٔ تنظیمات) یک ورودی در تاریخچه push کند و یک تابع
   «بستن» ثبت کند؛ با هر بازگشت، بالاترین لایه بسته می‌شود (LIFO).

   چرا پشتهٔ سراسری؟ چون مودال می‌تواند روی مودال، و زیرصفحه روی تب باز
   شود؛ باید دقیقاً همان ترتیب بازشدن، معکوس بسته شود — نه همه با هم.

   نکتهٔ ظریف: وقتی لایه‌ای به‌جای بازگشت، برنامه‌ای بسته می‌شود (کلیک
   «انصراف»، بیرون مودال، تعویض تب)، باید ورودی تاریخچه‌اش هم پس گرفته
   شود تا یک بار بازگشت اضافه لازم نشود. این کار با history.back() انجام
   می‌شود. پیمایش تاریخچه ناهمگام است؛ تا رسیدن popstate، ورودی جدید
   اضافه نمی‌کنیم تا بازگشت در حال انجام، لایهٔ جایگزین را مصرف نکند. */

type Guard = {
  id: symbol;
  close: () => void;
  order: number;
};

const stack: Guard[] = [];
/* پشتهٔ لایه‌های باز از ورودی‌های واقعاً ثبت‌شده جداست: ممکن است لایه
   بسته شده باشد ولی پیمایش هنوز تمام نشده، یا لایهٔ جدید منتظر ثبت باشد. */
const historyEntries: symbol[] = [];
let internalBackPending = false;
let listening = false;
const handledPops = new WeakSet<Event>();
let settledAction: (() => void) | null = null;
let guardOrder = 0;
let registrationsPending = false;

export function nextGuardOrder() { return ++guardOrder; }

export function isGuardPop(event: Event) { return handledPops.has(event); }

/** Remove overlay entries before pushing a route; never navigate during async Back. */
export function afterGuards(action: () => void) {
  settledAction = action;
  stack.splice(0);
  reconcileHistory();
}

function reconcileHistory() {
  if (internalBackPending || registrationsPending) return;
  const liveIds = new Set(stack.map((guard) => guard.id));
  const top = historyEntries[historyEntries.length - 1];
  if (top && !liveIds.has(top)) {
    /* ورودی بسته‌شدهٔ زیر یک لایهٔ باز را نگه می‌داریم تا روی پشته برسد؛
       پس بستن لایهٔ زیرین، ورودی لایهٔ رویی را از تاریخچه حذف نمی‌کند. */
    internalBackPending = true;
    history.back();
    return;
  }
  if (!historyEntries.length && settledAction) {
    const action = settledAction;
    settledAction = null;
    action();
  }
  for (const guard of stack) {
    if (historyEntries.includes(guard.id)) continue;
    history.pushState({ ...history.state, backGuard: true, k: historyEntries.length + 1 }, "");
    historyEntries.push(guard.id);
  }
}

function onPopState(event: Event) {
  if (!internalBackPending && !historyEntries.length) return;
  handledPops.add(event);
  const id = historyEntries.pop();
  if (internalBackPending) {
    internalBackPending = false;
    reconcileHistory();
    return;
  }
  /* ورودی مصرف‌شده را پیش از close حذف می‌کنیم تا cleanup همان لایه
     دوباره history.back() نزند؛ close می‌تواند لایهٔ دیگری هم باز کند. */
  const i = stack.findIndex((guard) => guard.id === id);
  if (i !== -1) {
    const [guard] = stack.splice(i, 1);
    guard.close();
  }
  reconcileHistory();
}

export function observeGuardHistory() {
  if (listening) return;
  listening = true;
  // Native events run microtasks between listeners. Inspect the old overlay
  // entries before the router's listener can reactivate a cached destination
  // and register its guards for this same route pop.
  window.addEventListener("popstate", onPopState, true);
}

/** یک لایهٔ قابل‌بستن باز شد: ورودی تاریخچه push و close ثبت می‌شود. */
export function pushGuard(close: () => void): symbol {
  return registerGuard(close, nextGuardOrder());
}

/** React restores descendants before parents: batch and keep original opening order. */
export function pushOrderedGuard(close: () => void, order: number): symbol {
  if (!registrationsPending) {
    registrationsPending = true;
    queueMicrotask(() => {
      registrationsPending = false;
      reconcileHistory();
    });
  }
  return registerGuard(close, order);
}

function registerGuard(close: () => void, order: number): symbol {
  observeGuardHistory();
  const id = Symbol("back-guard");
  stack.push({ id, close, order });
  stack.sort((a, b) => a.order - b.order);
  reconcileHistory();
  return id;
}

/** لایه به‌شکل برنامه‌ای بسته شد (نه با بازگشت): ورودی‌اش را پس بگیر. */
export function popGuard(id: symbol) {
  const i = stack.findIndex((g) => g.id === id);
  if (i === -1) return;
  stack.splice(i, 1);
  reconcileHistory();
}

/** Visible back controls consume the same top layer as the native back button. */
export function requestBack(): boolean {
  if (internalBackPending) return true;
  if (registrationsPending) {
    registrationsPending = false;
    reconcileHistory();
  }
  if (!stack.length) return false;
  history.back();
  return true;
}
