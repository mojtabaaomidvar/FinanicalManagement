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

type Phase = "boot" | "auth" | "ready";

interface AppState {
  phase: Phase;
  member: Member | null;
  family: Family | null;
  members: Member[];
  txs: Transaction[];
  useCases: UseCases | null;
  refreshData: () => Promise<void>;
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
      const [familyRow, memberRows, txRows] = await Promise.all([
        useCases.getFamily.execute(),
        useCases.getMembers.execute(),
        useCases.listTransactions.execute(),
      ]);
      setFamily(familyRow);
      setMembers(memberRows);
      setTxs(txRows);
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
      useCases,
      refreshData,
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
        setPhase("auth");
      },
    }),
    [phase, member, family, members, txs, useCases, refreshData],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp باید داخل AppProvider استفاده شود");
  return ctx;
}
