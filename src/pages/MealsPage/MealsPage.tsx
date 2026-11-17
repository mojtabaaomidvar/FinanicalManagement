import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import type { MealDish, MealEntry, MealIngredient, MealShoppingResult, MealType } from "@/domain/meal/meal.types";
import { cleanIngredient, dishError, importError, MEAL_LIMITS, weeklyIngredients } from "@/domain/meal/meal.rules";
import type { ShoppingList } from "@/domain/shopping/shopping.types";
import { MEAL_TYPES, mealWeekDays, mealWeekStart, shiftMealWeek } from "@/features/meals/model/mealPresentation";
import { isAppError } from "@/shared/lib/appError";
import { normalizeNumeric, toFa } from "@/shared/lib/digits";
import { formatLong, formatWeekday, isoToJalali } from "@/shared/lib/jalali";
import { useOnline } from "@/shared/lib/useOnline";
import { Card, Field, Icon, Modal } from "@/shared/ui";
import "./MealsPage.css";

interface IngredientForm { key: string; title: string; qty: string; unit: string; selected: boolean; conflictingUnit?: boolean }
interface MealData { scope: string; week: string; dishes: MealDish[]; entries: MealEntry[]; lists: ShoppingList[] }
type Dialog = { scope: string } & (
  | { kind: "dish"; dish: MealDish | null }
  | { kind: "slot"; date: string; mealType: MealType; entry: MealEntry | null }
  | { kind: "deleteDish"; dish: MealDish }
  | { kind: "import" }
);
const EMPTY_DATA: MealData = { scope: "", week: "", dishes: [], entries: [], lists: [] };
const quantityText = (qty: number) => toFa(qty).replace(".", "٫");
const quantityValue = (raw: string) => !raw.trim() || !/^[\d۰-۹٠-٩\s.,٫٬،_]+$/.test(raw) ? NaN : Number(normalizeNumeric(raw));
const ingredientInput = (row: IngredientForm): MealIngredient => ({ title: row.title, qty: quantityValue(row.qty), unit: row.unit || null });
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "انجام عملیات ناموفق بود. دوباره تلاش کنید.";

export function MealsPage() {
  const { phase, member, family, useCases, shoppingSync, offlineSession } = useApp();
  const { show } = useToast();
  const online = useOnline();
  const available = phase === "ready" && member?.status === "active" && member.membershipState === "active" &&
    Boolean(family && useCases) && online && !shoppingSync.offline && !offlineSession;
  const scope = available ? `${member!.id}:${family!.id}` : "";
  const identity = useRef({ scope });
  if (identity.current.scope !== scope) identity.current = { scope };
  const mounted = useRef(true);
  const sequence = useRef(0);
  const mutationPending = useRef(false);
  const operation = useRef<{ key: string; id: string } | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [tab, setTab] = useState<"week" | "dishes">("week");
  const currentWeek = mealWeekStart();
  const week = shiftMealWeek(currentWeek, weekOffset);
  const days = useMemo(() => mealWeekDays(week), [week]);
  const [data, setData] = useState<MealData>(EMPTY_DATA);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [dialogError, setDialogError] = useState("");
  const [title, setTitle] = useState("");
  const [ingredients, setIngredients] = useState<IngredientForm[]>([]);
  const [dishId, setDishId] = useState("");
  const [listId, setListId] = useState("");
  const [result, setResult] = useState<MealShoppingResult | null>(null);
  const dishes = available && data.scope === scope ? data.dishes : [];
  const entries = available && data.scope === scope && data.week === week ? data.entries : [];
  const lists = available && data.scope === scope ? data.lists : [];
  const catalog = useMemo(() => new Map(dishes.map((dish) => [dish.id, dish])), [dishes]);
  const activeDialog = available && !accessDenied && dialog?.scope === scope ? dialog : null;
  const stillCurrent = (captured: { scope: string }) => mounted.current && captured.scope !== "" && identity.current === captured;

  const clearForms = useCallback(() => {
    setDialog(null); setTitle(""); setIngredients([]); setDishId(""); setListId("");
    setDialogError(""); setResult(null); operation.current = null;
  }, []);

  const clearDeniedAccess = useCallback((error: unknown) => {
    if (!isAppError(error) || !["FORBIDDEN", "SESSION_EXPIRED"].includes(error.code) &&
      error.status !== 401 && error.status !== 403) return false;
    identity.current = { scope: identity.current.scope }; sequence.current += 1;
    setData(EMPTY_DATA); setSelected([]); clearForms(); setAccessDenied(true);
    setLoadError(error.message); setLoading(false); setBusy(false); mutationPending.current = false;
    return true;
  }, [clearForms]);

  const reload = useCallback(async () => {
    if (!scope || !useCases) return;
    const captured = identity.current;
    const request = ++sequence.current;
    setLoading(true); setLoadError("");
    try {
      const [nextDishes, plan, nextLists] = await Promise.all([
        useCases.listDishes.execute(), useCases.getMealPlan.execute(week), useCases.listShoppingLists.execute(),
      ]);
      if (!mounted.current || identity.current !== captured || request !== sequence.current) return;
      setData({ scope, week, dishes: nextDishes, entries: plan.entries, lists: nextLists });
      setSelected(plan.entries.map((entry) => entry.id)); setAccessDenied(false);
    } catch (error) {
      if (!mounted.current || identity.current !== captured || request !== sequence.current) return;
      if (clearDeniedAccess(error)) return;
      setData(EMPTY_DATA); setSelected([]); setLoadError(errorMessage(error));
    } finally {
      if (mounted.current && identity.current === captured && request === sequence.current) setLoading(false);
    }
  }, [scope, week, useCases, clearDeniedAccess]);

  useEffect(() => {
    mounted.current = true;
    if (identity.current.scope !== scope) identity.current = { scope };
    return () => { mounted.current = false; identity.current = { scope: "" }; sequence.current += 1; };
  }, []);
  useEffect(() => {
    sequence.current += 1; setData(EMPTY_DATA); setSelected([]); clearForms();
    setBusy(false); mutationPending.current = false; setLoadError(""); setAccessDenied(false);
    if (scope) void reload(); else setLoading(false);
  }, [scope, reload, clearForms]);

  const closeDialog = () => { if (!busy) clearForms(); };
  const openDish = (dish: MealDish | null) => {
    if (!available || busy || accessDenied) return;
    setTitle(dish?.title ?? ""); setDialogError(""); setResult(null);
    setIngredients((dish?.ingredients ?? []).map((row, index) => ({ key: String(index), title: row.title,
      qty: quantityText(row.qty), unit: row.unit ?? "", selected: true })));
    setDialog({ scope, kind: "dish", dish });
  };
  const openSlot = (date: string, mealType: MealType, entry: MealEntry | null) => {
    if (!available || busy || accessDenied) return;
    setDishId(entry?.dishId ?? ""); setDialogError(""); setDialog({ scope, kind: "slot", date, mealType, entry });
  };
  const changeIngredient = (key: string, change: Partial<IngredientForm>) => {
    operation.current = null; setResult(null); setDialogError("");
    setIngredients((previous) => previous.map((row) => row.key === key ? { ...row, ...change } : row));
  };

  const mutate = async (action: () => Promise<unknown>, message: string) => {
    if (!available || !useCases || busy || mutationPending.current || accessDenied) return;
    const captured = identity.current;
    mutationPending.current = true; setBusy(true); setDialogError("");
    try {
      await action();
      if (!stillCurrent(captured)) return;
      clearForms(); show(message); await reload();
    } catch (error) {
      if (!stillCurrent(captured) || clearDeniedAccess(error)) return;
      setDialogError(errorMessage(error));
      if (isAppError(error) && error.code === "CONFLICT") {
        show(errorMessage(error)); clearForms(); void reload();
      }
    } finally { if (stillCurrent(captured)) { setBusy(false); mutationPending.current = false; } }
  };
  const saveDish = () => {
    if (!useCases || activeDialog?.kind !== "dish" || activeDialog.dish && !activeDialog.dish.canEdit) return;
    const input = { title: title.trim(), ingredients: ingredients.map(ingredientInput) };
    const error = dishError(input);
    if (error) { setDialogError(error); return; }
    input.ingredients = input.ingredients.map(cleanIngredient);
    const dish = activeDialog.dish;
    void mutate(() => dish ? useCases.updateDish.execute(dish.id, input, dish.revision) : useCases.addDish.execute(input),
      dish ? "غذا به‌روز شد." : "غذا ثبت شد.");
  };
  const saveSlot = () => {
    if (!useCases || activeDialog?.kind !== "slot" || activeDialog.entry && !activeDialog.entry.canEdit) return;
    if (!dishId || !catalog.has(dishId)) { setDialogError("یک غذا انتخاب کنید."); return; }
    const slot = activeDialog;
    void mutate(() => slot.entry ? useCases.updateMealEntry.execute(slot.entry.id, dishId, slot.entry.revision)
      : useCases.addMealEntry.execute({ date: slot.date, mealType: slot.mealType, dishId }), "وعده ثبت شد.");
  };
  const removeSlot = () => {
    if (!useCases || activeDialog?.kind !== "slot" || !activeDialog.entry?.canDelete) return;
    const entry = activeDialog.entry;
    void mutate(() => useCases.deleteMealEntry.execute(entry.id, entry.revision), "وعده از برنامه برداشته شد.");
  };
  const removeDish = () => {
    if (!useCases || activeDialog?.kind !== "deleteDish" || !activeDialog.dish.canDelete) return;
    const dish = activeDialog.dish;
    void mutate(() => useCases.deleteDish.execute(dish.id, dish.revision), "غذا حذف شد.");
  };
  const openImport = () => {
    if (!available || busy || accessDenied) return;
    const combined = weeklyIngredients(entries.filter((entry) => selected.includes(entry.id)), dishes);
    setIngredients(combined.map((row) => ({ ...row, qty: quantityText(row.qty), unit: row.unit ?? "", selected: true })));
    setListId(lists[0]?.id ?? ""); setDialogError(""); setResult(null); operation.current = null;
    setDialog({ scope, kind: "import" });
  };
  const importIngredients = async () => {
    if (!useCases || activeDialog?.kind !== "import" || busy || mutationPending.current || result) return;
    const input = ingredients.filter((row) => row.selected).map(ingredientInput);
    const error = importError(input);
    if (error) { setDialogError(error); return; }
    if (!lists.some((list) => list.id === listId)) { setDialogError("لیست خرید مقصد را انتخاب کنید."); return; }
    const items = input.map(cleanIngredient);
    const key = JSON.stringify([listId, items]);
    if (operation.current?.key !== key) operation.current = { key, id: crypto.randomUUID() };
    const captured = identity.current;
    mutationPending.current = true; setBusy(true); setDialogError("");
    try {
      const saved = await useCases.addMealIngredientsToShopping.execute(listId, items, operation.current.id);
      if (!stillCurrent(captured)) return;
      setResult(saved); operation.current = null;
      try {
        const nextLists = await useCases.listShoppingLists.execute();
        if (stillCurrent(captured)) setData((previous) => ({ ...previous, lists: nextLists }));
      } catch { /* A committed import stays successful when the list refresh fails. */ }
    } catch (error) {
      if (stillCurrent(captured) && !clearDeniedAccess(error)) setDialogError(errorMessage(error));
    } finally { if (stillCurrent(captured)) { setBusy(false); mutationPending.current = false; } }
  };
  const readOnlyDish = activeDialog?.kind === "dish" && Boolean(activeDialog.dish && !activeDialog.dish.canEdit);
  const selectedIngredients = ingredients.filter((row) => row.selected).length;

  return <section className="page active meals-page" aria-busy={loading || busy}>
    <header className="app-header"><div className="header-title"><h1>برنامهٔ غذایی</h1>
      <p>غذاهای هفته و مواد لازم برای خرید خانواده</p></div></header>
    <div className="content">
      {!available ? <Card><p className="modal-sub" role="status">مشاهده و مدیریت برنامهٔ غذایی به اتصال اینترنت و ورود معتبر نیاز دارد.</p></Card> : <>
        <Card><div className="meals-summary"><div><p className="meals-count">{toFa(entries.length)} وعده در این هفته</p>
          <p className="form-note">{toFa(dishes.length)} غذا در فهرست مشترک خانواده</p></div><Icon name="i-food" size={30} /></div>
          <button type="button" className="btn-primary" onClick={() => openDish(null)} disabled={busy || loading || accessDenied}>غذای جدید</button>
        </Card>
        <div className="meals-tabs" role="group" aria-label="بخش برنامهٔ غذایی">
          <button type="button" className={`meals-tab${tab === "week" ? " active" : ""}`} aria-pressed={tab === "week"} onClick={() => setTab("week")}>برنامهٔ هفته</button>
          <button type="button" className={`meals-tab${tab === "dishes" ? " active" : ""}`} aria-pressed={tab === "dishes"} onClick={() => setTab("dishes")}>فهرست غذاها</button>
        </div>
        {loading ? <p className="form-note" role="status">در حال دریافت برنامهٔ غذایی…</p> : null}
        {loadError ? <Card><p className="modal-sub" role="alert">{loadError}</p><button type="button" className="btn-secondary"
          disabled={loading || busy} onClick={() => void reload()}>تلاش دوباره</button></Card> : null}
        {tab === "week" && !accessDenied ? <>
          <div className="meals-week-nav" role="group" aria-label="انتخاب هفته">
            <button type="button" className="meals-tab" disabled={busy || weekOffset <= -1} onClick={() => setWeekOffset((offset) => offset - 1)}>هفتهٔ قبل</button>
            <button type="button" className={`meals-tab${weekOffset === 0 ? " active" : ""}`} disabled={busy} onClick={() => setWeekOffset(0)}>هفتهٔ جاری</button>
            <button type="button" className="meals-tab" disabled={busy || weekOffset >= 1} onClick={() => setWeekOffset((offset) => offset + 1)}>هفتهٔ بعد</button>
          </div>
          <p className="meals-week-label">{formatLong(isoToJalali(days[0]))} تا {formatLong(isoToJalali(days[6]))}</p>
          {!loading && !loadError && !dishes.length ? <p className="modal-sub" role="status">ابتدا یک غذا در فهرست خانواده ثبت کنید، سپس آن را برای وعده‌های هفته انتخاب کنید.</p> : null}
          <div className="meals-days">{days.map((date) => <Card key={date}>
            <h2 className="meal-day-title">{formatWeekday(isoToJalali(date))}</h2>
            {MEAL_TYPES.map((type) => {
              const entry = entries.find((row) => row.date === date && row.mealType === type.value);
              const dish = entry ? catalog.get(entry.dishId) : null;
              return <div className="meal-slot" key={type.value}>
                {entry ? <label className="meal-slot-check"><input type="checkbox" checked={selected.includes(entry.id)} disabled={busy || loading}
                  aria-label={`انتخاب ${type.label} ${formatWeekday(isoToJalali(date))} برای خرید`}
                  onChange={(event) => setSelected((previous) => event.target.checked ? [...previous, entry.id] : previous.filter((id) => id !== entry.id))} /></label>
                  : <span className="meal-slot-spacer" />}
                <span className="meal-slot-type">{type.label}</span>
                <button type="button" className={`meal-slot-dish${entry ? " assigned" : ""}`} disabled={busy || loading || !dishes.length || Boolean(loadError)}
                  aria-label={`${entry ? "جزئیات" : "انتخاب غذا برای"} ${type.label} ${formatWeekday(isoToJalali(date))}`}
                  onClick={() => openSlot(date, type.value, entry ?? null)}>{dish?.title ?? (entry ? "غذای ثبت‌شده" : "انتخاب غذا")}</button>
              </div>;
            })}
          </Card>)}</div>
          <Card><p className="form-note">وعده‌های موردنظر را علامت بزنید و مواد لازم را پیش از افزودن به خرید بررسی کنید.</p>
            <button type="button" className="btn-primary" disabled={busy || loading || !selected.length || Boolean(loadError)} onClick={openImport}>
              مواد لازم برای خرید ({toFa(selected.length)} وعده)</button></Card>
        </> : tab === "dishes" && !accessDenied ? <>
          {dishes.length ? <Card><div className="meals-catalog">{dishes.map((dish) => <div className="meal-dish-row" key={dish.id}>
            <button type="button" className="meal-dish-details" disabled={busy} onClick={() => openDish(dish)} aria-label={`جزئیات ${dish.title}`}>
              <b>{dish.title}</b><span>{toFa(dish.ingredients.length)} مادهٔ لازم{!dish.canDelete && dish.canEdit ? " · در برنامه استفاده شده" : ""}</span></button>
            {dish.canDelete ? <button type="button" className="icon-btn" disabled={busy} aria-label={`حذف ${dish.title}`}
              onClick={() => { setDialogError(""); setDialog({ scope, kind: "deleteDish", dish }); }}><Icon name="i-trash" size={18} /></button> : null}
          </div>)}</div></Card> : !loading && !loadError ? <p className="modal-sub" role="status">هنوز غذایی ثبت نشده. نام غذا و مواد لازم آن را اضافه کنید.</p> : null}
          <p className="form-note">همهٔ اعضای فعال غذاها را می‌بینند. سازنده و مدیران می‌توانند غذا را ویرایش کنند.</p>
        </> : null}
      </>}
    </div>
    <Modal open={activeDialog?.kind === "dish"} onClose={closeDialog} title={readOnlyDish ? "جزئیات غذا" : activeDialog?.kind === "dish" && activeDialog.dish ? "ویرایش غذا" : "غذای جدید"} sheetClassName="meals-sheet" dragToClose>
      <form onSubmit={(event) => { event.preventDefault(); saveDish(); }} autoComplete="off">
        <Field label="نام غذا"><input className="text-input" aria-label="نام غذا" value={title} maxLength={MEAL_LIMITS.title}
          disabled={busy || readOnlyDish} autoFocus={!readOnlyDish} placeholder="مثلاً عدس‌پلو" onChange={(event) => setTitle(event.target.value)} /></Field>
        <h3 className="meal-form-heading">مواد لازم</h3>
        {!ingredients.length ? <p className="form-note">می‌توانید مواد لازم را اکنون یا بعداً ثبت کنید.</p> : null}
        <div className="meal-ingredients">{ingredients.map((row, index) => <div className="meal-ingredient" key={row.key}>
          <div className="meal-ingredient-heading"><b>مادهٔ {toFa(index + 1)}</b>{!readOnlyDish ? <button type="button" className="icon-btn"
            aria-label={`حذف مادهٔ ${toFa(index + 1)}`} disabled={busy} onClick={() => setIngredients((previous) => previous.filter((item) => item.key !== row.key))}><Icon name="i-trash" size={18} /></button> : null}</div>
          <Field label="نام ماده"><input className="text-input" aria-label={`نام مادهٔ ${toFa(index + 1)}`} value={row.title} maxLength={MEAL_LIMITS.title}
            disabled={busy || readOnlyDish} onChange={(event) => changeIngredient(row.key, { title: event.target.value })} /></Field>
          <div className="meal-ingredient-values"><Field label="مقدار"><input className="text-input" inputMode="decimal" aria-label={`مقدار مادهٔ ${toFa(index + 1)}`}
            value={row.qty} disabled={busy || readOnlyDish} onChange={(event) => changeIngredient(row.key, { qty: event.target.value })} /></Field>
            <Field label="واحد (اختیاری)"><input className="text-input" aria-label={`واحد مادهٔ ${toFa(index + 1)}`} value={row.unit} maxLength={MEAL_LIMITS.unit}
              placeholder="مثلاً پیمانه" disabled={busy || readOnlyDish} onChange={(event) => changeIngredient(row.key, { unit: event.target.value })} /></Field></div>
        </div>)}</div>
        {!readOnlyDish ? <button type="button" className="btn-secondary" disabled={busy || ingredients.length >= MEAL_LIMITS.ingredients}
          onClick={() => setIngredients((previous) => [...previous, { key: crypto.randomUUID(), title: "", qty: "۱", unit: "", selected: true }])}>افزودن مادهٔ لازم</button> : null}
        {dialogError ? <p className="form-error" role="alert">{dialogError}</p> : null}
        {!readOnlyDish ? <button type="submit" className="btn-primary meal-form-submit" disabled={busy}>{busy ? "در حال ذخیره…" : "ذخیرهٔ غذا"}</button> : null}
      </form>
    </Modal>
    <Modal open={activeDialog?.kind === "slot"} onClose={closeDialog} title="انتخاب غذای وعده" sheetClassName="meals-sheet" dragToClose>
      {activeDialog?.kind === "slot" ? <form onSubmit={(event) => { event.preventDefault(); saveSlot(); }}>
        <p className="modal-sub">{MEAL_TYPES.find((type) => type.value === activeDialog.mealType)?.label} · {formatWeekday(isoToJalali(activeDialog.date))}</p>
        <Field label="غذا"><select className="text-input" aria-label="غذای وعده" value={dishId} disabled={busy || Boolean(activeDialog.entry && !activeDialog.entry.canEdit)}
          onChange={(event) => { setDishId(event.target.value); setDialogError(""); }}><option value="">انتخاب غذا</option>
          {dishes.map((dish) => <option key={dish.id} value={dish.id}>{dish.title}</option>)}</select></Field>
        {dialogError ? <p className="form-error" role="alert">{dialogError}</p> : null}
        {!activeDialog.entry || activeDialog.entry.canEdit ? <button type="submit" className="btn-primary" disabled={busy || !dishId}>{busy ? "در حال ذخیره…" : "ذخیرهٔ وعده"}</button>
          : <p className="form-note">ویرایش این وعده در اختیار سازنده و مدیران خانواده است.</p>}
        {activeDialog.entry?.canDelete ? <button type="button" className="btn-secondary meal-remove-slot" disabled={busy} onClick={removeSlot}>برداشتن این وعده از برنامه</button> : null}
      </form> : null}
    </Modal>
    <Modal open={activeDialog?.kind === "deleteDish"} onClose={closeDialog} title="حذف غذا" sheetClassName="meals-sheet">
      {activeDialog?.kind === "deleteDish" ? <><p className="modal-sub">«{activeDialog.dish.title}» از فهرست غذاهای خانواده حذف شود؟</p>
        {dialogError ? <p className="form-error" role="alert">{dialogError}</p> : null}
        <button type="button" className="btn-primary meal-delete-button" disabled={busy} onClick={removeDish}>{busy ? "در حال حذف…" : "حذف غذا"}</button></> : null}
    </Modal>
    <Modal open={activeDialog?.kind === "import"} onClose={closeDialog} title="افزودن مواد لازم به خرید" sheetClassName="meals-sheet" dragToClose>
      {result ? <div role="status"><p className="meals-import-result">{toFa(result.addedCount)} ماده به لیست خرید اضافه شد.</p>
        {result.added.length ? <ul className="meal-result-list">{result.added.map((row) => <li key={row.id}>{row.title} · {quantityText(row.qty)}{row.unit ? ` ${row.unit}` : ""}</li>)}</ul> : null}
        {result.skippedCount ? <><p className="form-note">{toFa(result.skippedCount)} ماده از قبل در لیست بود و تغییر نکرد.</p>
          <ul className="meal-result-list">{result.skipped.map((row) => <li key={row.id}>{row.title}</li>)}</ul></> : null}
        <button type="button" className="btn-primary" disabled={busy} onClick={closeDialog}>بستن</button></div> : <form onSubmit={(event) => { event.preventDefault(); void importIngredients(); }}>
        <p className="modal-sub">مواد، مقدار و واحد را بررسی کنید. مواد هم‌نام با واحد یکسان جمع شده‌اند.</p>
        {!ingredients.length ? <p className="form-note" role="status">برای وعده‌های انتخاب‌شده ماده‌ای ثبت نشده. مواد لازم غذاها را در فهرست غذاها اضافه کنید.</p> : null}
        <div className="meal-ingredients">{ingredients.map((row, index) => <div className="meal-ingredient" key={row.key}>
          <label className="meal-import-check"><input type="checkbox" checked={row.selected} disabled={busy}
            onChange={(event) => changeIngredient(row.key, { selected: event.target.checked })} /><b>{row.title}</b></label>
          {row.conflictingUnit ? <p className="meal-unit-warning">این ماده با چند واحد آمده؛ فقط یک واحد انتخاب کنید یا واحدها را دستی یکسان کنید.</p> : null}
          <div className="meal-ingredient-values"><Field label="مقدار"><input className="text-input" inputMode="decimal" aria-label={`مقدار ${row.title} ${toFa(index + 1)}`}
            value={row.qty} disabled={busy || !row.selected} onChange={(event) => changeIngredient(row.key, { qty: event.target.value })} /></Field>
            <Field label="واحد (اختیاری)"><input className="text-input" aria-label={`واحد ${row.title} ${toFa(index + 1)}`} value={row.unit} maxLength={MEAL_LIMITS.unit}
              disabled={busy || !row.selected} onChange={(event) => changeIngredient(row.key, { unit: event.target.value })} /></Field></div>
        </div>)}</div>
        <Field label="لیست خرید مقصد"><select className="text-input" aria-label="لیست خرید مقصد" value={listId} disabled={busy || !lists.length}
          onChange={(event) => { operation.current = null; setListId(event.target.value); setDialogError(""); }}>
          <option value="">انتخاب لیست خرید</option>{lists.map((list) => <option key={list.id} value={list.id}>{list.title}</option>)}</select></Field>
        {!lists.length ? <p className="form-note">ابتدا در بخش لیست خرید یک لیست بسازید.</p> : null}
        <p className="form-note">مواد موجود در لیست دوباره اضافه نمی‌شوند. مقدار و قیمت آن‌ها حفظ می‌شود.</p>
        {dialogError ? <p className="form-error" role="alert">{dialogError}</p> : null}
        <button type="submit" className="btn-primary" disabled={busy || !listId || !selectedIngredients}>{busy ? "در حال افزودن…" : `افزودن ${toFa(selectedIngredients)} ماده به خرید`}</button>
      </form>}
    </Modal>
  </section>;
}
