import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/shared/ui";
import { toFa } from "@/shared/lib/digits";
import { filterLibrary, LIBRARY_PAGE_SIZE, loadLibrary } from "../model/mealLibrary";
import type { LibraryFood, LibraryIndex } from "../model/mealLibrary";

const MEAL_LABEL_ORDER = ["صبحانه", "ناهار", "شام", "میان وعده"];

export function MealLibrary({ onSelect, disabled = false, compact = false }: {
  onSelect: (food: LibraryFood) => void; disabled?: boolean; compact?: boolean;
}) {
  const [index, setIndex] = useState<LibraryIndex | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [meal, setMeal] = useState("");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(0);
  useEffect(() => {
    let current = true;
    setFailed(false);
    void loadLibrary().then(value => { if (current) setIndex(value); }).catch(() => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [attempt]);
  const matches = useMemo(() => index ? filterLibrary(index, query, meal, category) : [], [index, query, meal, category]);
  const orderedMeals = useMemo(() => index ? [...index.meals].sort((left, right) => {
    const leftOrder = MEAL_LABEL_ORDER.indexOf(left.label);
    const rightOrder = MEAL_LABEL_ORDER.indexOf(right.label);
    return (leftOrder < 0 ? MEAL_LABEL_ORDER.length : leftOrder) - (rightOrder < 0 ? MEAL_LABEL_ORDER.length : rightOrder);
  }) : [], [index]);
  const visible = matches.slice(page * LIBRARY_PAGE_SIZE, (page + 1) * LIBRARY_PAGE_SIZE);
  const changeFilter = (action: () => void) => { action(); setPage(0); };
  const reset = () => { setQuery(""); setMeal(""); setCategory(""); setPage(0); };
  return <div className={`meal-library${compact ? " compact" : ""}`}>
    <div className="meal-search"><Icon name="i-search" />
      <input className="text-input" type="search" value={query} aria-label="جست‌وجو در کتابخانهٔ غذاها"
        placeholder="امروز چه غذایی درست کنیم؟" disabled={disabled} onChange={event => changeFilter(() => setQuery(event.target.value))} />
    </div>
    {failed ? <div className="meal-empty" role="alert"><h3>فهرست غذاها دریافت نشد.</h3>
      <p>اتصال را بررسی کنید و دوباره تلاش کنید.</p><button className="btn-secondary" type="button" onClick={() => setAttempt(value => value + 1)}>تلاش دوباره</button></div>
      : !index ? <div className="meal-empty" role="status"><p>در حال آماده‌کردن کتابخانهٔ غذاها…</p></div> : <>
      <div className="meal-category-strip" role="group" aria-label="دستهٔ وعدهٔ غذایی">
        <button type="button" className={`meal-category${!meal ? " active" : ""}`} aria-pressed={!meal} disabled={disabled} onClick={() => changeFilter(() => setMeal(""))}>همهٔ غذاها</button>
         {orderedMeals.map(tag => <button type="button" key={tag.id} className={`meal-category${meal === tag.id ? " active" : ""}`}
          aria-pressed={meal === tag.id} disabled={disabled} onClick={() => changeFilter(() => setMeal(tag.id))} data-meal-content>{tag.label}</button>)}
      </div>
      <div className="meal-library-tools"><label className="meal-type-filter"><span>نوع غذا</span>
        <select className="text-input" value={category} aria-label="نوع غذا در کتابخانه" disabled={disabled} onChange={event => changeFilter(() => setCategory(event.target.value))}>
          <option value="">همهٔ دسته‌ها</option>{index.categories.map(tag => <option value={tag.id} key={tag.id} data-meal-content>{tag.label}</option>)}
        </select></label><p className="meal-result-count" role="status">{toFa(matches.length)} غذا</p>
      </div>
      {!matches.length ? <div className="meal-empty" role="status"><Icon name="i-food" /><h3>غذایی با این انتخاب پیدا نشد.</h3>
        <p>نام کوتاه‌تر یا دستهٔ دیگری را امتحان کنید.</p><button className="btn-secondary" type="button" onClick={reset}>پاک‌کردن جست‌وجو و فیلترها</button></div>
        : <ul className="meal-library-grid">{visible.map(food => <li key={food.id}>
          <button type="button" className="meal-food-tile" disabled={disabled} onClick={() => onSelect(food)} aria-label={`مواد اولیهٔ ${food.title}`}>
            <span className="meal-food-mark"><Icon name="i-food" /></span>
            <span className="meal-food-copy"><b data-meal-content>{food.title}</b>
              <span className="meal-food-labels" data-meal-content>{food.meals.map(id => index.meals.find(tag => tag.id === id)?.label).filter(Boolean).join(" · ")}</span>
              <span className="meal-food-preview" data-meal-content>{food.ingredientPreview.join("، ")}</span>
            </span><Icon name="i-arrow-l" />
          </button>
        </li>)}</ul>}
      {matches.length > LIBRARY_PAGE_SIZE ? <div className="meal-pagination" role="group" aria-label="صفحه‌های کتابخانهٔ غذاها">
        <button className="btn-secondary" type="button" disabled={disabled || page === 0} onClick={() => setPage(value => value - 1)}>صفحهٔ قبل</button>
        <span>{toFa(page + 1)} از {toFa(Math.ceil(matches.length / LIBRARY_PAGE_SIZE))}</span>
        <button className="btn-secondary" type="button" disabled={disabled || (page + 1) * LIBRARY_PAGE_SIZE >= matches.length} onClick={() => setPage(value => value + 1)}>صفحهٔ بعد</button>
      </div> : null}
    </>}
  </div>;
}
