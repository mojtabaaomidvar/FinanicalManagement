/* دسته‌ها — فیچر مستقل (جدا از برچسب‌ها)
   ────────────────────────────────────────
   افزودن و حذف دکمه‌ای دستهٔ دلخواه. هر دسته‌ای که اینجا ساخته شود از
   RPCهای خانواده‌محور می‌آید و فقط برای همین خانواده ثبت و دیده می‌شود.
   دسته‌های پیش‌فرض کاتالوگ برنامه‌اند و حذف نمی‌شوند. */

import { useMemo, useState } from "react";
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
  const { useCases, customCategories, txs, refreshData } = useApp();
  const { show } = useToast();

  const [type, setType] = useState<CatType>("expense");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

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
    const trimmed = name.trim();
    if (!trimmed) return show("نام دسته را بنویسید");
    if (trimmed.length > 30) return show("نام دسته حداکثر ۳۰ کاراکتر است");

    const exists =
      builtin.some((c) => c.name === trimmed) ||
      mine.some((c) => c.name === trimmed);
    if (exists) return show(`دستهٔ «${trimmed}» از قبل وجود دارد`);

    setBusy(true);
    try {
      await useCases!.addCustomCategory.execute(type, trimmed);
      setName("");
      show("دسته اضافه شد");
      await refreshData();
    } catch (e) {
      show((e as Error).message || "خطا در افزودن دسته");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, label: string) {
    const used = usage.get(id) ?? 0;
    if (used > 0) {
      return show(
        `دستهٔ «${label}» در ${toFa(used)} تراکنش به‌کار رفته و حذف نمی‌شود`,
      );
    }
    if (!confirm(`دستهٔ «${label}» حذف شود؟`)) return;

    setBusy(true);
    try {
      await useCases!.deleteCustomCategory.execute(id);
      show("دسته حذف شد");
      await refreshData();
    } catch (e) {
      show((e as Error).message || "خطا در حذف دسته");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card
        title="دسته‌های خودم"
        action={<span className="badge">{toFa(mine.length)} دسته</span>}
      >
        <Segmented value={type} onChange={setType} options={TYPE_TABS} />

        <div className="chip-adder">
          <TextInput
            value={name}
            onChange={setName}
            placeholder={
              type === "expense" ? "مثلاً: شارژ ساختمان" : "مثلاً: اجاره ملک"
            }
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

        {mine.length ? (
          <div className="label-chips">
            {mine.map((c) => {
              const used = usage.get(c.id) ?? 0;
              return (
                <span className="label-chip removable" key={c.id}>
                  <svg>
                    <use href={`#${CUSTOM_CATEGORY_ICON}`} />
                  </svg>
                  {c.name}
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
              {c.name}
            </span>
          ))}
        </div>
        <p className="modal-sub" style={{ marginTop: 10 }}>
          این دسته‌ها بخشی از خود برنامه‌اند و حذف نمی‌شوند.
        </p>
      </Card>
    </>
  );
}
