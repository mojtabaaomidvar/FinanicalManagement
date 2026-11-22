import { useId } from "react";
import type { InventoryItem } from "@/domain/shopping/shopping.types";
import { inventoryCategory, INVENTORY_CATALOG_SECTIONS, type InventoryCatalogGroup,
  type InventoryCatalogSection } from "@/domain/inventory/inventory.catalog";
import { INVENTORY_GROUP_LABELS, INVENTORY_SECTION_LABELS } from "@/domain/inventory/inventory.labels";
import { toFa } from "@/shared/lib/digits";

export type InventorySectionFilter = InventoryCatalogSection | "uncategorized" | null;

export function InventoryCategorySelect({ value, onChange }: {
  value: InventoryCatalogGroup | ""; onChange: (group: InventoryCatalogGroup | "") => void;
}) {
  const id = useId();
  return <div className="inv-category-field"><label htmlFor={id}>دسته</label>
    <select id={id} className="text-input" aria-label="دستهٔ قلم انبار" value={value}
      onChange={event => onChange(event.target.value as InventoryCatalogGroup | "")}>
      <option value="">انتخاب دسته</option>
      {(Object.keys(INVENTORY_CATALOG_SECTIONS) as InventoryCatalogSection[]).map(section =>
        <optgroup key={section} label={INVENTORY_SECTION_LABELS[section]}>
          {INVENTORY_CATALOG_SECTIONS[section].map(group =>
            <option key={group} value={group}>{INVENTORY_GROUP_LABELS[group]}</option>)}
        </optgroup>)}
    </select></div>;
}

export function InventoryCategories({ inventory, section, subgroup, onChange }: {
  inventory: readonly InventoryItem[]; section: InventorySectionFilter; subgroup: InventoryCatalogGroup | null;
  onChange: (section: InventorySectionFilter, subgroup: InventoryCatalogGroup | null) => void;
}) {
  const id = useId();
  const counts = new Map<InventoryCatalogGroup | null, number>();
  for (const item of inventory) {
    const category = inventoryCategory(item);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  const groups = section && section !== "uncategorized" ? INVENTORY_CATALOG_SECTIONS[section] : null;
  return <div className="inv-categories">
    <div className="inv-categories-heading"><h2>دسته‌های انبار</h2>
      {section !== null && <button type="button" className="btn-ghost" onClick={() => onChange(null, null)}>همهٔ دسته‌ها</button>}</div>
    <div className="inv-category-tiles" aria-label="دسته‌های موجودی ثبت‌شده">
      {(Object.keys(INVENTORY_CATALOG_SECTIONS) as InventoryCatalogSection[]).map(key => {
        const count = INVENTORY_CATALOG_SECTIONS[key].reduce((total, group) => total + (counts.get(group) ?? 0), 0);
        return <button key={key} type="button" aria-expanded={section === key}
          aria-controls={section === key ? id : undefined} onClick={() => onChange(section === key ? null : key, null)}>
          <span>{INVENTORY_SECTION_LABELS[key]}</span><bdi>{toFa(count)}</bdi></button>;
      })}
      {!!counts.get(null) && <button type="button" aria-pressed={section === "uncategorized"}
        onClick={() => onChange(section === "uncategorized" ? null : "uncategorized", null)}>
        <span>بدون دسته</span><bdi>{toFa(counts.get(null)!)}</bdi></button>}
    </div>
    {groups && <div id={id} className="inv-category-subgroups" role="group" aria-label="زیرگروه‌های موجودی">
      <button type="button" aria-pressed={subgroup === null} onClick={() => onChange(section, null)}>همهٔ این دسته</button>
      {groups.map(group => <button key={group} type="button" aria-pressed={subgroup === group}
        onClick={() => onChange(section, group)}>{INVENTORY_GROUP_LABELS[group]} <bdi>{toFa(counts.get(group) ?? 0)}</bdi></button>)}
    </div>}
  </div>;
}
