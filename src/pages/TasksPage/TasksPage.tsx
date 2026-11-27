import { AppPage } from "@/shared/ui/AppPage";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import type { Task, TaskInput } from "@/domain/task/task.types";
import { validateTaskCompletionPhoto } from "@/domain/task/taskCompletionPhoto";
import { ShoppingSyncStatus } from "@/features/shopping-offline/ui/ShoppingSyncStatus";
import {
  canAssignOffline, canCompleteTask, canEditTask, filterTasks, isTaskOverdue, isTaskAssignee,
  type TaskFilter,
} from "@/features/tasks/model/taskPresentation";
import { toFa } from "@/shared/lib/digits";
import { compressImage } from "@/shared/lib/image";
import {
  formatISO, formatLong, isoToJalali, jalaliToIso, parse, today,
} from "@/shared/lib/jalali";
import { useOnline } from "@/shared/lib/useOnline";
import { Card, Field, Icon, JalaliDateInput, Modal } from "@/shared/ui";
import "./TasksPage.css";

interface TaskForm {
  title: string;
  description: string;
  assigneeId: string;
  due: string;
}

const EMPTY: TaskForm = { title: "", description: "", assigneeId: "", due: "" };
const FILTERS: { value: TaskFilter; label: string; empty: string }[] = [
  { value: "open", label: "باز", empty: "کار بازی ندارید." },
  { value: "mine", label: "کارهای من", empty: "کار بازی به شما سپرده نشده." },
  { value: "overdue", label: "عقب‌افتاده", empty: "کار عقب‌افتاده‌ای ندارید." },
  { value: "completed", label: "انجام‌شده", empty: "هنوز کاری انجام‌شده ثبت نشده." },
];

export function TasksPage() {
  const {
    useCases, tasks, member, members, refreshTasks, shoppingSync, offlineSession,
  } = useApp();
  const { show } = useToast();
  const online = useOnline();
  const offline = !online || shoppingSync.offline || offlineSession;
  const todayIso = jalaliToIso(today());
  const [filter, setFilter] = useState<TaskFilter>("open");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const [completing, setCompleting] = useState<Task | null>(null);
  const [completionPhoto, setCompletionPhoto] = useState<string | null>(null);
  const [completionError, setCompletionError] = useState("");
  const [processingPhoto, setProcessingPhoto] = useState(false);
  const photoFileRef = useRef<HTMLInputElement>(null);
  const photoSelection = useRef(0);
  const completionPending = useRef(false);
  const [form, setForm] = useState<TaskForm>(EMPTY);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    void refreshTasks().then(() => {
      if (active) setLoadError("");
    }).catch((error: unknown) => {
      if (active) setLoadError((error as Error).message || "دریافت کارها ناموفق بود.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [refreshTasks]);

  useEffect(() => () => { photoSelection.current += 1; }, []);

  const visible = useMemo(
    () => filterTasks(tasks, filter, member?.id ?? "", todayIso),
    [tasks, filter, member?.id, todayIso],
  );
  const openCount = tasks.filter((task) => !task.completed).length;
  const overdueCount = tasks.filter((task) => isTaskOverdue(task, todayIso)).length;
  const editable = editing === null || canEditTask(editing, member, offline);
  const memberNames = new Map(!offline ? members.map((row) => [row.id, row.name]) : []);
  const assigneeOptions = [
    { value: "", label: "بدون مسئول" },
    ...(member ? [{ value: member.id, label: "خودم" }] : []),
    ...(!offline ? members.filter((row) => row.id !== member?.id && isTaskAssignee(row))
      .map((row) => ({ value: row.id, label: row.name })) : []),
  ];
  if (editing?.assigneeId && !assigneeOptions.some((option) => option.value === editing.assigneeId)) {
    assigneeOptions.push({ value: editing.assigneeId, label: "مسئول تعیین‌شده" });
  }

  const personName = (id: string | null): string => {
    if (!id) return "بدون مسئول";
    if (id === member?.id) return "خودم";
    return memberNames.get(id) ?? "مسئول تعیین‌شده";
  };

  const openNew = () => {
    setEditing(null); setForm(EMPTY); setFormError(""); setOpen(true);
  };

  const openTask = (task: Task) => {
    setEditing(task);
    setForm({ title: task.title, description: task.description ?? "",
      assigneeId: task.assigneeId ?? "",
      due: task.dueDate ? formatISO(isoToJalali(task.dueDate)) : "" });
    setFormError(""); setOpen(true);
  };

  const closeForm = () => { if (!busy) setOpen(false); };

  const savedMessage = (message: string, pending = false) => { if (!offline && !pending) show(message); };

  const save = async () => {
    if (!useCases || !member || busy || !editable) return;
    const title = form.title.trim();
    if (!title) { setFormError("عنوان کار را بنویسید."); return; }
    const parsed = form.due ? parse(form.due) : null;
    if (form.due && !parsed) { setFormError("موعد را دوباره انتخاب کنید."); return; }
    const assigneeId = form.assigneeId || null;
    if (offline && !canAssignOffline(assigneeId, member.id, editing?.assigneeId ?? null)) {
      setFormError("برای انتخاب عضو دیگر به اتصال نیاز دارید؛ می‌توانید خودتان را انتخاب کنید یا کار را بدون مسئول بگذارید.");
      return;
    }
    const input: TaskInput = { title, description: form.description.trim() || null,
      assigneeId, dueDate: parsed ? jalaliToIso(parsed) : null };
    setBusy(true); setFormError("");
    try {
      if (editing) await useCases.updateTask.execute(editing.id, input, editing.revision);
      else await useCases.addTask.execute(input);
      const status = await refreshTasks();
      setOpen(false);
      savedMessage(editing ? "کار به‌روز شد." : "کار ثبت شد.", status.pendingCount > 0);
    } catch (error) {
      setFormError((error as Error).message || "ذخیرهٔ کار ناموفق بود.");
    } finally { setBusy(false); }
  };

  const closeCompletion = () => {
    if (busy || completionPending.current) return;
    photoSelection.current += 1;
    setCompleting(null); setCompletionPhoto(null); setCompletionError("");
    setProcessingPhoto(false);
  };

  const chooseCompletionPhoto = async (file?: File) => {
    if (!file || busy || completionPending.current) return;
    const selection = ++photoSelection.current;
    setCompletionError("");
    if (!file.type.startsWith("image/")) {
      setProcessingPhoto(false);
      setCompletionError("یک فایل عکس انتخاب کنید.");
      return;
    }
    setProcessingPhoto(true);
    try {
      const photo = await compressImage(file, 1600, 0.8);
      validateTaskCompletionPhoto(photo);
      if (selection === photoSelection.current) setCompletionPhoto(photo);
    } catch (error) {
      if (selection === photoSelection.current) {
        setCompletionError((error as Error).message || "آماده‌سازی عکس ناموفق بود.");
      }
    } finally {
      if (selection === photoSelection.current) setProcessingPhoto(false);
    }
  };

  const confirmCompletion = async () => {
    if (!useCases || !completing || busy || processingPhoto || completionPending.current ||
      !canCompleteTask(completing, member, offline)) return;
    completionPending.current = true;
    setBusy(true); setCompletionError("");
    try {
      await useCases.setTaskCompleted.execute(
        completing.id, true, completing.revision, completionPhoto,
      );
      const status = await refreshTasks();
      setCompleting(null); setCompletionPhoto(null);
      savedMessage("انجام‌شدن کار ثبت شد؛ در فهرست انجام‌شده می‌توانید آن را ببینید.", status.pendingCount > 0);
    } catch (error) {
      setCompletionError((error as Error).message || "ثبت انجام‌شدن کار ناموفق بود.");
    } finally { completionPending.current = false; setBusy(false); }
  };

  const toggle = async (task: Task) => {
    if (!useCases || busy || completing || !canCompleteTask(task, member, offline)) return;
    if (!task.completed) {
      photoSelection.current += 1;
      setCompleting(task); setCompletionPhoto(null); setCompletionError("");
      setProcessingPhoto(false);
      return;
    }
    setBusy(true);
    try {
      await useCases.setTaskCompleted.execute(task.id, false, task.revision);
      const status = await refreshTasks();
      savedMessage("کار دوباره باز شد.", status.pendingCount > 0);
    } catch (error) { show((error as Error).message || "تغییر وضعیت کار ناموفق بود."); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!useCases || !deleting || busy || !canEditTask(deleting, member, offline)) return;
    setBusy(true);
    try {
      await useCases.deleteTask.execute(deleting.id, deleting.revision);
      const status = await refreshTasks();
      setDeleting(null);
      savedMessage("کار حذف شد.", status.pendingCount > 0);
    } catch (error) { show((error as Error).message || "حذف کار ناموفق بود."); }
    finally { setBusy(false); }
  };

  const retry = async () => {
    setLoading(true);
    try { await refreshTasks(); setLoadError(""); }
    catch (error) { setLoadError((error as Error).message || "دریافت کارها ناموفق بود."); }
    finally { setLoading(false); }
  };

  return (
    <AppPage className="page active" aria-busy={busy || loading}>
      <header className="app-header">
        <div className="header-title">
          <h1>کارهای خانه</h1>
          <p>کارهای مشترک، مسئول هر کار و موعد انجام</p>
        </div>
      </header>
      <div className="content">
        <ShoppingSyncStatus />
        <Card>
          <div className="bill-summary">
            <p className="bill-summary-label">
              {openCount ? `${toFa(openCount)} کار باز` : "کار بازی ندارید"}
              {overdueCount ? ` · ${toFa(overdueCount)} عقب‌افتاده` : ""}
            </p>
          </div>
          <button type="button" className="btn-primary" disabled={busy || !useCases || !member}
            onClick={openNew}>ثبت کار جدید</button>
        </Card>
        <div className="shop-tabs" role="group" aria-label="فیلتر کارها">
          {FILTERS.map((option) => (
            <button key={option.value} type="button"
              className={`shop-tab${filter === option.value ? " active" : ""}`}
              aria-pressed={filter === option.value} onClick={() => setFilter(option.value)}>
              {option.label}
            </button>
          ))}
        </div>
        {loading ? <p className="form-note" role="status">در حال دریافت کارها…</p> : null}
        {loadError ? (
          <Card>
            <p className="modal-sub" role="alert">{loadError}</p>
            <button type="button" className="btn-secondary" disabled={loading}
              onClick={() => void retry()}>تلاش دوباره</button>
          </Card>
        ) : null}
        {visible.length ? (
          <Card title={FILTERS.find((option) => option.value === filter)?.label}>
            <div className="shop-list">
              {visible.map((task) => {
                const overdue = isTaskOverdue(task, todayIso);
                const dueLabel = task.dueDate ? task.dueDate === todayIso ? "موعد امروز"
                  : `${overdue ? "عقب‌افتاده · " : "موعد: "}${formatLong(isoToJalali(task.dueDate))}`
                  : "بدون موعد";
                return (
                  <div key={task.id} id={`task-${task.id}`}
                    className={`shop-item${task.completed ? " is-checked" : ""}`}>
                    <button type="button" className="shop-check" role="checkbox"
                      aria-checked={task.completed}
                      aria-label={`${task.completed ? "بازکردن دوبارهٔ" : "انجام‌شدن"} ${task.title}`}
                      disabled={busy || !canCompleteTask(task, member, offline)}
                      onClick={() => void toggle(task)}>
                      <span className="shop-box" aria-hidden="true">
                        {task.completed ? <Icon name="i-check" size={14} /> : null}
                      </span>
                    </button>
                    <div className="shop-body" role="button" tabIndex={0}
                      aria-label={`${canEditTask(task, member, offline) ? "ویرایش" : "جزئیات"} ${task.title}`}
                      onClick={() => openTask(task)} onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault(); openTask(task);
                        }
                      }}>
                      <b>{task.title}</b>
                      <p>{personName(task.assigneeId)} · {task.completed ? "انجام‌شده" : dueLabel}</p>
                    </div>
                    {canEditTask(task, member, offline) ? (
                      <button type="button" className="shop-del" aria-label={`حذف ${task.title}`}
                        disabled={busy} onClick={() => setDeleting(task)}>
                        <Icon name="i-trash" size={15} />
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </Card>
        ) : !loading && !loadError ? (
          <p className="modal-sub" role="status">
            {!tasks.length ? "هنوز کاری ثبت نشده. یک کار مثل «تعویض فیلتر آب» بسازید و مسئول و موعدش را مشخص کنید."
              : FILTERS.find((option) => option.value === filter)?.empty}
          </p>
        ) : null}
        {offline && (member?.role === "owner" || member?.role === "admin") ? (
          <p className="form-note">برای مدیریت کارهای دیگران به اتصال نیاز دارید. کارهایی که ساخته‌اید یا مسئولشان هستید در دسترس‌اند.</p>
        ) : null}
      </div>
      <Modal open={open} onClose={closeForm}
        title={editing ? editable ? "ویرایش کار" : "جزئیات کار" : "کار جدید"} dragToClose>
        <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <Field label="عنوان کار">
            <input aria-label="عنوان کار" className="text-input" value={form.title}
              disabled={busy || !editable} autoFocus={editable} maxLength={120}
              placeholder="مثلاً تعویض فیلتر آب"
              onChange={(event) => setForm((previous) => ({ ...previous, title: event.target.value }))} />
          </Field>
          <Field label="توضیح مشترک (اختیاری)">
            <textarea aria-label="توضیح مشترک" className="text-input" value={form.description}
              disabled={busy || !editable} rows={3} maxLength={2000}
              placeholder="جزئیاتی که اعضای خانواده باید بدانند"
              onChange={(event) => setForm((previous) => ({ ...previous, description: event.target.value }))} />
          </Field>
          <Field label="مسئول (اختیاری)">
            <select aria-label="مسئول" className="select-input" value={form.assigneeId}
              disabled={busy || !editable}
              onChange={(event) => setForm((previous) => ({ ...previous, assigneeId: event.target.value }))}>
              {assigneeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
          {offline && editable ? <p className="form-note">در حالت آفلاین می‌توانید مسئول فعلی را نگه دارید، خودتان را انتخاب کنید یا کار را بدون مسئول بگذارید. انتخاب عضو دیگر به اتصال نیاز دارد.</p> : null}
          <Field label="موعد شمسی (اختیاری)">
            {editable && !busy ? (
              <JalaliDateInput value={form.due} placeholder="بدون موعد"
                onChange={(due) => setForm((previous) => ({ ...previous, due }))} />
            ) : <p className="modal-sub">{form.due || "بدون موعد"}</p>}
            {form.due && editable ? <button type="button" className="btn-ghost" disabled={busy}
              onClick={() => setForm((previous) => ({ ...previous, due: "" }))}>حذف موعد</button> : null}
          </Field>
          {editing?.completed && editing.completionPhotoUrl ? (
            <Field label="عکس انجام کار">
              <a href={editing.completionPhotoUrl} target="_blank" rel="noreferrer"
                aria-label="مشاهدهٔ عکس انجام کار">
                <img className="task-completion-photo" src={editing.completionPhotoUrl} alt="عکس انجام کار" />
              </a>
            </Field>
          ) : null}
          {formError ? <p className="modal-sub" role="alert">{formError}</p> : null}
          {editable ? <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "در حال ذخیره…" : editing ? "ذخیرهٔ تغییرات" : "ثبت کار"}
          </button> : <p className="form-note">ویرایش و حذف این کار در اختیار مدیر یا سازندهٔ آن است.</p>}
          {!editable && editing && !editing.completed && canCompleteTask(editing, member, offline) ? (
            <button type="button" className="btn-primary" disabled={busy} onClick={() => {
              setOpen(false); void toggle(editing);
            }}>ثبت انجام کار</button>
          ) : null}
          <button type="button" className="btn-ghost" disabled={busy} onClick={closeForm}>
            {editable ? "انصراف" : "بستن"}
          </button>
        </form>
      </Modal>
      <Modal open={completing !== null} onClose={closeCompletion} title="تأیید انجام کار">
        <div role="dialog" aria-modal="true" aria-label="تأیید انجام کار">
          <p className="modal-sub">کار «{completing?.title}» انجام شده است؟</p>
          <p className="form-note">پس از تأیید، کار به فهرست «انجام‌شده» منتقل می‌شود.</p>
          <Field label="عکس انجام کار (اختیاری)">
            <p className="form-note">اگر می‌خواهید، عکسی از نتیجهٔ کار اضافه کنید.</p>
            <input ref={photoFileRef} type="file" accept="image/*" aria-label="عکس انجام کار"
              hidden disabled={busy || processingPhoto}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                void chooseCompletionPhoto(file);
              }} />
            {completionPhoto ? (
              <div className="task-completion-preview">
                <img className="task-completion-photo" src={completionPhoto} alt="پیش‌نمایش عکس انجام کار" />
                <button type="button" className="btn-ghost" disabled={busy || processingPhoto}
                  onClick={() => { setCompletionPhoto(null); setCompletionError(""); }}>حذف عکس</button>
              </div>
            ) : null}
            <button type="button" className="btn-secondary" disabled={busy || processingPhoto}
              onClick={() => photoFileRef.current?.click()}>
              <Icon name="i-image" size={18} />
              {processingPhoto ? "در حال آماده‌سازی عکس…" : completionPhoto ? "تغییر عکس" : "افزودن عکس"}
            </button>
          </Field>
          {completionError ? <p className="modal-sub" role="alert">{completionError}</p> : null}
          <div className="modal-actions">
            <button type="button" className="btn-secondary" disabled={busy} autoFocus onClick={closeCompletion}>انصراف</button>
            <button type="button" className="btn-primary" disabled={busy || processingPhoto ||
              !completing || !canCompleteTask(completing, member, offline)}
              onClick={() => void confirmCompletion()}>
              {busy ? "در حال ثبت…" : "تأیید انجام کار"}
            </button>
          </div>
        </div>
      </Modal>
      <Modal open={deleting !== null} onClose={() => { if (!busy) setDeleting(null); }} title="حذف کار">
        <p className="modal-sub">کار «{deleting?.title}» حذف شود؟</p>
        <div className="modal-actions">
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => setDeleting(null)}>انصراف</button>
          <button type="button" className="btn-secondary danger-text" disabled={busy} onClick={() => void remove()}>
            {busy ? "در حال حذف…" : "حذف کار"}
          </button>
        </div>
      </Modal>
    </AppPage>
  );
}
