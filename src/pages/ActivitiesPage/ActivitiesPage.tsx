import { AppPage } from "@/shared/ui/AppPage";
import { useActivitiesModel } from "@/features/activities/model/useActivitiesModel";
import { activityStatusLabel, type ActivityFilter } from "@/features/activities/model/activityPresentation";
import type { ActivityStatus } from "@/domain/activity/activity.types";
import { formatLong, isoToJalali } from "@/shared/lib/jalali";
import { toFa } from "@/shared/lib/digits";
import { Card, Field, Icon, JalaliDateInput, Modal } from "@/shared/ui";
import "./ActivitiesPage.css";
import { useState } from "react";
import { useQuickAddRequest, type QuickAddPageProps } from "@/shared/lib/useQuickAddRequest";
import { useToast } from "@/app/providers/ToastProvider";

const FILTERS: { value: ActivityFilter; label: string }[] = [
  { value: "all", label: "همه" }, { value: "planned", label: "برنامه‌ریزی‌شده" },
  { value: "done", label: "انجام‌شده" }, { value: "cancelled", label: "لغوشده" },
];
export function ActivitiesPage({ initialActivityId, onChanged, onInitialActivityConsumed, quickAddId, onQuickAddConsumed }: QuickAddPageProps & {
  initialActivityId?: string; onChanged?: () => void | Promise<void>; onInitialActivityConsumed?: () => void;
}) {
  const model = useActivitiesModel(initialActivityId, onChanged, onInitialActivityConsumed);
  const { detailItem, activeDialog, form, busy } = model;
  const [quickForm, setQuickForm] = useState(false);
  const { show } = useToast();
  useQuickAddRequest(quickAddId, model.available && !model.loading && !busy && (model.hasSnapshot || model.accessDenied), () => {
    if (activeDialog || detailItem) { show("فرم باز قبلی حفظ شده است؛ ابتدا همان فرم را تکمیل یا ببندید."); return; }
    if (!model.canCreate) { show("اجازهٔ ثبت برنامهٔ خانوادگی در دسترس نیست."); return; }
    model.openItem(null); setQuickForm(true);
  }, onQuickAddConsumed);
  const selectedParticipants = detailItem ? model.participants.filter((member) => detailItem.participantIds.includes(member.id)) : [];
  return <AppPage className="page active activities-page" aria-busy={model.loading || busy || model.detailLoading}>
    <header className="app-header"><div className="header-title"><h1>تفریح و برنامه‌های خانوادگی</h1><p>برنامه‌های مشترک، شرکت‌کنندگان و یادآورها</p></div></header>
    <div className="content">
      {!model.available ? <Card><p className="modal-sub" role="status">مشاهده و مدیریت برنامه‌های خانوادگی به اتصال اینترنت و ورود معتبر نیاز دارد.</p></Card> : <>
        <Card><div className="activities-summary"><div><p className="activities-count">{toFa(model.items.length)} برنامهٔ خانوادگی</p>
          <p className="form-note">برنامه‌های مشترک خانواده در تقویم هم نمایش داده می‌شوند.</p></div><Icon name="i-grid4" size={30} /></div>
          <button type="button" className="btn-primary" disabled={model.loading || busy || !model.canCreate || model.accessDenied} onClick={() => { setQuickForm(false); model.openItem(null); }}>ثبت برنامهٔ جدید</button></Card>
        <input type="search" className="text-input" aria-label="جست‌وجوی برنامه‌ها" placeholder="عنوان، توضیح یا مکان" value={model.query} onChange={(event) => model.setQuery(event.target.value)} />
        <div className="activities-tabs" role="group" aria-label="فیلتر وضعیت">{FILTERS.map((option) => <button type="button" key={option.value}
          className={`activities-tab${model.filter === option.value ? " active" : ""}`} aria-pressed={model.filter === option.value} onClick={() => model.setFilter(option.value)}>{option.label}</button>)}</div>
        {model.loading || model.detailLoading ? <p className="form-note" role="status">در حال دریافت برنامه‌ها…</p> : null}
        {model.loadError ? <Card><p className="modal-sub" role="alert">{model.loadError}</p><button type="button" className="btn-secondary" disabled={model.loading || busy} onClick={() => void model.reload()}>تلاش دوباره</button></Card> : null}
        {model.visible.length ? <div className="activities-list">{model.visible.map((item) => <Card key={item.id}><div className="activities-row" id={`activity-${item.id}`}>
          <button type="button" className="activities-details" aria-label={`جزئیات ${item.title}`} disabled={busy || model.detailLoading} onClick={() => void model.openDetail(item.id)}>
            <b>{item.title}</b><span>{formatLong(isoToJalali(item.date))} · {activityStatusLabel(item.status)}</span>
            <span>{item.location || "مکان مشخص نشده"}</span>{item.note ? <span className="activities-note-preview">{item.note}</span> : null}</button>
          {item.canDelete ? <button type="button" className="icon-btn" disabled={busy} aria-label={`حذف ${item.title}`} onClick={() => model.openDelete(item)}><Icon name="i-trash" size={18} /></button> : null}
        </div></Card>)}</div> : !model.loading && !model.loadError ? <Card><p className="modal-sub">{model.items.length ? "برنامه‌ای با این جست‌وجو و فیلتر پیدا نشد." : "هنوز برنامه‌ای ثبت نشده است."}</p></Card> : null}
      </>}
    </div>
    <Modal open={Boolean(detailItem)} onClose={model.closeDetail} title={detailItem?.title} sheetClassName="activities-sheet" dragToClose>
      {detailItem ? <div className="activities-detail-body"><dl className="activities-facts">
        <div><dt>تاریخ برنامه</dt><dd>{formatLong(isoToJalali(detailItem.date))}</dd></div>
        <div><dt>وضعیت</dt><dd>{activityStatusLabel(detailItem.status)}</dd></div>
        <div><dt>مکان</dt><dd>{detailItem.location || "مشخص نشده"}</dd></div>
        <div><dt>یادآور</dt><dd>{detailItem.reminderEnabled ? "روشن" : "خاموش"}</dd></div>
      </dl>{detailItem.note ? <p className="activities-note">{detailItem.note}</p> : <p className="form-note">توضیحی ثبت نشده است.</p>}
        <h2 className="activities-section-title">شرکت‌کنندگان</h2>
        {selectedParticipants.length ? <ul className="activities-participant-list">{selectedParticipants.map((member) => <li key={member.id}>{member.name}</li>)}</ul> : <p className="form-note">شرکت‌کننده‌ای انتخاب نشده است.</p>}
        {detailItem.canEdit ? <div className="activities-actions">
          {detailItem.status !== "done" ? <button type="button" className="btn-primary" disabled={busy} onClick={() => model.setStatus(detailItem, "done")}>ثبت انجام‌شدن</button> : null}
          {detailItem.status !== "planned" ? <button type="button" className="btn-secondary" disabled={busy} onClick={() => model.setStatus(detailItem, "planned")}>برنامه‌ریزی دوباره</button> : null}
          {detailItem.status !== "cancelled" ? <button type="button" className="btn-secondary" disabled={busy} onClick={() => model.setStatus(detailItem, "cancelled")}>لغو برنامه</button> : null}
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => model.openItem(detailItem)}>ویرایش برنامه</button>
        </div> : <p className="form-note">ویرایش برنامه در اختیار سازنده و مدیر خانواده است.</p>}
        {detailItem.canDelete ? <button type="button" className="btn-secondary activities-danger-text" disabled={busy} onClick={() => model.openDelete(detailItem)}>حذف برنامه</button> : null}
        {model.conflict ? <button type="button" className="btn-secondary" disabled={busy} onClick={model.refreshConflict}>دریافت نسخهٔ جدیدِ برنامه</button> : null}
        <button type="button" className="btn-secondary" disabled={busy} onClick={model.closeDetail}>بستن جزئیات</button>
      </div> : null}
    </Modal>
    <Modal open={activeDialog?.kind === "item"} onClose={model.closeForm} fullscreenOnMobile={quickForm && !activeDialog?.item} title={activeDialog?.kind === "item" && activeDialog.item ? "ویرایش برنامه" : "برنامهٔ جدید"} sheetClassName="activities-sheet" dragToClose>
      <form autoComplete="off" onSubmit={(event) => { event.preventDefault(); model.saveItem(); }}>
        <fieldset className="activities-fields" disabled={busy}>
          <Field label="عنوان برنامه"><input className="text-input" aria-label="عنوان برنامه" value={form.title} maxLength={120} required onChange={(event) => model.setForm((previous) => ({ ...previous, title: event.target.value }))} /></Field>
          <Field label="توضیح"><textarea className="text-input activities-description" aria-label="توضیح" value={form.note} maxLength={2000} rows={4} placeholder="اختیاری" onChange={(event) => model.setForm((previous) => ({ ...previous, note: event.target.value }))} /></Field>
          <div className="activities-date" role="group" aria-label="تاریخ برنامه"><Field label="تاریخ برنامه"><JalaliDateInput value={form.date} onChange={(date) => model.setForm((previous) => ({ ...previous, date }))} placeholder="انتخاب تاریخ" minYear={1300} maxYear={1500} /></Field></div>
          <Field label="مکان"><input className="text-input" aria-label="مکان" value={form.location} maxLength={180} placeholder="اختیاری" onChange={(event) => model.setForm((previous) => ({ ...previous, location: event.target.value }))} /></Field>
          <Field label="وضعیت"><select className="text-input" aria-label="وضعیت" value={form.status} onChange={(event) => model.setForm((previous) => ({ ...previous, status: event.target.value as ActivityStatus }))}>
            <option value="planned">برنامه‌ریزی‌شده</option><option value="done">انجام‌شده</option><option value="cancelled">لغوشده</option></select></Field>
          <fieldset className="activities-participants" aria-label="شرکت‌کنندگان"><legend>شرکت‌کنندگان</legend>
            {model.participants.map((member) => <label className="activities-check" key={member.id}><input type="checkbox" checked={form.participantIds.includes(member.id)}
              disabled={!form.participantIds.includes(member.id) && form.participantIds.length >= 50} onChange={() => model.toggleParticipant(member.id)} /><span>{member.name}</span></label>)}
            {!model.participants.length ? <p className="form-note">عضوی برای انتخاب در دسترس نیست.</p> : null}
          </fieldset>
          <label className="activities-check"><input type="checkbox" checked={form.reminder} onChange={(event) => model.setForm((previous) => ({ ...previous, reminder: event.target.checked }))} /><span>یادآور این برنامه</span></label>
          <p className="form-note">یادآور فقط برای برنامهٔ برنامه‌ریزی‌شده نمایش داده می‌شود.</p>
        </fieldset>
        {model.formError ? <p className="form-error" role="alert">{model.formError}</p> : null}
        {model.conflict ? <button type="button" className="btn-secondary" disabled={busy} onClick={model.refreshConflict}>دریافت نسخهٔ جدیدِ برنامه</button> : null}
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? "در حال ذخیره…" : "ذخیرهٔ برنامه"}</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={model.closeForm}>انصراف</button>
      </form>
    </Modal>
    <Modal open={activeDialog?.kind === "delete"} onClose={model.closeForm} title="حذف برنامه" sheetClassName="activities-sheet">
      <p className="modal-sub">«{activeDialog?.kind === "delete" ? activeDialog.item.title : ""}» از برنامه‌های خانوادگی و تقویم حذف می‌شود و قابل بازیابی نیست.</p>
      {model.formError ? <p className="form-error" role="alert">{model.formError}</p> : null}
      {model.conflict ? <button type="button" className="btn-secondary" disabled={busy} onClick={model.refreshConflict}>دریافت نسخهٔ جدیدِ برنامه</button> : null}
      <button type="button" className="btn-primary activities-delete" disabled={busy} onClick={model.deleteItem}>{busy ? "در حال حذف…" : "تأیید حذف برنامه"}</button>
      <button type="button" className="btn-secondary" disabled={busy} onClick={model.closeForm}>انصراف</button>
    </Modal>
  </AppPage>;
}
