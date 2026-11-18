/* دسته‌ها — فیچر مستقل (جدا از برچسب‌ها)
   ────────────────────────────────────────
   افزودن و حذف دکمه‌ای دستهٔ دلخواه. هر دسته‌ای که اینجا ساخته شود از
   RPCهای خانواده‌محور می‌آید و فقط برای همین خانواده ثبت و دیده می‌شود.
   دسته‌های پیش‌فرض کاتالوگ برنامه‌اند و حذف نمی‌شوند. */

import { useMemo, useRef, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { Card, Segmented, TextInput } from "@/shared/ui";
import {
  CATEGORIES,
  CUSTOM_CATEGORY_ICON,
} from "@/domain/category/category.catalog";
import { toFa } from "@/shared/lib/digits";

type CatType = "expense" | "income";

const TYPE_TABS: { value: CatType; label: string }[] = [
  { value: "expense", label: "هزینه" },
  { value: "income", label: "درآمد" },
];

export function CategoriesCard() {
  const { useCases, customCategories, subcategories, budgets, txs, refreshData } = useApp();
  const { show } = useToast();

  const [type, setType] = useState<CatType>("expense");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);

  const mine = useMemo(
    () => customCategories.filter((c) => c.type === type),
    [customCategories, type],
  );
  const builtin = useMemo(
    () => CATEGORIES.filter((c) => c.type === type),
    [type],
  );

  /* چند تراکنش به هر دسته ارجاع دارد — دستهٔ به‌کاررفته حذف نمی‌شود */
  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of txs) m.set(t.category, (m.get(t.category) ?? 0) + 1);
    return m;
  }, [txs]);

  async function add() {
    if (!useCases || writing.current) return;
    const trimmed = name.trim();
    if (!trimmed) return setNotice("نام دسته را بنویسید");
    if (trimmed.length > 30) return setNotice("نام دسته حداکثر ۳۰ کاراکتر است");

    const exists =
      builtin.some((c) => c.name === trimmed) ||
      mine.some((c) => c.name === trimmed);
    if (exists) return setNotice(`دستهٔ «${trimmed}» از قبل وجود دارد`);

    writing.current = true;
    setBusy(true);
    setNotice(null);
    let added = false;
    try {
      await useCases.addCustomCategory.execute(type, trimmed);
      added = true;
      setName("");
      show("دسته اضافه شد");
      await refreshData();
    } catch (e) {
      setNotice(added ? "دسته اضافه شد؛ اطلاعات صفحه تازه نشد. صفحه را بازخوانی کنید" : (e as Error).message || "خطا در افزودن دسته");
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  async function remove(id: string, label: string) {
    if (!useCases || writing.current) return;
    const used = usage.get(id) ?? 0;
    if (used > 0) {
      return setNotice(
        `دستهٔ «${label}» در ${toFa(used)} تراکنش به‌کار رفته و حذف نمی‌شود`,
      );
    }
    const hasDependencies = subcategories.some(item => item.category === id) || budgets.some(item => item.category === id);
    const confirmation = hasDependencies
      ? /* @copy-text categories.remove_dependencies */ `دستهٔ «${label}» همراه برچسب‌ها و بودجهٔ وابسته حذف شود؟`
      : /* @copy-text categories.remove */ `دستهٔ «${label}» حذف شود؟`;
    if (!confirm(confirmation)) return;

    writing.current = true;
    setBusy(true);
    setNotice(null);
    let deleted = false;
    try {
      await useCases.deleteCustomCategory.execute(id);
      deleted = true;
      show("دسته حذف شد");
      await refreshData();
    } catch (e) {
      setNotice(deleted ? "دسته حذف شد؛ اطلاعات صفحه تازه نشد. صفحه را بازخوانی کنید" : (e as Error).message || "خطا در حذف دسته");
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  return (
    <fieldset className="category-fields" disabled={busy} aria-busy={busy}>
      <Card
        title="دسته‌های خودم"
        action={<span className="badge">{toFa(mine.length)} دسته</span>}
      >
        <Segmented value={type} onChange={value => { if (!writing.current) { setType(value); setNotice(null); } }} options={TYPE_TABS} />

        <form className="chip-adder" onSubmit={event => { event.preventDefault(); void add(); }}>
          <TextInput
            value={name}
            onChange={value => { if (!writing.current) { setName(value); setNotice(null); } }}
            aria-label="نام دستهٔ جدید"
            placeholder={
              type === "expense" ? "مثلاً: شارژ ساختمان" : "مثلاً: اجاره ملک"
            }
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

        {mine.length ? (
          <div className="label-chips">
            {mine.map((c) => {
              const used = usage.get(c.id) ?? 0;
              return (
                <span className="label-chip removable" key={c.id}>
                  <svg>
                    <use href={`#${CUSTOM_CATEGORY_ICON}`} />
                  </svg>
                  <span className="label-chip-name">{c.name}</span>
                  {used ? <i>{toFa(used)} تراکنش</i> : null}
                  <button
                    type="button"
                    aria-label={`حذف ${c.name}`}
                    disabled={busy}
                    onClick={() => void remove(c.id, c.name)}
                  >
                    <svg>
                      <use href="#i-x" />
                    </svg>
                  </button>
                </span>
              );
            })}
          </div>
        ) : (
          <p className="modal-sub">
            هنوز دستهٔ دلخواهی نساخته‌اید — نامش را بنویسید و «افزودن» را
            بزنید.
          </p>
        )}

        <p className="modal-sub" style={{ marginTop: 10 }}>
          دسته‌هایی که اینجا می‌سازید فقط در خانوادهٔ شما دیده می‌شود. دستهٔ
          به‌کاررفته در تراکنش‌ها حذف نمی‌شود.
        </p>
      </Card>

      <Card
        title="دسته‌های پیش‌فرض"
        action={<span className="badge">{toFa(builtin.length)} دسته</span>}
      >
        <div className="label-chips">
          {builtin.map((c) => (
            <span className="label-chip" key={c.id}>
              <svg>
                <use href={`#${c.icon}`} />
              </svg>
              <span className="label-chip-name">{c.name}</span>
            </span>
          ))}
        </div>
        <p className="modal-sub" style={{ marginTop: 10 }}>
          این دسته‌ها بخشی از خود برنامه‌اند و حذف نمی‌شوند.
        </p>
      </Card>
    </fieldset>
  );
}
