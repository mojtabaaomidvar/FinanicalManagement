import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import type { Child, ChildDetail, ChildInput } from "@/domain/child/child.types";
import { childError } from "@/domain/child/child.rules";
import { isAppError } from "@/shared/lib/appError";
import { formatISO, isoToJalali, jalaliToIso, parse } from "@/shared/lib/jalali";
import { useOnline } from "@/shared/lib/useOnline";
import { ChildSession, type ChildTicket } from "./childSession";
import { filterChildren } from "./childPresentation";

interface ChildForm { name: string; birthDate: string }
interface ChildDialog { ticket: ChildTicket; child: Child | null }
const emptyForm = (): ChildForm => ({ name: "", birthDate: "" });
const messageOf = (error: unknown) => error instanceof Error ? error.message : "انجام عملیات ناموفق بود. دوباره تلاش کنید.";
const birthValue = (value: string): string | null => {
  if (!value.trim()) return null;
  const day = parse(value);
  if (!day) throw new Error("تاریخ تولد معتبر را انتخاب کنید.");
  return jalaliToIso(day);
};

export function useChildrenModel(onChanged?: () => void | Promise<void>) {
  const { phase, member, family, useCases, shoppingSync, offlineSession } = useApp();
  const { show } = useToast();
  const online = useOnline();
  const available = phase === "ready" && member?.status === "active" && member.membershipState === "active"
    && Boolean(family && useCases) && online && !shoppingSync.offline && !offlineSession;
  const scope = available ? `${member!.id}:${family!.id}:${member!.role}` : "";
  const session = useRef(new ChildSession()).current;
  session.setScope(scope);
  const mounted = useRef(true);
  const listSequence = useRef(0);
  const detailSequence = useRef(0);
  const pending = useRef(false);
  const changed = useRef(onChanged); changed.current = onChanged;
  const [snapshot, setSnapshot] = useState<{ ticket: ChildTicket | null; children: Child[]; canCreate: boolean }>({ ticket: null, children: [], canCreate: false });
  const [detail, setDetail] = useState<{ ticket: ChildTicket; value: ChildDetail } | null>(null);
  const [dialog, setDialog] = useState<ChildDialog | null>(null);
  const [form, setForm] = useState<ChildForm>(emptyForm);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [formError, setFormError] = useState("");
  const [conflict, setConflict] = useState(false);
  const current = useCallback((ticket: ChildTicket) => mounted.current && session.isCurrent(ticket), [session]);
  const hasSnapshot = available && !accessDenied && snapshot.ticket !== null && session.isCurrent(snapshot.ticket);
  const children = hasSnapshot ? snapshot.children : [];
  const canCreate = hasSnapshot && snapshot.canCreate;
  const visible = useMemo(() => filterChildren(children, query), [children, query]);
  const activeDialog = available && !accessDenied && dialog && session.isCurrent(dialog.ticket)
    && (dialog.child ? children.find((child) => child.id === dialog.child?.id)?.canEdit : canCreate) ? dialog : null;
  const detailValue = available && !accessDenied && detail && session.isCurrent(detail.ticket) ? detail.value : null;

  const clearForm = useCallback(() => { setDialog(null); setForm(emptyForm()); setFormError(""); setConflict(false); }, []);
  const forget = useCallback(() => {
    listSequence.current += 1; detailSequence.current += 1; pending.current = false;
    setSnapshot({ ticket: null, children: [], canCreate: false }); setDetail(null); clearForm();
    setQuery(""); setBusy(false); setDetailLoading(false);
  }, [clearForm]);
  const deny = useCallback((error: unknown) => {
    if (!isAppError(error) || ![401, 403, 404].includes(error.status ?? 0)
      && !["SESSION_EXPIRED", "FORBIDDEN", "NOT_FOUND"].includes(error.code)) return false;
    session.invalidate(); forget(); setAccessDenied(true); setLoadError(messageOf(error)); setLoading(false);
    return true;
  }, [session, forget]);
  const reload = useCallback(async () => {
    if (!scope || !useCases) return;
    const ticket = session.capture(); const request = ++listSequence.current;
    detailSequence.current += 1; setDetail(null); setDetailLoading(false); setLoading(true); setLoadError("");
    try {
      const result = await useCases.listChildren.execute();
      if (!current(ticket) || listSequence.current !== request) return;
      setSnapshot({ ticket, children: result.children, canCreate: result.canCreate }); setAccessDenied(false);
      // Related records are read again whenever the focused profile is reopened.
      setDetail(null);
    } catch (error) {
      if (!current(ticket) || listSequence.current !== request) return;
      if (!deny(error)) { forget(); setLoadError(messageOf(error)); setLoading(false); }
    } finally { if (current(ticket) && listSequence.current === request) setLoading(false); }
  }, [scope, useCases, session, current, deny, forget]);

  useEffect(() => {
    mounted.current = true; session.setScope(scope);
    return () => { mounted.current = false; session.close(); listSequence.current += 1; detailSequence.current += 1; };
  }, [session]);
  useEffect(() => {
    forget(); setAccessDenied(false); setLoadError("");
    if (scope) void reload(); else setLoading(false);
  }, [scope, reload, forget]);
  useEffect(() => {
    const disconnect = () => { session.invalidate(); forget(); setLoading(false); };
    const reconnect = () => { session.invalidate(); forget(); if (scope) void reload(); };
    window.addEventListener("offline", disconnect); window.addEventListener("online", reconnect);
    return () => { window.removeEventListener("offline", disconnect); window.removeEventListener("online", reconnect); };
  }, [session, forget, scope, reload]);
  useEffect(() => { if (hasSnapshot && dialog && !activeDialog) clearForm(); }, [hasSnapshot, dialog, activeDialog, clearForm]);

  const openDetail = async (id: string) => {
    if (!useCases || !scope || busy || loading || accessDenied || !hasSnapshot) return;
    const ticket = session.capture(); const request = ++detailSequence.current;
    setDetail(null); setDetailLoading(true); setLoadError("");
    try {
      const value = await useCases.getChild.execute(id);
      if (!current(ticket) || detailSequence.current !== request) return;
      setSnapshot((previous) => ({ ticket, canCreate: previous.canCreate, children: [value.child, ...previous.children.filter((child) => child.id !== value.child.id)] }));
      setDetail({ ticket, value });
    } catch (error) { if (current(ticket) && detailSequence.current === request && !deny(error)) setLoadError(messageOf(error)); }
    finally { if (current(ticket) && detailSequence.current === request) setDetailLoading(false); }
  };
  const openItem = (child: Child | null) => {
    if (!available || busy || accessDenied || (child ? !child.canEdit : !canCreate)) return;
    detailSequence.current += 1; setDetail(null); setDetailLoading(false); clearForm();
    setForm(child ? { name: child.name, birthDate: child.birthDate ? formatISO(isoToJalali(child.birthDate)) : "" } : emptyForm());
    setDialog({ ticket: session.capture(), child });
  };
  const saveItem = async () => {
    if (!useCases || !available || !activeDialog || pending.current || accessDenied) return;
    let input: ChildInput;
    try {
      input = { name: form.name, birthDate: birthValue(form.birthDate) };
      const error = childError(input);
      if (error) { setFormError(error); return; }
    } catch (error) { setFormError(messageOf(error)); return; }
    const ticket = session.capture(); const child = activeDialog.child;
    pending.current = true; setBusy(true); setFormError(""); setLoadError("");
    try {
      if (child) await useCases.updateChild.execute(child.id, input, child.revision);
      else await useCases.addChild.execute(input);
      if (!current(ticket)) return;
      clearForm(); show("مشخصات فرزند ذخیره شد."); window.dispatchEvent(new Event("children-changed"));
      await Promise.resolve(changed.current?.()).catch(() => undefined);
      if (!current(ticket)) return;
      await reload();
    } catch (error) {
      if (!current(ticket)) return;
      if (!deny(error)) { setFormError(messageOf(error)); setLoadError(messageOf(error)); setConflict(isAppError(error) && (error.code === "CONFLICT" || error.status === 409)); }
    } finally { if (current(ticket)) { pending.current = false; setBusy(false); } }
  };
  const closeDetail = () => { if (!busy) { detailSequence.current += 1; setDetail(null); setDetailLoading(false); } };
  return { available, children, visible, canCreate, loading, detailLoading, busy, accessDenied, loadError, formError, conflict,
    query, setQuery, detailValue, activeDialog, form, setForm, reload, openDetail, openItem, saveItem, closeDetail,
    closeForm: () => { if (!busy) clearForm(); },
    refreshConflict: () => { if (!busy) { clearForm(); void reload(); } },
  };
}
