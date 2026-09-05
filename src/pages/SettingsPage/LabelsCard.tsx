/* دسته‌های سفارشی و برچسب‌ها — زیرصفحه تنظیمات
   ─────────────────────────────────────────────
   هر دو از دل شیت ثبت تراکنش ساخته می‌شوند و تا امروز جایی برای
   مرور یا پاک‌سازی‌شان نبود. دسته سفارشی حذف‌شدنی نیست (تراکنش‌های
   قدیمی به id آن ارجاع دارند)، اما برچسب حذف‌شدنی است. */

import { useMemo } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { Card } from "@/shared/ui";
import { CATEGORIES, CUSTOM_CATEGORY_ICON } from "@/domain/category/category.catalog";

export function LabelsCard() {
  const { useCases, customCategories, subcategories, refreshData } = useApp();
  const { show } = useToast();

  /* برچسب‌ها زیر نام دستهٔ والدشان گروه می‌شوند */
  const grouped = useMemo(() => {
    const nameOf = (id: string) =>
      CATEGORIES.find((c) => c.id === id)?.name ??
      customCategories.find((c) => c.id === id)?.name ??
      "دستهٔ حذف‌شده";

    const map = new Map<string, { name: string; items: typeof subcategories }>();
    for (const s of subcategories) {
      const g = map.get(s.category) ?? { name: nameOf(s.category), items: [] };
      g.items.push(s);
      map.set(s.category, g);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "fa"));
  }, [subcategories, customCategories]);

  async function removeLabel(id: string, name: string) {
    if (!confirm(`برچسب «${name}» حذف شود؟ تراکنش‌های قبلی دست‌نخورده می‌مانند.`)) {
      return;
    }
    try {
      await useCases!.deleteSubcategory.execute(id);
      show("برچسب حذف شد");
      await refreshData();
    } catch (e) {
      show((e as Error).message || "خطا در حذف برچسب");
    }
  }

  return (
    <>
      <Card title="دسته‌های سفارشی">
        {customCategories.length ? (
          <div className="label-chips">
            {customCategories.map((c) => (
              <span className="label-chip" key={c.id}>
                <svg>
                  <use href={`#${CUSTOM_CATEGORY_ICON}`} />
                </svg>
                {c.name}
                <i>{c.type === "income" ? "درآمد" : "هزینه"}</i>
              </span>
            ))}
          </div>
        ) : (
          <p className="modal-sub">
            دستهٔ سفارشی ندارید — موقع ثبت تراکنش، در انتهای فهرست دسته‌ها
            «دستهٔ جدید» را بزنید.
          </p>
        )}
        <p className="modal-sub" style={{ marginTop: 10 }}>
          دستهٔ سفارشی حذف نمی‌شود؛ تراکنش‌های ثبت‌شده به آن ارجاع دارند.
        </p>
      </Card>

      <Card title="برچسب‌ها">
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
                        onClick={() => void removeLabel(s.id, s.name)}
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
            برچسبی ثبت نشده — موقع ثبت تراکنش می‌توانید برچسب دلخواه اضافه
            کنید (مثل «نان»، «قسط وام»).
          </p>
        )}
      </Card>
    </>
  );
}
