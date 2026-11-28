import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import type { Activity, ActivityInput, ActivityStatus } from "@/domain/activity/activity.types";
import { activityError, activityInput, activityParticipants } from "@/domain/activity/activity.rules";
import { isAppError } from "@/shared/lib/appError";
import { formatISO, isoToJalali, jalaliToIso, parse, today } from "@/shared/lib/jalali";
import { useOnline } from "@/shared/lib/useOnline";
import { filterActivities, type ActivityFilter } from "./activityPresentation";
import { ActivitySession, type ActivityTicket } from "./activitySession";

export interface ActivityForm { title: string; note: string; date: string; location: string; status: ActivityStatus; participantIds: string[]; reminder: boolean }
type Dialog = { ticket: ActivityTicket; kind: "item"; item: Activity | null } | { ticket: ActivityTicket; kind: "delete"; item: Activity };
const emptyForm = (): ActivityForm => ({ title: "", note: "", date: formatISO(today()), location: "", status: "planned", participantIds: [], reminder: true });
const messageOf = (error: unknown) => error instanceof Error ? error.message : "انجام عملیات ناموفق بود. دوباره تلاش کنید.";
const dateValue = (value: string) => {
  const day = parse(value);
  if (!day) throw new Error("تاریخ برنامه را انتخاب کنید.");
  return jalaliToIso(day);
};

export function useActivitiesModel(initialActivityId?: string, onChanged?: () => void | Promise<void>, onInitialActivityConsumed?: () => void) {
  const { phase, member, members, family, useCases, shoppingSync, offlineSession } = useApp();
  const { show } = useToast();
  const online = useOnline();
  const available = phase === "ready" && member?.status === "active" && member.membershipState === "active"
    && Boolean(family && useCases) && online && !shoppingSync.offline && !offlineSession;
  const scope = available ? `${member!.id}:${family!.id}:${member!.role}` : "";
  const session = useRef(new ActivitySession()).current;
  session.setScope(scope);
  const mounted = useRef(true);
  const sequence = useRef(0);
  const detailSequence = useRef(0);
  const pending = useRef(false);
  const handledInitial = useRef("");
  const changed = useRef(onChanged); changed.current = onChanged;
  const consumed = useRef(onInitialActivityConsumed); consumed.current = onInitialActivityConsumed;
  const [snapshot, setSnapshot] = useState<{ ticket: ActivityTicket | null; activities: Activity[]; canCreate: boolean }>({ ticket: null, activities: [], canCreate: false });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [detail, setDetail] = useState<{ ticket: ActivityTicket; id: string } | null>(null);
  const [form, setForm] = useState<ActivityForm>(emptyForm);
  const [formError, setFormError] = useState("");
  const [conflict, setConflict] = useState(false);
  const current = useCallback((ticket: ActivityTicket) => mounted.current && session.isCurrent(ticket), [session]);
  const hasSnapshot = available && !accessDenied && snapshot.ticket !== null && session.isCurrent(snapshot.ticket);
  const items = hasSnapshot ? snapshot.activities : [];
  const canCreate = hasSnapshot && snapshot.canCreate;
  const participants = available && !accessDenied && family ? activityParticipants(members, family.id) : [];
  const visible = useMemo(() => filterActivities(items, filter, query), [items, filter, query]);
  const dialogItem = dialog?.item ? items.find((item) => item.id === dialog.item?.id) : undefined;
  const activeDialog = available && !accessDenied && dialog && session.isCurrent(dialog.ticket)
    && (dialog.kind === "item" && !dialog.item ? canCreate : dialog.kind === "delete" ? dialogItem?.canDelete : dialogItem?.canEdit) ? dialog : null;
  const detailItem = available && !accessDenied && detail && session.isCurrent(detail.ticket) ? items.find((item) => item.id === detail.id) : undefined;

  const clearForm = useCallback(() => { setDialog(null); setForm(emptyForm()); setFormError(""); setConflict(false); }, []);
  const forget = useCallback(() => {
    sequence.current += 1; detailSequence.current += 1; pending.current = false;
    setSnapshot({ ticket: null, activities: [], canCreate: false }); setDetail(null); clearForm();
    setQuery(""); setFilter("all"); setBusy(false); setDetailLoading(false);
  }, [clearForm]);
  const deny = useCallback((error: unknown) => {
    if (!isAppError(error) || ![401, 403, 404].includes(error.status ?? 0)
      && !["SESSION_EXPIRED", "FORBIDDEN", "NOT_FOUND"].includes(error.code)) return false;
    session.invalidate(); forget(); setAccessDenied(true); setLoadError(messageOf(error)); setLoading(false);
    return true;
  }, [session, forget]);
  const reload = useCallback(async (silent = false) => {
    if (!scope || !useCases) return;
    const ticket = session.capture(); const request = ++sequence.current;
    if (!silent) setLoading(true); setLoadError("");
    try {
      const result = await useCases.listActivities.execute();
      if (!current(ticket) || sequence.current !== request) return;
      setSnapshot({ ticket, activities: result.activities, canCreate: result.canCreate }); setAccessDenied(false);
    } catch (error) {
      if (!current(ticket) || sequence.current !== request) return;
      if (!deny(error)) { forget(); setLoadError(messageOf(error)); setLoading(false); }
    } finally { if (current(ticket) && sequence.current === request) setLoading(false); }
  }, [scope, useCases, session, current, deny, forget]);
  useHouseholdRefresh(() => reload(true));

  useEffect(() => {
    mounted.current = true; session.setScope(scope);
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
  useEffect(() => { if (hasSnapshot && dialog && !activeDialog) clearForm(); }, [hasSnapshot, dialog, activeDialog, clearForm]);

  const openDetail = useCallback(async (id: string) => {
    if (!useCases || !scope || busy || accessDenied) return;
    const ticket = session.capture(); const request = ++detailSequence.current;
    setDetail(null); setDetailLoading(true); setLoadError("");
    try {
      const item = await useCases.getActivity.execute(id);
      if (!current(ticket) || detailSequence.current !== request) return;
      setSnapshot((previous) => ({ ticket, canCreate: previous.canCreate, activities: [item, ...previous.activities.filter((row) => row.id !== item.id)] }));
      setDetail({ ticket, id: item.id });
    } catch (error) { if (current(ticket) && detailSequence.current === request && !deny(error)) setLoadError(messageOf(error)); }
    finally { if (current(ticket) && detailSequence.current === request) setDetailLoading(false); }
  }, [useCases, scope, busy, accessDenied, session, current, deny]);
  useEffect(() => {
    if (!initialActivityId) { handledInitial.current = ""; return; }
    if (!hasSnapshot || loading || accessDenied) return;
    const key = `${scope}:${initialActivityId}`;
    if (handledInitial.current === key) return;
    handledInitial.current = key; consumed.current?.(); void openDetail(initialActivityId);
  }, [initialActivityId, hasSnapshot, loading, accessDenied, scope, openDetail]);

  const openItem = (item: Activity | null) => {
    if (!available || busy || accessDenied || (item ? !item.canEdit : !canCreate)) return;
    clearForm(); setForm(item ? { title: item.title, note: item.note ?? "", date: formatISO(isoToJalali(item.date)), location: item.location ?? "",
      status: item.status, participantIds: item.participantIds.filter((id) => participants.some((row) => row.id === id)), reminder: item.reminderEnabled } : emptyForm());
    setDialog({ ticket: session.capture(), kind: "item", item });
  };
  const openDelete = (item: Activity) => {
    if (!available || busy || accessDenied || !item.canDelete) return;
    clearForm(); setDialog({ ticket: session.capture(), kind: "delete", item });
  };
  const mutate = async (action: () => Promise<Activity | void>, success: string) => {
    if (!available || accessDenied || pending.current) return;
    const ticket = session.capture(); pending.current = true; setBusy(true); setFormError(""); setLoadError("");
    try {
      await action(); if (!current(ticket)) return;
      clearForm(); show(success); window.dispatchEvent(new Event("activities-changed"));
      void Promise.resolve(changed.current?.()).catch(() => undefined); await reload();
    } catch (error) {
      if (!current(ticket)) return;
      if (!deny(error)) { setFormError(messageOf(error)); setLoadError(messageOf(error)); setConflict(isAppError(error) && (error.code === "CONFLICT" || error.status === 409)); }
    } finally { if (current(ticket)) { pending.current = false; setBusy(false); } }
  };
  const saveItem = () => {
    if (!useCases || activeDialog?.kind !== "item") return;
    try {
      const input: ActivityInput = { title: form.title, note: form.note, date: dateValue(form.date), location: form.location,
        status: form.status, participantIds: form.participantIds, reminderEnabled: form.reminder };
      const error = activityError(input, participants.map((member) => member.id));
      if (error) { setFormError(error); return; }
      const item = activeDialog.item;
      if (item && !items.find((row) => row.id === item.id)?.canEdit) return;
      void mutate(() => item ? useCases.updateActivity.execute(item.id, input, item.revision) : useCases.addActivity.execute(input), "برنامه ذخیره شد.");
    } catch (error) { setFormError(messageOf(error)); }
  };
  const setStatus = (item: Activity, status: ActivityStatus) => {
    if (!useCases || !item.canEdit) return;
    const input = { ...activityInput(item), status };
    void mutate(() => useCases.updateActivity.execute(item.id, input, item.revision), status === "done" ? "برنامه انجام شد." : status === "cancelled" ? "برنامه لغو شد." : "برنامه دوباره برنامه‌ریزی شد.");
  };
  const deleteItem = () => {
    if (!useCases || activeDialog?.kind !== "delete" || !dialogItem?.canDelete) return;
    const item = activeDialog.item;
    void mutate(async () => { await useCases.deleteActivity.execute(item.id, item.revision); if (current(activeDialog.ticket)) setDetail(null); }, "برنامه حذف شد.");
  };
  const toggleParticipant = (id: string) => {
    if (busy || !participants.some((member) => member.id === id)) return;
    setForm((previous) => ({ ...previous, participantIds: previous.participantIds.includes(id)
      ? previous.participantIds.filter((selected) => selected !== id) : [...previous.participantIds, id] }));
  };
  return { available, hasSnapshot, items, visible, canCreate, loading, busy, detailLoading, loadError, accessDenied, participants,
    query, setQuery, filter, setFilter, activeDialog, detailItem, form, setForm, formError, conflict, reload,
    openDetail, openItem, openDelete, saveItem, setStatus, deleteItem, toggleParticipant,
    closeForm: () => { if (!busy) clearForm(); }, closeDetail: () => { if (!busy) { detailSequence.current += 1; setDetail(null); } },
    refreshConflict: () => { if (!busy) { clearForm(); void reload(); } },
  };
}
import { useHouseholdRefresh } from "@/shared/lib/useHouseholdRefresh";
