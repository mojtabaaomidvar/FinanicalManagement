/* کیپد ماشین‌حساب مبلغ — چهار عمل اصلی + ارزیابی امن (بدون eval)
   عبارت در همان فیلد مبلغ نمایش داده می‌شود؛ = نتیجه را می‌گذارد */

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
  "۷", "۸", "۹", "÷",
  "۴", "۵", "۶", "×",
  "۱", "۲", "۳", "-",
  "۰", "۰۰۰", "⌫", "+",
] as const;

export function CalcKeypad({
  value,
  onChange,
  onDone,
}: {
  value: string;
  onChange: (v: string) => void;
  /** = — ارزیابی و جای‌گذاری نتیجه */
  onDone: (v: string) => void;
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
    if (["+", "-", "×", "÷"].includes(k)) {
      if (!value) return;
      const last = value.slice(-1);
      if (["+", "-", "×", "÷"].includes(last)) {
        onChange(value.slice(0, -1) + k);
      } else {
        onChange(value + k);
      }
      return;
    }
    onChange(value + k);
  }

  function equals() {
    const r = evaluateExpression(value);
    if (r === null) return;
    onDone(toFa(Math.round(r).toLocaleString("en-US")));
  }

  return (
    <div className="calc-pad" dir="ltr">
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          className={`calc-key ${["+", "-", "×", "÷"].includes(k) ? "op" : ""}`}
          onClick={() => press(k)}
        >
          {k}
        </button>
      ))}
      <button type="button" className="calc-key eq" onClick={equals}>
        =
      </button>
    </div>
  );
}
