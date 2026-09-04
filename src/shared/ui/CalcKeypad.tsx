/* کیپد ماشین‌حساب مبلغ — چیدمان ۴×۴ پیل: رقم‌ها + عملگرها در ستون چهارم
   فشردن عملگر پس از عبارت کامل، نتیجه را همان‌جا می‌گذارد (محاسبه inline)؛
   ارزیابی امن دو-گذره بدون eval (اولویت ضرب/تقسیم، سپس جمع/تفریق) */

import { toEn, toFa } from "@/shared/lib/digits";

/** ارزیابی امن عبارت «a±×÷b±×÷c…» — اولویت ضرب/تقسیم، سپس جمع/تفریق */
export function evaluateExpression(raw: string): number | null {
  const s = toEn(raw).replace(/,/g, "").replace(/\s+/g, "");
  if (!s) return null;
  if (!/^[\d+\-×÷.]+$/.test(s)) return null;

  const tokens = s.match(/\d+(?:\.\d+)?|[+\-×÷]/g);
  if (!tokens || tokens.length === 0) return null;
  if (!/^\d/.test(tokens[0])) return null;

  /* جمله‌ها: term با علامت sign جمع می‌شوند؛ ×÷ درون جمله فوری اعمال می‌شود */
  let total = 0;
  let sign = 1;
  let term = parseFloat(tokens[0]);
  let i = 1;

  while (i < tokens.length) {
    const op = tokens[i++];
    const numTok = tokens[i++];
    if (numTok === undefined || !/^\d/.test(numTok)) return null;
    const n = parseFloat(numTok);

    if (op === "×" || op === "÷") {
      if (op === "÷" && n === 0) return null;
      term = op === "×" ? term * n : term / n;
    } else {
      total += sign * term;
      sign = op === "+" ? 1 : -1;
      term = n;
    }
  }
  total += sign * term;
  return isFinite(total) ? total : null;
}

const KEYS = [
  "۱", "۲", "۳", "÷",
  "۴", "۵", "۶", "×",
  "۷", "۸", "۹", "-",
  "۰۰۰", "۰", "⌫", "+",
] as const;

const OPS = ["+", "-", "×", "÷"] as const;

export function CalcKeypad({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  function press(k: string) {
    if (k === "⌫") {
      onChange(value.slice(0, -1));
      return;
    }
    if (k === "۰۰۰") {
      const digits = toEn(value).replace(/[^\d]/g, "");
      onChange(digits ? toFa(digits + "000") : "");
      return;
    }
    if ((OPS as readonly string[]).includes(k)) {
      if (!value) return;
      const last = value.slice(-1);
      if ((OPS as readonly string[]).includes(last)) {
        /* جایگزینی عملگر قبلی */
        onChange(value.slice(0, -1) + k);
        return;
      }
      /* عبارت کامل → نتیجه + عملگر جدید (محاسبه inline) */
      if ((OPS as readonly string[]).some((op) => value.includes(op))) {
        const r = evaluateExpression(value);
        if (r !== null) {
          onChange(toFa(Math.round(r).toLocaleString("en-US")) + k);
          return;
        }
      }
      onChange(value + k);
      return;
    }
    onChange(value + k);
  }

  return (
    <div className="calc-pad" dir="ltr">
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          className={`calc-key ${(OPS as readonly string[]).includes(k) ? "op" : ""} ${k === "⌫" ? "back" : ""}`}
          aria-label={k === "⌫" ? "پاک‌کردن رقم آخر" : `درج ${k}`}
          onClick={() => press(k)}
        >
          {k}
        </button>
      ))}
    </div>
  );
}
