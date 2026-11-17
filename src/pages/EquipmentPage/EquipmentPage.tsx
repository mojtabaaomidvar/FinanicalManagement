import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import type { Equipment, EquipmentInput, MaintenanceInput, MaintenanceRecord } from "@/domain/equipment/equipment.types";
import { equipmentError, maintenanceError, tehranToday } from "@/domain/equipment/equipment.rules";
import type { HouseDocument } from "@/domain/document/document.types";
import { validateDocumentDownload } from "@/domain/document/document.rules";
import { daysUntil, filterEquipment, serviceLabel, warrantyLabel, type EquipmentFilter } from "@/features/equipment/model/equipmentPresentation";
import { isAppError } from "@/shared/lib/appError";
import { formatISO, formatLong, isoToJalali, jalaliToIso, parse } from "@/shared/lib/jalali";
import { toFa } from "@/shared/lib/digits";
import { useOnline } from "@/shared/lib/useOnline";
import { Card, Field, Icon, JalaliDateInput, Modal } from "@/shared/ui";
import "./EquipmentPage.css";

interface EquipmentForm {
  title: string; brand: string; model: string; purchase: string; warranty: string;
  documentId: string; taskId: string; serviceDue: string; reminder: boolean;
}
type Dialog = { scope: string } & (
  | { kind: "item"; item: Equipment | null }
  | { kind: "service"; item: Equipment }
  | { kind: "delete"; item: Equipment }
);
const EMPTY_FORM: EquipmentForm = { title: "", brand: "", model: "", purchase: "", warranty: "", documentId: "", taskId: "", serviceDue: "", reminder: true };
const FILTERS: { value: EquipmentFilter; label: string }[] = [
  { value: "all", label: "همه" }, { value: "service", label: "سرویس نزدیک" },
  { value: "overdue", label: "سرویس عقب‌افتاده" }, { value: "warranty", label: "گارانتی رو به پایان" },
];
const dateText = (value: string | null) => value ? formatLong(isoToJalali(value)) : "ثبت نشده";
const dateForm = (value: string | null) => value ? formatISO(isoToJalali(value)) : "";
const dateValue = (value: string): string | null => {
  if (!value.trim()) return null;
  const parsed = parse(value);
  if (!parsed) throw new Error("تاریخ را دوباره انتخاب کنید.");
  return jalaliToIso(parsed);
};
const messageOf = (error: unknown) => error instanceof Error ? error.message : "انجام عملیات ناموفق بود. دوباره تلاش کنید.";

export function EquipmentPage({ initialEquipmentId, onOpenTasks, onOpenDocuments, onChanged }: {
  initialEquipmentId?: string;
  onOpenTasks?: () => void;
  onOpenDocuments?: () => void;
  onChanged?: () => void | Promise<void>;
}) {
  const { phase, member, family, useCases, shoppingSync, offlineSession, tasks } = useApp();
  const { show } = useToast();
  const online = useOnline();
  const available = phase === "ready" && member?.status === "active" && member.membershipState === "active"
    && Boolean(family && useCases) && online && !shoppingSync.offline && !offlineSession;
  const scope = available ? `${member!.id}:${family!.id}` : "";
  const identity = useRef({ scope });
  if (identity.current.scope !== scope) identity.current = { scope };
  const mounted = useRef(true);
  const sequence = useRef(0);
  const historySequence = useRef(0);
  const fileSequence = useRef(0);
  const mutationPending = useRef(false);
  const operation = useRef<{ key: string; id: string } | null>(null);
  const objectUrls = useRef(new Set<string>());
  const handledInitial = useRef("");
  const changedRef = useRef(onChanged);
  changedRef.current = onChanged;
  const [snapshot, setSnapshot] = useState<{ scope: string; items: Equipment[]; documents: HouseDocument[] }>({ scope: "", items: [], documents: [] });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<EquipmentFilter>("all");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [form, setForm] = useState<EquipmentForm>(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [serviceConflict, setServiceConflict] = useState(false);
  const [performed, setPerformed] = useState("");
  const [description, setDescription] = useState("");
  const [nextDue, setNextDue] = useState("");
  const [detail, setDetail] = useState<{ scope: string; id: string } | null>(null);
  const [history, setHistory] = useState<{ scope: string; id: string; rows: MaintenanceRecord[] } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [fileError, setFileError] = useState("");
  const [preview, setPreview] = useState<{ scope: string; document: HouseDocument; url: string } | null>(null);
  const items = available && snapshot.scope === scope && !accessDenied ? snapshot.items : [];
  const documents = available && snapshot.scope === scope && !accessDenied ? snapshot.documents : [];
  const todayIso = tehranToday();
  const visible = useMemo(() => filterEquipment(items, filter, query, todayIso), [items, filter, query, todayIso]);
  const activeDialog = available && !accessDenied && dialog?.scope === scope ? dialog : null;
  const detailItem = available && !accessDenied && detail?.scope === scope ? items.find((item) => item.id === detail.id) : undefined;
  const records = detailItem && history?.scope === scope && history.id === detailItem.id ? history.rows : [];
  const stillCurrent = (captured: { scope: string }) => mounted.current && captured.scope !== "" && identity.current === captured;

  const revokeUrls = useCallback(() => {
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url)); objectUrls.current.clear();
  }, []);
  const closePreview = useCallback(() => {
    fileSequence.current += 1; setPreview(null); setDownloading(false); revokeUrls();
  }, [revokeUrls]);
  const clearForm = useCallback(() => {
    setDialog(null); setForm(EMPTY_FORM); setFormError(""); setServiceConflict(false); setPerformed(""); setDescription(""); setNextDue(""); operation.current = null;
  }, []);
  const forget = useCallback(() => {
    sequence.current += 1; historySequence.current += 1;
    setSnapshot({ scope: "", items: [], documents: [] }); setDetail(null); setHistory(null);
    setHistoryError(""); setFileError(""); setQuery(""); setHistoryLoading(false); clearForm(); closePreview();
    setBusy(false); mutationPending.current = false;
  }, [clearForm, closePreview]);
  const deny = useCallback((error: unknown) => {
    if (!isAppError(error) || error.status !== 401 && error.status !== 403
      && !["FORBIDDEN", "SESSION_EXPIRED"].includes(error.code)) return false;
    identity.current = { scope: identity.current.scope }; forget();
    setAccessDenied(true); setLoadError(messageOf(error)); setLoading(false);
    return true;
  }, [forget]);

  const reload = useCallback(async () => {
    if (!scope || !useCases) return;
    const captured = identity.current;
    const request = ++sequence.current;
    setLoading(true); setLoadError("");
    try {
      const [nextItems, nextDocuments] = await Promise.all([
        useCases.listEquipment.execute(),
        useCases.listDocuments.execute().catch(() => [] as HouseDocument[]),
      ]);
      if (!mounted.current || identity.current !== captured || sequence.current !== request) return;
      setSnapshot({ scope, items: nextItems, documents: nextDocuments.filter((document) => document.visibility === "shared") });
      setAccessDenied(false);
    } catch (error) {
      if (!mounted.current || identity.current !== captured || sequence.current !== request) return;
      if (!deny(error)) { setSnapshot({ scope: "", items: [], documents: [] }); setLoadError(messageOf(error)); }
    } finally {
      if (mounted.current && identity.current === captured && sequence.current === request) setLoading(false);
    }
  }, [scope, useCases, deny]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; identity.current = { scope: "" }; sequence.current += 1; historySequence.current += 1; fileSequence.current += 1; revokeUrls(); };
  }, [revokeUrls]);
  useEffect(() => {
    forget(); setLoadError(""); setAccessDenied(false); handledInitial.current = "";
    if (scope) void reload(); else setLoading(false);
  }, [scope, reload, forget]);
  useEffect(() => {
    const offline = () => { identity.current = { scope: "" }; forget(); setLoading(false); };
    const reconnect = () => { identity.current = { scope }; if (scope) void reload(); };
    window.addEventListener("offline", offline); window.addEventListener("online", reconnect);
    return () => { window.removeEventListener("offline", offline); window.removeEventListener("online", reconnect); };
  }, [scope, forget, reload]);

  const loadHistory = async (item: Equipment) => {
    if (!useCases || !available || accessDenied) return;
    const captured = identity.current;
    const request = ++historySequence.current;
    setHistory(null); setHistoryLoading(true); setHistoryError("");
    try {
      const rows = await useCases.listMaintenance.execute(item.id);
      if (stillCurrent(captured) && historySequence.current === request) setHistory({ scope, id: item.id, rows });
    } catch (error) {
      if (stillCurrent(captured) && historySequence.current === request && !deny(error)) setHistoryError(messageOf(error));
    } finally { if (stillCurrent(captured) && historySequence.current === request) setHistoryLoading(false); }
  };
  const openDetail = (item: Equipment) => {
    if (!available || busy || accessDenied) return;
    setDetail({ scope, id: item.id }); setFileError(""); void loadHistory(item);
  };
  useEffect(() => {
    if (!initialEquipmentId || !available || loading || snapshot.scope !== scope || accessDenied) return;
    const key = `${scope}:${initialEquipmentId}`;
    if (handledInitial.current === key) return;
    handledInitial.current = key;
    const item = snapshot.items.find((row) => row.id === initialEquipmentId);
    if (item) openDetail(item);
  }, [initialEquipmentId, available, loading, snapshot, scope, accessDenied]);
  const closeDetail = () => {
    if (busy) return;
    setDetail(null); setHistory(null); setHistoryError(""); setFileError(""); historySequence.current += 1; closePreview();
  };
  const openItem = (item: Equipment | null) => {
    if (!available || busy || accessDenied || item && !item.canEdit) return;
    clearForm();
    setForm(item ? { title: item.title, brand: item.brand ?? "", model: item.model ?? "", purchase: dateForm(item.purchaseDate),
      warranty: dateForm(item.warrantyUntil), documentId: item.warrantyDocumentId ?? "", taskId: item.serviceTaskId ?? "",
      serviceDue: dateForm(item.serviceDueDate), reminder: item.serviceReminderEnabled } : EMPTY_FORM);
    setDialog({ scope, kind: "item", item });
  };
  const openService = (item: Equipment) => {
    if (!available || busy || accessDenied || !item.canEdit) return;
    clearForm(); setPerformed(dateForm(todayIso)); setDialog({ scope, kind: "service", item });
  };
  const changeService = (setter: (value: string) => void, value: string) => {
    setter(value); operation.current = null; setFormError("");
  };
  const afterCommit = async (captured: { scope: string }, message: string) => {
    if (!stillCurrent(captured)) return;
    clearForm(); show(message); await reload();
    if (!stillCurrent(captured)) return;
    try { await changedRef.current?.(); } catch { /* The committed operation remains successful. */ }
  };
  const mutate = async (action: () => Promise<unknown>, message: string) => {
    if (!available || !useCases || busy || mutationPending.current || accessDenied) return;
    const captured = identity.current;
    mutationPending.current = true; setBusy(true); setFormError("");
    try { await action(); await afterCommit(captured, message); }
    catch (error) {
      if (!stillCurrent(captured) || deny(error)) return;
      setFormError(messageOf(error));
      if (isAppError(error) && error.code === "CONFLICT") { show(messageOf(error)); clearForm(); void reload(); }
    } finally { if (stillCurrent(captured)) { mutationPending.current = false; setBusy(false); } }
  };
  const saveItem = () => {
    if (!useCases || activeDialog?.kind !== "item") return;
    try {
      const input: EquipmentInput = { title: form.title, brand: form.brand, model: form.model,
        purchaseDate: dateValue(form.purchase), warrantyUntil: dateValue(form.warranty),
        warrantyDocumentId: form.documentId || null, serviceTaskId: form.taskId || null,
        serviceDueDate: dateValue(form.serviceDue), serviceReminderEnabled: form.reminder };
      const error = equipmentError(input);
      if (error) { setFormError(error); return; }
      const item = activeDialog.item;
      void mutate(() => item ? useCases.updateEquipment.execute(item.id, input, item.revision) : useCases.addEquipment.execute(input),
        item ? "وسیله به‌روز شد." : "وسیله ثبت شد.");
    } catch (error) { setFormError(messageOf(error)); }
  };
  const saveService = async () => {
    if (!useCases || activeDialog?.kind !== "service" || busy || mutationPending.current || !activeDialog.item.canEdit) return;
    const item = activeDialog.item;
    try {
      const input: MaintenanceInput = { performedOn: dateValue(performed) ?? "", description: description.trim(), nextDueDate: dateValue(nextDue) };
      const error = maintenanceError(input);
      if (error) { setFormError(error); return; }
      const key = JSON.stringify([item.id, item.revision, input]);
      if (operation.current?.key !== key) operation.current = { key, id: crypto.randomUUID() };
      const captured = identity.current;
      mutationPending.current = true; setBusy(true); setFormError("");
      try {
        const saved = await useCases.addMaintenance.execute(item.id, input, item.revision, operation.current.id);
        if (!stillCurrent(captured)) return;
        setSnapshot((previous) => ({ ...previous, items: previous.items.map((row) => row.id === item.id ? saved.equipment : row) }));
        setHistory((previous) => ({ scope, id: item.id, rows: [saved.record, ...(previous?.id === item.id ? previous.rows.filter((row) => row.id !== saved.record.id) : [])] }));
        await afterCommit(captured, "سرویس ثبت شد و موعد بعدی به‌روز شد.");
        if (stillCurrent(captured)) void loadHistory(saved.equipment);
      } catch (error) {
        if (stillCurrent(captured) && !deny(error)) {
          setFormError(messageOf(error)); setServiceConflict(isAppError(error) && error.code === "CONFLICT");
        }
      } finally { if (stillCurrent(captured)) { mutationPending.current = false; setBusy(false); } }
    } catch (error) { setFormError(messageOf(error)); }
  };
  const downloadDocument = async (document: HouseDocument) => {
    if (!useCases || !available || accessDenied || downloading) return;
    const captured = identity.current;
    const request = ++fileSequence.current;
    setDownloading(true); setFileError("");
    try {
      const blob = await useCases.downloadDocument.execute(document.id);
      if (!stillCurrent(captured) || fileSequence.current !== request) return;
      validateDocumentDownload(blob, document);
      revokeUrls(); const url = URL.createObjectURL(blob); objectUrls.current.add(url);
      setPreview({ scope, document, url });
    } catch (error) {
      if (!stillCurrent(captured) || fileSequence.current !== request) return;
      closePreview(); setFileError(messageOf(error));
      if (isAppError(error) && error.status === 401) deny(error);
      else {
        if (isAppError(error) && (error.status === 403 || error.status === 404
          || error.code === "FORBIDDEN" || error.code === "NOT_FOUND")) {
          // An explicit denial invalidates this document before any refresh settles.
          setSnapshot((previous) => ({ ...previous,
            documents: previous.documents.filter((row) => row.id !== document.id),
            items: previous.items.map((row) => row.warrantyDocumentId === document.id
              ? { ...row, warrantyDocumentId: null } : row),
          }));
          setForm((previous) => previous.documentId === document.id ? { ...previous, documentId: "" } : previous);
        }
        void reload();
      }
    } finally { if (stillCurrent(captured) && fileSequence.current === request) setDownloading(false); }
  };
  const linkedDocument = detailItem ? documents.find((row) => row.id === detailItem.warrantyDocumentId) : undefined;
  const linkedTask = detailItem ? tasks.find((row) => row.id === detailItem.serviceTaskId) : undefined;

  return <section className="page active equipment-page" aria-busy={loading || busy}>
    <header className="app-header"><div className="header-title"><h1>وسایل خانه</h1><p>گارانتی، موعد سرویس و سابقهٔ نگهداری</p></div></header>
    <div className="content">
      {!available ? <Card><p className="modal-sub" role="status">مشاهده و مدیریت وسایل خانه به اتصال اینترنت و ورود معتبر نیاز دارد.</p></Card> : <>
        <Card><div className="equipment-summary"><div><p className="equipment-count">{toFa(items.length)} وسیله در خانه</p>
          <p className="form-note">{toFa(filterEquipment(items, "overdue", "", todayIso).length)} سرویس عقب‌افتاده</p></div><Icon name="i-grid4" size={30} /></div>
          <button type="button" className="btn-primary" disabled={loading || busy || accessDenied} onClick={() => openItem(null)}>ثبت وسیلهٔ جدید</button></Card>
        <input type="search" className="text-input" aria-label="جست‌وجوی وسایل" placeholder="نام وسیله، برند یا مدل" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="equipment-tabs" role="group" aria-label="فیلتر وسایل">{FILTERS.map((option) => <button type="button" key={option.value}
          className={`equipment-tab${filter === option.value ? " active" : ""}`} aria-pressed={filter === option.value} onClick={() => setFilter(option.value)}>{option.label}</button>)}</div>
        {loading ? <p className="form-note" role="status">در حال دریافت وسایل خانه…</p> : null}
        {loadError ? <Card><p className="modal-sub" role="alert">{loadError}</p><button type="button" className="btn-secondary" disabled={loading || busy} onClick={() => void reload()}>تلاش دوباره</button></Card> : null}
        {visible.length ? <div className="equipment-list">{visible.map((item) => <Card key={item.id}><div className="equipment-row" id={`equipment-${item.id}`}>
          <button type="button" className="equipment-details" aria-label={`جزئیات ${item.title}`} disabled={busy} onClick={() => openDetail(item)}>
            <b>{item.title}</b><span>{[item.brand, item.model].filter(Boolean).join(" · ") || "بدون برند و مدل"}</span>
            <span className={daysUntil(item.serviceDueDate, todayIso) !== null && item.serviceDueDate! < todayIso ? "equipment-overdue" : ""}>{serviceLabel(item, todayIso)}{item.serviceDueDate ? ` · ${dateText(item.serviceDueDate)}` : ""}</span>
            <span>{warrantyLabel(item, todayIso)}</span></button>
          {item.canDelete ? <button type="button" className="icon-btn" disabled={busy} aria-label={`حذف ${item.title}`} onClick={() => { clearForm(); setDialog({ scope, kind: "delete", item }); }}><Icon name="i-trash" size={18} /></button> : null}
        </div></Card>)}</div> : !loading && !loadError ? <p className="modal-sub" role="status">{items.length ? "وسیله‌ای با این جست‌وجو یا فیلتر پیدا نشد." : "هنوز وسیله‌ای ثبت نشده. از یک وسیله مثل یخچال یا کولر شروع کنید."}</p> : null}
      </>}
    </div>
    <Modal open={Boolean(detailItem)} onClose={closeDetail} title={detailItem?.title} sheetClassName="equipment-sheet" dragToClose>
      {detailItem ? <div className="equipment-detail-body">
        <dl className="equipment-facts"><div><dt>برند و مدل</dt><dd>{[detailItem.brand, detailItem.model].filter(Boolean).join(" · ") || "ثبت نشده"}</dd></div>
          <div><dt>تاریخ خرید</dt><dd>{dateText(detailItem.purchaseDate)}</dd></div><div><dt>پایان گارانتی</dt><dd>{dateText(detailItem.warrantyUntil)}</dd></div>
          <div><dt>موعد سرویس بعدی</dt><dd>{dateText(detailItem.serviceDueDate)}</dd></div><div><dt>یادآور سرویس</dt><dd>{detailItem.serviceReminderEnabled ? "روشن" : "خاموش"}</dd></div></dl>
        {detailItem.canEdit ? <div className="equipment-actions"><button type="button" className="btn-primary" disabled={busy} onClick={() => openService(detailItem)}>ثبت سرویس انجام‌شده</button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => openItem(detailItem)}>ویرایش وسیله</button></div> : <p className="form-note">ویرایش و ثبت سرویس در اختیار سازندهٔ وسیله و مدیر خانواده است.</p>}
        {linkedDocument ? <div className="equipment-link"><span>سند گارانتی: {linkedDocument.title}</span><button type="button" className="btn-secondary" disabled={downloading} onClick={() => void downloadDocument(linkedDocument)}>{downloading ? "در حال دریافت سند…" : "مشاهدهٔ سند گارانتی"}</button></div> : null}
        {!linkedDocument && onOpenDocuments ? <button type="button" className="equipment-text-action" onClick={() => { closeDetail(); onOpenDocuments(); }}>اسناد خانه</button> : null}
        {linkedTask ? <div className="equipment-link"><span>کار مرتبط: {linkedTask.title} · {linkedTask.completed ? "انجام‌شده" : "در انتظار انجام"}</span>
          {onOpenTasks ? <button type="button" className="btn-secondary" onClick={() => { closeDetail(); onOpenTasks(); }}>بازکردن کارهای خانه</button> : null}</div> : null}
        {fileError ? <p className="form-error" role="alert">{fileError}</p> : null}
        <h2 className="equipment-section-title">سابقهٔ سرویس</h2>
        {historyLoading ? <p className="form-note" role="status">در حال دریافت سابقه…</p> : null}
        {historyError ? <><p className="form-error" role="alert">{historyError}</p><button type="button" className="btn-secondary" onClick={() => void loadHistory(detailItem)}>دریافت دوبارهٔ سابقه</button></> : null}
        {!historyLoading && !historyError && !records.length ? <p className="form-note">هنوز سرویس انجام‌شده‌ای ثبت نشده است.</p> : null}
        <ol className="equipment-history">{records.map((record) => <li key={record.id}><b>{dateText(record.performedOn)}</b><p>{record.description}</p>
          <span>موعد بعدی: {dateText(record.nextDueDate)}</span></li>)}</ol>
        <button type="button" className="btn-secondary" onClick={closeDetail}>بستن جزئیات</button>
      </div> : null}
    </Modal>
    <Modal open={activeDialog?.kind === "item"} onClose={() => { if (!busy) clearForm(); }} title={activeDialog?.kind === "item" && activeDialog.item ? "ویرایش وسیله" : "وسیلهٔ جدید"} sheetClassName="equipment-sheet" dragToClose>
      <form autoComplete="off" onSubmit={(event) => { event.preventDefault(); saveItem(); }}>
        <fieldset disabled={busy} className="equipment-fields">
          <Field label="نام وسیله"><input className="text-input" aria-label="نام وسیله" value={form.title} maxLength={120} onChange={(event) => setForm((previous) => ({ ...previous, title: event.target.value }))} /></Field>
          <div className="equipment-two-fields"><Field label="برند"><input className="text-input" aria-label="برند" value={form.brand} maxLength={80} onChange={(event) => setForm((previous) => ({ ...previous, brand: event.target.value }))} /></Field>
            <Field label="مدل"><input className="text-input" aria-label="مدل" value={form.model} maxLength={80} onChange={(event) => setForm((previous) => ({ ...previous, model: event.target.value }))} /></Field></div>
          <EquipmentDate label="تاریخ خرید" value={form.purchase} onChange={(value) => setForm((previous) => ({ ...previous, purchase: value }))} />
          <EquipmentDate label="پایان گارانتی" value={form.warranty} onChange={(value) => setForm((previous) => ({ ...previous, warranty: value }))} />
          <Field label="سند گارانتی مشترک"><select className="text-input" aria-label="سند گارانتی مشترک" value={form.documentId} onChange={(event) => setForm((previous) => ({ ...previous, documentId: event.target.value }))}>
            <option value="">بدون سند مرتبط</option>{form.documentId && !documents.some((row) => row.id === form.documentId) ? <option value={form.documentId}>سند مرتبط؛ اطلاعات فعلاً در دسترس نیست</option> : null}
            {documents.map((document) => <option key={document.id} value={document.id}>{document.title}</option>)}</select></Field>
          <p className="form-note">فقط اسناد مشترکِ مجاز قابل انتخاب‌اند. سند را از بخش اسناد خانه ثبت کنید.</p>
          <EquipmentDate label="موعد سرویس بعدی" value={form.serviceDue} onChange={(value) => setForm((previous) => ({ ...previous, serviceDue: value }))} />
          <label className="equipment-check"><input type="checkbox" checked={form.reminder} onChange={(event) => setForm((previous) => ({ ...previous, reminder: event.target.checked }))} /><span>یادآور سرویس این وسیله</span></label>
          <Field label="کار مرتبط"><select className="text-input" aria-label="کار مرتبط" value={form.taskId} onChange={(event) => setForm((previous) => ({ ...previous, taskId: event.target.value }))}>
            <option value="">بدون کار مرتبط</option>{form.taskId && !tasks.some((row) => row.id === form.taskId) ? <option value={form.taskId}>کار مرتبط؛ اطلاعات فعلاً در دسترس نیست</option> : null}
            {tasks.map((task) => <option key={task.id} value={task.id}>{task.title}{task.completed ? " (انجام‌شده)" : ""}</option>)}</select></Field>
          <p className="form-note">ثبت سرویس، کار مرتبط را خودکار انجام‌شده نمی‌کند.</p>
        </fieldset>
        {formError ? <p className="form-error" role="alert">{formError}</p> : null}
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? "در حال ذخیره…" : "ذخیرهٔ وسیله"}</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={clearForm}>انصراف</button>
      </form>
    </Modal>
    <Modal open={activeDialog?.kind === "service"} onClose={() => { if (!busy) clearForm(); }} title="ثبت سرویس انجام‌شده" sheetClassName="equipment-sheet" dragToClose>
      <form autoComplete="off" onSubmit={(event) => { event.preventDefault(); void saveService(); }}>
        <p className="modal-sub">{activeDialog?.kind === "service" ? activeDialog.item.title : ""}</p>
        <fieldset disabled={busy} className="equipment-fields">
          <EquipmentDate label="تاریخ انجام سرویس" value={performed} onChange={(value) => changeService(setPerformed, value)} required />
          <Field label="شرح سرویس"><textarea className="text-input equipment-description" aria-label="شرح سرویس" value={description} maxLength={1000} rows={4} onChange={(event) => changeService(setDescription, event.target.value)} /></Field>
          <EquipmentDate label="موعد بعدی پس از سرویس" value={nextDue} onChange={(value) => changeService(setNextDue, value)} />
          <p className="form-note">با ثبت این سرویس، موعد قبلی جایگزین می‌شود. موعد بعدی خالی یعنی فعلاً سرویس دیگری برنامه‌ریزی نشده است.</p>
        </fieldset>
        {formError ? <p className="form-error" role="alert">{formError}</p> : null}
        {serviceConflict ? <button type="button" className="btn-secondary" disabled={busy} onClick={() => { clearForm(); void reload(); }}>دریافت نسخهٔ جدیدِ وسیله</button> : null}
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? "در حال ثبت…" : "ثبت سرویس"}</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={clearForm}>انصراف</button>
      </form>
    </Modal>
    <Modal open={activeDialog?.kind === "delete"} onClose={() => { if (!busy) clearForm(); }} title="حذف وسیله" sheetClassName="equipment-sheet">
      <p className="modal-sub">«{activeDialog?.kind === "delete" ? activeDialog.item.title : ""}» و تمام سابقهٔ سرویس آن حذف می‌شوند. سند و کار مرتبط حفظ می‌شوند.</p>
      {formError ? <p className="form-error" role="alert">{formError}</p> : null}
      <button type="button" className="btn-primary equipment-delete" disabled={busy} onClick={() => {
        if (!useCases || activeDialog?.kind !== "delete" || !activeDialog.item.canDelete) return;
        const item = activeDialog.item;
        void mutate(() => useCases.deleteEquipment.execute(item.id, item.revision), "وسیله و سابقهٔ آن حذف شدند.");
      }}>{busy ? "در حال حذف…" : "حذف وسیله و سابقه"}</button>
      <button type="button" className="btn-secondary" disabled={busy} onClick={clearForm}>انصراف</button>
    </Modal>
    <Modal open={available && preview?.scope === scope} onClose={closePreview} title="سند گارانتی" sheetClassName="equipment-sheet">
      {preview && available && preview.scope === scope ? <><p className="modal-sub">{preview.document.title}</p>
        {preview.document.mimeType.startsWith("image/") ? <img className="equipment-preview" src={preview.url} alt={preview.document.title} /> : <p className="form-note">فایل PDF: {preview.document.fileName}</p>}
        <a className="btn-primary equipment-download" href={preview.url} download={preview.document.fileName}>دانلود سند</a>
        <button type="button" className="btn-secondary" onClick={closePreview}>بستن سند</button></> : null}
    </Modal>
  </section>;
}

function EquipmentDate({ label, value, onChange, required = false }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return <div className="equipment-date" role="group" aria-label={label}><Field label={label}><JalaliDateInput value={value} onChange={onChange} placeholder={required ? "انتخاب تاریخ" : "اختیاری؛ انتخاب تاریخ"} minYear={1300} maxYear={1500} /></Field>
    {!required && value ? <button type="button" className="equipment-text-action" aria-label={`پاک‌کردن ${label}`} onClick={() => onChange("")}>پاک‌کردن تاریخ</button> : null}</div>;
}
