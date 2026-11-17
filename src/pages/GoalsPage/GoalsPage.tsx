import { useGoalsModel } from "@/features/goals/model/useGoalsModel";
import { goalKindLabel, goalStatusLabel, type GoalKindFilter, type GoalStatusFilter } from "@/features/goals/model/goalPresentation";
import type { GoalKind, GoalStatus } from "@/domain/goal/goal.types";
import { formatLong, isoToJalali } from "@/shared/lib/jalali";
import { toFa } from "@/shared/lib/digits";
import { Card, Field, Icon, JalaliDateInput, Modal } from "@/shared/ui";
import "./GoalsPage.css";

const KINDS: { value: GoalKindFilter; label: string }[] = [
  { value: "all", label: "همه" }, { value: "goal", label: "هدف‌ها" }, { value: "wish", label: "آرزوها" },
];
const STATUSES: { value: GoalStatusFilter; label: string }[] = [
  { value: "all", label: "همه" }, { value: "active", label: "فعال" }, { value: "done", label: "انجام‌شده" },
];
const dateText = (value: string | null) => value ? formatLong(isoToJalali(value)) : "بدون موعد";

export function GoalsPage({ initialGoalId, onChanged, onInitialGoalConsumed }: {
  initialGoalId?: string; onChanged?: () => void | Promise<void>; onInitialGoalConsumed?: () => void;
}) {
  const model = useGoalsModel(initialGoalId, onChanged, onInitialGoalConsumed);
  const { detailItem, activeDialog, form, busy } = model;
  return <section className="page active goals-page" aria-busy={model.loading || busy || model.detailLoading}>
    <header className="app-header"><div className="header-title"><h1>اهداف و آرزوها</h1><p>هدف‌ها و آرزوهای شخصی شما</p></div></header>
    <div className="content">
      {!model.available ? <Card><p className="modal-sub" role="status">مشاهده و مدیریت اهداف و آرزوها به اتصال اینترنت و ورود معتبر نیاز دارد.</p></Card> : <>
        <Card><div className="goals-summary"><div><p className="goals-count">{toFa(model.items.filter((goal) => goal.status === "active").length)} مورد فعال</p>
          <p className="form-note">فقط شما این موارد را می‌بینید.</p></div><Icon name="i-heart" size={30} /></div>
          <button type="button" className="btn-primary" disabled={model.loading || busy || !model.canCreate || model.accessDenied} onClick={() => model.openItem(null)}>ثبت هدف یا آرزوی جدید</button></Card>
        <input type="search" className="text-input" aria-label="جست‌وجوی اهداف و آرزوها" placeholder="جست‌وجوی عنوان یا توضیح" value={model.query} onChange={(event) => model.setQuery(event.target.value)} />
        <div className="goals-filter-row"><div className="goals-tabs" role="group" aria-label="فیلتر نوع مورد">{KINDS.map((option) => <button type="button" key={option.value}
          className={`goals-tab${model.kindFilter === option.value ? " active" : ""}`} aria-pressed={model.kindFilter === option.value} onClick={() => model.setKindFilter(option.value)}>{option.label}</button>)}</div>
          <div className="goals-tabs" role="group" aria-label="فیلتر وضعیت">{STATUSES.map((option) => <button type="button" key={option.value}
            className={`goals-tab${model.statusFilter === option.value ? " active" : ""}`} aria-pressed={model.statusFilter === option.value} onClick={() => model.setStatusFilter(option.value)}>{option.label}</button>)}</div></div>
        {model.loading || model.detailLoading ? <p className="form-note" role="status">در حال دریافت اهداف و آرزوها…</p> : null}
        {model.loadError ? <Card><p className="modal-sub" role="alert">{model.loadError}</p><button type="button" className="btn-secondary" disabled={model.loading || busy} onClick={() => void model.reload()}>تلاش دوباره</button></Card> : null}
        {model.visible.length ? <div className="goals-list">{model.visible.map((item) => <Card key={item.id}><div className="goals-row" id={`goal-${item.id}`}>
          <button type="button" className="goals-details" aria-label={`جزئیات ${item.title}`} disabled={busy || model.detailLoading} onClick={() => void model.openDetail(item.id)}>
            <b>{item.title}</b><span>{goalKindLabel(item.kind)} · {goalStatusLabel(item.status)}</span><span>{dateText(item.targetDate)}</span>
            {item.note ? <span className="goals-note-preview">{item.note}</span> : null}</button>
          <button type="button" className="icon-btn" disabled={busy} aria-label={`حذف ${item.title}`} onClick={() => model.openDelete(item)}><Icon name="i-trash" size={18} /></button>
        </div></Card>)}</div> : !model.loading && !model.loadError ? <Card><p className="modal-sub">{model.items.length ? "موردی با این جست‌وجو و فیلتر پیدا نشد." : "هنوز هدف یا آرزویی ثبت نکرده‌اید."}</p></Card> : null}
      </>}
    </div>
    <Modal open={Boolean(detailItem)} onClose={model.closeDetail} title={detailItem?.title} sheetClassName="goals-sheet" dragToClose>
      {detailItem ? <div className="goals-detail-body"><dl className="goals-facts">
        <div><dt>نوع مورد</dt><dd>{goalKindLabel(detailItem.kind)}</dd></div>
        <div><dt>وضعیت</dt><dd>{goalStatusLabel(detailItem.status)}</dd></div>
        <div><dt>موعد</dt><dd>{dateText(detailItem.targetDate)}</dd></div>
        <div><dt>یادآور</dt><dd>{detailItem.reminderEnabled ? "روشن" : "خاموش"}</dd></div>
      </dl>{detailItem.note ? <p className="goals-note">{detailItem.note}</p> : <p className="form-note">توضیحی ثبت نشده است.</p>}
        <div className="goals-actions"><button type="button" className="btn-primary" disabled={busy} onClick={() => model.toggleStatus(detailItem)}>{busy ? "در حال ذخیره…" : detailItem.status === "done" ? "بازگشایی مورد" : "ثبت انجام‌شدن"}</button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => model.openItem(detailItem)}>ویرایش مورد</button>
          <button type="button" className="btn-secondary goals-danger-text" disabled={busy} onClick={() => model.openDelete(detailItem)}>حذف مورد</button></div>
        {model.conflict ? <button type="button" className="btn-secondary" disabled={busy} onClick={model.refreshConflict}>دریافت نسخهٔ جدیدِ مورد</button> : null}
        <button type="button" className="btn-secondary" disabled={busy} onClick={model.closeDetail}>بستن جزئیات</button>
      </div> : null}
    </Modal>
    <Modal open={activeDialog?.kind === "item"} onClose={model.closeForm} title={activeDialog?.kind === "item" && activeDialog.item ? "ویرایش مورد" : "هدف یا آرزوی جدید"} sheetClassName="goals-sheet" dragToClose>
      <form autoComplete="off" onSubmit={(event) => { event.preventDefault(); model.saveItem(); }}>
        <fieldset className="goals-fields" disabled={busy}>
          <Field label="نوع مورد"><select className="text-input" aria-label="نوع مورد" value={form.kind} onChange={(event) => model.setForm((previous) => ({ ...previous, kind: event.target.value as GoalKind }))}>
            <option value="goal">هدف</option><option value="wish">آرزو</option></select></Field>
          <Field label="عنوان"><input className="text-input" aria-label="عنوان" value={form.title} maxLength={120} required onChange={(event) => model.setForm((previous) => ({ ...previous, title: event.target.value }))} /></Field>
          <Field label="توضیح"><textarea className="text-input goals-description" aria-label="توضیح" value={form.note} maxLength={2000} rows={4} placeholder="اختیاری" onChange={(event) => model.setForm((previous) => ({ ...previous, note: event.target.value }))} /></Field>
          <div className="goals-date" role="group" aria-label="موعد"><Field label="موعد"><JalaliDateInput value={form.date} onChange={(date) => model.setForm((previous) => ({ ...previous, date }))} placeholder="اختیاری؛ انتخاب تاریخ" minYear={1300} maxYear={1500} /></Field>
            {form.date ? <button type="button" className="goals-text-action" aria-label="پاک‌کردن موعد" onClick={() => model.setForm((previous) => ({ ...previous, date: "" }))}>پاک‌کردن تاریخ</button> : null}</div>
          <Field label="وضعیت"><select className="text-input" aria-label="وضعیت" value={form.status} onChange={(event) => model.setForm((previous) => ({ ...previous, status: event.target.value as GoalStatus }))}>
            <option value="active">فعال</option><option value="done">انجام‌شده</option></select></Field>
          <label className="goals-check"><input type="checkbox" checked={form.reminder} onChange={(event) => model.setForm((previous) => ({ ...previous, reminder: event.target.checked }))} /><span>یادآور این مورد</span></label>
          <p className="form-note">یادآور برای مورد فعال با موعد ثبت‌شده نمایش داده می‌شود.</p>
        </fieldset>
        {model.formError ? <p className="form-error" role="alert">{model.formError}</p> : null}
        {model.conflict ? <button type="button" className="btn-secondary" disabled={busy} onClick={model.refreshConflict}>دریافت نسخهٔ جدیدِ مورد</button> : null}
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? "در حال ذخیره…" : "ذخیرهٔ مورد"}</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={model.closeForm}>انصراف</button>
      </form>
    </Modal>
    <Modal open={activeDialog?.kind === "delete"} onClose={model.closeForm} title="حذف مورد" sheetClassName="goals-sheet">
      <p className="modal-sub">«{activeDialog?.kind === "delete" ? activeDialog.item.title : ""}» حذف می‌شود و قابل بازیابی نیست.</p>
      {model.formError ? <p className="form-error" role="alert">{model.formError}</p> : null}
      {model.conflict ? <button type="button" className="btn-secondary" disabled={busy} onClick={model.refreshConflict}>دریافت نسخهٔ جدیدِ مورد</button> : null}
      <button type="button" className="btn-primary goals-delete" disabled={busy} onClick={model.deleteItem}>{busy ? "در حال حذف…" : "تأیید حذف مورد"}</button>
      <button type="button" className="btn-secondary" disabled={busy} onClick={model.closeForm}>انصراف</button>
    </Modal>
  </section>;
}
