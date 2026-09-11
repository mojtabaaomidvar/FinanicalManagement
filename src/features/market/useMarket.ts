/* هوک بازار — دادهٔ مشترک بینِ کاشیِ هاب و صفحه‌ی بازار.

   کشِ ماژول-سطح (۶۰ ثانیه) مانعِ فراخوانیِ پشت‌سرهم می‌شود: سرور خودش
   ۵ دقیقه کش می‌کند، این لایه فقط از اسپامِ درخواستِ «هر رندر» جلوگیری
   می‌کند. refresh() کشِ کلاینت را دور می‌زند (سرور همچنان تصمیم می‌گیرد). */

import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import type { UseCases } from "@/application/useCases";
import type { MarketSnapshot } from "@/domain/market/market.types";

const CLIENT_TTL_MS = 60_000;

let cached: { at: number; data: MarketSnapshot } | null = null;
let inflight: Promise<MarketSnapshot> | null = null;

/** کشِ کلاینت را بی‌اعتبار می‌کند (مثلاً بعد از به‌روزرسانی اپ). */
export function invalidateMarketCache(): void {
  cached = null;
}

function load(uc: UseCases): Promise<MarketSnapshot> {
  if (cached && Date.now() - cached.at < CLIENT_TTL_MS) return Promise.resolve(cached.data);
  if (!inflight) {
    inflight = uc.getMarketSnapshot
      .execute()
      .then((data) => {
        cached = { at: Date.now(), data };
        return data;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function useMarket() {
  const { useCases } = useApp();
  const [data, setData] = useState<MarketSnapshot | null>(cached?.data ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!cached);

  const fetchSnapshot = useCallback(
    async (force: boolean) => {
      if (!useCases) return;
      if (force) cached = null;
      if (!force && cached && Date.now() - cached.at < CLIENT_TTL_MS) {
        setData(cached.data);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        setData(await load(useCases));
      } catch (e) {
        setError(e instanceof Error ? e.message : "خطا در دریافت قیمت بازار");
      } finally {
        setLoading(false);
      }
    },
    [useCases],
  );

  useEffect(() => {
    void fetchSnapshot(false);
  }, [fetchSnapshot]);

  const refresh = useCallback(() => fetchSnapshot(true), [fetchSnapshot]);

  return { data, error, loading, refresh };
}
