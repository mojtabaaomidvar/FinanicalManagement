/* Context اپ — تأمین use-cases و داده خانواده برای UI */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { getContainer } from "@/infrastructure/repositories/container";
import { createUseCases, type UseCases } from "@/application/useCases";
import type { ShoppingOfflineEngine } from "@/infrastructure/offline/shoppingOffline";
import { offlineLists, offlineInventory } from "@/domain/shopping/offline.view";
import type { OfflineTaskNotificationPrefs, ShoppingOfflineState } from "@/domain/shopping/offline.types";
import type { Task } from "@/domain/task/task.types";
import { useToast } from "./ToastProvider";
import { offlineTasks } from "@/domain/task/task.view";
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

interface ShoppingSyncStatus {
  offline: boolean;
  pendingCount: number;
  syncing: boolean;
  lastSyncedAt: string | null;
  storageAvailable: boolean;
  issues: Array<{ operationId: string; message: string }>;
}

const emptySync: ShoppingSyncStatus = { offline: false, pendingCount: 0, syncing: false,
  lastSyncedAt: null, storageAvailable: true, issues: [] };
const defaultTaskPrefs: OfflineTaskNotificationPrefs = { enabled: true, tasks_enabled: true, lead_days: 0 };

function syncStatus(state: ShoppingOfflineState): ShoppingSyncStatus {
  return { offline: state.offline, pendingCount: state.pending.length, syncing: state.syncing,
    lastSyncedAt: state.lastSyncedAt, storageAvailable: state.storageAvailable,
    issues: state.issues.map((issue) => ({ operationId: issue.operation.operation_id,
      message: issue.message ?? "این تغییر به بررسی نیاز دارد." })) };
}

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
  billDataStatus: "loading" | "ready" | "error";
  /** §۱.۸ — لیست‌های خرید با اقلامِ نخریده‌شان */
  shoppingLists: ShoppingList[];
  /** §۱.۸ — انبار خانه. این‌جا در حالتِ سراسری است چون اعلانِ کمبودِ §۷
      از آن مشتق می‌شود و نباید منتظرِ بازشدنِ صفحهٔ انبار بماند. */
  inventory: InventoryItem[];
  tasks: Task[];
  taskNotificationPrefs: OfflineTaskNotificationPrefs;
  refreshTasks: () => Promise<ShoppingSyncStatus>;
  budgets: CategoryBudget[];
  budgetDataStatus: "loading" | "ready" | "error";
  /** واحد پول نمایشی کاربر فعلی (v5.8) — شخصی است، نه خانوادگی.
      منبع نمایش است؛ هر پیش‌نویس واحد ورودیِ مستقل و مقدار دقیق دارد. */
  cur: string;
  currencyBusy: boolean;
  changeDisplayCurrency: (next: string) => Promise<void>;
  useCases: UseCases | null;
  refreshData: () => Promise<void>;
  shoppingSync: ShoppingSyncStatus;
  offlineSession: boolean;
  /** Readiness of the existing data used by the household overview. */
  homeDataStatus: { loading: boolean; incomplete: boolean };
  discardShoppingChange: (id: string) => Promise<void>;
  retryShoppingSync: () => Promise<void>;
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
  const { show } = useToast();
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
  const [billDataStatus, setBillDataStatus] = useState<"loading" | "ready" | "error">("loading");
  const [shoppingLists, setShoppingLists] = useState<ShoppingList[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskNotificationPrefs, setTaskNotificationPrefs] = useState(defaultTaskPrefs);
  const [budgets, setBudgets] = useState<CategoryBudget[]>([]);
  const [budgetDataStatus, setBudgetDataStatus] = useState<"loading" | "ready" | "error">("loading");
  const [useCases, setUseCases] = useState<UseCases | null>(null);
  const [offlineEngine, setOfflineEngine] = useState<ShoppingOfflineEngine | null>(null);
  const [shoppingSync, setShoppingSync] = useState<ShoppingSyncStatus>(emptySync);
  const [offlineSession, setOfflineSession] = useState(false);
  const [homeSnapshot, setHomeSnapshot] = useState<{
    scope: string; loading: boolean; incomplete: boolean;
  } | null>(null);
  const homeScope = `${phase}:${member?.id ?? ""}:${family?.id ?? ""}`;
  const homeRestricted = offlineSession || shoppingSync.offline
    || (typeof navigator !== "undefined" && navigator.onLine === false);
  const homeDataStatus = useMemo(() => phase !== "ready"
    ? { loading: false, incomplete: false }
    : homeRestricted ? { loading: false, incomplete: true }
      : homeSnapshot?.scope === homeScope
        ? { loading: homeSnapshot.loading, incomplete: homeSnapshot.incomplete }
        : { loading: true, incomplete: false }, [phase, homeRestricted, homeSnapshot, homeScope]);
  const identity = useRef({ phase, memberId: member?.id, familyId: family?.id });
  const currencyEpoch = useRef(0);
  const identityChanged = identity.current.phase !== phase || identity.current.memberId !== member?.id || identity.current.familyId !== family?.id;
  if (identityChanged) currencyEpoch.current += 1;
  const [currencyRequest, setCurrencyRequest] = useState<{ scope: string; unit: string } | null>(null);
  const currencyWriting = useRef<string | null>(null);
  const currencyScope = `${phase}:${member?.familyId ?? ""}:${member?.id ?? ""}:${currencyEpoch.current}`;
  const currencyBusy = currencyRequest?.scope === currencyScope;
  const displayCurrency = currencyBusy ? currencyRequest.unit : member?.currency === "ریال" ? "ریال" : "تومان";
  async function changeDisplayCurrency(next: string) {
    if (phase !== "ready" || !member || !useCases || !["ریال", "تومان"].includes(next) || currencyWriting.current === currencyScope) return;
    const scope = currencyScope, memberId = member.id, familyId = member.familyId, epoch = currencyEpoch.current;
    currencyWriting.current = scope; setCurrencyRequest({ scope, unit: next });
    const current = () => mounted.current && currencyEpoch.current === epoch && identity.current.phase === "ready"
      && identity.current.memberId === memberId && identity.current.familyId === familyId;
    try {
      const updated = await useCases.setCurrency.execute(next);
      if (!current()) return;
      if (updated.id !== memberId || updated.familyId !== familyId) throw new Error("پاسخ تغییر واحد نمایش با حساب شما سازگار نیست.");
      // A currency response must not overwrite a newer profile or another identity.
      setMember(previous => previous?.id === memberId ? { ...previous, currency: updated.currency } : previous);
      setMembers(previous => previous.map(item => item.id === memberId ? { ...item, currency: updated.currency } : item));
    } catch (error) {
      if (current()) show((error instanceof Error ? error.message : "") || "تغییر واحد نمایش ذخیره نشد؛ دوباره تلاش کنید.");
    } finally {
      if (currencyWriting.current === scope) currencyWriting.current = null;
      setCurrencyRequest(previous => previous?.scope === scope ? null : previous);
    }
  }
  const dataGeneration = useRef(0);
  const mounted = useRef(true);
  if (identityChanged) dataGeneration.current += 1;
  identity.current = { phase, memberId: member?.id, familyId: family?.id };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; dataGeneration.current += 1; };
  }, []);

  /* راه‌اندازی: container + بازیابی نشست */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const c = await getContainer();
      const uc = createUseCases(c);
      if (cancelled) return;
      setUseCases(uc);
      setOfflineEngine(c.shoppingOffline);

      const restored = await uc.restoreSession.execute();
      if (cancelled) return;
      if (restored) {
        setOfflineSession(Boolean(restored.offline));
        if (!restored.offline) {
          await c.shoppingOffline.initialize({ familyId: restored.family.id, memberId: restored.member.id,
            familyName: restored.family.name, validatedAt: new Date().toISOString() });
          if (cancelled) return;
        }
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

  useEffect(() => {
    if (!offlineEngine || phase !== "ready") return;
    let active = true;
    const update = async () => {
      const state = await offlineEngine.readState();
      if (!active) return;
      setShoppingSync(syncStatus(state));
      if (!state.scope) {
        setShoppingLists([]); setInventory([]); setTasks([]); setTaskNotificationPrefs(defaultTaskPrefs); setTxs([]); setAccounts([]);
        setMembers([]); setBills([]); setBudgets([]); setEvents([]);
        setOfflineSession(true); setPhase("auth");
        return;
      }
      if (state.scope.memberId !== member?.id || state.scope.familyId !== family?.id) return;
      if (state.offline || state.pending.length) setShoppingLists((previous) => {
        const rows = offlineLists(state.view);
        if (state.offline) return rows;
        const prices = new Map(previous.flatMap((row) => row.items.map((item) => [item.id, item.price] as const)));
        return rows.map((row) => ({ ...row, items: row.items.map((item) => ({ ...item, price: prices.get(item.id) ?? null })) }));
      });
      setInventory(offlineInventory(state.view));
      setTasks(offlineTasks(state.view));
      setTaskNotificationPrefs(state.view.task_notification_prefs ?? defaultTaskPrefs);
      if (state.offline) {
        setTxs([]); setAccounts([]); setBills([]); setBudgets([]); setMembers([]);
        setEvents([]); setSubcategories([]); setCustomCategories([]);
      }
    };
    const unsubscribe = offlineEngine.subscribe(() => { void update(); });
    void update();
    return () => { active = false; unsubscribe(); };
  }, [offlineEngine, phase, member?.id, family?.id]);

  const refreshData = useMemo(
    () => async () => {
      if (!useCases) return;
      const actor = identity.current;
      const request = ++dataGeneration.current;
      const requestScope = `${actor.phase}:${actor.memberId ?? ""}:${actor.familyId ?? ""}`;
      setHomeSnapshot({ scope: requestScope, loading: true, incomplete: false });
      setBillDataStatus("loading");
      setBudgetDataStatus("loading");
      let incomplete = !offlineEngine;
      setEvents((rows) => rows.filter((row) => row.kind !== "activity"));
      const stillCurrent = () => mounted.current && dataGeneration.current === request && navigator.onLine !== false
        && identity.current.phase === actor.phase
        && identity.current.memberId === actor.memberId && identity.current.familyId === actor.familyId;
      try {
        const cached = await offlineEngine?.refresh();
        if (!stillCurrent()) return;
        if (cached) {
          incomplete = incomplete || cached.offline || !cached.scope
            || cached.scope.memberId !== actor.memberId || cached.scope.familyId !== actor.familyId;
          setShoppingSync(syncStatus(cached));
          if (cached.offline || cached.pending.length) setShoppingLists((previous) => {
            const rows = offlineLists(cached.view);
            if (cached.offline) return rows;
            const prices = new Map(previous.flatMap((row) => row.items.map((item) => [item.id, item.price] as const)));
            return rows.map((row) => ({ ...row, items: row.items.map((item) => ({ ...item, price: prices.get(item.id) ?? null })) }));
          });
          setInventory(offlineInventory(cached.view));
          setTasks(offlineTasks(cached.view));
          setTaskNotificationPrefs(cached.view.task_notification_prefs ?? defaultTaskPrefs);
          if (cached.offline || !cached.scope) return;
        }

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
          useCases.syncBirthdays.execute().then(() => {
            if (!stillCurrent()) return [];
            return useCases.listEvents.execute();
          }),
          /* A failed budget read must not look like an empty allocation. */
          useCases.listCategoryBudgets.execute().catch(() => { incomplete = true; return null; }),
          /* Keep other modules available while exposing a distinct bill read
             failure. Previously fetched bills must not become a false empty list. */
          useCases.listBills.execute().catch(() => { incomplete = true; return null; }),
          /* §۱.۸ خرید و انبار — همان الگو، برای مهاجرتِ 0011 */
          useCases.listShoppingLists.execute().catch(() => { incomplete = true; return []; }),
          useCases.listInventory.execute().catch(() => { incomplete = true; return []; }),
        ]);
        if (!stillCurrent()) return;
        setFamily(familyRow);
        setMembers(memberRows);
        setTxs(txRows);
        setAccounts(accountRows);
        setSubcategories(subRows);
        setCustomCategories(customCatRows);
        setEvents(eventRows);
        if (budgetRows !== null) setBudgets(budgetRows);
        setBudgetDataStatus(budgetRows === null ? "error" : "ready");
        if (billRows !== null) setBills(billRows);
        setBillDataStatus(billRows === null ? "error" : "ready");
        setShoppingLists(shoppingRows);
        setInventory(inventoryRows);
        const current = await useCases.restoreSession.execute();
        if (!current || current.offline) incomplete = true;
        if (stillCurrent() && current && !current.offline) { setMember(current.member); setOfflineSession(false); }
      } catch (error) {
        incomplete = true;
        if (stillCurrent()) { setBillDataStatus("error"); setBudgetDataStatus("error"); }
        throw error;
      } finally {
        if (stillCurrent()) setHomeSnapshot({ scope: requestScope, loading: false, incomplete });
      }
    },
    [useCases, offlineEngine],
  );

  useEffect(() => {
    const disconnect = () => { dataGeneration.current += 1; setEvents([]); setHomeSnapshot(null); };
    const reconnect = () => { void refreshData().catch(() => undefined); };
    window.addEventListener("offline", disconnect);
    window.addEventListener("online", reconnect);
    return () => {
      window.removeEventListener("offline", disconnect);
      window.removeEventListener("online", reconnect);
    };
  }, [refreshData]);

  useEffect(() => { setEvents([]); setHomeSnapshot(null); }, [phase, member?.id, family?.id]);

  const refreshTasks = useMemo(
    () => async () => {
      if (!offlineEngine) throw new Error("اطلاعات کارها هنوز آماده نیست.");
      const actor = identity.current;
      const state = await offlineEngine.refresh();
      if (identity.current.phase !== actor.phase || identity.current.memberId !== actor.memberId
        || identity.current.familyId !== actor.familyId) throw new Error("نشست تغییر کرده است؛ دوباره وارد شوید.");
      if (!state.scope || state.scope.memberId !== actor.memberId || state.scope.familyId !== actor.familyId) {
        throw new Error(state.issues[0]?.message ?? "برای ادامه دوباره وارد شوید.");
      }
      setShoppingSync(syncStatus(state));
      setTasks(offlineTasks(state.view));
      setTaskNotificationPrefs(state.view.task_notification_prefs ?? defaultTaskPrefs);
      return syncStatus(state);
    },
    [offlineEngine],
  );

  const wasOffline = useRef(false);
  const reconnecting = useRef(false);
  useEffect(() => {
    if (shoppingSync.offline) wasOffline.current = true;
    if (phase !== "ready" || shoppingSync.offline || shoppingSync.syncing || reconnecting.current) return;
    if (!wasOffline.current && !offlineSession) return;
    wasOffline.current = false;
    reconnecting.current = true;
    void refreshData().catch(() => undefined).finally(() => { reconnecting.current = false; });
  }, [phase, shoppingSync.offline, shoppingSync.syncing, offlineSession, refreshData]);

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
      budgetDataStatus: homeRestricted ? "error" : homeSnapshot?.scope === homeScope ? budgetDataStatus : "loading",
      bills,
      billDataStatus: homeRestricted ? "error" : homeSnapshot?.scope === homeScope ? billDataStatus : "loading",
      shoppingLists,
      inventory,
      tasks,
      taskNotificationPrefs,
      refreshTasks,
      cur: displayCurrency,
      currencyBusy,
      changeDisplayCurrency,
      useCases,
      refreshData,
      shoppingSync,
      offlineSession,
      homeDataStatus,
      discardShoppingChange: async (id) => { await offlineEngine?.discard(id); },
      retryShoppingSync: async () => { await refreshData(); },
      /* هر عضو به‌روزشده‌ای را می‌پذیرد؛ member فعلی فقط وقتی جابه‌جا
         می‌شود که همان عضو باشد — وگرنه ویرایش عضو دیگر توسط مدیر،
         هویت کاربر جاری را عوض می‌کرد */
      updateMember: (m: Member) => {
        setMember((prev) => (prev?.id === m.id ? m : prev));
        setMembers((prev) => prev.map((x) => (x.id === m.id ? m : x)));
      },
      onAuthenticated: (r) => {
        void (async () => {
          await offlineEngine?.initialize({ familyId: r.family.id, memberId: r.member.id,
            familyName: r.family.name, validatedAt: new Date().toISOString() });
          setOfflineSession(false); setMember(r.member); setFamily(r.family);
          setMembers(r.members); setPhase("ready");
        })();
      },
      onLoggedOut: () => {
        identity.current = { phase: "auth", memberId: undefined, familyId: undefined };
        setMember(null);
        setHomeSnapshot(null);
        setFamily(null);
        setMembers([]);
        setTxs([]);
        setAccounts([]);
        setSubcategories([]);
        setCustomCategories([]);
        setEvents([]);
        setBudgets([]);
        setBudgetDataStatus("loading");
        setBills([]);
        setBillDataStatus("loading");
        setShoppingLists([]); setInventory([]); setTasks([]); setTaskNotificationPrefs(defaultTaskPrefs); setShoppingSync(emptySync); setOfflineSession(false);
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
      billDataStatus,
      budgetDataStatus,
      homeRestricted,
      homeScope,
      homeSnapshot,
      shoppingLists,
      inventory,
      tasks,
      taskNotificationPrefs,
      refreshTasks,
      useCases,
      refreshData,
      offlineEngine,
      shoppingSync,
      offlineSession,
      homeDataStatus,
      displayCurrency,
      currencyBusy,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp باید داخل AppProvider استفاده شود");
  return ctx;
}
