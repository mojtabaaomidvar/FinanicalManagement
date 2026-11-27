import { AppPage } from "@/shared/ui/AppPage";
import { CurrencyUnit } from "@/shared/ui/CurrencyUnit";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import type { Vehicle, VehicleInput, VehicleServiceInput, VehicleMaintenanceRecord } from "@/domain/vehicle/vehicle.types";
import { odometerValue, serviceCost, vehicleError, vehicleServiceError, vehicleToday } from "@/domain/vehicle/vehicle.rules";
import type { HouseDocument } from "@/domain/document/document.types";
import { validateDocumentDownload } from "@/domain/document/document.rules";
import { filterVehicles, vehicleServiceLabel, type VehicleFilter } from "@/features/vehicles/model/vehiclePresentation";
import { isAppError } from "@/shared/lib/appError";
import { formatISO, formatLong, isoToJalali, jalaliToIso, parse } from "@/shared/lib/jalali";
import { toFa } from "@/shared/lib/digits";
import { formatAmount } from "@/shared/lib/format";
import { currencyLabel, toDisplay } from "@/shared/lib/currency";
import { useOnline } from "@/shared/lib/useOnline";
import { AmountInput, Card, Field, Icon, JalaliDateInput, Modal } from "@/shared/ui";
import "./VehiclesPage.css";

interface VehicleForm {
  title: string; brand: string; model: string; plate: string; purchase: string; insurance: string; inspection: string;
  odometer: string; documentId: string; taskId: string; serviceDue: string; serviceKm: string; reminder: boolean;
}
type Dialog = { scope: string } & (
  | { kind: "item"; item: Vehicle | null }
  | { kind: "service"; item: Vehicle }
  | { kind: "delete"; item: Vehicle }
);
const EMPTY_FORM: VehicleForm = { title: "", brand: "", model: "", plate: "", purchase: "", insurance: "", inspection: "",
  odometer: "۰", documentId: "", taskId: "", serviceDue: "", serviceKm: "", reminder: true };
const FILTERS: { value: VehicleFilter; label: string }[] = [
  { value: "all", label: "همه" }, { value: "service", label: "سرویس نزدیک" },
  { value: "overdue", label: "سرویس عقب‌افتاده" }, { value: "insurance", label: "بیمه" }, { value: "inspection", label: "معاینهٔ فنی" },
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

export function VehiclesPage({ initialVehicleId, onInitialVehicleConsumed, onOpenTasks, onOpenDocuments, onOpenFinance, onChanged }: {
  initialVehicleId?: string;
  onInitialVehicleConsumed?: () => void;
  onOpenTasks?: () => void;
  onOpenDocuments?: () => void;
  onOpenFinance?: (transactionId: string) => void;
  onChanged?: () => void | Promise<void>;
}) {
  const { phase, member, family, useCases, shoppingSync, offlineSession, tasks, accounts, cur } = useApp();
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
  const [snapshot, setSnapshot] = useState<{ scope: string; items: Vehicle[]; documents: HouseDocument[]; canCreate: boolean }>({ scope: "", items: [], documents: [], canCreate: false });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<VehicleFilter>("all");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [form, setForm] = useState<VehicleForm>(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [serviceConflict, setServiceConflict] = useState(false);
  const [performed, setPerformed] = useState("");
  const [description, setDescription] = useState("");
  const [nextDue, setNextDue] = useState("");
  const [performedKm, setPerformedKm] = useState("");
  const [nextKm, setNextKm] = useState("");
  const [cost, setCost] = useState("");
  const [accountId, setAccountId] = useState("");
  const [entryCurrency, setEntryCurrency] = useState(cur);
  const [detail, setDetail] = useState<{ scope: string; id: string } | null>(null);
  const [history, setHistory] = useState<{ scope: string; id: string; rows: VehicleMaintenanceRecord[] } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [fileError, setFileError] = useState("");
  const [preview, setPreview] = useState<{ scope: string; document: HouseDocument; url: string } | null>(null);
  const items = available && snapshot.scope === scope && !accessDenied ? snapshot.items : [];
  const documents = available && snapshot.scope === scope && !accessDenied ? snapshot.documents : [];
  const canCreate = available && snapshot.scope === scope && !accessDenied && snapshot.canCreate;
  const todayIso = vehicleToday();
  const visible = useMemo(() => filterVehicles(items, filter, query, todayIso), [items, filter, query, todayIso]);
  const activeDialog = available && !accessDenied && dialog?.scope === scope
    && (dialog.kind === "item" && !dialog.item ? canCreate : items.some((item) => item.id === dialog.item?.id && item.canEdit)) ? dialog : null;
  const detailItem = available && !accessDenied && detail?.scope === scope ? items.find((item) => item.id === detail.id) : undefined;
  const records = detailItem?.canViewHistory && history?.scope === scope && history.id === detailItem.id ? history.rows : [];
  const stillCurrent = (captured: { scope: string }) => mounted.current && captured.scope !== "" && identity.current === captured;

  const revokeUrls = useCallback(() => {
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url)); objectUrls.current.clear();
  }, []);
  const closePreview = useCallback(() => {
    fileSequence.current += 1; setPreview(null); setDownloading(false); revokeUrls();
  }, [revokeUrls]);
  const clearForm = useCallback(() => {
    setDialog(null); setForm(EMPTY_FORM); setFormError(""); setServiceConflict(false); setPerformed(""); setDescription(""); setNextDue("");
    setPerformedKm(""); setNextKm(""); setCost(""); setAccountId(""); operation.current = null;
  }, []);
  const forget = useCallback(() => {
    sequence.current += 1; historySequence.current += 1;
    setSnapshot({ scope: "", items: [], documents: [], canCreate: false }); setDetail(null); setHistory(null);
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

  const reload = useCallback(async (silent = false) => {
    if (!scope || !useCases) return;
    const captured = identity.current;
    const request = ++sequence.current;
    if (!silent) setLoading(true); setLoadError("");
    try {
      const [nextItems, nextDocuments] = await Promise.all([
        useCases.listVehicles.execute(),
        useCases.listDocuments.execute().catch(() => [] as HouseDocument[]),
      ]);
      if (!mounted.current || identity.current !== captured || sequence.current !== request) return;
      setSnapshot({ scope, items: nextItems.vehicles, canCreate: nextItems.canCreate,
        documents: nextItems.canCreate ? nextDocuments.filter((document) => document.visibility === "shared") : [] });
      setAccessDenied(false);
    } catch (error) {
      if (!mounted.current || identity.current !== captured || sequence.current !== request) return;
      if (!deny(error)) { setSnapshot({ scope: "", items: [], documents: [], canCreate: false }); setLoadError(messageOf(error)); }
    } finally {
      if (mounted.current && identity.current === captured && sequence.current === request) setLoading(false);
    }
  }, [scope, useCases, deny]);
  useHouseholdRefresh(() => reload(true));

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
  useEffect(() => {
    if (snapshot.scope !== scope || loading) return;
    if (!canCreate) clearForm();
    if (detailItem && !detailItem.canViewHistory) {
      historySequence.current += 1; setHistory(null); setHistoryError(""); setHistoryLoading(false); closePreview();
    }
  }, [canCreate, detailItem?.canViewHistory, snapshot.scope, scope, loading, clearForm, closePreview]);

  const loadHistory = async (item: Vehicle) => {
    if (!useCases || !available || accessDenied || !item.canViewHistory) return;
    const captured = identity.current;
    const request = ++historySequence.current;
    setHistory(null); setHistoryLoading(true); setHistoryError("");
    try {
      const rows = await useCases.listVehicleServices.execute(item.id);
      if (stillCurrent(captured) && historySequence.current === request) setHistory({ scope, id: item.id, rows });
    } catch (error) {
      if (stillCurrent(captured) && historySequence.current === request && !deny(error)) setHistoryError(messageOf(error));
    } finally { if (stillCurrent(captured) && historySequence.current === request) setHistoryLoading(false); }
  };
  const openDetail = (item: Vehicle) => {
    if (!available || busy || accessDenied) return;
    setDetail({ scope, id: item.id }); setFileError(""); void loadHistory(item);
  };
  useEffect(() => {
    if (!initialVehicleId) { handledInitial.current = ""; return; }
    if (!available || loading || snapshot.scope !== scope || accessDenied) return;
    const key = `${scope}:${initialVehicleId}`;
    if (handledInitial.current === key) return;
    handledInitial.current = key;
    const item = snapshot.items.find((row) => row.id === initialVehicleId);
    if (item) openDetail(item);
    onInitialVehicleConsumed?.();
  }, [initialVehicleId, available, loading, snapshot, scope, accessDenied, onInitialVehicleConsumed]);
  const closeDetail = () => {
    if (busy) return;
    setDetail(null); setHistory(null); setHistoryError(""); setFileError(""); historySequence.current += 1; closePreview();
  };
  const openItem = (item: Vehicle | null) => {
    if (!available || busy || accessDenied || (item ? !item.canEdit : !canCreate)) return;
    clearForm();
    setForm(item ? { title: item.title, brand: item.brand ?? "", model: item.model ?? "", plate: item.plate ?? "", purchase: dateForm(item.purchaseDate),
      insurance: dateForm(item.insuranceUntil), inspection: dateForm(item.inspectionUntil), odometer: toFa(item.odometer),
      documentId: item.documentId ?? "", taskId: item.serviceTaskId ?? "",
      serviceDue: dateForm(item.serviceDueDate), serviceKm: item.serviceDueOdometer === null ? "" : toFa(item.serviceDueOdometer), reminder: item.serviceReminderEnabled } : EMPTY_FORM);
    setDialog({ scope, kind: "item", item });
  };
  const openService = (item: Vehicle) => {
    if (!available || busy || accessDenied || !item.canEdit) return;
    clearForm(); setPerformed(dateForm(todayIso)); setPerformedKm(toFa(item.odometer)); setEntryCurrency(cur); setDialog({ scope, kind: "service", item });
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
      const input: VehicleInput = { title: form.title, brand: form.brand, model: form.model, plate: form.plate,
        purchaseDate: dateValue(form.purchase), insuranceUntil: dateValue(form.insurance), inspectionUntil: dateValue(form.inspection), odometer: odometerValue(form.odometer),
        documentId: form.documentId || null, serviceTaskId: form.taskId || null,
        serviceDueDate: dateValue(form.serviceDue), serviceDueOdometer: form.serviceKm.trim() ? odometerValue(form.serviceKm) : null, serviceReminderEnabled: form.reminder };
      const error = vehicleError(input, activeDialog.item?.odometer ?? 0);
      if (error) { setFormError(error); return; }
      const item = activeDialog.item;
      void mutate(() => item ? useCases.updateVehicle.execute(item.id, input, item.revision) : useCases.addVehicle.execute(input),
        item ? "خودرو به‌روز شد." : "خودرو ثبت شد.");
    } catch (error) { setFormError(messageOf(error)); }
  };
  const saveService = async () => {
    if (!useCases || activeDialog?.kind !== "service" || busy || mutationPending.current || !activeDialog.item.canEdit) return;
    const item = activeDialog.item;
    try {
      const input: VehicleServiceInput = { performedOn: dateValue(performed) ?? "", description: description.trim(), nextDueDate: dateValue(nextDue),
        performedOdometer: odometerValue(performedKm), nextDueOdometer: nextKm.trim() ? odometerValue(nextKm) : null,
        costAmount: serviceCost(cost, entryCurrency), accountId: accountId || null };
      const error = vehicleServiceError(input, item.odometer);
      if (error) { setFormError(error); return; }
      const key = JSON.stringify([item.id, item.revision, input]);
      if (operation.current?.key !== key) operation.current = { key, id: crypto.randomUUID() };
      const captured = identity.current;
      mutationPending.current = true; setBusy(true); setFormError("");
      try {
        const saved = await useCases.addVehicleService.execute(item.id, input, item.revision, operation.current.id);
        if (!stillCurrent(captured)) return;
        setSnapshot((previous) => ({ ...previous, items: previous.items.map((row) => row.id === item.id ? saved.vehicle : row) }));
        setHistory((previous) => ({ scope, id: item.id, rows: [saved.record, ...(previous?.id === item.id ? previous.rows.filter((row) => row.id !== saved.record.id) : [])] }));
        await afterCommit(captured, saved.record.costStatus === "recorded" ? "سرویس و هزینهٔ آن در مالی ثبت شدند." : "سرویس ثبت شد و موعدهای بعدی به‌روز شدند.");
        if (stillCurrent(captured)) void loadHistory(saved.vehicle);
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
            items: previous.items.map((row) => row.documentId === document.id
              ? { ...row, documentId: null } : row),
          }));
          setForm((previous) => previous.documentId === document.id ? { ...previous, documentId: "" } : previous);
        }
        void reload();
      }
    } finally { if (stillCurrent(captured) && fileSequence.current === request) setDownloading(false); }
  };
  const linkedDocument = detailItem ? documents.find((row) => row.id === detailItem.documentId) : undefined;
  const linkedTask = detailItem ? tasks.find((row) => row.id === detailItem.serviceTaskId) : undefined;

  return <AppPage className="page active vehicle-page" aria-busy={loading || busy}>
    <header className="app-header"><div className="header-title"><h1>خودرو و نگهداری</h1><p>مدارک، کیلومتر و هزینهٔ سرویس</p></div></header>
    <div className="content">
      {!available ? <Card><p className="modal-sub" role="status">مشاهده و مدیریت خودرو و نگهداری به اتصال اینترنت و ورود معتبر نیاز دارد.</p></Card> : <>
        <Card><div className="vehicle-summary"><div><p className="vehicle-count">{toFa(items.length)} خودروی خانواده</p>
          <p className="form-note">{toFa(filterVehicles(items, "overdue", "", todayIso).length)} سرویس عقب‌افتاده</p></div><Icon name="i-grid4" size={30} /></div>
          {canCreate ? <button type="button" className="btn-primary" disabled={loading || busy || accessDenied} onClick={() => openItem(null)}>ثبت خودروی جدید</button> : null}</Card>
        <input type="search" className="text-input" aria-label="جست‌وجوی خودروها" placeholder="نام خودرو، برند، مدل یا پلاک" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="vehicle-tabs" role="group" aria-label="فیلتر خودروها">{FILTERS.map((option) => <button type="button" key={option.value}
          className={`vehicle-tab${filter === option.value ? " active" : ""}`} aria-pressed={filter === option.value} onClick={() => setFilter(option.value)}>{option.label}</button>)}</div>
        {loading ? <p className="form-note" role="status">در حال دریافت خودرو و نگهداری…</p> : null}
        {loadError ? <Card><p className="modal-sub" role="alert">{loadError}</p><button type="button" className="btn-secondary" disabled={loading || busy} onClick={() => void reload()}>تلاش دوباره</button></Card> : null}
        {visible.length ? <div className="vehicle-list">{visible.map((item) => <Card key={item.id}><div className="vehicle-row" id={`vehicle-${item.id}`}>
          <button type="button" className="vehicle-details" aria-label={`جزئیات ${item.title}`} disabled={busy} onClick={() => openDetail(item)}>
            <b>{item.title}</b><span>{[item.brand, item.model].filter(Boolean).join(" · ") || "بدون برند و مدل"}</span>
            <span>{toFa(item.odometer)} کیلومتر{item.canViewHistory && item.plate ? ` · ${item.plate}` : ""}</span>
            <span className={filterVehicles([item], "overdue", "", todayIso).length ? "vehicle-overdue" : ""}>{vehicleServiceLabel(item, todayIso)}{item.serviceDueDate ? ` · ${dateText(item.serviceDueDate)}` : ""}</span>
            {item.serviceDueOdometer !== null ? <span>سرویس بعدی در {toFa(item.serviceDueOdometer)} کیلومتر</span> : null}</button>
          {item.canDelete ? <button type="button" className="icon-btn" disabled={busy} aria-label={`حذف ${item.title}`} onClick={() => { clearForm(); setDialog({ scope, kind: "delete", item }); }}><Icon name="i-trash" size={18} /></button> : null}
        </div></Card>)}</div> : !loading && !loadError ? <p className="modal-sub" role="status">{items.length ? "خودرویی با این جست‌وجو یا فیلتر پیدا نشد." : "هنوز خودرویی ثبت نشده است."}</p> : null}
      </>}
    </div>
    <Modal open={Boolean(detailItem)} onClose={closeDetail} title={detailItem?.title} sheetClassName="vehicle-sheet" dragToClose>
      {detailItem ? <div className="vehicle-detail-body">
        <dl className="vehicle-facts"><div><dt>برند و مدل</dt><dd>{[detailItem.brand, detailItem.model].filter(Boolean).join(" · ") || "ثبت نشده"}</dd></div>
          <div><dt>تاریخ خرید</dt><dd>{dateText(detailItem.purchaseDate)}</dd></div><div><dt>کیلومتر فعلی</dt><dd>{toFa(detailItem.odometer)} کیلومتر</dd></div>
          {detailItem.canViewHistory ? <><div><dt>پلاک</dt><dd>{detailItem.plate || "ثبت نشده"}</dd></div>
            <div><dt>پایان بیمه</dt><dd>{dateText(detailItem.insuranceUntil)}</dd></div><div><dt>پایان معاینهٔ فنی</dt><dd>{dateText(detailItem.inspectionUntil)}</dd></div></> : null}
          <div><dt>تاریخ سرویس بعدی</dt><dd>{dateText(detailItem.serviceDueDate)}</dd></div>
          <div><dt>کیلومتر سرویس بعدی</dt><dd>{detailItem.serviceDueOdometer === null ? "ثبت نشده" : `${toFa(detailItem.serviceDueOdometer)} کیلومتر`}</dd></div>
          <div><dt>یادآور سرویس</dt><dd>{detailItem.serviceReminderEnabled ? "روشن" : "خاموش"}</dd></div></dl>
        {detailItem.canEdit ? <div className="vehicle-actions"><button type="button" className="btn-primary" disabled={busy} onClick={() => openService(detailItem)}>ثبت سرویس انجام‌شده</button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => openItem(detailItem)}>ویرایش خودرو</button></div> : <p className="form-note">ویرایش و ثبت سرویس در اختیار سازندهٔ خودرو و مدیر خانواده است.</p>}
        {detailItem.canViewHistory && linkedDocument ? <div className="vehicle-link"><span>سند خودرو: {linkedDocument.title}</span><button type="button" className="btn-secondary" disabled={downloading} onClick={() => void downloadDocument(linkedDocument)}>{downloading ? "در حال دریافت سند…" : "مشاهدهٔ سند خودرو"}</button></div> : null}
        {detailItem.canViewHistory && !linkedDocument && onOpenDocuments ? <button type="button" className="vehicle-text-action" onClick={onOpenDocuments}>اسناد خانه</button> : null}
        {linkedTask ? <div className="vehicle-link"><span>کار مرتبط: {linkedTask.title} · {linkedTask.completed ? "انجام‌شده" : "در انتظار انجام"}</span>
          {onOpenTasks ? <button type="button" className="btn-secondary" onClick={onOpenTasks}>بازکردن کارهای خانه</button> : null}</div> : null}
        {fileError ? <p className="form-error" role="alert">{fileError}</p> : null}
        {detailItem.canViewHistory ? <><h2 className="vehicle-section-title">سابقهٔ سرویس</h2>
        {historyLoading ? <p className="form-note" role="status">در حال دریافت سابقه…</p> : null}
        {historyError ? <><p className="form-error" role="alert">{historyError}</p><button type="button" className="btn-secondary" onClick={() => void loadHistory(detailItem)}>دریافت دوبارهٔ سابقه</button></> : null}
        {!historyLoading && !historyError && !records.length ? <p className="form-note">هنوز سرویس انجام‌شده‌ای ثبت نشده است.</p> : null}
        <ol className="vehicle-history">{records.map((record) => <li key={record.id}><b>{dateText(record.performedOn)} · {toFa(record.performedOdometer)} کیلومتر</b><p>{record.description}</p>
          <span>تاریخ سرویس بعدی: {dateText(record.nextDueDate)}</span>
          <span>کیلومتر سرویس بعدی: {record.nextDueOdometer === null ? "ثبت نشده" : `${toFa(record.nextDueOdometer)} کیلومتر`}</span>
          <p className="vehicle-service-cost">{record.costStatus === "none" ? "بدون هزینهٔ ثبت‌شده" : record.costStatus === "recorded" && record.costAmount !== null
            ? <>هزینهٔ ثبت‌شده در مالی: {formatAmount(toDisplay(record.costAmount, cur))} <CurrencyUnit /></> : "هزینهٔ قبلی اکنون در دسترس نیست."}</p>
          {record.costStatus === "recorded" && record.transactionId && onOpenFinance ? <button type="button" className="btn-secondary" onClick={() => {
            const transactionId = record.transactionId!; onOpenFinance(transactionId);
          }}>مشاهدهٔ هزینه در مالی</button> : null}</li>)}</ol></> : <p className="form-note">سابقهٔ سرویس برای این حساب در دسترس نیست.</p>}
        <button type="button" className="btn-secondary" onClick={closeDetail}>بستن جزئیات</button>
      </div> : null}
    </Modal>
    <Modal open={activeDialog?.kind === "item"} onClose={() => { if (!busy) clearForm(); }} title={activeDialog?.kind === "item" && activeDialog.item ? "ویرایش خودرو" : "خودروی جدید"} sheetClassName="vehicle-sheet" dragToClose>
      <form autoComplete="off" onSubmit={(event) => { event.preventDefault(); saveItem(); }}>
        <fieldset disabled={busy} className="vehicle-fields">
          <Field label="نام خودرو"><input className="text-input" aria-label="نام خودرو" value={form.title} maxLength={120} onChange={(event) => setForm((previous) => ({ ...previous, title: event.target.value }))} /></Field>
          <div className="vehicle-two-fields"><Field label="برند"><input className="text-input" aria-label="برند" value={form.brand} maxLength={80} onChange={(event) => setForm((previous) => ({ ...previous, brand: event.target.value }))} /></Field>
            <Field label="مدل"><input className="text-input" aria-label="مدل" value={form.model} maxLength={80} onChange={(event) => setForm((previous) => ({ ...previous, model: event.target.value }))} /></Field></div>
          <Field label="پلاک"><input className="text-input" aria-label="پلاک" value={form.plate} maxLength={30} onChange={(event) => setForm((previous) => ({ ...previous, plate: event.target.value }))} /></Field>
          <Field label="کیلومتر فعلی"><input className="text-input" aria-label="کیلومتر فعلی" inputMode="numeric" value={form.odometer} onChange={(event) => setForm((previous) => ({ ...previous, odometer: event.target.value }))} /></Field>
          <VehicleDate label="تاریخ خرید" value={form.purchase} onChange={(value) => setForm((previous) => ({ ...previous, purchase: value }))} />
          <VehicleDate label="پایان بیمه" value={form.insurance} onChange={(value) => setForm((previous) => ({ ...previous, insurance: value }))} />
          <VehicleDate label="پایان معاینهٔ فنی" value={form.inspection} onChange={(value) => setForm((previous) => ({ ...previous, inspection: value }))} />
          <Field label="سند مشترک خودرو"><select className="text-input" aria-label="سند مشترک خودرو" value={form.documentId} onChange={(event) => setForm((previous) => ({ ...previous, documentId: event.target.value }))}>
            <option value="">بدون سند مرتبط</option>{form.documentId && !documents.some((row) => row.id === form.documentId) ? <option value={form.documentId}>سند مرتبط؛ اطلاعات فعلاً در دسترس نیست</option> : null}
            {documents.map((document) => <option key={document.id} value={document.id}>{document.title}</option>)}</select></Field>
          <p className="form-note">فقط اسناد مشترکِ مجاز قابل انتخاب‌اند. سند را از بخش اسناد خانه ثبت کنید.</p>
          <VehicleDate label="موعد سرویس بعدی" value={form.serviceDue} onChange={(value) => setForm((previous) => ({ ...previous, serviceDue: value }))} />
          <Field label="کیلومتر سرویس بعدی"><input className="text-input" aria-label="کیلومتر سرویس بعدی" inputMode="numeric" value={form.serviceKm} placeholder="اختیاری" onChange={(event) => setForm((previous) => ({ ...previous, serviceKm: event.target.value }))} /></Field>
          <label className="vehicle-check"><input type="checkbox" checked={form.reminder} onChange={(event) => setForm((previous) => ({ ...previous, reminder: event.target.checked }))} /><span>یادآور سرویس این خودرو</span></label>
          <Field label="کار مرتبط"><select className="text-input" aria-label="کار مرتبط" value={form.taskId} onChange={(event) => setForm((previous) => ({ ...previous, taskId: event.target.value }))}>
            <option value="">بدون کار مرتبط</option>{form.taskId && !tasks.some((row) => row.id === form.taskId) ? <option value={form.taskId}>کار مرتبط؛ اطلاعات فعلاً در دسترس نیست</option> : null}
            {tasks.map((task) => <option key={task.id} value={task.id}>{task.title}{task.completed ? " (انجام‌شده)" : ""}</option>)}</select></Field>
          <p className="form-note">ثبت سرویس، کار مرتبط را خودکار انجام‌شده نمی‌کند.</p>
        </fieldset>
        {formError ? <p className="form-error" role="alert">{formError}</p> : null}
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? "در حال ذخیره…" : "ذخیرهٔ خودرو"}</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={clearForm}>انصراف</button>
      </form>
    </Modal>
    <Modal open={activeDialog?.kind === "service"} onClose={() => { if (!busy) clearForm(); }} title="ثبت سرویس انجام‌شده" sheetClassName="vehicle-sheet" dragToClose>
      <form autoComplete="off" onSubmit={(event) => { event.preventDefault(); void saveService(); }}>
        <p className="modal-sub">{activeDialog?.kind === "service" ? activeDialog.item.title : ""}</p>
        <fieldset disabled={busy} className="vehicle-fields">
          <VehicleDate label="تاریخ انجام سرویس" value={performed} onChange={(value) => changeService(setPerformed, value)} required />
          <Field label="کیلومتر انجام سرویس"><input className="text-input" aria-label="کیلومتر انجام سرویس" inputMode="numeric" value={performedKm} onChange={(event) => changeService(setPerformedKm, event.target.value)} /></Field>
          <Field label="شرح سرویس"><textarea className="text-input vehicle-description" aria-label="شرح سرویس" value={description} maxLength={1000} rows={4} onChange={(event) => changeService(setDescription, event.target.value)} /></Field>
          <VehicleDate label="تاریخ سرویس بعدی" value={nextDue} onChange={(value) => changeService(setNextDue, value)} />
          <Field label="کیلومتر سرویس بعدی"><input className="text-input" aria-label="کیلومتر سرویس بعدی" inputMode="numeric" value={nextKm} placeholder="اختیاری" onChange={(event) => changeService(setNextKm, event.target.value)} /></Field>
          <p className="form-note">موعدهای قبلی با انتخاب جدید جایگزین می‌شوند. می‌توانید تاریخ، کیلومتر یا هر دو را ثبت کنید؛ خالی‌بودن هر دو یعنی فعلاً سرویس دیگری برنامه‌ریزی نشده است.</p>
          <div role="group" aria-label="هزینهٔ سرویس"><Field label="هزینهٔ سرویس — اختیاری"><AmountInput value={cost} currency={currencyLabel(entryCurrency)} disabled={busy} onCurrencyChange={(value, unit) => { changeService(setCost, value); setEntryCurrency(unit); }} onChange={(value) => {
            changeService(setCost, value); if (!value.trim()) setAccountId("");
          }} /></Field></div>
          <Field label="حساب پرداخت هزینه"><select className="text-input" aria-label="حساب پرداخت هزینه" value={accountId} disabled={!cost.trim()} onChange={(event) => changeService(setAccountId, event.target.value)}>
            <option value="">بدون حساب مشخص</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.title}</option>)}</select></Field>
          <p className="form-note">مبلغ خالی یعنی بدون هزینه. با ثبت مبلغ، یک هزینهٔ حمل‌ونقل در بخش مالی همراه این سرویس ثبت می‌شود؛ ویرایش یا حذف هزینه از همان بخش مالی انجام می‌شود.</p>
        </fieldset>
        {formError ? <p className="form-error" role="alert">{formError}</p> : null}
        {serviceConflict ? <button type="button" className="btn-secondary" disabled={busy} onClick={() => { clearForm(); void reload(); }}>دریافت نسخهٔ جدیدِ خودرو</button> : null}
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? "در حال ثبت…" : cost.trim() ? "ثبت سرویس و هزینه" : "ثبت سرویس"}</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={clearForm}>انصراف</button>
      </form>
    </Modal>
    <Modal open={activeDialog?.kind === "delete"} onClose={() => { if (!busy) clearForm(); }} title="حذف خودرو" sheetClassName="vehicle-sheet">
      <p className="modal-sub">«{activeDialog?.kind === "delete" ? activeDialog.item.title : ""}» و تمام سابقهٔ سرویس آن حذف می‌شوند. هزینه‌های ثبت‌شده در مالی، اسناد و کار مرتبط حفظ می‌شوند.</p>
      {formError ? <p className="form-error" role="alert">{formError}</p> : null}
      <button type="button" className="btn-primary vehicle-delete" disabled={busy} onClick={() => {
        if (!useCases || activeDialog?.kind !== "delete" || !activeDialog.item.canDelete) return;
        const item = activeDialog.item;
        void mutate(() => useCases.deleteVehicle.execute(item.id, item.revision), "خودرو و سابقهٔ آن حذف شدند.");
      }}>{busy ? "در حال حذف…" : "حذف خودرو و سابقه"}</button>
      <button type="button" className="btn-secondary" disabled={busy} onClick={clearForm}>انصراف</button>
    </Modal>
    <Modal open={available && preview?.scope === scope && Boolean(detailItem?.canViewHistory)} onClose={closePreview} title="سند خودرو" sheetClassName="vehicle-sheet">
      {preview && available && preview.scope === scope && detailItem?.canViewHistory ? <><p className="modal-sub">{preview.document.title}</p>
        {preview.document.mimeType.startsWith("image/") ? <img className="vehicle-preview" src={preview.url} alt={preview.document.title} /> : <p className="form-note">فایل PDF: {preview.document.fileName}</p>}
        <a className="btn-primary vehicle-download" href={preview.url} download={preview.document.fileName}>دانلود سند</a>
        <button type="button" className="btn-secondary" onClick={closePreview}>بستن سند</button></> : null}
    </Modal>
  </AppPage>;
}

function VehicleDate({ label, value, onChange, required = false }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return <div className="vehicle-date" role="group" aria-label={label}><Field label={label}><JalaliDateInput value={value} onChange={onChange} placeholder={required ? "انتخاب تاریخ" : "اختیاری؛ انتخاب تاریخ"} minYear={1300} maxYear={1500} /></Field>
    {!required && value ? <button type="button" className="vehicle-text-action" aria-label={`پاک‌کردن ${label}`} onClick={() => onChange("")}>پاک‌کردن تاریخ</button> : null}</div>;
}
import { useHouseholdRefresh } from "@/shared/lib/useHouseholdRefresh";
