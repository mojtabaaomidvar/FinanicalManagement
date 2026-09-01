/* Context اپ — تأمین use-cases و داده خانواده برای UI */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
import type { FamilyEvent } from "@/domain/event/event.types";

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
  const [useCases, setUseCases] = useState<UseCases | null>(null);
  const seeded = useRef(false);

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

      /* seed زیردسته‌های پیش‌فرض فقط یک‌بار در هر نشست */
      if (!seeded.current) {
        try {
          await useCases.ensureDefaultSubcategories.execute();
        } catch {
          /* بی‌صدا */
        }
        seeded.current = true;
      }

      const [
        familyRow,
        memberRows,
        txRows,
        accountRows,
        subRows,
        customCatRows,
        eventRows,
      ] = await Promise.all([
        useCases.getFamily.execute(),
        useCases.getMembers.execute(),
        useCases.listTransactions.execute(),
        useCases.listAccounts.execute(),
        useCases.listSubcategories.execute(),
        useCases.listCustomCategories.execute(),
        useCases.listEvents.execute(),
      ]);
      setFamily(familyRow);
      setMembers(memberRows);
      setTxs(txRows);
      setAccounts(accountRows);
      setSubcategories(subRows);
      setCustomCategories(customCatRows);
      setEvents(eventRows);
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
      useCases,
      refreshData,
      updateMember: (m: Member) => {
        setMember(m);
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
        seeded.current = false;
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
