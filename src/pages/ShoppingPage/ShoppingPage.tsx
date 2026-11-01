/* §۱.۸ — صفحهٔ لیست خرید.

   چیزی که این صفحه از صفحهٔ تراکنش‌ها جدا می‌کند: این‌جا **قصدِ خرید**
   است، نه خرجِ انجام‌شده. خرج فقط وقتی ساخته می‌شود که «خرید انجام شد»
   زده شود. دلیلِ کاملش در `backend/alembic/versions/0011_shopping.py`.

   ── یک داوریِ آگاهانه دربارهٔ قاعدهٔ «لمسِ ردیف → ویرایش» ──
   در این مخزن قاعده این است که لمسِ ردیف ویرایش را باز کند (آیکونِ جدا
   نداریم). ولی در لیستِ خرید کنشِ غالب «تیک‌زدن» است، نه ویرایش — کسی که
   وسطِ سوپرمارکت ایستاده نباید دنبالِ چک‌باکسِ ریز بگردد.

   راهِ میانه‌ای که گرفته شد: چک‌باکس یک دکمهٔ **بزرگ** (۴۴ پیکسل) در لبهٔ
   ردیف است و بقیهٔ ردیف ویرایش را باز می‌کند. هم قاعده سرِ جایش می‌ماند،
   هم تیک‌زدن یک‌دستی ممکن است.

   «خرید انجام شد» سه چیز را عوض می‌کند (قلم‌ها، تراکنشِ هزینه، موجودیِ
   انبار) پس بعدش `refreshData` لازم است. */

import { useMemo, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import {
  AmountInput,
  Card,
  Field,
  Icon,
  Modal,
  Segmented,
  Select,
  TextInput,
} from "@/shared/ui";
import type {
  ShoppingItem,
  ShoppingList,
} from "@/domain/shopping/shopping.types";
import { UNIT_PRESETS } from "@/domain/shopping/shopping.types";
import {
  formatQty,
  liveFormatQty,
  parseQty,
  summarize,
} from "@/domain/shopping/shopping.rules";
import { toFa } from "@/shared/lib/digits";
import { formatAmount, parseAmountInput } from "@/shared/lib/format";
import { fromDisplay, toDisplay } from "@/shared/lib/currency";

interface ItemForm {
  title: string;
  /** رشتهٔ در حال تایپ — «۱٫۵» */
  qty: string;
  unit: string;
  /** مبلغ در واحدِ نمایشِ کاربر */
  price: string;
  note: string;
  inventoryItemId: string;
}

const EMPTY_ITEM: ItemForm = {
  title: "",
  qty: "۱",
  unit: "",
  price: "",
  note: "",
  inventoryItemId: "",
};

export function ShoppingPage() {
  const { useCases, cur, accounts, shoppingLists, inventory, refreshData } =
    useApp();
  const { show } = useToast();

  const [activeId, setActiveId] = useState("");
  const [busy, setBusy] = useState(false);
  const [quick, setQuick] = useState("");

  /* فرمِ لیست (ساخت/تغییرِ نام) */
  const [listOpen, setListOpen] = useState(false);
  const [listEditing, setListEditing] = useState<ShoppingList | null>(null);
  const [listTitle, setListTitle] = useState("");

  /* فرمِ قلم */
  const [itemOpen, setItemOpen] = useState(false);
  const [itemEditing, setItemEditing] = useState<ShoppingItem | null>(null);
  const [itemForm, setItemForm] = useState<ItemForm>(EMPTY_ITEM);

  /* بستنِ سفرِ خرید */
  const [tripOpen, setTripOpen] = useState(false);
  const [tripAccount, setTripAccount] = useState("");
  const [tripMode, setTripMode] = useState<"record" | "skip">("record");

  /* لیستِ فعال — اگر انتخابی نباشد یا پاک شده باشد، اولی.
     ترتیب از سرور می‌آید، پس «اولی» پایدار است. */
  const active =
    shoppingLists.find((l) => l.id === activeId) ?? shoppingLists[0] ?? null;
  const sum = useMemo(
    () => (active ? summarize(active) : null),
    [active],
  );

  const inventoryOptions = useMemo(
    () => [
      { value: "", label: "بدون پیوند به انبار" },
      ...inventory.map((i) => ({ value: i.id, label: i.title })),
    ],
    [inventory],
  );

  function openNewList() {
    setListEditing(null);
    setListTitle("");
    setListOpen(true);
  }

  function openRenameList(list: ShoppingList) {
    setListEditing(list);
    setListTitle(list.title);
    setListOpen(true);
  }

  async function saveList() {
    if (!useCases || busy) return;
    const title = listTitle.trim();
    if (!title) {
      show("نام لیست را بنویسید");
      return;
    }
    setBusy(true);
    try {
      if (listEditing) {
        await useCases.renameShoppingList.execute(listEditing.id, title);
      } else {
        const created = await useCases.addShoppingList.execute(title);
        /* به لیستِ تازه برو — وگرنه کاربر لیست می‌ساخت و هیچ اتفاقی
           نمی‌دید چون لیستِ فعال همان قبلی می‌ماند. */
        setActiveId(created.id);
      }
      await refreshData();
      setListOpen(false);
      show(listEditing ? "نام لیست عوض شد" : "لیست ساخته شد");
    } catch (e) {
      show((e as Error).message || "ذخیرهٔ لیست ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function removeList(list: ShoppingList) {
    if (!useCases || busy) return;
    if (
      !confirm(
        `لیست «${list.title}» و همهٔ اقلامش حذف شود؟ خرج‌هایی که قبلاً ثبت شده‌اند می‌مانند.`,
      )
    )
      return;
    setBusy(true);
    try {
      await useCases.deleteShoppingList.execute(list.id);
      setActiveId("");
      await refreshData();
      show("لیست حذف شد");
    } catch (e) {
      show((e as Error).message || "حذف ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  /* افزودنِ سریع — کلِ ارزشِ لیستِ خرید در کم‌اصطکاک‌بودنِ همین است:
     اسم را بنویس و تمام. تعداد و قیمت بعداً با لمسِ ردیف. */
  async function quickAdd() {
    if (!useCases || !active || busy) return;
    const title = quick.trim();
    if (!title) return;
    setBusy(true);
    try {
      await useCases.addShoppingItem.execute(active.id, { title });
      setQuick("");
      await refreshData();
    } catch (e) {
      show((e as Error).message || "افزودن ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  function openEditItem(item: ShoppingItem) {
    setItemEditing(item);
    setItemForm({
      title: item.title,
      qty: formatQty(item.qty),
      unit: item.unit ?? "",
      price:
        item.price === null ? "" : formatAmount(toDisplay(item.price, cur)),
      note: item.note ?? "",
      inventoryItemId: item.inventoryItemId ?? "",
    });
    setItemOpen(true);
  }

  function openNewItem() {
    setItemEditing(null);
    setItemForm({ ...EMPTY_ITEM, title: quick.trim() });
    setItemOpen(true);
  }

  async function saveItem() {
    if (!useCases || !active || busy) return;
    const title = itemForm.title.trim();
    if (!title) {
      show("نام قلم را بنویسید");
      return;
    }
    const qty = parseQty(itemForm.qty);
    if (qty <= 0) {
      show("تعداد باید بزرگ‌تر از صفر باشد");
      return;
    }
    const display = parseAmountInput(itemForm.price);
    const input = {
      title,
      qty,
      unit: itemForm.unit.trim() || null,
      /* قیمت اختیاری است: خالی یا صفر یعنی «نگفتم»، نه «مجانی».
         نمایش → پایه (تومان)، وگرنه کاربرِ ریالی ده‌برابر ذخیره می‌کرد. */
      price: display > 0 ? fromDisplay(display, cur) : null,
      note: itemForm.note.trim() || null,
      inventoryItemId: itemForm.inventoryItemId || null,
    };

    setBusy(true);
    try {
      if (itemEditing) {
        await useCases.updateShoppingItem.execute(itemEditing.id, input);
      } else {
        await useCases.addShoppingItem.execute(active.id, input);
        setQuick("");
      }
      await refreshData();
      setItemOpen(false);
      show(itemEditing ? "قلم به‌روز شد" : "به لیست اضافه شد");
    } catch (e) {
      show((e as Error).message || "ذخیره ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(item: ShoppingItem) {
    if (!useCases || busy) return;
    setBusy(true);
    try {
      await useCases.checkShoppingItem.execute(item.id, !item.checked);
      await refreshData();
    } catch (e) {
      show((e as Error).message || "تغییر ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(item: ShoppingItem) {
    if (!useCases || busy) return;
    setBusy(true);
    try {
      await useCases.deleteShoppingItem.execute(item.id);
      await refreshData();
    } catch (e) {
      show((e as Error).message || "حذف ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  function openTrip() {
    if (!sum?.checked) {
      show("اول آن‌چه خریده‌ای را تیک بزن");
      return;
    }
    setTripAccount("");
    setTripMode("record");
    setTripOpen(true);
  }

  async function confirmTrip() {
    if (!useCases || !active || busy) return;
    setBusy(true);
    try {
      const res = await useCases.completeTrip.execute(active.id, {
        accountId: tripAccount || null,
        createTransaction: tripMode === "record",
      });
      /* تراکنش و انبار هم عوض شده‌اند، پس رفرشِ کامل لازم است نه فقط
         فهرستِ خرید. */
      await refreshData();
      setTripOpen(false);
      show(
        res.transactionId
          ? `${toFa(res.itemCount)} قلم بسته شد · ${formatAmount(
              toDisplay(res.total, cur),
            )} ${cur} در هزینه‌ها ثبت شد`
          : `${toFa(res.itemCount)} قلم بسته شد — خرجی ثبت نشد`,
      );
    } catch (e) {
      show((e as Error).message || "بستنِ خرید ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page active">
      <header className="app-header">
        <div className="header-title">
          <h1>لیست خرید</h1>
          <p>چه چیزی باید بخریم</p>
        </div>
      </header>

      <div className="content">
        {!shoppingLists.length ? (
          <Card>
            <p className="form-note">
              هنوز لیستی نداری. یک لیست بساز — مثلاً «سوپرمارکت» یا «داروخانه»
              — و هر چه باید بخرید را در آن بگذارید. هر عضوِ خانه می‌تواند
              اضافه کند و تیک بزند.
            </p>
            <button type="button" className="btn-primary" onClick={openNewList}>
              ساختن اولین لیست
            </button>
          </Card>
        ) : (
          <>
            {/* چیپ‌های لیست — فقط وقتی بیش از یکی هست معنا دارد */}
            <div className="shop-tabs" role="tablist">
              {shoppingLists.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  role="tab"
                  aria-selected={active?.id === l.id}
                  className={`shop-tab${active?.id === l.id ? " active" : ""}`}
                  onClick={() => setActiveId(l.id)}
                >
                  {l.title}
                  {l.items.length ? (
                    <span className="shop-tab-n">{toFa(l.items.length)}</span>
                  ) : null}
                </button>
              ))}
              <button
                type="button"
                className="shop-tab is-add"
                aria-label="لیست تازه"
                onClick={openNewList}
              >
                <Icon name="i-plus" size={16} />
              </button>
            </div>

            {active ? (
              <Card>
                {/* افزودنِ سریع */}
                <div className="shop-add">
                  <TextInput
                    value={quick}
                    onChange={setQuick}
                    placeholder="چه چیزی اضافه کنم؟"
                  />
                  <button
                    type="button"
                    className="shop-add-btn"
                    disabled={busy || !quick.trim()}
                    onClick={() => void quickAdd()}
                  >
                    افزودن
                  </button>
                  <button
                    type="button"
                    className="shop-add-more"
                    aria-label="افزودن با تعداد و قیمت"
                    onClick={openNewItem}
                  >
                    <Icon name="i-more" size={16} />
                  </button>
                </div>

                {active.items.length ? (
                  <div className="shop-list">
                    {active.items.map((it) => (
                      <ItemRow
                        key={it.id}
                        item={it}
                        cur={cur}
                        busy={busy}
                        onToggle={() => void toggle(it)}
                        onOpen={() => openEditItem(it)}
                        onDelete={() => void removeItem(it)}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="form-note">
                    این لیست خالی است. اسمِ چیزی که باید بخرید را بالا بنویسید.
                  </p>
                )}

                {sum && sum.checked ? (
                  <div className="shop-foot">
                    <div className="shop-foot-sum">
                      <span>
                        {toFa(sum.checked)} قلم در سبد
                        {sum.missingPrice
                          ? ` · ${toFa(sum.missingPrice)} قلم بی‌قیمت`
                          : ""}
                      </span>
                      <b>
                        {formatAmount(toDisplay(sum.checkedTotal, cur))} {cur}
                      </b>
                    </div>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={busy}
                      onClick={openTrip}
                    >
                      خرید انجام شد
                    </button>
                  </div>
                ) : null}
              </Card>
            ) : null}

            {active ? (
              <div className="shop-list-actions">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => openRenameList(active)}
                >
                  تغییر نام لیست
                </button>
                <button
                  type="button"
                  className="btn-ghost-danger"
                  disabled={busy}
                  onClick={() => void removeList(active)}
                >
                  حذف لیست
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* ── فرمِ لیست ── */}
      <Modal
        open={listOpen}
        onClose={() => setListOpen(false)}
        title={listEditing ? "تغییر نام لیست" : "لیست تازه"}
        dragToClose
      >
        <Field label="نام لیست">
          <TextInput
            value={listTitle}
            onChange={setListTitle}
            placeholder="مثلاً سوپرمارکت"
          />
        </Field>
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => void saveList()}
        >
          {busy ? "…" : listEditing ? "ذخیره" : "ساختنِ لیست"}
        </button>
      </Modal>

      {/* ── فرمِ قلم ── */}
      <Modal
        open={itemOpen}
        onClose={() => setItemOpen(false)}
        title={itemEditing ? "ویرایش قلم" : "افزودن قلم"}
        dragToClose
      >
        <Field label="نام">
          <TextInput
            value={itemForm.title}
            onChange={(v) => setItemForm((f) => ({ ...f, title: v }))}
            placeholder="مثلاً شیر"
          />
        </Field>
        <Field label="تعداد">
          <TextInput
            value={itemForm.qty}
            onChange={(v) =>
              setItemForm((f) => ({ ...f, qty: liveFormatQty(v) }))
            }
            placeholder="۱"
            dir="ltr"
            /* decimal نه numeric: «۱٫۵ کیلو» با کیبوردِ numeric قابلِ
               تایپ نیست (جداکنندهٔ اعشار ندارد). */
            inputMode="decimal"
          />
        </Field>
        <Field label="واحد (اختیاری)">
          <Select
            value={itemForm.unit}
            onChange={(v) => setItemForm((f) => ({ ...f, unit: v }))}
            options={[
              { value: "", label: "—" },
              ...UNIT_PRESETS.map((u) => ({ value: u, label: u })),
            ]}
          />
        </Field>
        <Field label={`قیمت (${cur}) — اختیاری`}>
          <AmountInput
            value={itemForm.price}
            onChange={(v) => setItemForm((f) => ({ ...f, price: v }))}
          />
        </Field>
        <p className="form-note">
          قیمتِ کلِ همین قلم است، نه قیمتِ واحد. خالی بگذارید اگر نمی‌دانید؛
          جمعِ سبد از قیمت‌هایی که نوشته‌اید ساخته می‌شود.
        </p>
        {inventory.length ? (
          <Field label="پیوند به انبار (اختیاری)">
            <Select
              value={itemForm.inventoryItemId}
              onChange={(v) =>
                setItemForm((f) => ({ ...f, inventoryItemId: v }))
              }
              options={inventoryOptions}
            />
          </Field>
        ) : null}
        <Field label="یادداشت (اختیاری)">
          <TextInput
            value={itemForm.note}
            onChange={(v) => setItemForm((f) => ({ ...f, note: v }))}
          />
        </Field>
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => void saveItem()}
        >
          {busy ? "…" : itemEditing ? "ذخیرهٔ تغییرات" : "افزودن"}
        </button>
      </Modal>

      {/* ── بستنِ سفرِ خرید ── */}
      <Modal
        open={tripOpen}
        onClose={() => setTripOpen(false)}
        title="خرید انجام شد"
        dragToClose
      >
        <p className="modal-sub">
          {sum
            ? `${toFa(sum.checked)} قلمِ تیک‌خورده · ${formatAmount(
                toDisplay(sum.checkedTotal, cur),
              )} ${cur}`
            : ""}
        </p>
        {sum?.missingPrice ? (
          <p className="form-note">
            {toFa(sum.missingPrice)} قلم قیمت ندارد، پس جمعِ بالا از خرجِ
            واقعی کم‌تر است. اگر می‌خواهید درست ثبت شود، اول قیمتشان را
            بگذارید.
          </p>
        ) : null}
        {/* متن صریح است چون این کنش سه کار می‌کند و کاربر باید بداند */}
        <p className="modal-sub">
          اقلامِ تیک‌خورده از لیست بیرون می‌روند، یک هزینه در دستهٔ «خرید»
          ساخته می‌شود، و موجودیِ اقلامِ پیوندخورده به انبار بالا می‌رود.
        </p>
        <Field label="خرجش ثبت شود؟">
          <Segmented
            value={tripMode}
            onChange={setTripMode}
            options={[
              { value: "record", label: "بله، ثبت کن" },
              { value: "skip", label: "نه" },
            ]}
          />
        </Field>
        {tripMode === "record" ? (
          <Field label="از کدام حساب؟ (اختیاری)">
            <Select
              value={tripAccount}
              onChange={setTripAccount}
              options={[
                { value: "", label: "مشخص نیست / نقدی" },
                ...accounts.map((a) => ({ value: a.id, label: a.title })),
              ]}
            />
          </Field>
        ) : null}
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => void confirmTrip()}
        >
          {busy ? "…" : "بستنِ خرید"}
        </button>
      </Modal>
    </section>
  );
}

function ItemRow({
  item,
  cur,
  busy,
  onToggle,
  onOpen,
  onDelete,
}: {
  item: ShoppingItem;
  cur: string;
  busy: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  /* دکمه‌های درونی stopPropagation می‌زنند تا لمسشان ویرایش را باز نکند */
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  const meta: string[] = [];
  if (item.qty !== 1 || item.unit) {
    meta.push(`${formatQty(item.qty)}${item.unit ? ` ${item.unit}` : ""}`);
  }
  if (item.note) meta.push(item.note);

  return (
    <div className={`shop-item${item.checked ? " is-checked" : ""}`}>
      <button
        type="button"
        className="shop-check"
        role="checkbox"
        aria-checked={item.checked}
        aria-label={item.checked ? "برداشتن تیک" : "تیک زدن"}
        disabled={busy}
        onClick={stop(onToggle)}
      >
        <span className="shop-box" aria-hidden="true">
          {item.checked ? <Icon name="i-check" size={14} /> : null}
        </span>
      </button>

      <div
        className="shop-body"
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
      >
        <b>{item.title}</b>
        {meta.length ? <p>{meta.join(" · ")}</p> : null}
      </div>

      <div className="shop-side">
        {item.price !== null ? (
          <b className="shop-price">
            {formatAmount(toDisplay(item.price, cur))}
          </b>
        ) : null}
        <button
          type="button"
          className="shop-del"
          aria-label="حذف"
          disabled={busy}
          onClick={stop(onDelete)}
        >
          <Icon name="i-trash" size={15} />
        </button>
      </div>
    </div>
  );
}
