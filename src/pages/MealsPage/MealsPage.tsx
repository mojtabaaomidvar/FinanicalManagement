import { AppPage } from "@/shared/ui/AppPage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import type { MealDish, MealEntry, MealIngredient, MealIngredientCheck, MealSelectionInput, MealShoppingResult, MealType } from "@/domain/meal/meal.types";
import { cleanIngredient, dishError, importError, MEAL_LIMITS, weeklyIngredients } from "@/domain/meal/meal.rules";
import type { ShoppingList } from "@/domain/shopping/shopping.types";
import { MEAL_TYPES, mealWeekDays, mealWeekStart, shiftMealWeek } from "@/features/meals/model/mealPresentation";
import { isAppError } from "@/shared/lib/appError";
import { normalizeNumeric, toFa } from "@/shared/lib/digits";
import { formatLong, formatWeekday, isoToJalali, today, weekdayIndex, WEEKDAYS } from "@/shared/lib/jalali";
import { useOnline } from "@/shared/lib/useOnline";
import { Card, Field, Icon } from "@/shared/ui";
import { FoodArt } from "@/features/meals/ui/FoodArt";
import { MealDialog } from "@/features/meals/ui/MealDialog";
import { MealLibrary } from "@/features/meals/ui/MealLibrary";
import { MealLibraryDetail } from "@/features/meals/ui/MealLibraryDetail";
import { normalizeFoodSearch } from "@/features/meals/model/mealLibrary";
import type { LibraryFood } from "@/features/meals/model/mealLibrary";
import { checkMealIngredient } from "@/features/meals/model/mealInventory";
import { useHouseholdRefresh } from "@/shared/lib/useHouseholdRefresh";
import type { DishInput } from "@/domain/meal/meal.types";
import "./MealsPage.css";

interface IngredientForm { key: string; title: string; catalogId?: string | null; qty: string; unit: string; selected: boolean; conflictingUnit?: boolean }
interface MealData { scope: string; week: string; dishes: MealDish[]; entries: MealEntry[]; lists: ShoppingList[] }
interface MealSlot { date: string; mealType: MealType; entry: MealEntry | null }
type Dialog = { scope: string } & (
  | { kind: "dish"; dish: MealDish | null }
  | ({ kind: "slot" } & MealSlot)
  | { kind: "library"; food: LibraryFood; slot?: MealSlot }
  | { kind: "deleteDish"; dish: MealDish }
  | { kind: "import" }
);
type PendingMissing = MealIngredientCheck;
interface PendingDecision { action: "shopping" | "available" | ""; qty: string; unit: string }
interface PendingMealFlow {
  scope: string;
  slot: MealSlot;
  missing: PendingMissing[];
  dishId?: string;
  dishRevision?: number;
  input?: DishInput;
}
const EMPTY_DATA: MealData = { scope: "", week: "", dishes: [], entries: [], lists: [] };
const quantityText = (qty: number | null) => qty === null ? "" : toFa(qty).replace(".", "٫");
const quantityValue = (raw: string) => !raw.trim() || !/^[\d۰-۹٠-٩\s.,٫٬،_]+$/.test(raw) ? NaN : Number(normalizeNumeric(raw));
const ingredientInput = (row: IngredientForm): MealIngredient => ({ title: row.title, catalogId: row.catalogId ?? null, qty: row.qty.trim() ? quantityValue(row.qty) : null, unit: row.unit || null });
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
  const selectionOperation = useRef<{ key: string; id: string } | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [tab, setTab] = useState<"week" | "library" | "dishes">("week");
  const [dayIndex, setDayIndex] = useState(() => weekdayIndex(today()));
  const [weekView, setWeekView] = useState(false);
  const [familyQuery, setFamilyQuery] = useState("");
  const [chooserQuery, setChooserQuery] = useState("");
  const [chooserSource, setChooserSource] = useState<"family" | "library">("family");
  const [showAmounts, setShowAmounts] = useState(false);
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
  const [pending, setPending] = useState<PendingMealFlow | null>(null);
  const [pendingChoices, setPendingChoices] = useState<Record<string, PendingDecision>>({});
  const [pendingListId, setPendingListId] = useState("");
  const [pendingError, setPendingError] = useState("");
  const dishes = available && data.scope === scope ? data.dishes : [];
  const entries = available && data.scope === scope && data.week === week ? data.entries : [];
  const lists = available && data.scope === scope ? data.lists : [];
  const catalog = useMemo(() => new Map(dishes.map((dish) => [dish.id, dish])), [dishes]);
  const activeDialog = available && !accessDenied && dialog?.scope === scope ? dialog : null;
  const stillCurrent = (captured: { scope: string }) => mounted.current && captured.scope !== "" && identity.current === captured;

  const clearForms = useCallback(() => {
    setDialog(null); setTitle(""); setIngredients([]); setDishId(""); setListId("");
    setDialogError(""); setResult(null); operation.current = null;
    setChooserQuery(""); setShowAmounts(false);
    setPending(null); setPendingChoices({}); setPendingListId(""); setPendingError("");
    selectionOperation.current = null;
  }, []);

  const clearDeniedAccess = useCallback((error: unknown) => {
    if (!isAppError(error) || !["FORBIDDEN", "SESSION_EXPIRED"].includes(error.code) &&
      error.status !== 401 && error.status !== 403) return false;
    identity.current = { scope: identity.current.scope }; sequence.current += 1;
    setData(EMPTY_DATA); setSelected([]); clearForms(); setAccessDenied(true);
    setLoadError(error.message); setLoading(false); setBusy(false); mutationPending.current = false;
    return true;
  }, [clearForms]);

  const reload = useCallback(async (silent = false) => {
    if (!scope || !useCases) return;
    const captured = identity.current;
    const request = ++sequence.current;
    if (!silent) setLoading(true); setLoadError("");
    try {
      const [nextDishes, plan, nextLists] = await Promise.all([
        useCases.listDishes.execute(), useCases.getMealPlan.execute(week), useCases.listShoppingLists.execute(),
      ]);
      if (!mounted.current || identity.current !== captured || request !== sequence.current) return;
      setData({ scope, week, dishes: nextDishes, entries: plan.entries, lists: nextLists });
      if (!silent) setSelected(plan.entries.map((entry) => entry.id)); setAccessDenied(false);
    } catch (error) {
      if (!mounted.current || identity.current !== captured || request !== sequence.current) return;
      if (clearDeniedAccess(error)) return;
      setData(EMPTY_DATA); setSelected([]); setLoadError(errorMessage(error));
    } finally {
      if (mounted.current && identity.current === captured && request === sequence.current) setLoading(false);
    }
  }, [scope, week, useCases, clearDeniedAccess]);
  useHouseholdRefresh(() => reload(true));

  useEffect(() => {
    mounted.current = true;
    if (identity.current.scope !== scope) identity.current = { scope };
    return () => { mounted.current = false; identity.current = { scope: "" }; sequence.current += 1; };
  }, []);
  useEffect(() => {
    sequence.current += 1; setData(EMPTY_DATA); setSelected([]); clearForms();
    setBusy(false); mutationPending.current = false; setLoadError(""); setAccessDenied(false);
    setFamilyQuery("");
    if (scope) void reload(); else setLoading(false);
  }, [scope, reload, clearForms]);

  const closeDialog = () => { if (!busy) clearForms(); };
  const openDish = (dish: MealDish | null) => {
    if (!available || busy || accessDenied) return;
    setTitle(dish?.title ?? ""); setDialogError(""); setResult(null); setShowAmounts(false);
    setIngredients((dish?.ingredients ?? []).map((row, index) => ({ key: String(index), title: row.title,
      catalogId: row.catalogId ?? null, qty: quantityText(row.qty), unit: row.unit ?? "", selected: true })));
    setDialog({ scope, kind: "dish", dish });
  };
  const openSlot = (date: string, mealType: MealType, entry: MealEntry | null) => {
    if (!available || busy || accessDenied) return;
    setDishId(entry?.dishId ?? ""); setDialogError(""); setChooserQuery(""); setChooserSource(dishes.length ? "family" : "library");
    setDialog({ scope, kind: "slot", date, mealType, entry });
  };
  const openLibraryFood = (food: LibraryFood) => {
    if (!available || busy || accessDenied) return;
    const slot = activeDialog?.kind === "slot" ? { date: activeDialog.date, mealType: activeDialog.mealType, entry: activeDialog.entry } : undefined;
    setDialogError(""); setDialog({ scope, kind: "library", food, slot });
  };
  const backFromLibrary = () => {
    if (busy || activeDialog?.kind !== "library") return;
    setDialogError("");
    if (activeDialog.slot) { setChooserSource("library"); setDialog({ scope, kind: "slot", ...activeDialog.slot }); }
    else clearForms();
  };

  const beginMissingFlow = (flow: PendingMealFlow) => {
    setPending(flow);
    setPendingChoices(Object.fromEntries(flow.missing.map((row) => [row.key, {
      action: "", qty: quantityText(row.ingredient.qty), unit: row.ingredient.unit ?? "",
    }])));
    setPendingListId("");
    setPendingError("");
    setDialog(null);
  };

  const findMissingIngredients = async (rows: MealIngredient[]): Promise<PendingMissing[]> => {
    if (!useCases) return [];
    return (await useCases.checkMealIngredients.execute(rows)).filter(row => row.status !== "available");
  };

  const changePendingChoice = (key: string, change: Partial<PendingDecision>) => {
    setPendingError("");
    setPendingChoices(previous => {
      const choice: PendingDecision = previous[key] ?? { action: "", qty: "", unit: "" };
      return { ...previous, [key]: { ...choice, ...change } };
    });
  };

  const submitMeal = async (flow: PendingMealFlow, decisions: MealSelectionInput["decisions"], destination?: string) => {
    if (!useCases) return;
    const input = { date: flow.slot.date, mealType: flow.slot.mealType, dishId: flow.dishId,
      dishRevision: flow.dishRevision, dish: flow.input, entryId: flow.slot.entry?.id,
      baseRevision: flow.slot.entry?.revision, listId: destination, decisions };
    const key = JSON.stringify(input);
    if (selectionOperation.current?.key !== key) selectionOperation.current = { key, id: crypto.randomUUID() };
    await useCases.confirmMealSelection.execute({ ...input, operationId: selectionOperation.current.id });
  };

  const completePendingMeal = async () => {
    if (!pending || pending.scope !== scope || !available || accessDenied || !useCases || busy || mutationPending.current) return;
    const decisions: MealSelectionInput["decisions"] = [];
    for (const row of pending.missing) {
      const choice = pendingChoices[row.key];
      if (!choice?.action) { setPendingError("برای همهٔ مواد ناموجود یک گزینه انتخاب کنید."); return; }
      if (choice.action === "shopping") {
        const qty = quantityValue(choice.qty);
        const invalid = importError([{ ...row.ingredient, qty, unit: choice.unit.trim() || null }]);
        if (invalid) {
          setPendingError(invalid);
          return;
        }
        decisions.push({ key: row.key, action: choice.action, qty, unit: choice.unit.trim() || null });
      } else {
        decisions.push({ key: row.key, action: choice.action, qty: null, unit: null });
      }
    }
    const withShopping = decisions.some(row => row.action === "shopping");
    if (withShopping && !lists.some((list) => list.id === pendingListId)) {
      setPendingError("لیست خرید مقصد را انتخاب کنید."); return;
    }
    const captured = identity.current;
    mutationPending.current = true; setBusy(true); setPendingError("");
    try {
      await submitMeal(pending, decisions, withShopping ? pendingListId : undefined);
      if (!stillCurrent(captured)) return;
      clearForms(); show("وعده ثبت شد و مواد انتخاب‌شده تعیین تکلیف شدند."); await reload();
    } catch (error) {
      if (stillCurrent(captured) && !clearDeniedAccess(error)) {
        setPendingError(errorMessage(error));
        // Recheck after a rejected commit. Never discard the submitted receipt
        // key on a lost response: a retry must return the committed result.
        if (isAppError(error) && error.code !== "NETWORK") {
          try {
            const nextDishes = pending.dishId ? await useCases.listDishes.execute() : null;
            if (!stillCurrent(captured)) return;
            const latestDish = nextDishes?.find(row => row.id === pending.dishId);
            const rows = pending.input?.ingredients ?? latestDish?.ingredients ?? [];
            const missing = await findMissingIngredients(rows);
            if (stillCurrent(captured)) {
              const changed = latestDish && latestDish.revision !== pending.dishRevision;
              if (changed) setPendingChoices({});
              if (nextDishes) setData(previous => ({ ...previous, dishes: nextDishes }));
              setPending(previous => previous ? { ...previous, missing,
                dishRevision: latestDish?.revision ?? previous.dishRevision } : previous);
            }
          } catch { /* Keep the review and original error until a successful retry. */ }
        }
      }
    } finally {
      if (stillCurrent(captured)) { setBusy(false); mutationPending.current = false; }
    }
  };
  const saveLibraryFood = async (input: DishInput) => {
    if (!available || !useCases || busy || mutationPending.current || accessDenied || activeDialog?.kind !== "library") return;
    const captured = identity.current, slot = activeDialog.slot;
    mutationPending.current = true; setBusy(true); setDialogError("");
    try {
      if (slot) {
        const missing = await findMissingIngredients(input.ingredients);
        if (!stillCurrent(captured)) return;
        const flow = { scope, slot, missing, input };
        if (missing.length) {
          beginMissingFlow(flow);
          return;
        }
        await submitMeal(flow, []);
      } else {
        await useCases.addDish.execute(input);
      }
      if (!stillCurrent(captured)) return;
      clearForms(); show(slot ? "غذا ذخیره و برای وعده انتخاب شد." : "غذا به فهرست خانواده اضافه شد."); await reload();
    } catch (error) { if (stillCurrent(captured) && !clearDeniedAccess(error)) setDialogError(errorMessage(error)); }
    finally { if (stillCurrent(captured)) { setBusy(false); mutationPending.current = false; } }
  };
  const changeIngredient = (key: string, change: Partial<IngredientForm>) => {
    operation.current = null; setResult(null); setDialogError("");
    setIngredients((previous) => previous.map((row) => row.key === key ? { ...row, ...change,
      ...(change.title !== undefined ? { catalogId: null } : {}) } : row));
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
    const input: DishInput = { title: title.trim(), ingredients: ingredients.map(ingredientInput).map((row) => ({
      ...row, catalogId: row.catalogId ?? checkMealIngredient(row, []).catalogId,
    })) };
    const error = dishError(input);
    if (error) { setDialogError(error); return; }
    input.ingredients = input.ingredients.map(cleanIngredient);
    const dish = activeDialog.dish;
    void mutate(() => dish ? useCases.updateDish.execute(dish.id, input, dish.revision) : useCases.addDish.execute(input),
      dish ? "غذا به‌روز شد." : "غذا ثبت شد.");
  };
  const saveSlot = async () => {
    if (!available || accessDenied || busy || mutationPending.current || !useCases || activeDialog?.kind !== "slot" || activeDialog.entry && !activeDialog.entry.canEdit) return;
    if (!dishId || !catalog.has(dishId)) { setDialogError("یک غذا انتخاب کنید."); return; }
    const slot = activeDialog;
    const dish = catalog.get(dishId);
    if (dish) {
      const captured = identity.current;
      mutationPending.current = true; setBusy(true); setDialogError("");
      try {
        const missing = await findMissingIngredients(dish.ingredients);
        if (!stillCurrent(captured)) return;
        const flow = { scope, slot, missing, dishId, dishRevision: dish.revision };
        if (missing.length) {
          beginMissingFlow(flow);
          return;
        }
        await submitMeal(flow, []);
        if (!stillCurrent(captured)) return;
        clearForms(); show("وعده ثبت شد."); await reload();
      } catch (error) {
        if (stillCurrent(captured) && !clearDeniedAccess(error)) setDialogError(errorMessage(error));
      } finally { if (stillCurrent(captured)) { setBusy(false); mutationPending.current = false; } }
    }
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
  const familyDishes = dishes.filter(dish => normalizeFoodSearch(dish.title).includes(normalizeFoodSearch(familyQuery)));
  const chooserDishes = dishes.filter(dish => normalizeFoodSearch(dish.title).includes(normalizeFoodSearch(chooserQuery)));
  const visibleDays = weekView ? days : [days[dayIndex]];

  return <AppPage className="page active meals-page" aria-busy={loading || busy}>
    <header className="app-header"><div className="header-title"><h1>برنامهٔ غذایی</h1><p>برای سفرهٔ خانواده</p></div></header>
    <div className="content meals-content">
      <div className="meal-kitchen-hero"><div className="meal-hero-copy"><p className="meal-eyebrow">دفتر آشپزخانهٔ ما</p>
        <h2>امروز چی بخوریم؟</h2><p>از صبحانه تا شام، غذای هر روز را با هم انتخاب کنیم.</p>
        <button type="button" className="meal-text-button" onClick={() => setTab("library")} disabled={!available || accessDenied || busy}>یک غذا از کتابخانه پیدا کنیم<Icon name="i-arrow-l" /></button>
      </div><FoodArt className="meal-hero-art" /></div>
      {!available ? <Card><p className="modal-sub" role="status">مشاهده و مدیریت برنامهٔ غذایی به اتصال اینترنت و ورود معتبر نیاز دارد.</p></Card> : <>
        <nav className="meals-tabs" aria-label="بخش برنامهٔ غذایی">
          <button type="button" className={`meals-tab${tab === "week" ? " active" : ""}`} aria-pressed={tab === "week"} onClick={() => setTab("week")}>برنامهٔ هفته</button>
          <button type="button" className={`meals-tab${tab === "library" ? " active" : ""}`} aria-pressed={tab === "library"} onClick={() => setTab("library")}>کتابخانهٔ غذاها</button>
          <button type="button" className={`meals-tab${tab === "dishes" ? " active" : ""}`} aria-pressed={tab === "dishes"} onClick={() => setTab("dishes")}>غذاهای خانواده</button>
        </nav>
        {loading ? <p className="form-note" role="status">در حال دریافت برنامهٔ غذایی…</p> : null}
        {loadError ? <Card><p className="modal-sub" role="alert">{loadError}</p><button type="button" className="btn-secondary" disabled={loading || busy} onClick={() => void reload()}>تلاش دوباره</button></Card> : null}
        {tab === "week" && !accessDenied ? <>
          <div className="meals-week-nav" role="group" aria-label="انتخاب هفته">
            <button type="button" className="meal-week-step" disabled={busy || weekOffset <= -1} onClick={() => setWeekOffset(offset => offset - 1)}><Icon name="i-arrow-r" />هفتهٔ قبل</button>
            <button type="button" className="meal-current-week" disabled={busy} onClick={() => setWeekOffset(0)}>هفتهٔ جاری</button>
            <button type="button" className="meal-week-step" disabled={busy || weekOffset >= 1} onClick={() => setWeekOffset(offset => offset + 1)}>هفتهٔ بعد<Icon name="i-arrow-l" /></button>
          </div>
          <p className="meals-week-label">{formatLong(isoToJalali(days[0]))} تا {formatLong(isoToJalali(days[6]))}</p>
          <div className="meal-day-selector" role="group" aria-label="روزهای برنامهٔ غذایی">{days.map((date, index) => <button type="button" key={date}
            className={`meal-day-button${dayIndex === index && !weekView ? " active" : ""}`} aria-pressed={dayIndex === index && !weekView} disabled={busy}
            onClick={() => { setDayIndex(index); setWeekView(false); }}><span>{WEEKDAYS[index]}</span><b>{toFa(isoToJalali(date)[2])}</b>
            <span className="meal-day-dots" aria-hidden="true">{MEAL_TYPES.map(type => <i key={type.value} className={entries.some(entry => entry.date === date && entry.mealType === type.value) ? "filled" : ""} />)}</span>
          </button>)}</div>
          <div className="meal-week-toolbar"><p>{toFa(entries.length)} وعده برای این هفته انتخاب شده</p>
            <button type="button" className="meal-text-button" aria-pressed={weekView} disabled={busy} onClick={() => setWeekView(value => !value)}>{weekView ? "نمای یک روز" : "نمای کامل هفته"}</button></div>
          <div className={`meals-days${weekView ? " full-week" : " selected-day"}`}>{visibleDays.map(date => <Card key={date}>
            <div className="meal-menu-heading"><div><p className="meal-eyebrow">سر سفرهٔ خانواده</p><h2 className="meal-day-title">{formatWeekday(isoToJalali(date))}</h2></div><span>{formatLong(isoToJalali(date))}</span></div>
            {MEAL_TYPES.map(type => {
              const entry = entries.find(row => row.date === date && row.mealType === type.value);
              const dish = entry ? catalog.get(entry.dishId) : null;
              return <div className="meal-slot" key={type.value}>
                <FoodArt kind={type.value} className="meal-slot-art" />
                <div className="meal-slot-main"><span className="meal-slot-type">{type.label}</span>
                  <button type="button" className={`meal-slot-dish${entry ? " assigned" : ""}`} disabled={busy || loading || Boolean(loadError)}
                    aria-label={`${entry ? "جزئیات" : "انتخاب غذا برای"} ${type.label} ${formatWeekday(isoToJalali(date))}`}
                    onClick={() => openSlot(date, type.value, entry ?? null)}><span data-meal-content>{dish?.title ?? (entry ? "غذای ثبت‌شده" : "برای این وعده غذا انتخاب کنیم")}</span><Icon name={entry ? "i-arrow-l" : "i-plus"} /></button>
                  {dish?.ingredients.length ? <p className="meal-slot-ingredients" data-meal-content>{dish.ingredients.slice(0, 4).map(row => row.title).join("، ")}</p> : null}
                </div>
                {entry ? <label className="meal-slot-check"><input type="checkbox" checked={selected.includes(entry.id)} disabled={busy || loading}
                  aria-label={`انتخاب ${type.label} ${formatWeekday(isoToJalali(date))} برای خرید`}
                  onChange={event => setSelected(previous => event.target.checked ? [...previous, entry.id] : previous.filter(id => id !== entry.id))} /></label> : null}
              </div>;
            })}
          </Card>)}</div>
          <details className="meal-shopping-panel"><summary>مواد لازم برای خرید خانواده</summary><p className="form-note">وعده‌های موردنظر را علامت بزنید و مواد لازم را پیش از افزودن به خرید بررسی کنید.</p>
            <button type="button" className="btn-secondary" disabled={busy || loading || !selected.length || Boolean(loadError)} onClick={openImport}>مواد لازم برای خرید ({toFa(selected.length)} وعده)</button></details>
        </> : tab === "library" && !accessDenied ? <>
          <div className="meal-section-heading"><div><h2>برای هر وعده، یک انتخاب</h2><p>غذاهای آماده، با دسته‌بندی و مواد اولیهٔ خودشان.</p></div></div>
          <MealLibrary onSelect={openLibraryFood} disabled={busy || loading} />
        </> : tab === "dishes" && !accessDenied ? <>
          <div className="meal-section-heading"><div><h2>غذاهای آشنای خانه</h2><p>غذاهایی که خودتان نوشته‌اید یا از کتابخانه انتخاب کرده‌اید.</p></div>
            <button type="button" className="btn-primary" onClick={() => openDish(null)} disabled={busy || loading || accessDenied}><Icon name="i-plus" />غذای جدید</button></div>
          <div className="meal-search"><Icon name="i-search" /><input className="text-input" type="search" aria-label="جست‌وجو در غذاهای خانواده" placeholder="نام غذا را بنویسید"
            value={familyQuery} onChange={event => setFamilyQuery(event.target.value)} /></div>
          {familyDishes.length ? <Card><div className="meals-catalog">{familyDishes.map(dish => <div className="meal-dish-row" key={dish.id}>
            <span className="meal-food-mark"><Icon name="i-food" /></span><button type="button" className="meal-dish-details" disabled={busy} onClick={() => openDish(dish)} aria-label={`جزئیات ${dish.title}`}>
              <b data-meal-content>{dish.title}</b><span data-meal-content>{dish.ingredients.slice(0, 5).map(row => row.title).join("، ")}</span></button>
            {dish.canDelete ? <button type="button" className="meal-close" disabled={busy} aria-label={`حذف ${dish.title}`}
              onClick={() => { setDialogError(""); setDialog({ scope, kind: "deleteDish", dish }); }}><Icon name="i-trash" /></button> : null}
          </div>)}</div></Card> : !loading && !loadError ? <div className="meal-empty" role="status"><FoodArt kind="dinner" /><h3>{dishes.length ? "غذایی با این نام پیدا نشد." : "جای غذاهای محبوب خانه اینجاست."}</h3>
            <p>یک غذا از کتابخانه انتخاب کنید یا غذای خودتان را بنویسید.</p><button className="btn-secondary" type="button" onClick={() => setTab("library")}>رفتن به کتابخانهٔ غذاها</button></div> : null}
          <p className="form-note">همهٔ اعضای فعال غذاها را می‌بینند. سازنده و مدیران می‌توانند غذا را ویرایش کنند.</p>
        </> : null}
      </>}
    </div>
    <MealDialog open={activeDialog?.kind === "library"} onClose={closeDialog} title="مواد اولیهٔ غذا">
      {activeDialog?.kind === "library" ? <MealLibraryDetail key={activeDialog.food.id} food={activeDialog.food} busy={busy} error={dialogError}
        checkIngredients={useCases!.checkMealIngredients} forSlot={Boolean(activeDialog.slot)} onBack={backFromLibrary} onSave={input => void saveLibraryFood(input)} /> : null}
    </MealDialog>
    <MealDialog open={available && !accessDenied && pending?.scope === scope} onClose={() => { if (!busy) clearForms(); }} title="تعیین تکلیف مواد ناموجود">
      {available && pending?.scope === scope ? <form onSubmit={event => { event.preventDefault(); void completePendingMeal(); }}>
        <p className="modal-sub">برخی از مواد اولیهٔ این غذا در موجودی انبار شما ثبت نشده‌اند. برای هر ماده یکی از گزینه‌ها را انتخاب کنید.</p>
        {pending.missing.map((row, index) => {
          const choice: PendingDecision = pendingChoices[row.key] ?? { action: "", qty: quantityText(row.ingredient.qty), unit: row.ingredient.unit ?? "" };
          return <fieldset className="meal-missing-choice" key={row.key}>
            <legend>{row.ingredient.title}</legend>
            {row.status === "unresolved" ? <p className="form-note">این ماده هنوز به قلم استاندارد متصل نیست؛ موجودی آن تأیید نشده است.</p> : null}
            <label><input type="radio" name={`missing-${index}`} checked={choice.action === "shopping"} disabled={busy}
              onChange={() => changePendingChoice(row.key, { ...choice, action: "shopping" })} />افزودن به لیست خرید</label>
            <label><input type="radio" name={`missing-${index}`} checked={choice.action === "available"} disabled={busy}
              onChange={() => changePendingChoice(row.key, { ...choice, action: "available" })} />موجود است، اما در انبار ثبت نشده</label>
            {choice.action === "shopping" ? <div className="meal-ingredient-values">
              <Field label="مقدار خرید"><input className="text-input" inputMode="decimal" aria-label={`مقدار خرید ${row.ingredient.title}`}
                 value={choice.qty} disabled={busy} onChange={event => changePendingChoice(row.key, { ...choice, qty: event.target.value })} /></Field>
              <Field label="واحد (اختیاری)"><input className="text-input" aria-label={`واحد خرید ${row.ingredient.title}`}
                 value={choice.unit} maxLength={MEAL_LIMITS.unit} disabled={busy} onChange={event => changePendingChoice(row.key, { ...choice, unit: event.target.value })} /></Field>
            </div> : null}
          </fieldset>;
        })}
        {Object.values(pendingChoices).some(choice => choice.action === "shopping") ? <Field label="لیست خرید مقصد">
          <select className="text-input" aria-label="لیست خرید مقصد" value={pendingListId} disabled={busy}
             onChange={event => { setPendingError(""); setPendingListId(event.target.value); }}><option value="">انتخاب لیست خرید</option>
            {lists.map(list => <option key={list.id} value={list.id}>{list.title}</option>)}</select>
        </Field> : null}
        {Object.values(pendingChoices).some(choice => choice.action === "shopping") && !lists.length ? <p className="form-note">ابتدا در بخش لیست خرید یک لیست بسازید؛ یا موجودبودن مواد را تأیید کنید.</p> : null}
        {pendingError ? <p className="form-error" role="alert">{pendingError}</p> : null}
        <button type="submit" className="btn-primary meal-form-submit" disabled={busy}>{busy ? "در حال ثبت…" : "تأیید و ثبت وعده"}</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={clearForms}>انصراف</button>
      </form> : null}
    </MealDialog>
    <MealDialog open={activeDialog?.kind === "dish"} onClose={closeDialog} title={readOnlyDish ? "جزئیات غذا" : activeDialog?.kind === "dish" && activeDialog.dish ? "ویرایش غذا" : "غذای جدید"}>
      <form onSubmit={event => { event.preventDefault(); saveDish(); }} autoComplete="off">
        <Field label="نام غذا"><input className="text-input" aria-label="نام غذا" value={title} maxLength={MEAL_LIMITS.title} disabled={busy || readOnlyDish}
          placeholder="مثلاً عدس‌پلو" onChange={event => setTitle(event.target.value)} /></Field>
        <div className="meal-ingredients-title"><h3 className="meal-form-heading">مواد اولیه</h3>{ingredients.some(row => row.qty || row.unit) ? <button type="button" className="meal-text-button"
          onClick={() => setShowAmounts(value => !value)}>{showAmounts ? "بستن مقادیر ثبت‌شده" : "نمایش مقادیر ثبت‌شده"}</button> : null}</div>
        {!ingredients.length ? <p className="form-note">نام مواد اولیه را اکنون یا بعداً اضافه کنید؛ مقدار لازم نیست.</p> : null}
        <div className="meal-ingredients">{ingredients.map((row, index) => <div className="meal-ingredient" key={row.key}>
          <div className="meal-ingredient-heading"><Field label="نام ماده"><input className="text-input" aria-label={`نام مادهٔ ${toFa(index + 1)}`} value={row.title} maxLength={MEAL_LIMITS.title}
            disabled={busy || readOnlyDish} onChange={event => changeIngredient(row.key, { title: event.target.value })} /></Field>
            {!readOnlyDish ? <button type="button" className="meal-close" aria-label={`حذف مادهٔ ${toFa(index + 1)}`} disabled={busy}
              onClick={() => setIngredients(previous => previous.filter(item => item.key !== row.key))}><Icon name="i-trash" /></button> : null}</div>
          {showAmounts ? <div className="meal-ingredient-values"><Field label="مقدار ثبت‌شده"><input className="text-input" inputMode="decimal" aria-label={`مقدار مادهٔ ${toFa(index + 1)}`}
            value={row.qty} disabled={busy || readOnlyDish} onChange={event => changeIngredient(row.key, { qty: event.target.value })} /></Field>
            <Field label="واحد ثبت‌شده"><input className="text-input" aria-label={`واحد مادهٔ ${toFa(index + 1)}`} value={row.unit} maxLength={MEAL_LIMITS.unit}
              disabled={busy || readOnlyDish} onChange={event => changeIngredient(row.key, { unit: event.target.value })} /></Field></div> : null}
        </div>)}</div>
        {!readOnlyDish ? <button type="button" className="btn-secondary" disabled={busy || ingredients.length >= MEAL_LIMITS.ingredients}
          onClick={() => setIngredients(previous => [...previous, { key: crypto.randomUUID(), title: "", qty: "", unit: "", selected: true }])}>افزودن مادهٔ لازم</button> : null}
        {dialogError ? <p className="form-error" role="alert">{dialogError}</p> : null}
        {!readOnlyDish ? <button type="submit" className="btn-primary meal-form-submit" disabled={busy}>{busy ? "در حال ذخیره…" : "ذخیرهٔ غذا"}</button> : null}
      </form>
    </MealDialog>
    <MealDialog open={activeDialog?.kind === "slot"} onClose={closeDialog} title="انتخاب غذای وعده">
      {activeDialog?.kind === "slot" ? <>
        <p className="meal-slot-caption">{MEAL_TYPES.find(type => type.value === activeDialog.mealType)?.label} · {formatWeekday(isoToJalali(activeDialog.date))}</p>
        {activeDialog.entry && !activeDialog.entry.canEdit ? <><h3 data-meal-content>{catalog.get(activeDialog.entry.dishId)?.title}</h3>
          <ul className="meal-readonly-ingredients">{catalog.get(activeDialog.entry.dishId)?.ingredients.map((row, index) => <li key={index} data-meal-content>{row.title}</li>)}</ul>
          <p className="form-note">ویرایش این وعده در اختیار سازنده و مدیران خانواده است.</p></> : <>
          <div className="meal-chooser-tabs" role="group" aria-label="منبع انتخاب غذا">
            <button type="button" className={`meal-category${chooserSource === "family" ? " active" : ""}`} aria-pressed={chooserSource === "family"} onClick={() => setChooserSource("family")}>غذاهای خانواده</button>
            <button type="button" className={`meal-category${chooserSource === "library" ? " active" : ""}`} aria-pressed={chooserSource === "library"} onClick={() => setChooserSource("library")}>کتابخانهٔ غذاها</button>
          </div>
          {chooserSource === "library" ? <MealLibrary onSelect={openLibraryFood} disabled={busy} compact /> : <form onSubmit={event => { event.preventDefault(); saveSlot(); }}>
            <div className="meal-search"><Icon name="i-search" /><input className="text-input" type="search" aria-label="جست‌وجوی غذای وعده" placeholder="نام غذا را بنویسید" value={chooserQuery}
              disabled={busy} onChange={event => setChooserQuery(event.target.value)} /></div>
            <fieldset className="meal-family-chooser"><legend>غذای وعده</legend>{chooserDishes.map(dish => <label key={dish.id} className={`meal-chooser-row${dishId === dish.id ? " active" : ""}`}>
              <input type="radio" name="meal-dish" value={dish.id} checked={dishId === dish.id} disabled={busy} onChange={() => { setDishId(dish.id); setDialogError(""); }} />
              <span><b data-meal-content>{dish.title}</b><small data-meal-content>{dish.ingredients.slice(0, 4).map(row => row.title).join("، ")}</small></span>
            </label>)}</fieldset>
            {!chooserDishes.length ? <p className="form-note" role="status">غذایی در این فهرست پیدا نشد؛ از کتابخانه انتخاب کنید.</p> : null}
            {dialogError ? <p className="form-error" role="alert">{dialogError}</p> : null}
            <button type="submit" className="btn-primary meal-form-submit" disabled={busy || !dishId}>{busy ? "در حال ذخیره…" : "ذخیرهٔ وعده"}</button>
          </form>}
        </>}
        {activeDialog.entry?.canDelete ? <button type="button" className="btn-secondary meal-remove-slot" disabled={busy} onClick={removeSlot}>برداشتن این وعده از برنامه</button> : null}
      </> : null}
    </MealDialog>
    <MealDialog open={activeDialog?.kind === "deleteDish"} onClose={closeDialog} title="حذف غذا">
      {activeDialog?.kind === "deleteDish" ? <><p className="modal-sub">«{activeDialog.dish.title}» از فهرست غذاهای خانواده حذف شود؟</p>
        {dialogError ? <p className="form-error" role="alert">{dialogError}</p> : null}
        <button type="button" className="btn-primary meal-delete-button" disabled={busy} onClick={removeDish}>{busy ? "در حال حذف…" : "حذف غذا"}</button></> : null}
    </MealDialog>
    <MealDialog open={activeDialog?.kind === "import"} onClose={closeDialog} title="افزودن مواد لازم به خرید">
      {result ? <div role="status"><p className="meals-import-result">{toFa(result.addedCount)} ماده به لیست خرید اضافه شد.</p>
        {result.added.length ? <ul className="meal-result-list">{result.added.map(row => <li key={row.id} data-meal-content>{row.title} · {quantityText(row.qty)}{row.unit ? ` ${row.unit}` : ""}</li>)}</ul> : null}
        {result.skippedCount ? <><p className="form-note">{toFa(result.skippedCount)} ماده از قبل در لیست بود و تغییر نکرد.</p><ul className="meal-result-list">{result.skipped.map(row => <li key={row.id} data-meal-content>{row.title}</li>)}</ul></> : null}
        <button type="button" className="btn-primary" disabled={busy} onClick={closeDialog}>بستن</button></div> : <form onSubmit={event => { event.preventDefault(); void importIngredients(); }}>
        <p className="modal-sub">مواد، مقدار و واحد را بررسی کنید. مواد هم‌نام با واحد یکسان جمع شده‌اند.</p>
        {!ingredients.length ? <p className="form-note" role="status">برای وعده‌های انتخاب‌شده ماده‌ای ثبت نشده. مواد لازم غذاها را در فهرست غذاها اضافه کنید.</p> : null}
        <div className="meal-ingredients">{ingredients.map((row, index) => <div className="meal-ingredient" key={row.key}>
          <label className="meal-import-check"><input type="checkbox" checked={row.selected} disabled={busy} onChange={event => changeIngredient(row.key, { selected: event.target.checked })} /><b data-meal-content>{row.title}</b></label>
          {!row.qty ? <p className="form-note">مقدار دستور غذا مشخص نیست؛ مقدار خرید را خودتان وارد کنید.</p> : null}
          {row.conflictingUnit ? <p className="meal-unit-warning">این ماده با چند واحد آمده؛ فقط یک واحد انتخاب کنید یا واحدها را دستی یکسان کنید.</p> : null}
          <div className="meal-ingredient-values"><Field label="مقدار"><input className="text-input" inputMode="decimal" aria-label={`مقدار ${row.title} ${toFa(index + 1)}`} value={row.qty}
            disabled={busy || !row.selected} onChange={event => changeIngredient(row.key, { qty: event.target.value })} /></Field>
            <Field label="واحد (اختیاری)"><input className="text-input" aria-label={`واحد ${row.title} ${toFa(index + 1)}`} value={row.unit} maxLength={MEAL_LIMITS.unit}
              disabled={busy || !row.selected} onChange={event => changeIngredient(row.key, { unit: event.target.value })} /></Field></div>
        </div>)}</div>
        <Field label="لیست خرید مقصد"><select className="text-input" aria-label="لیست خرید مقصد" value={listId} disabled={busy || !lists.length} onChange={event => { operation.current = null; setListId(event.target.value); setDialogError(""); }}>
          <option value="">انتخاب لیست خرید</option>{lists.map(list => <option key={list.id} value={list.id}>{list.title}</option>)}</select></Field>
        {!lists.length ? <p className="form-note">ابتدا در بخش لیست خرید یک لیست بسازید.</p> : null}
        <p className="form-note">مواد موجود در لیست دوباره اضافه نمی‌شوند. مقدار و قیمت آن‌ها حفظ می‌شود.</p>
        {dialogError ? <p className="form-error" role="alert">{dialogError}</p> : null}
        <button type="submit" className="btn-primary" disabled={busy || !listId || !selectedIngredients}>{busy ? "در حال افزودن…" : `افزودن ${toFa(selectedIngredients)} ماده به خرید`}</button>
      </form>}
    </MealDialog>
  </AppPage>;
}
