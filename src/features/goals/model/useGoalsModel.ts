import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import type { Goal, GoalInput, GoalKind, GoalStatus } from "@/domain/goal/goal.types";
import { goalError, goalInput } from "@/domain/goal/goal.rules";
import { isAppError } from "@/shared/lib/appError";
import { formatISO, isoToJalali, jalaliToIso, parse } from "@/shared/lib/jalali";
import { useOnline } from "@/shared/lib/useOnline";
import { filterGoals, type GoalKindFilter, type GoalStatusFilter } from "./goalPresentation";
import { GoalSession, type GoalTicket } from "./goalSession";

export interface GoalForm { kind: GoalKind; title: string; note: string; date: string; status: GoalStatus; reminder: boolean }
type Dialog = { ticket: GoalTicket; kind: "item"; item: Goal | null } | { ticket: GoalTicket; kind: "delete"; item: Goal };
const emptyForm = (): GoalForm => ({ kind: "goal", title: "", note: "", date: "", status: "active", reminder: true });
const messageOf = (error: unknown) => error instanceof Error ? error.message : "انجام عملیات ناموفق بود. دوباره تلاش کنید.";
const dateValue = (value: string) => {
  if (!value.trim()) return null;
  const day = parse(value);
  if (!day) throw new Error("موعد را دوباره انتخاب کنید.");
  return jalaliToIso(day);
};

export function useGoalsModel(initialGoalId?: string, onChanged?: () => void | Promise<void>, onInitialGoalConsumed?: () => void) {
  const { phase, member, family, useCases, shoppingSync, offlineSession } = useApp();
  const { show } = useToast();
  const online = useOnline();
  const available = phase === "ready" && member?.status === "active" && member.membershipState === "active"
    && Boolean(family && useCases) && online && !shoppingSync.offline && !offlineSession;
  const scope = available ? `${member!.id}:${family!.id}` : "";
  const ownerId = available ? member!.id : "";
  const session = useRef(new GoalSession()).current;
  session.setScope(scope, ownerId);
  const mounted = useRef(true);
  const sequence = useRef(0);
  const detailSequence = useRef(0);
  const pending = useRef(false);
  const handledInitial = useRef("");
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const consumed = useRef(onInitialGoalConsumed);
  consumed.current = onInitialGoalConsumed;
  const [snapshot, setSnapshot] = useState<{ ticket: GoalTicket | null; goals: Goal[]; canCreate: boolean }>({ ticket: null, goals: [], canCreate: false });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<GoalKindFilter>("all");
  const [statusFilter, setStatusFilter] = useState<GoalStatusFilter>("all");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [detail, setDetail] = useState<{ ticket: GoalTicket; id: string } | null>(null);
  const [form, setForm] = useState<GoalForm>(emptyForm);
  const [formError, setFormError] = useState("");
  const [conflict, setConflict] = useState(false);
  const current = useCallback((ticket: GoalTicket) => mounted.current && session.isCurrent(ticket), [session]);
  const hasSnapshot = available && !accessDenied && snapshot.ticket !== null && session.isCurrent(snapshot.ticket);
  const items = hasSnapshot ? snapshot.goals.filter((goal) => goal.ownerId === ownerId) : [];
  const canCreate = hasSnapshot && snapshot.canCreate;
  const visible = useMemo(() => filterGoals(items, kindFilter, statusFilter, query), [items, kindFilter, statusFilter, query]);
  const activeDialog = available && !accessDenied && dialog && session.isCurrent(dialog.ticket)
    && (dialog.kind === "item" && !dialog.item ? canCreate : dialog.item?.ownerId === ownerId && items.some((goal) => goal.id === dialog.item?.id)) ? dialog : null;
  const detailItem = available && !accessDenied && detail && session.isCurrent(detail.ticket) ? items.find((goal) => goal.id === detail.id) : undefined;

  const clearForm = useCallback(() => { setDialog(null); setForm(emptyForm()); setFormError(""); setConflict(false); }, []);
  const forget = useCallback(() => {
    sequence.current += 1; detailSequence.current += 1; pending.current = false;
    setSnapshot({ ticket: null, goals: [], canCreate: false }); setDetail(null); clearForm();
    setQuery(""); setKindFilter("all"); setStatusFilter("all"); setBusy(false); setDetailLoading(false);
  }, [clearForm]);
  const deny = useCallback((error: unknown) => {
    if (!isAppError(error) || ![401, 403, 404].includes(error.status ?? 0)
      && !["SESSION_EXPIRED", "FORBIDDEN", "NOT_FOUND"].includes(error.code)) return false;
    session.invalidate(); forget(); setAccessDenied(true); setLoadError(messageOf(error)); setLoading(false);
    return true;
  }, [session, forget]);

  const reload = useCallback(async (silent = false) => {
    if (!scope || !useCases) return;
    const ticket = session.capture();
    const request = ++sequence.current;
    if (!silent) setLoading(true); setLoadError("");
    try {
      const result = await useCases.listGoals.execute();
      if (!current(ticket) || sequence.current !== request) return;
      setSnapshot({ ticket, goals: result.goals.filter((goal) => session.owns(ticket, goal)), canCreate: result.canCreate });
      setAccessDenied(false);
    } catch (error) {
      if (!current(ticket) || sequence.current !== request) return;
      if (!deny(error)) { forget(); setLoadError(messageOf(error)); setLoading(false); }
    } finally { if (current(ticket) && sequence.current === request) setLoading(false); }
  }, [scope, useCases, session, current, deny, forget]);
  useHouseholdRefresh(() => reload(true));

  useEffect(() => {
    mounted.current = true; session.setScope(scope, ownerId);
    return () => { mounted.current = false; session.close(); sequence.current += 1; detailSequence.current += 1; };
  }, [session]);
  useEffect(() => {
    forget(); setAccessDenied(false); setLoadError(""); handledInitial.current = "";
    if (scope) void reload(); else setLoading(false);
  }, [scope, reload, forget]);
  useEffect(() => {
    const disconnect = () => { session.invalidate(); forget(); setLoading(false); };
    const reconnect = () => { session.invalidate(); forget(); if (scope) void reload(); };
    window.addEventListener("offline", disconnect); window.addEventListener("online", reconnect);
    return () => { window.removeEventListener("offline", disconnect); window.removeEventListener("online", reconnect); };
  }, [session, forget, scope, reload]);

  const openDetail = useCallback(async (id: string) => {
    if (!useCases || !scope || busy || accessDenied) return;
    const ticket = session.capture();
    const request = ++detailSequence.current;
    setDetail(null); setDetailLoading(true); setLoadError("");
    try {
      const goal = await useCases.getGoal.execute(id);
      if (!current(ticket) || detailSequence.current !== request) return;
      if (!session.owns(ticket, goal)) { session.invalidate(); forget(); setAccessDenied(true); setLoadError("این مورد در دسترس نیست."); return; }
      setSnapshot((previous) => ({ ticket, canCreate: previous.canCreate,
        goals: [goal, ...previous.goals.filter((item) => item.ownerId === ticket.ownerId && item.id !== goal.id)] }));
      setDetail({ ticket, id: goal.id });
    } catch (error) { if (current(ticket) && detailSequence.current === request && !deny(error)) setLoadError(messageOf(error)); }
    finally { if (current(ticket) && detailSequence.current === request) setDetailLoading(false); }
  }, [useCases, scope, busy, accessDenied, session, current, forget, deny]);
  useEffect(() => {
    if (!initialGoalId) { handledInitial.current = ""; return; }
    if (!hasSnapshot || loading || accessDenied) return;
    const key = `${scope}:${initialGoalId}`;
    if (handledInitial.current === key) return;
    handledInitial.current = key; consumed.current?.(); void openDetail(initialGoalId);
  }, [initialGoalId, hasSnapshot, loading, accessDenied, scope, openDetail]);

  const openItem = (item: Goal | null) => {
    if (!available || busy || accessDenied || (item ? item.ownerId !== ownerId : !canCreate)) return;
    clearForm(); setForm(item ? { kind: item.kind, title: item.title, note: item.note ?? "",
      date: item.targetDate ? formatISO(isoToJalali(item.targetDate)) : "", status: item.status, reminder: item.reminderEnabled } : emptyForm());
    setDialog({ ticket: session.capture(), kind: "item", item });
  };
  const openDelete = (item: Goal) => {
    if (!available || busy || accessDenied || item.ownerId !== ownerId) return;
    clearForm(); setDialog({ ticket: session.capture(), kind: "delete", item });
  };
  const mutate = async (action: () => Promise<Goal | void>, success: string) => {
    if (!available || accessDenied || pending.current) return;
    const ticket = session.capture(); pending.current = true; setBusy(true); setFormError(""); setLoadError("");
    try {
      const result = await action();
      if (!current(ticket)) return;
      if (result && !session.owns(ticket, result)) { session.invalidate(); forget(); setAccessDenied(true); setLoadError("این مورد در دسترس نیست."); return; }
      clearForm(); show(success);
      window.dispatchEvent(new Event("goals-changed"));
      void Promise.resolve(changed.current?.()).catch(() => undefined);
      await reload();
    } catch (error) {
      if (!current(ticket)) return;
      if (!deny(error)) { setFormError(messageOf(error)); setLoadError(messageOf(error)); setConflict(isAppError(error) && (error.code === "CONFLICT" || error.status === 409)); }
    } finally { if (current(ticket)) { pending.current = false; setBusy(false); } }
  };
  const saveItem = () => {
    if (!useCases || activeDialog?.kind !== "item") return;
    try {
      const input: GoalInput = { kind: form.kind, title: form.title, note: form.note, targetDate: dateValue(form.date),
        status: form.status, reminderEnabled: form.reminder };
      const error = goalError(input);
      if (error) { setFormError(error); return; }
      const item = activeDialog.item;
      void mutate(() => item ? useCases.updateGoal.execute(item.id, input, item.revision) : useCases.addGoal.execute(input), "مورد ذخیره شد.");
    } catch (error) { setFormError(messageOf(error)); }
  };
  const toggleStatus = (item: Goal) => {
    if (!useCases || item.ownerId !== ownerId) return;
    const input = { ...goalInput(item), status: item.status === "done" ? "active" as const : "done" as const };
    void mutate(() => useCases.updateGoal.execute(item.id, input, item.revision), input.status === "done" ? "مورد انجام شد." : "مورد دوباره فعال شد.");
  };
  const deleteItem = () => {
    if (!useCases || activeDialog?.kind !== "delete") return;
    const item = activeDialog.item;
    void mutate(async () => { await useCases.deleteGoal.execute(item.id, item.revision); if (current(activeDialog.ticket)) setDetail(null); }, "مورد حذف شد.");
  };

  return { available, items, visible, canCreate, loading, busy, detailLoading, loadError, accessDenied,
    query, setQuery, kindFilter, setKindFilter, statusFilter, setStatusFilter, activeDialog, detailItem,
    form, setForm, formError, conflict, reload, openDetail, openItem, openDelete, saveItem, toggleStatus, deleteItem,
    closeForm: () => { if (!busy) clearForm(); }, closeDetail: () => { if (!busy) { detailSequence.current += 1; setDetail(null); } },
    refreshConflict: () => { if (!busy) { clearForm(); void reload(); } },
  };
}
import { useHouseholdRefresh } from "@/shared/lib/useHouseholdRefresh";
