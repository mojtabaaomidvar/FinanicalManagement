import { AppPage } from "@/shared/ui/AppPage";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { ShoppingSyncStatus } from "@/features/shopping-offline/ui/ShoppingSyncStatus";
import { useOnline } from "@/shared/lib/useOnline";
import { Card, Field, Icon, Modal, Segmented, Select, TextInput } from "@/shared/ui";
import type { InventoryItem } from "@/domain/shopping/shopping.types";
import { INVENTORY_UNIT_OPTIONS } from "@/domain/inventory/inventory.units";
import { formatQty } from "@/domain/shopping/shopping.rules";
import { filterInventory, inventoryShoppingLists, liveInventoryQuantity, MAX_INVENTORY_QUANTITY,
  parseInventoryQuantity, type InventoryFilter } from "@/domain/inventory/inventory.rules";
import { exactInventorySuggestion, inventoryCategory, inventoryNameFields, INVENTORY_CATALOG_SECTIONS, type InventoryCatalogGroup } from "@/domain/inventory/inventory.catalog";
import { INVENTORY_GROUP_LABELS } from "@/domain/inventory/inventory.labels";
import { InventoryCategories, type InventorySectionFilter } from "./InventoryCategories";
import { toFa } from "@/shared/lib/digits";
import { InventorySuggestions } from "./InventorySuggestions";
import { useInventoryCatalog } from "./useInventoryCatalog";
import "./InventoryPage.css";

interface ItemForm { title: string; unit: string; quantity: string; category: InventoryCatalogGroup | ""; note: string }
const EMPTY: ItemForm = { title: "", unit: "", quantity: "۰", category: "", note: "" };

export function InventoryPage() {
  const { useCases, inventory, shoppingLists, refreshData, shoppingSync, member, family } = useApp();
  const { show } = useToast();
  const online = useOnline(), offline = !online || shoppingSync.offline;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<InventoryFilter>("all");
  const [section, setSection] = useState<InventorySectionFilter>(null);
  const [subgroup, setSubgroup] = useState<InventoryCatalogGroup | null>(null);
  const [open, setOpen] = useState(false);
  const catalog = useInventoryCatalog(open, !offline);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [form, setForm] = useState<ItemForm>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  const [adjustMode, setAdjustMode] = useState<"consume" | "add">("consume");
  const [adjustQty, setAdjustQty] = useState("۱");
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sendList, setSendList] = useState("");
  const [sendQty, setSendQty] = useState("۱");
  const writing = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const identity = useRef({ useCases, memberId: member?.id, familyId: family?.id });
  identity.current = { useCases, memberId: member?.id, familyId: family?.id };
  const scope = `${family?.id}:${member?.id}`;
  useEffect(() => {
    setOpen(false); setAdjustingId(null); setSendingId(null); setError(null); setQuery(""); setFilter("all");
    setSection(null); setSubgroup(null);
  }, [scope]);
  const queued = useMemo(() => inventoryShoppingLists(shoppingLists), [shoppingLists]);
  const categories = section === "uncategorized" ? section : subgroup ? [subgroup]
    : section ? INVENTORY_CATALOG_SECTIONS[section] : null;
  const visible = filterInventory(inventory, filter, query, categories);
  const emptyCount = inventory.filter(item => item.quantity === 0).length;
  const adjusting = inventory.find(item => item.id === adjustingId);
  const sending = inventory.find(item => item.id === sendingId);
  const adjustment = parseInventoryQuantity(adjustQty, false);
  const purchase = parseInventoryQuantity(sendQty, false);
  useEffect(() => {
    if (!open) return;
    setForm(previous => {
      const known = exactInventorySuggestion(previous.title, catalog.entries);
      // A delayed catalog response can fill missing defaults, never overwrite
      // category/unit edits made while the request was running.
      return known ? { ...previous, category: previous.category || known.group, unit: previous.unit || known.unit } : previous;
    });
  }, [catalog.entries, open]);

  /** All mutations use the existing encrypted outbox, including while online. */
  async function runChange(change: () => Promise<unknown>, done: () => void, message: string | null) {
    if (!useCases || writing.current) return;
    writing.current = true; setBusy(true); setError(null);
    const actor = identity.current;
    const current = () => mounted.current && identity.current.useCases === actor.useCases
      && identity.current.memberId === actor.memberId && identity.current.familyId === actor.familyId;
    let saved = false;
    try {
      await change(); saved = true;
      if (!current()) return;
      // A saved command must not be repeated just because refreshing failed.
      done();
      if (message !== null && !offline) show(message);
      await refreshData();
    } catch (cause) {
      if (current() && !saved) {
        const message = (cause as Error).message || "ذخیرهٔ تغییر ناموفق بود؛ دوباره تلاش کنید.";
        setError(message); show(message);
      }
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function openNew() {
    if (busy) return;
    const groups = section && section !== "uncategorized" ? INVENTORY_CATALOG_SECTIONS[section] : null;
    setEditing(null); setForm({ ...EMPTY, category: subgroup ?? (groups?.length === 1 ? groups[0] : "") });
    setError(null); setOpen(true);
  }
  function openEdit(item: InventoryItem) {
    if (busy) return;
    setEditing(item); setForm({ title: item.title, unit: item.unit ?? "", quantity: formatQty(item.quantity),
      category: inventoryCategory(item) ?? "", note: item.note ?? "" }); setError(null); setOpen(true);
  }
  async function save() {
    if (!useCases || writing.current) return;
    const title = form.title.trim(), quantity = parseInventoryQuantity(form.quantity);
    if (!title) { setError("نام قلم را بنویسید."); return; }
    if (quantity === null) { setError("موجودی را با عدد معتبر و نامنفی وارد کنید."); return; }
    const category = form.category || inventoryCategory({ title }, catalog.entries);
    if (!category) { setError("دستهٔ این قلم را انتخاب کنید."); return; }
    if (!editing && !form.unit.trim()) { setError("واحد این قلم را انتخاب کنید یا بنویسید."); return; }
    const latest = editing && inventory.find(item => item.id === editing.id);
    if (editing && (!latest || latest.quantity !== editing.quantity || latest.category !== editing.category
      || latest.title !== editing.title || latest.unit !== editing.unit || latest.note !== editing.note)) {
      setError("این قلم تغییر کرده است؛ فرم را ببندید و اطلاعات تازه را دوباره بررسی کنید."); return;
    }
    const input = { title, quantity, category, unit: form.unit.trim() || null, note: form.note.trim() || null };
    await runChange(() => editing ? useCases.updateInventoryItem.execute(editing.id, input) : useCases.addInventoryItem.execute(input),
      () => { setOpen(false); if (!editing) { setQuery(""); setFilter("all"); } },
      editing ? /* @copy-text inventory.item_updated */ "قلم انبار به‌روز شد" : /* @copy-text inventory.item_created */ "به انبار اضافه شد");
  }
  async function step(item: InventoryItem, delta: number) {
    if (useCases) await runChange(() => useCases.adjustInventory.execute(item.id, delta), () => {}, null);
  }
  function openAdjustment(item: InventoryItem) {
    if (busy) return;
    setAdjustingId(item.id); setAdjustMode(item.quantity > 0 ? "consume" : "add"); setAdjustQty("۱"); setError(null);
  }
  async function adjust() {
    if (!useCases || !adjusting || writing.current) return;
    if (adjustment === null) { setError("مقدار مصرف یا افزایش را بزرگ‌تر از صفر وارد کنید."); return; }
    if (adjustMode === "consume" && adjustment > adjusting.quantity) { setError("مقدار مصرف از موجودی فعلی بیشتر است."); return; }
    if (adjustMode === "add" && adjustment + adjusting.quantity > MAX_INVENTORY_QUANTITY) { setError("موجودی پس از افزایش بیش از حد بزرگ است."); return; }
    await runChange(() => useCases.adjustInventory.execute(adjusting.id, adjustMode === "consume" ? -adjustment : adjustment),
      () => setAdjustingId(null), /* @copy-text inventory.quantity_updated */ "موجودی به‌روز شد");
  }
  async function remove(item: InventoryItem) {
    if (!useCases || writing.current || !confirm(`«${item.title}» از انبار حذف شود؟`)) return;
    await runChange(() => useCases.deleteInventoryItem.execute(item.id), () => {}, /* @copy-text inventory.item_removed */ "قلم از انبار حذف شد");
  }
  function sendToList(item: InventoryItem) {
    if (busy) return;
    if (!shoppingLists.length) { show("اول یک لیست خرید بسازید."); return; }
    setSendingId(item.id); setSendList(shoppingLists[0].id); setSendQty("۱"); setError(null);
  }
  async function addToList() {
    if (!useCases || !sending || writing.current) return;
    if (purchase === null) { setError("مقدار خرید را بزرگ‌تر از صفر وارد کنید."); return; }
    const list = shoppingLists.find(list => list.id === sendList);
    if (!list) { setError("لیست خرید مقصد را انتخاب کنید."); return; }
    if (queued.has(sending.id)) { setError("این قلم در لیست خرید قرار دارد؛ همان قلم را بررسی کنید."); return; }
    if (list.items.some(item => item.title.trim() === sending.title.trim())) {
      setError("قلمی هم‌نام در این لیست هست؛ مقدار و پیوند انبار آن را در لیست خرید بررسی کنید."); return;
    }
    await runChange(() => useCases.addShoppingItem.execute(list.id, { title: sending.title, qty: purchase,
      unit: sending.unit, inventoryItemId: sending.id }), () => setSendingId(null),
      /* @copy-text inventory.sent_to_shopping */ `«${sending.title}» به لیست خرید اضافه شد`);
  }
  const close = (done: () => void) => { if (!writing.current) { done(); setError(null); } };
  function rows(items: InventoryItem[]) {
    return <div className="inv-list">{items.map(item => <InvRow key={item.id} item={item} busy={busy}
      queued={queued.get(item.id) ?? []} onOpen={() => openEdit(item)} onStep={delta => void step(item, delta)}
      onAdjust={() => openAdjustment(item)} onSend={() => sendToList(item)} onDelete={() => void remove(item)} />)}</div>;
  }
  return <AppPage className="page active inventory-page">
    <header className="app-header"><div className="header-title"><h1>انبار خانه</h1><p>موجودی، مصرف و خرید دوباره</p></div></header>
    <div className="content">
      <ShoppingSyncStatus />
      <Card>
        <div className="inv-summary">
          <div><b>{toFa(inventory.length)}</b><span>قلم در انبار</span></div>
          <div><b>{toFa(emptyCount)}</b><span>تمام‌شده</span></div>
        </div>
        <button type="button" className="btn-primary" disabled={busy} onClick={openNew}>افزودن قلم به انبار</button>
      </Card>
      <InventoryCategories inventory={inventory} section={section} subgroup={subgroup}
        onChange={(nextSection, nextGroup) => { setSection(nextSection); setSubgroup(nextGroup); }} />
      {inventory.length ? <div className="inv-filters">
        <TextInput aria-label="جست‌وجوی انبار" value={query} onChange={setQuery} placeholder="جست‌وجوی نام، واحد یا یادداشت…" />
        <Segmented value={filter} onChange={setFilter} options={[
          { value: "all", label: "همه" }, { value: "empty", label: "تمام‌شده" },
        ]} />
      </div> : null}
      {visible.length ? <Card title={filter === "empty" ? "موجودی تمام‌شده" : "اقلام انبار"}>{rows(visible)}</Card> : null}
      {!inventory.length ? <Card><p className="form-note">چیزهایی مثل برنج، شیر و دستمال را با دسته و مقدار موجودی ثبت کنید.</p></Card>
        : !visible.length ? <Card><p className="form-note" role="status">قلمی با این جست‌وجو و فیلتر پیدا نشد.</p>
          <button type="button" className="btn-ghost" onClick={() => { setQuery(""); setFilter("all"); setSection(null); setSubgroup(null); }}>نمایش همهٔ اقلام</button></Card> : null}
      {error && !open && !adjustingId && !sendingId ? <p className="field-error" role="alert">{error}</p> : null}
    </div>
    <Modal open={open} onClose={() => close(() => setOpen(false))} title={editing ? "ویرایش قلم انبار" : "قلم جدید"} dragToClose sheetClassName="inv-edit-sheet">
      <form aria-busy={busy} onSubmit={event => { event.preventDefault(); void save(); }}>
        <fieldset className="inv-form-fields" disabled={busy}>
          <InventorySuggestions value={form.title} category={form.category} catalog={catalog.entries} inventory={editing ? inventory.filter(item => item.id !== editing.id) : inventory}
              onCategoryChange={category => { setForm(previous => ({ ...previous, category })); setError(null); }}
              onChange={title => { setForm(previous => inventoryNameFields(previous, title, catalog.entries)); setError(null); }}
              onPick={suggestion => {
                setForm(previous => ({ ...previous, title: suggestion.title, unit: suggestion.unit, category: suggestion.group }));
                setError(null);
              }} />
          {catalog.loading && <p className="form-note" role="status">در حال دریافت فهرست کالاها…</p>}
          {catalog.failed && !offline && <div className="form-note"><p>فهرست تازه دریافت نشد؛ پیشنهادهای ذخیره‌شده در دسترس‌اند.</p>
            <button type="button" className="btn-ghost" onClick={catalog.retry}>دریافت دوبارهٔ فهرست کالاها</button></div>}
          {form.title.trim() && !inventoryCategory({ title: form.title }, catalog.entries) && <p className="form-note">
            برای بررسی و تکمیل فهرست کالاها، فقط نام، دسته و واحد این قلم تازه به پشتیبانی فرستاده می‌شود.
          </p>}
          <Field label="واحد"><TextInput aria-label="واحد قلم انبار" value={form.unit} maxLength={20}
            onChange={unit => setForm(previous => ({ ...previous, unit }))} placeholder="مثلاً کیلوگرم یا بطری" />
            <div className="quick-chips inv-unit-options" role="group" aria-label="واحدهای پیشنهادی">
              {INVENTORY_UNIT_OPTIONS.map(({ value, label }) => <button key={value} type="button" className={`chip${form.unit === value ? " active" : ""}`}
                aria-pressed={form.unit === value} onClick={() => setForm(previous => ({ ...previous, unit: value }))}>
                {label}
              </button>)}
            </div>
          </Field>
          <div className="inv-number-fields">
            <Field label="موجودی فعلی"><TextInput aria-label="موجودی فعلی انبار" inputMode="decimal" dir="ltr" value={form.quantity}
              onChange={quantity => setForm(previous => ({ ...previous, quantity: liveInventoryQuantity(quantity) }))} /></Field>
          </div>
          <Field label="یادداشت (اختیاری)"><TextInput aria-label="یادداشت قلم انبار" value={form.note} maxLength={500}
            onChange={note => setForm(previous => ({ ...previous, note }))} /></Field>
        </fieldset>
        {error ? <p className="field-error" role="alert">{error}</p> : null}
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? "در حال ذخیره…" : editing ? "ذخیرهٔ تغییرات" : "افزودن"}</button>
      </form>
    </Modal>
    <Modal open={adjustingId !== null} onClose={() => close(() => setAdjustingId(null))} title="تغییر موجودی" dragToClose sheetClassName="inv-adjust-sheet">
      <form aria-busy={busy} onSubmit={event => { event.preventDefault(); void adjust(); }}>
        {adjusting ? <>
          <p className="modal-sub">{adjusting.title}</p>
          <fieldset className="inv-form-fields" disabled={busy}>
            <Segmented value={adjustMode} onChange={value => { setAdjustMode(value); setError(null); }} options={[
              { value: "consume", label: "مصرف شده" }, { value: "add", label: "افزایش موجودی" },
            ]} />
            <Field label={adjustMode === "consume" ? "مقدار مصرف" : "مقدار افزایش"}><TextInput aria-label="مقدار تغییر موجودی" dir="ltr" inputMode="decimal"
              value={adjustQty} onChange={value => { setAdjustQty(liveInventoryQuantity(value)); setError(null); }} /></Field>
            <p className="form-note">موجودی فعلی: {formatQty(adjusting.quantity)} {adjusting.unit}</p>
            {adjustment !== null && (adjustMode === "add" || adjustment <= adjusting.quantity) ? <p className="inv-result">
              موجودی پس از ثبت: {formatQty(adjusting.quantity + (adjustMode === "consume" ? -adjustment : adjustment))} {adjusting.unit}
            </p> : null}
          </fieldset>
        </> : <p className="field-error" role="alert">این قلم دیگر در انبار نیست؛ فهرست را دوباره بررسی کنید.</p>}
        {error ? <p className="field-error" role="alert">{error}</p> : null}
        <button type="submit" className="btn-primary" disabled={busy || !adjusting}>{busy ? "در حال ذخیره…" : "ثبت تغییر موجودی"}</button>
      </form>
    </Modal>
    <Modal open={sendingId !== null} onClose={() => close(() => setSendingId(null))} title="افزودن به لیست خرید" dragToClose sheetClassName="inv-send-sheet">
      <form aria-busy={busy} onSubmit={event => { event.preventDefault(); void addToList(); }}>
        {sending ? <>
          <p className="modal-sub">{sending.title}</p>
          <fieldset className="inv-form-fields" disabled={busy}>
            <Field label="لیست مقصد"><Select aria-label="لیست خرید مقصد" value={sendList} onChange={setSendList}
              options={shoppingLists.map(list => ({ value: list.id, label: list.title }))} /></Field>
            <Field label="مقدار خرید"><TextInput aria-label="مقدار خرید از انبار" value={sendQty} dir="ltr" inputMode="decimal"
              onChange={value => { setSendQty(liveInventoryQuantity(value)); setError(null); }} /></Field>
            <p className="form-note">موجودی فعلی: {formatQty(sending.quantity)} {sending.unit}</p>
            <p className="form-note">مقدار خرید را به اندازهٔ نیازتان وارد کنید.</p>
            {purchase !== null ? <p className="inv-result">موجودی پس از خرید: {formatQty(sending.quantity + purchase)} {sending.unit}</p> : null}
            <p className="form-note">موجودی انبار پس از تأیید «خرید انجام شد» افزایش می‌یابد؛ افزودن به لیست هزینه‌ای ثبت نمی‌کند.</p>
          </fieldset>
        </> : <p className="field-error" role="alert">این قلم دیگر در انبار نیست؛ فهرست را دوباره بررسی کنید.</p>}
        {error ? <p className="field-error" role="alert">{error}</p> : null}
        <button type="submit" className="btn-primary" disabled={busy || !sending}>{busy ? "در حال افزودن…" : "افزودن به لیست"}</button>
      </form>
    </Modal>
  </AppPage>;
}

function InvRow({ item, busy, queued, onOpen, onStep, onAdjust, onSend, onDelete }: {
  item: InventoryItem; busy: boolean; queued: string[]; onOpen: () => void; onStep: (delta: number) => void;
  onAdjust: () => void; onSend: () => void; onDelete: () => void;
}) {
  const category = inventoryCategory(item);
  return <div className={`inv-item${item.quantity === 0 ? " is-empty" : ""}`}>
    <button type="button" className="inv-body" disabled={busy} onClick={onOpen}>
      <b>{item.title}</b>
      <p>{formatQty(item.quantity)}{item.unit ? ` ${item.unit}` : ""}</p>
      <span className="inv-row-category">{category ? INVENTORY_GROUP_LABELS[category] : "بدون دسته"}</span>
      {item.quantity === 0 ? <span className="inv-empty-label">موجودی تمام شده</span> : null}
    </button>
    <div className="inv-side">
      <div className="inv-step">
        <button type="button" aria-label="یکی کم کن" disabled={busy || item.quantity <= 0} onClick={() => onStep(-1)}>−</button>
        <button type="button" aria-label="یکی اضافه کن" disabled={busy} onClick={() => onStep(1)}>+</button>
      </div>
      <button type="button" className="inv-adjust-open" disabled={busy} onClick={onAdjust}>مصرف / افزایش</button>
      {queued.length ? <span className="inv-queued">در لیست خرید: {queued.join("، ")}</span>
        : <button type="button" className="inv-send" disabled={busy} onClick={onSend}><Icon name="i-cart" size={16} />به لیست</button>}
      <button type="button" className="inv-del" aria-label="حذف" disabled={busy} onClick={onDelete}><Icon name="i-trash" size={16} /></button>
    </div>
  </div>;
}
