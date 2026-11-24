import { AppPage } from "@/shared/ui/AppPage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import type { DocumentInput, DocumentVisibility, HouseDocument } from "@/domain/document/document.types";
import { validateDocumentDownload, validateDocumentFile } from "@/domain/document/document.rules";
import {
  documentDaysRemaining, documentExpiryLabel, filterDocuments, type DocumentFilter,
} from "@/features/documents/model/documentPresentation";
import { isAppError } from "@/shared/lib/appError";
import { toFa } from "@/shared/lib/digits";
import { formatISO, formatLong, isoToJalali, jalaliToIso, parse, today } from "@/shared/lib/jalali";
import { useOnline } from "@/shared/lib/useOnline";
import { Card, Field, Icon, JalaliDateInput, Modal } from "@/shared/ui";
import "./DocumentsPage.css";

interface DocumentForm {
  title: string;
  category: string;
  visibility: DocumentVisibility;
  expiry: string;
  reminderEnabled: boolean;
}

const EMPTY: DocumentForm = { title: "", category: "", visibility: "private", expiry: "", reminderEnabled: true };
const FILTERS: { value: DocumentFilter; label: string }[] = [
  { value: "all", label: "همه" }, { value: "private", label: "خصوصی" },
  { value: "shared", label: "مشترک" }, { value: "expiring", label: "رو به پایان" },
  { value: "expired", label: "اعتبار تمام‌شده" },
];

function fileSizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${toFa((bytes / (1024 * 1024)).toFixed(1))} مگابایت`
    : `${toFa(Math.max(1, Math.ceil(bytes / 1024)))} کیلوبایت`;
}

export function DocumentsPage({ onChanged }: { onChanged?: () => Promise<void> | void }) {
  const { phase, member, family, useCases, shoppingSync, offlineSession } = useApp();
  const { show } = useToast();
  const online = useOnline();
  const restricted = !online || shoppingSync.offline || offlineSession;
  const available = phase === "ready" && member?.status === "active" &&
    member.membershipState === "active" && Boolean(family && useCases) && !restricted;
  const scope = available ? `${member!.id}:${family!.id}` : "";
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const accessIdentity = useRef({ scope });
  if (accessIdentity.current.scope !== scope) accessIdentity.current = { scope };
  const mounted = useRef(true);
  const requestSequence = useRef(0);
  const fileSequence = useRef(0);
  const mutationPending = useRef(false);
  const filePending = useRef(false);
  const objectUrls = useRef(new Set<string>());
  const fileInput = useRef<HTMLInputElement>(null);
  const [data, setData] = useState<{ scope: string; rows: HouseDocument[] }>({ scope: "", rows: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [filter, setFilter] = useState<DocumentFilter>("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [open, setOpen] = useState(false);
  const [modalScope, setModalScope] = useState("");
  const [editing, setEditing] = useState<HouseDocument | null>(null);
  const [deleting, setDeleting] = useState<HouseDocument | null>(null);
  const [form, setForm] = useState<DocumentForm>(EMPTY);
  const [file, setFile] = useState<File | null>(null);
  const [formError, setFormError] = useState("");
  const [preview, setPreview] = useState<{ document: HouseDocument; url: string; scope: string } | null>(null);
  const todayIso = jalaliToIso(today());
  const documents = data.scope === scope && available ? data.rows : [];
  const visible = useMemo(() => filterDocuments(documents, filter, query, todayIso),
    [documents, filter, query, todayIso]);
  const editable = editing === null || editing.canEdit;
  const stillCurrent = (identity: { scope: string }) => mounted.current && identity.scope !== "" &&
    accessIdentity.current === identity && scopeRef.current === identity.scope;

  const revokeUrls = useCallback(() => {
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.current.clear();
  }, []);

  const invalidateFileRequest = useCallback(() => {
    fileSequence.current += 1;
    filePending.current = false;
    setDownloading(false);
  }, []);

  const clearDeniedAccess = useCallback((error: unknown): boolean => {
    if (!isAppError(error) || !["FORBIDDEN", "SESSION_EXPIRED"].includes(error.code) &&
      error.status !== 401 && error.status !== 403) return false;
    accessIdentity.current = { scope: scopeRef.current };
    requestSequence.current += 1;
    mutationPending.current = false;
    invalidateFileRequest(); revokeUrls();
    setData({ scope: "", rows: [] }); setOpen(false); setEditing(null); setDeleting(null);
    setPreview(null); setFile(null); setForm(EMPTY); setFormError("");
    setBusy(false); setLoading(false); setAccessDenied(true); setLoadError(error.message);
    return true;
  }, [invalidateFileRequest, revokeUrls]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; scopeRef.current = ""; fileSequence.current += 1; revokeUrls(); };
  }, [revokeUrls]);

  const reload = useCallback(async () => {
    if (!scope || !useCases) return;
    const sequence = ++requestSequence.current;
    const identity = accessIdentity.current;
    setLoading(true); setLoadError("");
    try {
      const rows = await useCases.listDocuments.execute();
      if (!mounted.current || accessIdentity.current !== identity || scopeRef.current !== scope || sequence !== requestSequence.current) return;
      setData({ scope, rows }); setAccessDenied(false);
    } catch (error) {
      if (!mounted.current || accessIdentity.current !== identity || scopeRef.current !== scope || sequence !== requestSequence.current) return;
      if (clearDeniedAccess(error)) return;
      setData({ scope, rows: [] });
      setLoadError((error as Error).message || "دریافت اسناد ناموفق بود.");
      const denied = isAppError(error) && (error.code === "FORBIDDEN" || error.status === 403);
      setAccessDenied(denied);
    } finally {
      if (mounted.current && accessIdentity.current === identity && scopeRef.current === scope && sequence === requestSequence.current) setLoading(false);
    }
  }, [scope, useCases, clearDeniedAccess]);

  useEffect(() => {
    requestSequence.current += 1;
    setData({ scope: "", rows: [] }); setOpen(false); setEditing(null); setDeleting(null);
    setPreview(null); setFile(null); setForm(EMPTY); setFormError("");
    setBusy(false); setDownloading(false); setQuery(""); setFilter("all");
    mutationPending.current = false; filePending.current = false;
    fileSequence.current += 1;
    setAccessDenied(false); setLoadError(""); revokeUrls();
    if (scope) void reload();
    else setLoading(false);
  }, [scope, reload, revokeUrls]);

  const notifyChanged = () => {
    try { void Promise.resolve(onChanged?.()).catch(() => {}); }
    catch { /* A notification refresh cannot undo a successful document mutation. */ }
  };

  const openNew = () => {
    if (!available || accessDenied) return;
    invalidateFileRequest();
    setModalScope(scope); setEditing(null); setFile(null); setForm(EMPTY); setFormError(""); setOpen(true);
  };

  const openDocument = (document: HouseDocument) => {
    if (!available) return;
    invalidateFileRequest();
    setModalScope(scope); setEditing(document); setFile(null); setFormError("");
    setForm({ title: document.title, category: document.category ?? "", visibility: document.visibility,
      expiry: document.expiryDate ? formatISO(isoToJalali(document.expiryDate)) : "",
      reminderEnabled: document.reminderEnabled });
    setOpen(true);
  };

  const closeForm = () => {
    if (busy) return;
    invalidateFileRequest();
    setOpen(false); setEditing(null); setFile(null); setForm(EMPTY); setFormError("");
  };

  const chooseFile = (selected?: File) => {
    if (!selected) return;
    setFormError("");
    try { validateDocumentFile(selected); setFile(selected); }
    catch (error) { setFile(null); setFormError((error as Error).message); }
  };

  const save = async () => {
    if (!available || !useCases || busy || mutationPending.current || !editable) return;
    if (!editing && !file) { setFormError("فایل سند را انتخاب کنید."); return; }
    const expiry = form.expiry ? parse(form.expiry) : null;
    if (form.expiry && !expiry) { setFormError("تاریخ اعتبار را دوباره انتخاب کنید."); return; }
    const input: DocumentInput = { title: form.title.trim(), category: form.category.trim() || null,
      visibility: editing && !editing.canChangeVisibility ? editing.visibility : form.visibility,
      expiryDate: expiry ? jalaliToIso(expiry) : null, reminderEnabled: form.reminderEnabled };
    const requestScope = scope;
    const identity = accessIdentity.current;
    invalidateFileRequest();
    mutationPending.current = true;
    setBusy(true); setFormError("");
    try {
      const saved = editing ? await useCases.updateDocument.execute(editing.id, input, editing.revision)
        : await useCases.addDocument.execute(input, file!);
      if (!stillCurrent(identity)) return;
      requestSequence.current += 1;
      setLoading(false); setLoadError(""); setAccessDenied(false);
      setData((previous) => ({ scope: requestScope,
        rows: [saved, ...(previous.scope === requestScope ? previous.rows : []).filter((row) => row.id !== saved.id)] }));
      setOpen(false); setEditing(null); setFile(null); setForm(EMPTY);
      show(editing ? "سند به‌روز شد." : "سند ثبت شد."); notifyChanged();
    } catch (error) {
      if (stillCurrent(identity)) {
        if (clearDeniedAccess(error)) return;
        setFormError((error as Error).message || "ذخیرهٔ سند ناموفق بود.");
        if (isAppError(error) && error.code === "CONFLICT") void reload();
      }
    } finally { if (stillCurrent(identity)) { setBusy(false); mutationPending.current = false; } }
  };

  const remove = async () => {
    if (!available || !useCases || !deleting?.canDelete || busy || mutationPending.current) return;
    const requestScope = scope;
    const identity = accessIdentity.current;
    invalidateFileRequest(); revokeUrls(); setPreview(null);
    mutationPending.current = true;
    setBusy(true);
    try {
      await useCases.deleteDocument.execute(deleting.id, deleting.revision);
      if (!stillCurrent(identity)) return;
      requestSequence.current += 1;
      setLoading(false); setLoadError("");
      setData((previous) => ({ scope: requestScope,
        rows: (previous.scope === requestScope ? previous.rows : []).filter((row) => row.id !== deleting.id) }));
      setDeleting(null); show("سند و فایل آن حذف شدند."); notifyChanged();
    } catch (error) {
      if (stillCurrent(identity)) {
        if (clearDeniedAccess(error)) return;
        show((error as Error).message || "حذف سند ناموفق بود.");
        if (isAppError(error) && error.code === "CONFLICT") void reload();
      }
    } finally { if (stillCurrent(identity)) { setBusy(false); mutationPending.current = false; } }
  };

  const showFile = async (document: HouseDocument) => {
    if (!available || !useCases || downloading || filePending.current) return;
    const requestScope = scope;
    const identity = accessIdentity.current;
    const sequence = ++fileSequence.current;
    filePending.current = true;
    setDownloading(true);
    try {
      const blob = await useCases.downloadDocument.execute(document.id);
      if (!stillCurrent(identity) || sequence !== fileSequence.current) return;
      validateDocumentDownload(blob, document);
      revokeUrls();
      const url = URL.createObjectURL(blob);
      objectUrls.current.add(url);
      setPreview({ document, url, scope: requestScope });
    } catch (error) {
      if (stillCurrent(identity) && sequence === fileSequence.current) {
        if (clearDeniedAccess(error)) return;
        show((error as Error).message || "بازکردن فایل ناموفق بود.");
        if (isAppError(error) && error.code === "NOT_FOUND") {
          requestSequence.current += 1;
          invalidateFileRequest(); revokeUrls(); setPreview(null);
          setLoading(false); setOpen(false); setEditing(null); setFile(null); setForm(EMPTY);
          setData((previous) => ({ scope: requestScope,
            rows: (previous.scope === requestScope ? previous.rows : []).filter((row) => row.id !== document.id) }));
          notifyChanged();
        }
      }
    } finally {
      if (stillCurrent(identity) && sequence === fileSequence.current) { setDownloading(false); filePending.current = false; }
    }
  };

  const closePreview = () => { invalidateFileRequest(); revokeUrls(); setPreview(null); };
  const privateCount = documents.filter((document) => document.visibility === "private").length;
  const expiringCount = filterDocuments(documents, "expiring", "", todayIso).length;

  return (
    <AppPage className="page active documents-page" aria-busy={busy || loading}>
      <header className="app-header"><div className="header-title">
        <h1>اسناد خانه</h1><p>مدارک خصوصی شما و اسناد مشترک خانواده</p>
      </div></header>
      <div className="content">
        {!available ? <Card><p className="modal-sub" role="status">مشاهده و مدیریت اسناد به اتصال اینترنت و ورود معتبر نیاز دارد.</p></Card> : <>
          <Card>
            <div className="documents-summary">
              <div><p className="documents-count">{toFa(documents.length)} سند</p>
                <p className="form-note">{toFa(privateCount)} خصوصی{expiringCount ? ` · ${toFa(expiringCount)} رو به پایان` : ""}</p></div>
              <Icon name="i-briefcase" size={30} />
            </div>
            <button type="button" className="btn-primary" disabled={busy || loading || accessDenied} onClick={openNew}>ثبت سند جدید</button>
          </Card>
          <input type="search" className="text-input documents-search" aria-label="جست‌وجوی اسناد"
            placeholder="جست‌وجوی عنوان، دسته یا نام فایل" value={query} autoComplete="off"
            onChange={(event) => setQuery(event.target.value)} />
          <div className="documents-tabs" role="group" aria-label="فیلتر اسناد">
            {FILTERS.map((option) => <button key={option.value} type="button"
              className={`documents-tab${filter === option.value ? " active" : ""}`}
              aria-pressed={filter === option.value} onClick={() => setFilter(option.value)}>{option.label}</button>)}
          </div>
          {loading ? <p className="form-note" role="status">در حال دریافت اسناد…</p> : null}
          {loadError ? <Card><p className="modal-sub" role="alert">{loadError}</p>
            <button type="button" className="btn-secondary" disabled={loading} onClick={() => void reload()}>تلاش دوباره</button>
          </Card> : null}
          {visible.length ? <Card><div className="documents-list">
            {visible.map((document) => {
              const remaining = documentDaysRemaining(document, todayIso);
              return <div key={document.id} id={`document-${document.id}`} className="document-row">
                <button type="button" className="document-details" onClick={() => openDocument(document)}
                  aria-label={`جزئیات ${document.title}`}>
                  <span className="document-file-icon"><Icon name={document.mimeType === "application/pdf" ? "i-briefcase" : "i-receipt"} size={22} /></span>
                  <span className="document-copy"><b>{document.title}</b>
                    <span className="document-meta">{document.category || "بدون دسته‌بندی"} · {document.mimeType === "application/pdf" ? "PDF" : "عکس"}</span>
                    <span className={`document-expiry${remaining !== null && remaining < 0 ? " expired" : ""}`}>
                      {documentExpiryLabel(document, todayIso)}{document.expiryDate ? ` · ${formatLong(isoToJalali(document.expiryDate))}` : ""}
                    </span>
                  </span>
                </button>
                <div className="document-row-actions"><span className={`document-visibility ${document.visibility}`}>
                  {document.visibility === "private" ? "خصوصی" : "مشترک"}</span>
                  {document.canDelete ? <button type="button" className="icon-btn" aria-label={`حذف ${document.title}`}
                    disabled={busy} onClick={() => { setModalScope(scope); setDeleting(document); }}><Icon name="i-trash" size={17} /></button> : null}
                </div>
              </div>;
            })}
          </div></Card> : !loading && !loadError ? <p className="modal-sub" role="status">
            {!documents.length ? "هنوز سندی ثبت نشده. عکس یا PDF یک مدرک را اضافه کنید و دسترسی آن را مشخص کنید." : "سندی با این فیلتر یا جست‌وجو پیدا نشد."}
          </p> : null}
          <p className="form-note">سند خصوصی فقط برای صاحبش دیده می‌شود. سند مشترک در دسترس اعضای مجاز خانواده است.</p>
        </>}
      </div>
      <Modal open={open && available && modalScope === scope} onClose={closeForm}
        title={editing ? editable ? "ویرایش سند" : "جزئیات سند" : "سند جدید"} dragToClose>
        <form onSubmit={(event) => { event.preventDefault(); void save(); }} autoComplete="off">
          <Field label="عنوان سند"><input aria-label="عنوان سند" className="text-input" value={form.title}
            maxLength={120} autoFocus={editable} disabled={busy || !editable} placeholder="مثلاً ضمانت یخچال"
            onChange={(event) => setForm((previous) => ({ ...previous, title: event.target.value }))} /></Field>
          <Field label="دسته‌بندی (اختیاری)"><input aria-label="دسته‌بندی سند" className="text-input" value={form.category}
            maxLength={80} disabled={busy || !editable} placeholder="مثلاً ضمانت، بیمه یا قرارداد"
            onChange={(event) => setForm((previous) => ({ ...previous, category: event.target.value }))} /></Field>
          <Field label="دسترسی سند"><select aria-label="دسترسی سند" className="select-input" value={form.visibility}
            disabled={busy || !editable || Boolean(editing && !editing.canChangeVisibility)}
            onChange={(event) => setForm((previous) => ({ ...previous, visibility: event.target.value as DocumentVisibility }))}>
            <option value="private">خصوصی — فقط خودم</option><option value="shared">مشترک — خانواده</option>
          </select><p className="form-note">{form.visibility === "private" ? "فقط صاحب سند آن را می‌بیند؛ مدیر خانواده هم به سند خصوصی دسترسی ندارد."
            : "این سند برای اعضای مجاز خانواده قابل مشاهده است."}</p></Field>
          <Field label="تاریخ پایان اعتبار (اختیاری)">{editable && !busy ? <JalaliDateInput value={form.expiry}
            placeholder="بدون تاریخ اعتبار" onChange={(expiry) => setForm((previous) => ({ ...previous, expiry }))} />
            : <p className="modal-sub">{form.expiry || "بدون تاریخ اعتبار"}</p>}
            {form.expiry && editable ? <button type="button" className="btn-ghost" disabled={busy}
              onClick={() => setForm((previous) => ({ ...previous, expiry: "" }))}>حذف تاریخ اعتبار</button> : null}</Field>
          <label className="document-reminder"><input type="checkbox" checked={form.reminderEnabled}
            disabled={busy || !editable} onChange={(event) => setForm((previous) => ({ ...previous, reminderEnabled: event.target.checked }))} />
            یادآور پایان اعتبار</label>
          <p className="form-note">یادآور با تاریخ اعتبار در مرکز اعلان برنامه نمایش داده می‌شود و از تنظیمات اعلان قابل کنترل است.</p>
          <Field label="فایل سند">{editing ? <>
            <p className="document-file-name">{editing.fileName}</p><p className="form-note">{fileSizeLabel(editing.fileSize)}</p>
            <button type="button" className="btn-secondary" disabled={downloading} onClick={() => void showFile(editing)}>
              {downloading ? "در حال دریافت فایل…" : editing.mimeType === "application/pdf" ? "دریافت PDF" : "مشاهدهٔ فایل"}</button>
          </> : <>
            <input ref={fileInput} className="document-file-input" type="file" aria-label="فایل سند"
              accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp" disabled={busy}
              onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = ""; }} />
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => fileInput.current?.click()}>
              {file ? "تغییر فایل" : "انتخاب عکس یا PDF"}</button>
            {file ? <div className="document-selected-file"><span className="document-file-name">{file.name}</span>
              <span className="form-note">{fileSizeLabel(file.size)}</span><button type="button" className="btn-ghost"
                disabled={busy} onClick={() => setFile(null)}>حذف فایل انتخاب‌شده</button></div> : null}
            <p className="form-note">PDF یا عکس JPEG، PNG یا WebP، حداکثر ۱۰ مگابایت.</p>
          </>}</Field>
          {formError ? <p className="modal-sub" role="alert">{formError}</p> : null}
          {editable ? <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "در حال ذخیره…" : editing ? "ذخیرهٔ تغییرات" : "ثبت سند"}</button> : null}
          <button type="button" className="btn-ghost" disabled={busy} onClick={closeForm}>بستن</button>
        </form>
      </Modal>
      <Modal open={Boolean(deleting && available && modalScope === scope)} onClose={() => { if (!busy) setDeleting(null); }} title="حذف سند">
        <p className="modal-sub">«{deleting?.title}» و فایل آن حذف شوند؟</p>
        <button type="button" className="btn-primary document-delete-button" disabled={busy} onClick={() => void remove()}>
          {busy ? "در حال حذف…" : "حذف سند"}</button>
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => setDeleting(null)}>انصراف</button>
      </Modal>
      <Modal open={Boolean(preview && available && preview.scope === scope)} onClose={closePreview}
        title={preview?.document.title} sheetClassName="document-preview-sheet">
        {preview && available && preview.scope === scope ? <>
          {preview.document.mimeType === "application/pdf" ? <div className="document-pdf-download">
            <Icon name="i-briefcase" size={36} />
            <p>فایل PDF آمادهٔ دانلود است.</p>
            <p className="form-note">فایل را دانلود کنید و با برنامهٔ نمایش PDF باز کنید.</p>
          </div> : <img className="document-image-preview" src={preview.url} alt={preview.document.title} />}
          <a className="btn-secondary document-download" href={preview.url} download={preview.document.fileName}>دانلود فایل</a>
          <button type="button" className="btn-ghost" onClick={closePreview}>بستن فایل</button>
        </> : null}
      </Modal>
    </AppPage>
  );
}
