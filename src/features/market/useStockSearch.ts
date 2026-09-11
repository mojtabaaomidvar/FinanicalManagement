/* هوک جست‌وجوی تک‌سهم — کاربر تایپ می‌کند، سرور روی فهرستِ کشِ‌شده فیلتر می‌کند.

   چرا debounce: هر کلیدِ فشرده‌شده یک درخواست نباشد. ۳۵۰ میلی‌ثانیه سکوت
   کافی است تا تایپِ یک نماد تمام شود.

   چرا شمارندهٔ turn: پاسخ‌ها می‌توانند بی‌ترتیب برسند (کوئریِ کوتاه‌تر
   دیرتر جواب بگیرد). هر درخواست شماره دارد و فقط پاسخِ آخرین شماره در state
   می‌نشیند؛ وگرنه نتیجهٔ «فولا» روی نتیجهٔ «فولاد» می‌نشست.

   کشِ ماژول-سطح نداریم — برخلافِ اسنپ‌شات، این‌جا کوئری متغیر است و سرور
   خودش فهرست را کش کرده؛ پس تکرارِ درخواست هزینهٔ بالادست ندارد. */

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import type { StockSearch } from "@/domain/market/market.types";

const DEBOUNCE_MS = 350;

/** کمترین طولِ کوئری. سرور هم همین را دارد؛ این‌جا فقط درخواستِ بی‌فایده نمی‌زنیم. */
const MIN_CHARS = 2;

export function useStockSearch() {
  const { useCases } = useApp();
  const [query, setQuery] = useState("");
  const [data, setData] = useState<StockSearch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const turn = useRef(0);
  // زنده‌بودنِ کامپوننت: جلوی setState بعد از unmount را می‌گیرد.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    const q = query.trim();
    const mine = ++turn.current;

    if (q.length < MIN_CHARS) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    if (!useCases) return;

    setLoading(true);
    setError(null);

    const t = window.setTimeout(() => {
      useCases.searchStocks
        .execute(q)
        .then((res) => {
          if (!alive.current || mine !== turn.current) return; // پاسخِ کهنه
          setData(res);
          setLoading(false);
        })
        .catch((e: unknown) => {
          if (!alive.current || mine !== turn.current) return;
          setError(e instanceof Error ? e.message : "خطا در جست‌وجوی نماد");
          setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(t);
  }, [query, useCases]);

  const clear = useCallback(() => {
    turn.current++; // پاسخِ در راه را بی‌اعتبار کن
    setQuery("");
    setData(null);
    setError(null);
    setLoading(false);
  }, []);

  return { query, setQuery, data, error, loading, clear, minChars: MIN_CHARS };
}
