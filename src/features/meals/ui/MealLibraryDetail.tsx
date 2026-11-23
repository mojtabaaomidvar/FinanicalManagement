import { useEffect, useState } from "react";
import { Field, Icon } from "@/shared/ui";
import { toFa } from "@/shared/lib/digits";
import type { DishInput } from "@/domain/meal/meal.types";
import { dishError } from "@/domain/meal/meal.rules";
import { initialLibrarySelections, loadLibraryDetail, selectedLibraryIngredients } from "../model/mealLibrary";
import type { LibraryDetail, LibraryFood, LibrarySelections } from "../model/mealLibrary";
import { FoodArt } from "./FoodArt";

export function MealLibraryDetail({ food, busy, error, forSlot, onSave, onBack }: {
  food: LibraryFood; busy: boolean; error: string; forSlot: boolean;
  onSave: (input: DishInput) => void; onBack: () => void;
}) {
  const [detail, setDetail] = useState<LibraryDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [variantIndex, setVariantIndex] = useState(0);
  const [selections, setSelections] = useState<LibrarySelections>({});
  const [title, setTitle] = useState(food.title);
  const [validation, setValidation] = useState("");
  const [editingNames, setEditingNames] = useState(false);
  useEffect(() => {
    let current = true;
    setDetail(null); setTitle(food.title); setFailed(false); setValidation(""); setVariantIndex(0); setEditingNames(false);
    void loadLibraryDetail(food).then(value => {
      if (current) { setDetail(value); setSelections(initialLibrarySelections(value.variants[0])); }
    }).catch(() => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [food, attempt]);
  const variant = detail?.variants[variantIndex];
  const change = (id: string, patch: Partial<LibrarySelections[string]>) => {
    setSelections(previous => ({ ...previous, [id]: { ...previous[id], ...patch } })); setValidation("");
  };
  const save = () => {
    if (!variant || busy) return;
    const ingredients = selectedLibraryIngredients(variant, selections);
    if (ingredients === null) { setValidation("برای مواد انتخاب‌شده، یک گزینه یا نام مشخص وارد کنید."); return; }
    const input = { title: title.trim(), ingredients };
    const invalid = dishError(input);
    if (invalid) { setValidation(invalid); return; }
    onSave(input);
  };
  return <div className="meal-library-detail">
    <button className="meal-back" type="button" disabled={busy} onClick={onBack}><Icon name="i-arrow-r" />بازگشت به انتخاب غذا</button>
    <div className="meal-detail-heading"><div><p className="meal-eyebrow">از کتابخانهٔ غذاها</p><h2 data-meal-content>{food.title}</h2>
      <p>مواد اولیه را ببینید و ترکیب مناسب خانواده را انتخاب کنید.</p></div><FoodArt kind="dinner" /></div>
    {failed ? <div className="meal-empty" role="alert"><p>مواد اولیهٔ این غذا دریافت نشد.</p>
      <button type="button" className="btn-secondary" onClick={() => setAttempt(value => value + 1)}>تلاش دوباره</button></div>
      : !variant || !detail ? <p className="form-note" role="status">در حال دریافت مواد اولیه…</p> : <form onSubmit={event => { event.preventDefault(); save(); }}>
      {detail.variants.length > 1 ? <Field label="ترکیب مواد اولیه"><select className="text-input" aria-label="ترکیب مواد اولیه" value={variantIndex} disabled={busy}
        onChange={event => { const next = Number(event.target.value); setVariantIndex(next); setSelections(initialLibrarySelections(detail.variants[next])); setValidation(""); }}>
        {detail.variants.map((row, index) => <option key={row.id} value={index}>ترکیب {toFa(index + 1)} · {toFa(row.items.filter(item => item.kind !== "equipment").length)} ماده</option>)}
      </select><p className="form-note">هر ترکیب جداست؛ مواد ترکیب‌های مختلف با هم ادغام نمی‌شوند.</p></Field> : null}
      <div className="meal-ingredients-title"><h3 className="meal-form-heading">مواد اولیه</h3>
        <button type="button" className="meal-text-button" disabled={busy} onClick={() => setEditingNames(value => !value)}>{editingNames ? "پایان اصلاح نام‌ها" : "اصلاح نام مواد"}</button></div>
      <ul className="meal-name-ingredients">{variant.items.filter(item => item.kind !== "equipment").map((item, index) => {
        const row = selections[item.id];
        return <li key={item.id} className="meal-name-ingredient">
          <label className="meal-name-check"><input type="checkbox" checked={row?.included ?? false} disabled={busy}
            onChange={event => change(item.id, { included: event.target.checked })} /><span data-meal-content>{item.kind === "ingredient" ? row?.name || item.name : item.label}</span>
            {!item.required ? <small>اختیاری</small> : null}</label>
          {item.kind === "ingredient" ? editingNames ? <input className="text-input" aria-label={`نام مادهٔ انتخاب‌شدهٔ ${toFa(index + 1)}`} maxLength={120}
            value={row?.name ?? ""} disabled={busy || !row?.included} onChange={event => change(item.id, { name: event.target.value })} /> : null
            : item.kind === "choice" && !item.allowCustom ? <select className="text-input" aria-label={`انتخاب مادهٔ ${toFa(index + 1)}`} value={row?.name ?? ""} disabled={busy || !row?.included}
              onChange={event => change(item.id, { name: event.target.value })}><option value="">یکی را انتخاب کنید</option>
              {item.options?.map(name => <option key={name} value={name} data-meal-content>{name}</option>)}</select>
              : <><input className="text-input" aria-label={`نام جایگزین مادهٔ ${toFa(index + 1)}`} value={row?.name ?? ""} maxLength={120}
                placeholder="نام مادهٔ موردنظر شما" disabled={busy || !row?.included} onChange={event => change(item.id, { name: event.target.value })} />
                {item.kind === "unresolved" ? <p className="meal-unit-warning">نام این ماده نیاز به بررسی دارد؛ نام دقیقش را بنویسید یا آن را از انتخاب بردارید.</p> : null}</>}
        </li>;
      })}</ul>
      {variant.items.some(item => item.kind === "equipment") ? <div className="meal-equipment"><h3>وسایل ذکرشده در فهرست</h3>
        <p data-meal-content>{variant.items.filter(item => item.kind === "equipment").map(item => item.name).join("، ")}</p><p className="form-note">وسایل جزو مواد اولیه ذخیره نمی‌شوند.</p></div> : null}
      <Field label="نام غذا در فهرست خانواده"><input className="text-input" aria-label="نام غذا در فهرست خانواده" value={title} maxLength={120}
        disabled={busy} onChange={event => { setTitle(event.target.value); setValidation(""); }} /></Field>
      <p className="form-note">فقط نام مواد ذخیره می‌شود؛ مقدار و روش پخت لازم نیست.</p>
      {validation || error ? <p className="form-error" role="alert">{validation || error}</p> : null}
      <button className="btn-primary meal-form-submit" type="submit" disabled={busy}>{busy ? "در حال ذخیره…" : forSlot ? "ذخیرهٔ غذا و انتخاب برای وعده" : "افزودن به غذاهای خانواده"}</button>
    </form>}
  </div>;
}
