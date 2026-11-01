/* §۱.۸ — صفحهٔ انبار خانه.

   لیستِ خرید می‌گوید «چه بخریم»، این صفحه می‌گوید «چه داریم». جداییشان
   عمدی است: یک ردیف نمی‌تواند هم‌زمان «نداریمش» و «۲ تا داریم» را بگوید.

   **آستانهٔ صفر یعنی «آستانه ندارد»** — نه کم شمرده می‌شود نه اعلان
   می‌دهد. قلمی که کاربر آستانه‌اش را تعیین نکرده نباید خودسرانه زنگ بزند؛
   همین قاعده در `domain/shopping/shopping.rules.ts::isLow` و در
   `backend/app/services/inventory.py::is_low` هم هست و سه‌تایی باید یکی
   بمانند.

   دکمهٔ «به لیست اضافه کن» پیوندِ `inventoryItemId` را می‌سازد؛ بستنِ سفرِ
   خرید بعداً همین موجودی را بالا می‌برد. این همان چیزی است که «اقلامِ
   همیشگی» را بی‌جدولِ سوم حل می‌کند. */

import { useMemo, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { Card, Field, Icon, Modal, Select, TextInput } from "@/shared/ui";
import type { InventoryItem } from "@/domain/shopping/shopping.types";
import { UNIT_PRESETS } from "@/domain/shopping/shopping.types";
import {
  formatQty,
  isLow,
  liveFormatQty,
  parseQty,
  queuedInventoryIds,
} from "@/domain/shopping/shopping.rules";
import { toFa } from "@/shared/lib/digits";

interface ItemForm {
  title: string;
  unit: string;
  quantity: string;
  threshold: string;
  note: string;
}

const EMPTY: ItemForm = {
  title: "",
  unit: "",
  quantity: "۰",
  threshold: "۰",
  note: "",
};

export function InventoryPage() {
  const { useCases, inventory, shoppingLists, refreshData } = useApp();
  const { show } = useToast();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [form, setForm] = useState<ItemForm>(EMPTY);
  const [busy, setBusy] = useState(false);

  /* قلمی که منتظرِ انتخابِ لیست است (وقتی بیش از یک لیست داریم) */
  const [sending, setSending] = useState<InventoryItem | null>(null);
  const [sendList, setSendList] = useState("");

  /* ترتیب از سرور می‌آید (کم‌شده‌ها اول)، پس این‌جا دوباره مرتب نمی‌کنیم */
  const low = inventory.filter(isLow);
  const rest = inventory.filter((i) => !isLow(i));

  /* اقلامی که همین حالا در یک لیستِ خرید منتظرند — دکمهٔ «به لیست اضافه
     کن» برایشان پنهان می‌شود، وگرنه کاربر دوباره می‌زد و سرور ۴۰۹ می‌داد. */
  const queued = useMemo(
    () => queuedInventoryIds(shoppingLists),
    [shoppingLists],
  );

  function openNew() {
    setEditing(null);
    setForm(EMPTY);
    setOpen(true);
  }

  function openEdit(item: InventoryItem) {
    setEditing(item);
    setForm({
      title: item.title,
      unit: item.unit ?? "",
      quantity: formatQty(item.quantity),
      threshold: formatQty(item.threshold),
      note: item.note ?? "",
    });
    setOpen(true);
  }

  async function save() {
    if (!useCases || busy) return;
    const title = form.title.trim();
    if (!title) {
      show("نام قلم را بنویسید");
      return;
    }
    const input = {
      title,
      unit: form.unit.trim() || null,
      quantity: parseQty(form.quantity),
      threshold: parseQty(form.threshold),
      note: form.note.trim() || null,
    };
    setBusy(true);
    try {
      if (editing) await useCases.updateInventoryItem.execute(editing.id, input);
      else await useCases.addInventoryItem.execute(input);
      await refreshData();
      setOpen(false);
      show(editing ? "به‌روز شد" : "به انبار اضافه شد");
    } catch (e) {
      show((e as Error).message || "ذخیره ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function step(item: InventoryItem, delta: number) {
    if (!useCases || busy) return;
    setBusy(true);
    try {
      await useCases.adjustInventory.execute(item.id, delta);
      await refreshData();
    } catch (e) {
      show((e as Error).message || "تغییر ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: InventoryItem) {
    if (!useCases || busy) return;
    if (!confirm(`«${item.title}» از انبار حذف شود؟`)) return;
    setBusy(true);
    try {
      await useCases.deleteInventoryItem.execute(item.id);
      await refreshData();
      show("حذف شد");
    } catch (e) {
      show((e as Error).message || "حذف ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  /* «به لیست اضافه کن» — با یک لیست بی‌پرسش، با چند لیست یک انتخاب */
  function sendToList(item: InventoryItem) {
    if (!shoppingLists.length) {
      show("اول یک لیستِ خرید بساز");
      return;
    }
    if (shoppingLists.length === 1) {
      void addTo(item, shoppingLists[0].id);
      return;
    }
    setSending(item);
    setSendList(shoppingLists[0].id);
  }

  async function addTo(item: InventoryItem, listId: string) {
    if (!useCases || busy) return;
    setBusy(true);
    try {
      await useCases.addShoppingItem.execute(listId, {
        title: item.title,
        /* مقدارِ پیشنهادی: همان آستانه (یعنی «تا سرِ آستانه پرش کن»).
           بی‌آستانه → یکی. عددِ دلخواه را کاربر در لیست عوض می‌کند. */
        qty: item.threshold > 0 ? item.threshold : 1,
        unit: item.unit,
        inventoryItemId: item.id,
      });
      await refreshData();
      setSending(null);
      show(`«${item.title}» به لیست خرید اضافه شد`);
    } catch (e) {
      show((e as Error).message || "افزودن ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page active">
      <header className="app-header">
        <div className="header-title">
          <h1>انبار خانه</h1>
          <p>چه چیزی داریم و چه چیزی دارد تمام می‌شود</p>
        </div>
      </header>

      <div className="content">
        <Card>
          <div className="bill-summary">
            <p className="bill-summary-label">
              {low.length
                ? `${toFa(low.length)} قلم دارد تمام می‌شود`
                : inventory.length
                  ? "همه‌چیز به‌اندازه هست"
                  : "انبار خالی است"}
            </p>
          </div>
          <button type="button" className="btn-primary" onClick={openNew}>
            افزودن قلم به انبار
          </button>
        </Card>

        {low.length ? (
          <Card title="دارد تمام می‌شود">
            <div className="inv-list">
              {low.map((i) => (
                <InvRow
                  key={i.id}
                  item={i}
                  busy={busy}
                  queued={queued.has(i.id)}
                  onOpen={() => openEdit(i)}
                  onStep={(d) => void step(i, d)}
                  onSend={() => sendToList(i)}
                  onDelete={() => void remove(i)}
                />
              ))}
            </div>
          </Card>
        ) : null}

        {rest.length ? (
          <Card title={low.length ? "بقیه" : "انبار"}>
            <div className="inv-list">
              {rest.map((i) => (
                <InvRow
                  key={i.id}
                  item={i}
                  busy={busy}
                  queued={queued.has(i.id)}
                  onOpen={() => openEdit(i)}
                  onStep={(d) => void step(i, d)}
                  onSend={() => sendToList(i)}
                  onDelete={() => void remove(i)}
                />
              ))}
            </div>
          </Card>
        ) : null}

        {!inventory.length ? (
          <p className="form-note">
            انبار برای چیزهایی است که همیشه باید خانه باشند: برنج، شیر،
            دستمال… برای هرکدام «آستانهٔ کمبود» بگذار تا وقتی کم شد خودمان
            یادت بیاوریم و با یک لمس به لیست خرید اضافه‌اش کنی.
          </p>
        ) : null}
      </div>

      {/* ── فرمِ قلم ── */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "ویرایش قلم انبار" : "قلم تازه"}
        dragToClose
      >
        <Field label="نام">
          <TextInput
            value={form.title}
            onChange={(v) => setForm((f) => ({ ...f, title: v }))}
            placeholder="مثلاً برنج"
          />
        </Field>
        <Field label="واحد (اختیاری)">
          <Select
            value={form.unit}
            onChange={(v) => setForm((f) => ({ ...f, unit: v }))}
            options={[
              { value: "", label: "—" },
              ...UNIT_PRESETS.map((u) => ({ value: u, label: u })),
            ]}
          />
        </Field>
        <Field label="موجودیِ فعلی">
          <TextInput
            value={form.quantity}
            onChange={(v) =>
              setForm((f) => ({ ...f, quantity: liveFormatQty(v) }))
            }
            placeholder="۰"
            dir="ltr"
            inputMode="decimal"
          />
        </Field>
        <Field label="آستانهٔ کمبود">
          <TextInput
            value={form.threshold}
            onChange={(v) =>
              setForm((f) => ({ ...f, threshold: liveFormatQty(v) }))
            }
            placeholder="۰"
            dir="ltr"
            inputMode="decimal"
          />
        </Field>
        <p className="form-note">
          وقتی موجودی به آستانه یا کم‌تر رسید، این قلم «دارد تمام می‌شود»
          می‌شود و در اعلان‌ها می‌آید. آستانهٔ صفر یعنی هیچ‌وقت خبر نده.
        </p>
        <Field label="یادداشت (اختیاری)">
          <TextInput
            value={form.note}
            onChange={(v) => setForm((f) => ({ ...f, note: v }))}
          />
        </Field>
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => void save()}
        >
          {busy ? "…" : editing ? "ذخیرهٔ تغییرات" : "افزودن"}
        </button>
      </Modal>

      {/* ── انتخابِ لیست، وقتی بیش از یکی هست ── */}
      <Modal
        open={sending !== null}
        onClose={() => setSending(null)}
        title="به کدام لیست؟"
        dragToClose
      >
        <p className="modal-sub">{sending?.title ?? ""}</p>
        <Field label="لیست">
          <Select
            value={sendList}
            onChange={setSendList}
            options={shoppingLists.map((l) => ({
              value: l.id,
              label: l.title,
            }))}
          />
        </Field>
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => {
            if (sending) void addTo(sending, sendList);
          }}
        >
          {busy ? "…" : "افزودن به لیست"}
        </button>
      </Modal>
    </section>
  );
}

function InvRow({
  item,
  busy,
  queued,
  onOpen,
  onStep,
  onSend,
  onDelete,
}: {
  item: InventoryItem;
  busy: boolean;
  queued: boolean;
  onOpen: () => void;
  onStep: (delta: number) => void;
  onSend: () => void;
  onDelete: () => void;
}) {
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  const unit = item.unit ? ` ${item.unit}` : "";

  return (
    <div className={`inv-item${isLow(item) ? " is-low" : ""}`}>
      {/* لمسِ بدنه → ویرایش (قاعدهٔ ثبت‌شدهٔ مخزن) */}
      <div
        className="inv-body"
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
        <p>
          {formatQty(item.quantity)}
          {unit}
          {item.threshold > 0
            ? ` · آستانه ${formatQty(item.threshold)}${unit}`
            : " · بی‌آستانه"}
        </p>
      </div>

      <div className="inv-side">
        <div className="inv-step">
          <button
            type="button"
            aria-label="یکی کم کن"
            disabled={busy || item.quantity <= 0}
            onClick={stop(() => onStep(-1))}
          >
            −
          </button>
          <button
            type="button"
            aria-label="یکی اضافه کن"
            disabled={busy}
            onClick={stop(() => onStep(1))}
          >
            +
          </button>
        </div>
        {queued ? (
          <span className="inv-queued">در لیست خرید</span>
        ) : (
          <button
            type="button"
            className="inv-send"
            disabled={busy}
            onClick={stop(onSend)}
          >
            <Icon name="i-cart" size={14} />
            به لیست
          </button>
        )}
        <button
          type="button"
          className="inv-del"
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
