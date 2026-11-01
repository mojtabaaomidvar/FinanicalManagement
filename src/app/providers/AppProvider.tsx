/* Context اپ — تأمین use-cases و داده خانواده برای UI */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getContainer } from "@/infrastructure/repositories/container";
import { createUseCases, type UseCases } from "@/application/useCases";
import type { Member, Family } from "@/domain/family/family.types";
import type { Transaction } from "@/domain/transaction/transaction.types";
import type { Account } from "@/domain/account/account.types";
import type { Subcategory } from "@/domain/category/subcategory.types";
import type { CustomCategory } from "@/domain/category/custom-category.types";
import type { CategoryBudget } from "@/domain/category/category-budget.types";
import type { FamilyEvent } from "@/domain/event/event.types";
import type { Bill } from "@/domain/bill/bill.types";
import type {
  InventoryItem,
  ShoppingList,
} from "@/domain/shopping/shopping.types";

type Phase = "boot" | "auth" | "ready";

interface AppState {
  phase: Phase;
  member: Member | null;
  family: Family | null;
  members: Member[];
  txs: Transaction[];
  accounts: Account[];
  subcategories: Subcategory[];
  customCategories: CustomCategory[];
  events: FamilyEvent[];
  bills: Bill[];
  /** §۱.۸ — لیست‌های خرید با اقلامِ نخریده‌شان */
  shoppingLists: ShoppingList[];
  /** §۱.۸ — انبار خانه. این‌جا در حالتِ سراسری است چون اعلانِ کمبودِ §۷
      از آن مشتق می‌شود و نباید منتظرِ بازشدنِ صفحهٔ انبار بماند. */
  inventory: InventoryItem[];
  budgets: CategoryBudget[];
  /** واحد پول نمایشی کاربر فعلی (v5.8) — شخصی است، نه خانوادگی.
      تنها منبع مجاز برای toDisplay/fromDisplay در سراسر UI. */
  cur: string;
  useCases: UseCases | null;
  refreshData: () => Promise<void>;
  /** به‌روزرسانی عضو فعلی پس از ذخیره پروفایل */
  updateMember: (m: Member) => void;
  /* فراخوانی پس از ورود موفق */
  onAuthenticated: (r: {
    member: Member;
    family: Family;
    members: Member[];
  }) => void;
  onLoggedOut: () => void;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("boot");
  const [member, setMember] = useState<Member | null>(null);
  const [family, setFamily] = useState<Family | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [customCategories, setCustomCategories] = useState<CustomCategory[]>(
    [],
  );
  const [events, setEvents] = useState<FamilyEvent[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [shoppingLists, setShoppingLists] = useState<ShoppingList[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [budgets, setBudgets] = useState<CategoryBudget[]>([]);
  const [useCases, setUseCases] = useState<UseCases | null>(null);

  /* راه‌اندازی: container + بازیابی نشست */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const c = await getContainer();
      const uc = createUseCases(c);
      if (cancelled) return;
      setUseCases(uc);

      const restored = await uc.restoreSession.execute();
      if (cancelled) return;
      if (restored) {
        setMember(restored.member);
        setFamily(restored.family);
        setMembers(restored.members);
        setPhase("ready");
      } else {
        setPhase("auth");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshData = useMemo(
    () => async () => {
      if (!useCases) return;

      const [
        familyRow,
        memberRows,
        txRows,
        accountRows,
        subRows,
        customCatRows,
        eventRows,
        budgetRows,
        billRows,
        shoppingRows,
        inventoryRows,
      ] = await Promise.all([
        useCases.getFamily.execute(),
        useCases.getMembers.execute(),
        useCases.listTransactions.execute(),
        useCases.listAccounts.execute(),
        useCases.listSubcategories.execute(),
        useCases.listCustomCategories.execute(),
        useCases.listEvents.execute(),
        /* RPC جدید — تا زمان اجرای schema.sql روی سرور ممکن است نباشد */
        useCases.listCategoryBudgets.execute().catch(() => []),
        /* §۱.۹ قبوض — تا اجرای مهاجرتِ 0010 روی سرور ممکن است ۴۰۴/۵۰۰ بدهد.
           همان الگوی بودجهٔ دسته: خطا فهرستِ خالی می‌شود تا نرم‌افزارِ
           به‌روزشده روی سرورِ به‌روزنشده هم بالا بیاید، نه اینکه کلِ
           بارگذاریِ داده بشکند. */
        useCases.listBills.execute().catch(() => []),
        /* §۱.۸ خرید و انبار — همان الگو، برای مهاجرتِ 0011 */
        useCases.listShoppingLists.execute().catch(() => []),
        useCases.listInventory.execute().catch(() => []),
      ]);
      setFamily(familyRow);
      setMembers(memberRows);
      setTxs(txRows);
      setAccounts(accountRows);
      setSubcategories(subRows);
      setCustomCategories(customCatRows);
      setEvents(eventRows);
      setBudgets(budgetRows);
      setBills(billRows);
      setShoppingLists(shoppingRows);
      setInventory(inventoryRows);
    },
    [useCases],
  );

  const value = useMemo<AppState>(
    () => ({
      phase,
      member,
      family,
      members,
      txs,
      accounts,
      subcategories,
      customCategories,
      events,
      budgets,
      bills,
      shoppingLists,
      inventory,
      cur: member?.currency === "ریال" ? "ریال" : "تومان",
      useCases,
      refreshData,
      /* هر عضو به‌روزشده‌ای را می‌پذیرد؛ member فعلی فقط وقتی جابه‌جا
         می‌شود که همان عضو باشد — وگرنه ویرایش عضو دیگر توسط مدیر،
         هویت کاربر جاری را عوض می‌کرد */
      updateMember: (m: Member) => {
        setMember((prev) => (prev?.id === m.id ? m : prev));
        setMembers((prev) => prev.map((x) => (x.id === m.id ? m : x)));
      },
      onAuthenticated: (r) => {
        setMember(r.member);
        setFamily(r.family);
        setMembers(r.members);
        setPhase("ready");
      },
      onLoggedOut: () => {
        setMember(null);
        setFamily(null);
        setMembers([]);
        setTxs([]);
        setAccounts([]);
        setSubcategories([]);
        setCustomCategories([]);
        setEvents([]);
        setBudgets([]);
        setBills([]);
        setPhase("auth");
      },
    }),
    [
      phase,
      member,
      family,
      members,
      txs,
      accounts,
      subcategories,
      customCategories,
      events,
      budgets,
      bills,
      shoppingLists,
      inventory,
      useCases,
      refreshData,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp باید داخل AppProvider استفاده شود");
  return ctx;
}
