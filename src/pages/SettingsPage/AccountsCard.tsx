/* زیرصفحه «کارت‌ها و حساب‌ها»ی تنظیمات.
   این فایل عمداً پوسته‌ی نازکی روی features/accounts است: پیاده‌سازی
   قبلی یک نسخه‌ی جداگانه و ناهمگون بود (بدون موجودی، بدون تفکیک
   کیف‌پول، فرم افزودن محدودتر) و همان تفاوت‌ها باگ گزارش‌شده بود. */

import { AccountsFeature, useAccountsModel } from "@/features/accounts";
import { useLayoutEffect, useRef } from "react";
import { PageActivityContext } from "@/shared/lib/pageActivity";
import { useWalletTransactionNavigation } from "@/features/accounts/model/useWalletTransactionNavigation";
import { WalletTransactionsFeature } from "@/features/accounts/ui/WalletTransactionsFeature";

export function AccountsCard() {
  const m = useAccountsModel();
  const navigation = useWalletTransactionNavigation(m.accounts);
  const root = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string | null, number>());
  const previous = useRef(navigation.selected);
  const identity = useRef(navigation.identity);
  if (identity.current !== navigation.identity) { identity.current = navigation.identity; positions.current.clear(); }
  if (previous.current !== navigation.selected) {
    const scroll = root.current?.closest(".page-scroll");
    if (scroll) positions.current.set(previous.current, scroll.scrollTop);
    previous.current = navigation.selected;
  }
  useLayoutEffect(() => {
    if (!navigation.active) return;
    const scroll = root.current?.closest(".page-scroll");
    if (scroll) scroll.scrollTop = positions.current.get(navigation.selected) ?? 0;
  }, [navigation.selected, navigation.active, navigation.identity]);
  return <div ref={root}>
    <PageActivityContext.Provider value={navigation.active && navigation.selected === null}>
      <div hidden={navigation.selected !== null}><AccountsFeature key={navigation.identity} m={m} onOpenTransactions={navigation.open} /></div>
    </PageActivityContext.Provider>
    {navigation.visited.map(id => <PageActivityContext.Provider key={`${navigation.identity}:${id}`} value={navigation.active && navigation.selected === id}>
      <div hidden={navigation.selected !== id}><WalletTransactionsFeature embedded account={m.accounts.find(account => account.id === id)} balance={m.walletBalances.rows.get(id)}
        onBack={navigation.back} onRefresh={m.walletBalances.refresh} /></div>
    </PageActivityContext.Provider>)}
  </div>;
}
