/* برچسب‌ها — فیچر مستقل (جدا از دسته‌ها)
   ───────────────────────────────────────
   برچسب = زیردستهٔ آزاد زیر یک دسته (مثل «نان» زیر خورد و خوراک).
   افزودن و حذف دکمه‌ای؛ داده از RPCهای خانواده‌محور می‌آید، پس هر
   برچسبی فقط برای همان خانواده ثبت و دیده می‌شود. */

import { useMemo, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { Card, Field, Select, TextInput } from "@/shared/ui";
import { CATEGORIES } from "@/domain/category/category.catalog";

export function LabelsCard() {
  const { useCases, customCategories, subcategories, refreshData } = useApp();
  const { show } = useToast();

  /* دسته‌های قابل‌انتخاب برای برچسب — انتقال برچسب نمی‌گیرد */
  const options = useMemo(() => {
    const base = CATEGORIES.filter((c) => c.type !== "transfer").map((c) => ({
      value: c.id,
      label: c.name,
    }));
    const customs = customCategories.map((c) => ({
      value: c.id,
      label: `${c.name} (دستهٔ خودم)`,
    }));
    return [...base, ...customs];
  }, [customCategories]);

  const [category, setCategory] = useState(options[0]?.value ?? "food");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of CATEGORIES) map.set(c.id, c.name);
    for (const c of customCategories) map.set(c.id, c.name);
    return (id: string) => map.get(id) ?? "دستهٔ حذف‌شده";
  }, [customCategories]);

  /* برچسب‌ها زیر نام دستهٔ والدشان گروه می‌شوند */
  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; items: typeof subcategories }>();
    for (const s of subcategories) {
      const g = map.get(s.category) ?? { name: nameOf(s.category), items: [] };
      g.items.push(s);
      map.set(s.category, g);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "fa"));
  }, [subcategories, nameOf]);

  async function add() {
    const trimmed = name.trim();
    if (!trimmed) return show("نام برچسب را بنویسید");
    if (trimmed.length > 30) return show("نام برچسب حداکثر ۳۰ کاراکتر است");

    const exists = subcategories.some(
      (s) => s.category === category && s.name === trimmed,
    );
    if (exists) {
      return show(`برچسب «${trimmed}» زیر این دسته از قبل هست`);
    }

    setBusy(true);
    try {
      await useCases!.addSubcategory.execute(category, trimmed);
      setName("");
      show("برچسب اضافه شد");
      await refreshData();
    } catch (e) {
      show((e as Error).message || "خطا در افزودن برچسب");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, label: string) {
    if (!confirm(`برچسب «${label}» حذف شود؟ تراکنش‌های قبلی دست‌نخورده می‌مانند.`)) {
      return;
    }
    setBusy(true);
    try {
      await useCases!.deleteSubcategory.execute(id);
      show("برچسب حذف شد");
      await refreshData();
    } catch (e) {
      show((e as Error).message || "خطا در حذف برچسب");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card title="برچسب تازه">
        <div className="form-grid">
          <div className="form-row full">
            <Field label="زیر کدام دسته؟">
              <Select value={category} onChange={setCategory} options={options} />
            </Field>
          </div>
        </div>

        <div className="chip-adder">
          <TextInput
            value={name}
            onChange={setName}
            placeholder="مثلاً: نان، قسط وام، بنزین"
            maxLength={30}
          />
          <button
            type="button"
            className="btn-primary"
            disabled={busy || !name.trim()}
            onClick={() => void add()}
          >
            افزودن
          </button>
        </div>

        <p className="modal-sub" style={{ marginTop: 10 }}>
          برچسب، جزئیات یک دسته را مشخص می‌کند و موقع ثبت تراکنش پیشنهاد
          می‌شود. برچسب‌های شما فقط در خانوادهٔ خودتان دیده می‌شود.
        </p>
      </Card>

      <Card title="برچسب‌های ثبت‌شده">
        {grouped.length ? (
          <div className="label-groups">
            {grouped.map((g) => (
              <div className="label-group" key={g.name}>
                <h5>{g.name}</h5>
                <div className="label-chips">
                  {g.items.map((s) => (
                    <span className="label-chip removable" key={s.id}>
                      {s.name}
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
    </>
  );
}
