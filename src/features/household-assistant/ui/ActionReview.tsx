import { useId, useState } from "react";
import type { ContextAction, PrepareActionFields, PreparedAction } from "@/domain/assistant/contextual.types";
import type { Member } from "@/domain/family/family.types";
import type { ShoppingList } from "@/domain/shopping/shopping.types";

export const ACTION_LABELS = { shopping_list: "ساخت لیست خرید", shopping_item: "افزودن قلم خرید", task: "ساخت کار خانه", meal_entry: "ثبت غذا در وعدهٔ خالی" };

export function PreparedSummary({ review, members, lists }: { review: PreparedAction; members: Member[]; lists: ShoppingList[] }) {
  const value = review.summary;
  const assignee = members.find(member => member.id === value.assignee_id);
  const destination = lists.find(list => list.id === value.list_id);
  return <div className="assistant-review-note"><strong>{ACTION_LABELS[review.kind]}</strong>
    {value.title ? <p><bdi>{String(value.title)}</bdi></p> : null}
    {review.kind === "shopping_item" ? <>
      <p>لیست مقصد: <bdi>{String(value.destination_title ?? destination?.title ?? value.list_id)}</bdi></p>
      <p>مقدار: <bdi>{String(value.qty)} {value.unit ? String(value.unit) : null}</bdi></p>
      <p>فقط به لیست افزوده می‌شود؛ قیمت، خرید انجام‌شده، پرداخت و موجودی انبار تغییر نمی‌کنند.</p>
    </> : null}
    {review.kind === "task" ? <>
      {value.description ? <p><bdi>{String(value.description)}</bdi></p> : null}
      <p>مسئول: {value.assignee_id ? <bdi>{assignee?.name ?? String(value.assignee_id)}</bdi> : "بدون مسئول"}</p>
      <p>موعد: {value.due_date ? <bdi>{String(value.due_date)}</bdi> : "بدون موعد"}</p>
    </> : null}
    {review.kind === "meal_entry" ? <>
      <p>روز: <bdi>{String(value.date)}</bdi></p>
      <p>وعده: {value.meal_type === "breakfast" ? "صبحانه" : value.meal_type === "lunch" ? "ناهار" : "شام"}</p>
      <p>فقط برنامهٔ غذایی ثبت می‌شود؛ پخت غذا یا مصرف مواد انجام‌شده فرض نمی‌شود.</p>
    </> : null}
    <p>این خلاصه تا ۱۵ دقیقه اعتبار دارد؛ تغییر اطلاعات، بررسی تازه می‌خواهد.</p>
  </div>;
}

export function ActionReview({ action, lists, members, busy, offline, review, onPrepare, onExecute, onCancel, onEdit }: {
  action: ContextAction; lists: ShoppingList[]; members: Member[]; busy: boolean; offline: boolean;
  review: PreparedAction | null; onPrepare: (fields: PrepareActionFields) => void; onExecute: () => void;
  onCancel: () => void; onEdit: () => void;
}) {
  const fieldId = useId();
  const [listId, setListId] = useState("");
  const [title, setTitle] = useState("");
  const [qty, setQty] = useState(action.qty === null || action.qty === undefined ? "" : String(action.qty));
  const [unit, setUnit] = useState(action.unit ?? "");
  const [day, setDay] = useState(action.due_date ?? "");
  const [assignee, setAssignee] = useState("");
  const [mealType, setMealType] = useState<"" | "breakfast" | "lunch" | "dinner">("");
  const complete = action.kind === "shopping_list" ? !!title.trim()
    : action.kind === "shopping_item" ? lists.some(list => list.id === listId) && Number(qty) > 0 && Number(qty) <= 99999999
    : action.kind === "meal_entry" ? !!day && !!mealType : true;
  return <form className="assistant-list-choice" onSubmit={event => {
    event.preventDefault();
    if (!complete || busy || offline) return;
    const fields: PrepareActionFields = action.kind === "shopping_list" ? { title }
      : action.kind === "shopping_item" ? { list_id: listId, qty: Number(qty), unit: unit || null }
      : action.kind === "meal_entry" ? { due_date: day, meal_type: mealType || undefined }
      : { due_date: day || null, assignee_id: assignee || null };
    onPrepare(fields);
  }}>
    <fieldset disabled={busy || offline} onChange={onEdit}>
      <legend>{ACTION_LABELS[action.kind]}</legend>
      {action.title ? <p>{action.title}</p> : null}
      {action.kind === "shopping_list" ? <label>نام لیست<input value={title} onChange={event => setTitle(event.target.value)} maxLength={120} required /></label> : null}
      {action.kind === "shopping_item" ? <>
        {!lists.length ? <p>اول ساخت لیست خرید را بررسی و تأیید کنید؛ تا ساخت مقصد، افزودن قلم ممکن نیست.</p> : null}
        <label><span id={`${fieldId}-list`}>لیست مقصد</span><select aria-labelledby={`${fieldId}-list`} value={listId} onChange={event => setListId(event.target.value)} required>
          <option value="">لیست را انتخاب کنید</option>{lists.map(list => <option key={list.id} value={list.id}>{list.title}</option>)}
        </select></label>
        <label>مقدار خرید<input type="number" min="0.01" max="99999999" step="any" value={qty} onChange={event => setQty(event.target.value)} required /></label>
        <label>واحد خرید، در صورت مشخص‌بودن<input value={unit} onChange={event => setUnit(event.target.value)} maxLength={20} /></label>
      </> : null}
      {action.kind === "task" ? <label><span id={`${fieldId}-assignee`}>مسئول</span><select aria-labelledby={`${fieldId}-assignee`} value={assignee} onChange={event => setAssignee(event.target.value)}>
        <option value="">بدون مسئول</option>{members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
      </select></label> : null}
      {action.kind === "task" || action.kind === "meal_entry" ? <label>روز، به تاریخ میلادی<input type="date" value={day} onChange={event => setDay(event.target.value)} required={action.kind === "meal_entry"} /></label> : null}
      {action.kind === "meal_entry" ? <label><span id={`${fieldId}-meal`}>وعده</span><select aria-labelledby={`${fieldId}-meal`} value={mealType} onChange={event => setMealType(event.target.value as typeof mealType)} required>
        <option value="">وعده را انتخاب کنید</option><option value="breakfast">صبحانه</option><option value="lunch">ناهار</option><option value="dinner">شام</option>
      </select></label> : null}
      <button type="submit" className="assistant-primary" disabled={!complete || busy || offline}>بررسی تغییر بدون ثبت</button>
    </fieldset>
    {review ? <>
      <PreparedSummary review={review} members={members} lists={lists} />
      <p>فقط همین تغییرِ مشخص انجام شود؟</p>
      <button type="button" className="assistant-primary" disabled={busy || offline} onClick={onExecute}>تأیید و انجام</button>
    </> : null}
    <button type="button" className="btn-ghost" disabled={busy} onClick={onCancel}>لغو این تغییر</button>
  </form>;
}
