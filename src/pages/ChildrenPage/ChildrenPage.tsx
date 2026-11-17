import { useChildrenModel } from "@/features/children/model/useChildrenModel";
import { childAgeLabel, childStatusLabel } from "@/features/children/model/childPresentation";
import { formatLong, isoToJalali } from "@/shared/lib/jalali";
import { toFa } from "@/shared/lib/digits";
import { Card, Field, Icon, JalaliDateInput, Modal } from "@/shared/ui";
import "./ChildrenPage.css";

const activityStatus = { planned: "برنامه‌ریزی‌شده", done: "انجام‌شده", cancelled: "لغوشده" };
const displayDate = (date: string | null) => date ? formatLong(isoToJalali(date)) : "مشخص نشده";

export function ChildrenPage({ onChanged, navigate }: {
  onChanged?: () => void | Promise<void>; navigate: (page: "tasks" | "activities" | "calendar") => void;
}) {
  const model = useChildrenModel(onChanged);
  const { detailValue, activeDialog, form, busy } = model;
  const visit = (page: "tasks" | "activities" | "calendar") => { model.closeDetail(); navigate(page); };
  return <section className="page active children-page" aria-busy={model.loading || model.detailLoading || busy}>
    <header className="app-header"><div className="header-title"><h1>فرزندان و برنامه‌های آن‌ها</h1><p>مشخصات، کارهای محول‌شده و برنامه‌های خانوادگی</p></div></header>
    <div className="content">
      {!model.available ? <Card><p className="modal-sub" role="status">مشاهده و مدیریت فرزندان به اتصال اینترنت و ورود معتبر نیاز دارد.</p></Card> : <>
        <Card><div className="children-summary"><div><p className="children-count">{toFa(model.children.length)} فرزند</p><p className="form-note">مشخصات فرزندان با مدیر خانواده ثبت و ویرایش می‌شود.</p></div><Icon name="i-users" size={30} /></div>
          {model.canCreate ? <button type="button" className="btn-primary" disabled={model.loading || busy || model.accessDenied} onClick={() => model.openItem(null)}>ثبت فرزند جدید</button> : null}</Card>
        <input type="search" className="text-input" aria-label="جست‌وجوی فرزندان" placeholder="نام فرزند" value={model.query} onChange={(event) => model.setQuery(event.target.value)} />
        {model.loading || model.detailLoading ? <p className="form-note" role="status">در حال دریافت اطلاعات فرزندان…</p> : null}
        {model.loadError ? <Card><p className="modal-sub" role="alert">{model.loadError}</p><button type="button" className="btn-secondary" disabled={model.loading || busy || model.detailLoading} onClick={() => void model.reload()}>تلاش دوباره</button></Card> : null}
        {model.visible.length ? <div className="children-list">{model.visible.map((child) => <Card key={child.id}><div className="children-row" id={`child-${child.id}`}>
          <button type="button" className="children-details" aria-label={`جزئیات ${child.name}`} disabled={busy || model.detailLoading} onClick={() => void model.openDetail(child.id)}>
            <b>{child.name}</b><span>{childAgeLabel(child)} · {childStatusLabel(child)}</span><span>تولد: {displayDate(child.birthDate)}</span><span className="children-open">کارها و برنامه‌ها</span></button>
        </div></Card>)}</div> : !model.loading && !model.loadError ? <Card><p className="modal-sub">{model.children.length ? "فرزندی با این نام پیدا نشد." : "هنوز فرزندی ثبت نشده است."}</p></Card> : null}
      </>}
    </div>
    <Modal open={Boolean(detailValue)} onClose={model.closeDetail} title={detailValue?.child.name} sheetClassName="children-sheet" dragToClose>
      {detailValue ? <div className="children-detail-body"><dl className="children-facts">
        <div><dt>تاریخ تولد</dt><dd>{displayDate(detailValue.child.birthDate)}</dd></div><div><dt>سن</dt><dd>{childAgeLabel(detailValue.child)}</dd></div><div><dt>وضعیت حساب</dt><dd>{childStatusLabel(detailValue.child)}</dd></div>
      </dl>
        <h2 className="children-section-title">کارهای محول‌شده</h2>
        {detailValue.tasks.length ? <ul className="children-related-list">{detailValue.tasks.map((task) => <li key={task.id}><b>{task.title}</b><span>{task.completed ? "انجام‌شده" : "در انتظار انجام"} · موعد: {displayDate(task.dueDate)}</span></li>)}</ul> : <p className="form-note">کاری به این فرزند واگذار نشده است.</p>}
        <button type="button" className="btn-secondary" onClick={() => visit("tasks")}>رفتن به کارهای خانواده</button>
        <h2 className="children-section-title">برنامه‌های مرتبط</h2>
        {detailValue.activities.length ? <ul className="children-related-list">{detailValue.activities.map((activity) => <li key={activity.id}><b>{activity.title}</b><span>{displayDate(activity.date)} · {activityStatus[activity.status]}</span>{activity.location ? <span>{activity.location}</span> : null}</li>)}</ul> : <p className="form-note">برنامه‌ای برای این فرزند ثبت نشده است.</p>}
        <button type="button" className="btn-secondary" onClick={() => visit("activities")}>رفتن به برنامه‌های خانوادگی</button>
        <h2 className="children-section-title">تولد در تقویم</h2>
        {detailValue.birthday ? <p className="children-birthday">{detailValue.birthday.title} · {displayDate(detailValue.birthday.date)}</p> : <p className="form-note">با ثبت تاریخ تولد، یادآور آن در تقویم قرار می‌گیرد.</p>}
        <button type="button" className="btn-secondary" onClick={() => visit("calendar")}>مشاهدهٔ تقویم</button>
        {detailValue.child.canEdit ? <button type="button" className="btn-primary" disabled={busy} onClick={() => model.openItem(detailValue.child)}>ویرایش مشخصات فرزند</button> : null}
        <button type="button" className="btn-secondary" disabled={busy} onClick={model.closeDetail}>بستن جزئیات</button>
      </div> : null}
    </Modal>
    <Modal open={Boolean(activeDialog)} onClose={model.closeForm} title={activeDialog?.child ? "ویرایش مشخصات فرزند" : "فرزند جدید"} sheetClassName="children-sheet" dragToClose>
      <form autoComplete="off" onSubmit={(event) => { event.preventDefault(); void model.saveItem(); }}>
        <fieldset className="children-fields" disabled={busy}>
          <Field label="نام فرزند"><input className="text-input" aria-label="نام فرزند" value={form.name} maxLength={40} required onChange={(event) => model.setForm((previous) => ({ ...previous, name: event.target.value }))} /></Field>
          <div className="children-date" role="group" aria-label="تاریخ تولد"><Field label="تاریخ تولد"><JalaliDateInput value={form.birthDate} onChange={(birthDate) => model.setForm((previous) => ({ ...previous, birthDate }))} placeholder="انتخاب تاریخ تولد" minYear={1300} maxYear={1500} /></Field></div>
          {form.birthDate ? <button type="button" className="btn-secondary" onClick={() => model.setForm((previous) => ({ ...previous, birthDate: "" }))}>پاک‌کردن تاریخ تولد</button> : null}
          <p className="form-note">شمارهٔ موبایل لازم نیست. با ثبت تاریخ تولد، سن و یادآور تولد نمایش داده می‌شود.</p>
        </fieldset>
        {model.formError ? <p className="form-error" role="alert">{model.formError}</p> : null}
        {model.conflict ? <button type="button" className="btn-secondary" disabled={busy} onClick={model.refreshConflict}>دریافت مشخصات جدید</button> : null}
        <button type="submit" className="btn-primary" disabled={busy || !model.available}>{busy ? "در حال ذخیره…" : "ذخیرهٔ مشخصات فرزند"}</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={model.closeForm}>انصراف</button>
      </form>
    </Modal>
  </section>;
}
