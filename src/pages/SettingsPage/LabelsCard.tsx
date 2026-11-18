/* برچسب‌ها — فیچر مستقل (جدا از دسته‌ها)
   ───────────────────────────────────────
   برچسب = زیردستهٔ آزاد زیر یک دسته (مثل «نان» زیر خورد و خوراک).
   افزودن و حذف دکمه‌ای؛ داده از RPCهای خانواده‌محور می‌آید، پس هر
   برچسبی فقط برای همان خانواده ثبت و دیده می‌شود. */

import { useMemo, useRef, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { Card, Field, Select, TextInput } from "@/shared/ui";
import { CATEGORIES } from "@/domain/category/category.catalog";
import { toFa } from "@/shared/lib/digits";

export function LabelsCard() {
  const { useCases, customCategories, subcategories, txs, refreshData } = useApp();
  const { show } = useToast();

  /* دسته‌های قابل‌انتخاب برای برچسب — انتقال برچسب نمی‌گیرد */
  const options = useMemo(() => {
    const base = CATEGORIES.filter((c) => c.type !== "transfer").map((c) => ({
      value: c.id,
      label: c.name,
    }));
    const customs = customCategories.map((c) => ({
      value: c.id,
      label: c.type === "income" ? `${c.name} (درآمد)` : `${c.name} (هزینه)`,
    }));
    return [...base, ...customs];
  }, [customCategories]);

  const [category, setCategory] = useState(options[0]?.value ?? "food");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const selectedCategory = options.some(option => option.value === category) ? category : "";

  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of CATEGORIES) map.set(c.id, c.name);
    for (const option of options) map.set(option.value, option.label);
    return (id: string) => map.get(id) ?? "دستهٔ حذف‌شده";
  }, [options]);

  /* برچسب‌ها زیر نام دستهٔ والدشان گروه می‌شوند */
  const grouped = useMemo(() => {
    const map = new Map<string, { id: string; name: string; items: typeof subcategories }>();
    for (const s of subcategories) {
      const g = map.get(s.category) ?? { id: s.category, name: nameOf(s.category), items: [] };
      g.items.push(s);
      map.set(s.category, g);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "fa"));
  }, [subcategories, nameOf]);

  async function add() {
    if (!useCases || writing.current) return;
    const trimmed = name.trim();
    if (!selectedCategory) return setNotice("دستهٔ برچسب را انتخاب کنید");
    if (!trimmed) return setNotice("نام برچسب را بنویسید");
    if (trimmed.length > 30) return setNotice("نام برچسب حداکثر ۳۰ کاراکتر است");

    const exists = subcategories.some(
      (s) => s.category === selectedCategory && s.name === trimmed,
    );
    if (exists) {
      return setNotice(`برچسب «${trimmed}» زیر این دسته از قبل هست`);
    }

    writing.current = true;
    setBusy(true);
    setNotice(null);
    let added = false;
    try {
      await useCases.addSubcategory.execute(selectedCategory, trimmed);
      added = true;
      setName("");
      show("برچسب اضافه شد");
      await refreshData();
    } catch (e) {
      setNotice(added ? "برچسب اضافه شد؛ اطلاعات صفحه تازه نشد. صفحه را بازخوانی کنید" : (e as Error).message || "خطا در افزودن برچسب");
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  async function remove(id: string, label: string) {
    if (!useCases || writing.current) return;
    const used = txs.filter(transaction => transaction.subcategoryId === id).length;
    const confirmation = used
      ? /* @copy-text labels.remove_used */ `برچسب «${label}» از ${toFa(used)} تراکنش برداشته شود؟ مبلغ و حساب تغییر نمی‌کند.`
      : /* @copy-text labels.remove */ `برچسب «${label}» حذف شود؟`;
    if (!confirm(confirmation)) return;
    writing.current = true;
    setBusy(true);
    setNotice(null);
    let deleted = false;
    try {
      await useCases.deleteSubcategory.execute(id);
      deleted = true;
      show("برچسب حذف شد");
      await refreshData();
    } catch (e) {
      setNotice(deleted ? "برچسب حذف شد؛ اطلاعات صفحه تازه نشد. صفحه را بازخوانی کنید" : (e as Error).message || "خطا در حذف برچسب");
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  return (
    <fieldset className="category-fields" disabled={busy} aria-busy={busy}>
      <Card title="برچسب جدید">
        <div className="form-grid">
          <div className="form-row full">
            <Field label="زیر کدام دسته؟">
              <Select value={selectedCategory} onChange={value => { if (!writing.current) { setCategory(value); setNotice(null); } }} options={[{ value: "", label: "انتخاب دسته…" }, ...options]} aria-label="دستهٔ برچسب" />
            </Field>
          </div>
        </div>

        <form className="chip-adder" onSubmit={event => { event.preventDefault(); void add(); }}>
          <TextInput
            value={name}
            onChange={value => { if (!writing.current) { setName(value); setNotice(null); } }}
            aria-label="نام برچسب جدید"
            placeholder="مثلاً: نان، قسط وام، بنزین"
            maxLength={30}
          />
          <button
            type="submit"
            className="btn-primary"
            disabled={busy || !name.trim()}
          >
            {busy ? "در حال ذخیره…" : "افزودن"}
          </button>
        </form>
        {notice !== null ? <p className="field-error category-save-notice" role="status">{notice}</p> : null}

        <p className="modal-sub" style={{ marginTop: 10 }}>
          برچسب، جزئیات یک دسته را مشخص می‌کند و موقع ثبت تراکنش پیشنهاد
          می‌شود. برچسب‌های شما فقط در خانوادهٔ خودتان دیده می‌شود.
        </p>
      </Card>

      <Card title="برچسب‌های ثبت‌شده">
        {grouped.length ? (
          <div className="label-groups">
            {grouped.map((g) => (
              <div className="label-group" key={g.id}>
                <h5>{g.name}</h5>
                <div className="label-chips">
                  {g.items.map((s) => (
                    <span className="label-chip removable" key={s.id}>
                      <span className="label-chip-name">{s.name}</span>
                      <button
                        type="button"
                        aria-label={`حذف ${s.name}`}
                        disabled={busy}
                        onClick={() => void remove(s.id, s.name)}
                      >
                        <svg>
                          <use href="#i-x" />
                        </svg>
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="modal-sub">
            هنوز برچسبی ندارید — از کادر بالا اولین برچسب را اضافه کنید.
          </p>
        )}
      </Card>
    </fieldset>
  );
}
