import { AppPage } from "@/shared/ui/AppPage";
import { usePetsModel } from "@/features/pets/model/usePetsModel";
import { formatLong, isoToJalali } from "@/shared/lib/jalali";
import { toFa } from "@/shared/lib/digits";
import { Card, Field, Icon, JalaliDateInput, Modal } from "@/shared/ui";
import "./PetsPage.css";

const displayDate = (date: string | null) => date ? formatLong(isoToJalali(date)) : "مشخص نشده";

export function PetsPage({ onChanged, onOpenTasks }: {
  onChanged?: () => void | Promise<void>; onOpenTasks?: () => void;
}) {
  const model = usePetsModel(onChanged);
  const { detailValue, activeDialog, form, careForm, busy } = model;
  const assigneeName = (id: string | null) => id ? model.assignees.find((row) => row.id === id)?.name ?? "مسئول تعیین‌شده" : "بدون مسئول";
  const visitTasks = () => onOpenTasks?.();
  return <AppPage className="page active pets-page" aria-busy={model.loading || model.detailLoading || busy}>
    <header className="app-header"><div className="header-title"><h1>حیوانات خانگی و مراقبت</h1><p>مشخصات حیوانات و کارهای مراقبتی خانواده</p></div></header>
    <div className="content">
      {!model.available ? <Card><p className="modal-sub" role="status">مشاهده و مدیریت حیوانات خانگی به اتصال اینترنت و ورود معتبر نیاز دارد.</p></Card> : <>
        <Card><div className="pets-summary"><div><p className="pets-count">{toFa(model.pets.length)} حیوان خانگی</p><p className="form-note">مدیر خانواده مشخصات و کارهای مراقبتی را ثبت می‌کند.</p></div><Icon name="i-heart" size={30} /></div>
          {model.canCreate ? <button type="button" className="btn-primary" disabled={model.loading || busy || model.accessDenied} onClick={() => model.openProfile(null)}>ثبت حیوان جدید</button> : null}</Card>
        <input type="search" className="text-input" aria-label="جست‌وجوی حیوانات" placeholder="نام، نوع یا نژاد" value={model.query} onChange={(event) => model.setQuery(event.target.value)} />
        {model.loading || model.detailLoading ? <p className="form-note" role="status">در حال دریافت اطلاعات حیوانات…</p> : null}
        {model.loadError ? <Card><p className="modal-sub" role="alert">{model.loadError}</p><button type="button" className="btn-secondary" disabled={model.loading || busy || model.detailLoading} onClick={() => void model.reload()}>تلاش دوباره</button></Card> : null}
        {model.visible.length ? <div className="pets-list">{model.visible.map((pet) => <Card key={pet.id}><div className="pets-row" id={`pet-${pet.id}`}>
          <button type="button" className="pets-details" aria-label={`جزئیات ${pet.name}`} disabled={busy || model.detailLoading || model.loading} onClick={() => model.openDetail(pet.id)}>
            <b>{pet.name}</b><span>{[pet.species, pet.breed].filter(Boolean).join(" · ")}</span><span>تولد: {displayDate(pet.birthDate)}</span><span className="pets-open">کارهای مراقبتی</span></button>
        </div></Card>)}</div> : !model.loading && !model.loadError ? <Card><p className="modal-sub">{model.pets.length ? "حیوانی با این جست‌وجو پیدا نشد." : "هنوز حیوانی ثبت نشده است. اگر حیوان خانگی ندارید، این بخش می‌تواند خالی بماند."}</p></Card> : null}
      </>}
    </div>
    <Modal open={Boolean(detailValue) && !activeDialog} onClose={model.closeDetail} title={detailValue?.pet.name} sheetClassName="pets-sheet" dragToClose>
      {detailValue ? <div className="pets-detail-body"><dl className="pets-facts">
        <div><dt>نوع حیوان</dt><dd>{detailValue.pet.species}</dd></div><div><dt>نژاد</dt><dd>{detailValue.pet.breed || "مشخص نشده"}</dd></div><div><dt>تاریخ تولد</dt><dd>{displayDate(detailValue.pet.birthDate)}</dd></div>
      </dl>
        <h2 className="pets-section-title">کارهای مراقبتی</h2>
        <div className="pets-tabs" role="group" aria-label="وضعیت کارهای مراقبتی">
          <button type="button" className={`pets-tab${!model.showCompleted ? " active" : ""}`} aria-pressed={!model.showCompleted} onClick={() => model.setShowCompleted(false)}>باز</button>
          <button type="button" className={`pets-tab${model.showCompleted ? " active" : ""}`} aria-pressed={model.showCompleted} onClick={() => model.setShowCompleted(true)}>انجام‌شده</button>
        </div>
        {model.careTasks.length ? <ul className="pets-care-list">{model.careTasks.map((task) => <li key={task.id} data-care-task-id={task.id}>
          <b>{task.title}</b><span>مسئول: {assigneeName(task.assigneeId)}</span><span>موعد: {displayDate(task.dueDate)}</span>
          {task.canComplete ? <button type="button" className="btn-secondary" disabled={busy} aria-label={`${task.completed ? "بازکردن دوبارهٔ" : "ثبت انجام‌شدن"} ${task.title}`} onClick={() => model.setCompleted(task)}>{task.completed ? "بازکردن دوبارهٔ کار" : "ثبت انجام‌شدن کار"}</button> : null}
        </li>)}</ul> : <p className="form-note">{model.showCompleted ? "هنوز کار مراقبتی انجام‌شده‌ای ثبت نشده است." : "کار مراقبتی بازی برای این حیوان وجود ندارد."}</p>}
        {detailValue.canCreateCare ? <button type="button" className="btn-primary" disabled={busy} onClick={model.openCare}>ثبت کار مراقبتی جدید</button> : null}
        <p className="form-note">یادآور در اعلان‌های کارها برای مسئول کار نمایش داده می‌شود.</p>
        {onOpenTasks ? <button type="button" className="btn-secondary" disabled={busy} onClick={visitTasks}>ویرایش و مدیریت در کارهای خانه</button> : null}
        {detailValue.pet.canEdit ? <button type="button" className="btn-secondary" disabled={busy} onClick={() => model.openProfile(detailValue.pet)}>ویرایش مشخصات حیوان</button> : null}
        {detailValue.pet.canDelete ? <button type="button" className="btn-secondary pets-danger-text" disabled={busy} onClick={() => model.openDelete(detailValue.pet)}>حذف حیوان</button> : null}
        {model.formError ? <p className="form-error" role="alert">{model.formError}</p> : null}
        {model.conflict ? <button type="button" className="btn-secondary" disabled={busy} onClick={model.refreshConflict}>دریافت اطلاعات جدید</button> : null}
        <button type="button" className="btn-secondary" disabled={busy} onClick={model.closeDetail}>بستن جزئیات</button>
      </div> : null}
    </Modal>
    <Modal open={activeDialog?.kind === "profile"} onClose={model.closeForm} title={activeDialog?.kind === "profile" && activeDialog.pet ? "ویرایش مشخصات حیوان" : "حیوان جدید"} sheetClassName="pets-sheet" dragToClose>
      <form autoComplete="off" onSubmit={(event) => { event.preventDefault(); model.saveProfile(); }}>
        <fieldset className="pets-fields" disabled={busy}>
          <Field label="نام حیوان"><input className="text-input" aria-label="نام حیوان" value={form.name} maxLength={80} required onChange={(event) => model.setForm((previous) => ({ ...previous, name: event.target.value }))} /></Field>
          <Field label="نوع حیوان"><input className="text-input" aria-label="نوع حیوان" placeholder="مثلاً گربه، سگ یا پرنده" value={form.species} maxLength={60} required onChange={(event) => model.setForm((previous) => ({ ...previous, species: event.target.value }))} /></Field>
          <Field label="نژاد"><input className="text-input" aria-label="نژاد" placeholder="اختیاری" value={form.breed} maxLength={100} onChange={(event) => model.setForm((previous) => ({ ...previous, breed: event.target.value }))} /></Field>
          <div className="pets-date" role="group" aria-label="تاریخ تولد"><Field label="تاریخ تولد"><JalaliDateInput value={form.birthDate} onChange={(birthDate) => model.setForm((previous) => ({ ...previous, birthDate }))} placeholder="انتخاب تاریخ تولد" minYear={1300} maxYear={1500} /></Field></div>
          {form.birthDate ? <button type="button" className="btn-secondary" onClick={() => model.setForm((previous) => ({ ...previous, birthDate: "" }))}>پاک‌کردن تاریخ تولد</button> : null}
          <p className="form-note">نژاد و تاریخ تولد اختیاری‌اند.</p>
        </fieldset>
        {model.formError ? <p className="form-error" role="alert">{model.formError}</p> : null}
        {model.conflict ? <button type="button" className="btn-secondary" disabled={busy} onClick={model.refreshConflict}>دریافت مشخصات جدید</button> : null}
        <button type="submit" className="btn-primary" disabled={busy || !model.available}>{busy ? "در حال ذخیره…" : "ذخیرهٔ مشخصات حیوان"}</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={model.closeForm}>انصراف</button>
      </form>
    </Modal>
    <Modal open={activeDialog?.kind === "care"} onClose={model.closeForm} title="کار مراقبتی جدید" sheetClassName="pets-sheet" dragToClose>
      <form autoComplete="off" onSubmit={(event) => { event.preventDefault(); model.saveCare(); }}>
        <fieldset className="pets-fields" disabled={busy}>
          <Field label="عنوان کار مراقبتی"><input className="text-input" aria-label="عنوان کار مراقبتی" value={careForm.title} maxLength={120} required onChange={(event) => model.changeCareForm((previous) => ({ ...previous, title: event.target.value }))} /></Field>
          <Field label="مسئول کار"><select className="text-input" aria-label="مسئول کار" value={careForm.assigneeId} onChange={(event) => model.changeCareForm((previous) => ({ ...previous, assigneeId: event.target.value }))}>
            <option value="">بدون مسئول</option>{model.assignees.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></Field>
          <div className="pets-date" role="group" aria-label="موعد کار"><Field label="موعد کار"><JalaliDateInput value={careForm.dueDate} onChange={(dueDate) => model.changeCareForm((previous) => ({ ...previous, dueDate }))} placeholder="انتخاب موعد" minYear={1300} maxYear={1500} /></Field></div>
          {careForm.dueDate ? <button type="button" className="btn-secondary" onClick={() => model.changeCareForm((previous) => ({ ...previous, dueDate: "" }))}>پاک‌کردن موعد</button> : null}
          <p className="form-note">یادآور در اعلان‌های کارها برای مسئول دارای حساب ورود و طبق تنظیمات اعلان‌ها نمایش داده می‌شود.</p>
        </fieldset>
        {model.formError ? <p className="form-error" role="alert">{model.formError}</p> : null}
        {model.conflict ? <button type="button" className="btn-secondary" disabled={busy} onClick={model.refreshConflict}>دریافت اطلاعات جدید</button> : null}
        <button type="submit" className="btn-primary" disabled={busy || !model.available}>{busy ? "در حال ثبت…" : "ذخیرهٔ کار مراقبتی"}</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={model.closeForm}>انصراف</button>
      </form>
    </Modal>
    <Modal open={activeDialog?.kind === "delete"} onClose={model.closeForm} title="حذف حیوان" sheetClassName="pets-sheet">
      <p className="modal-sub">«{activeDialog?.kind === "delete" ? activeDialog.pet.name : ""}» از فهرست حذف می‌شود. کارهای مراقبتی آن در کارهای خانه باقی می‌مانند و ارتباط آن‌ها با حیوان حذف می‌شود.</p>
      {model.formError ? <p className="form-error" role="alert">{model.formError}</p> : null}
      {model.conflict ? <button type="button" className="btn-secondary" disabled={busy} onClick={model.refreshConflict}>دریافت اطلاعات جدید</button> : null}
      <button type="button" className="btn-primary pets-delete" disabled={busy} onClick={model.deletePet}>{busy ? "در حال حذف…" : "تأیید حذف حیوان"}</button>
      <button type="button" className="btn-secondary" disabled={busy} onClick={model.closeForm}>انصراف</button>
    </Modal>
  </AppPage>;
}
