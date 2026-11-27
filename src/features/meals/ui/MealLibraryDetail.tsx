import { useEffect, useState } from "react";
import { Field, Icon } from "@/shared/ui";
import { toFa } from "@/shared/lib/digits";
import type { DishInput, MealIngredient, MealIngredientCheck } from "@/domain/meal/meal.types";
import type { CheckMealIngredientsUseCase } from "@/application/meal/meal.usecases";
import { exactInventorySuggestion, inventoryCatalogId } from "@/domain/inventory/inventory.catalog";
import { dishError } from "@/domain/meal/meal.rules";
import { initialLibrarySelections, loadLibraryDetail, selectedLibraryIngredients } from "../model/mealLibrary";
import type { LibraryDetail, LibraryFood, LibrarySelections } from "../model/mealLibrary";
import { statusText } from "../model/mealInventory";
import { FoodArt } from "./FoodArt";
import { useHouseholdRefresh } from "@/shared/lib/useHouseholdRefresh";

export function MealLibraryDetail({ food, busy, error, forSlot, checkIngredients, onSave, onBack }: {
  food: LibraryFood; busy: boolean; error: string; forSlot: boolean;
  checkIngredients: CheckMealIngredientsUseCase;
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
  const [stock, setStock] = useState<{ key: string; checks: MealIngredientCheck[]; failed: boolean }>({ key: "", checks: [], failed: false });
  const [stockAttempt, setStockAttempt] = useState(0);
  useHouseholdRefresh(() => { setStock(previous => ({ ...previous, key: "" })); setStockAttempt(value => value + 1); });
  useEffect(() => {
    let current = true;
    setDetail(null); setTitle(food.title); setFailed(false); setValidation(""); setVariantIndex(0); setEditingNames(false);
    void loadLibraryDetail(food).then(value => {
      if (current) { setDetail(value); setSelections(initialLibrarySelections(value.variants[0])); }
    }).catch(() => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [food, attempt]);
  const variant = detail?.variants[variantIndex];
  const reviewItems: MealIngredient[] = (variant?.items ?? []).filter(item => item.kind !== "equipment").flatMap(item => {
    const name = (selections[item.id]?.name || item.name || "").trim();
    if (!name) return [];
    const suggestion = exactInventorySuggestion(name);
    const catalogId = name === item.name ? item.catalogId ?? (suggestion ? inventoryCatalogId(suggestion) : null)
      : suggestion ? inventoryCatalogId(suggestion) : null;
    return [{ title: name, catalogId, qty: null, unit: null }];
  });
  const reviewKey = JSON.stringify(reviewItems);
  const checking = stock.key !== reviewKey;
  useEffect(() => {
    let current = true;
    const ingredients: MealIngredient[] = JSON.parse(reviewKey);
    if (!ingredients.length) { setStock({ key: reviewKey, checks: [], failed: false }); return; }
    void checkIngredients.execute(ingredients).then(checks => {
      if (current) setStock({ key: reviewKey, checks, failed: false });
    }).catch(() => { if (current) setStock({ key: reviewKey, checks: [], failed: true }); });
    return () => { current = false; };
  }, [reviewKey, checkIngredients, stockAttempt]);
  const change = (id: string, patch: Partial<LibrarySelections[string]>) => {
    setSelections(previous => ({ ...previous, [id]: { ...previous[id], ...patch } })); setValidation("");
  };
  const save = () => {
    if (!variant || busy || checking || stock.failed) return;
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
         const selectedName = (row?.name || item.name || "").trim();
         const status = stock.checks.find(check => check.ingredient.title === selectedName)?.status ?? "unresolved";
         return <li key={item.id} className="meal-name-ingredient">
           <label className="meal-name-check"><input type="checkbox" checked={row?.included ?? false} disabled={busy}
             onChange={event => change(item.id, { included: event.target.checked })} /><span data-meal-content>{item.kind === "ingredient" ? row?.name || item.name : item.label}</span>
             {!item.required ? <small>اختیاری</small> : null}</label>
            <small className={`meal-inventory-status ${status}`} role="status">{checking ? "در حال بررسی انبار…" : stock.failed ? "بررسی انبار ناموفق بود" : statusText(status)}</small>
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
      <p className="form-note">مقدار دستور مشخص نیست؛ «موجود در انبار» فقط وجود ماده را نشان می‌دهد. کافی‌بودن مقدار را خودتان بررسی کنید.</p>
      {stock.failed ? <div role="alert"><p className="form-error">موجودی انبار دریافت نشد؛ دوباره بررسی کنید.</p>
        <button className="btn-secondary" type="button" disabled={busy} onClick={() => { setStock(previous => ({ ...previous, key: "" })); setStockAttempt(value => value + 1); }}>بررسی دوبارهٔ انبار</button></div> : null}
      {validation || error ? <p className="form-error" role="alert">{validation || error}</p> : null}
      <button className="btn-primary meal-form-submit" type="submit" disabled={busy || checking || stock.failed}>{busy ? "در حال ذخیره…" : forSlot ? "ذخیرهٔ غذا و انتخاب برای وعده" : "افزودن به غذاهای خانواده"}</button>
    </form>}
  </div>;
}
