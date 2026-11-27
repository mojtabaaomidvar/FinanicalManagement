import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { findInventorySuggestions, INVENTORY_PRESETS, type InventoryCatalogGroup, type InventorySuggestion } from "@/domain/inventory/inventory.catalog";
import { toFa } from "@/shared/lib/digits";
import { Icon } from "@/shared/ui";
import { InventoryCategorySelect } from "./InventoryCategories";

const RESULTS_PAGE = 24;

export function InventorySuggestions({ value, category, onChange, onCategoryChange, inventory, onPick, catalog = INVENTORY_PRESETS }: {
  value: string; category: InventoryCatalogGroup | "";
  onChange: (value: string) => void;
  onCategoryChange: (group: InventoryCatalogGroup | "") => void;
  inventory: readonly { title: string }[];
  onPick: (suggestion: InventorySuggestion) => void;
  catalog?: readonly InventorySuggestion[];
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [lookup, setLookup] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [limit, setLimit] = useState(RESULTS_PAGE);
  const typing = lookup && !!value.trim();
  // Category selection does not hide a matching preset from another category.
  const results = useMemo(() => typing ? findInventorySuggestions(value, null, inventory, catalog) : [], [typing, value, inventory, catalog]);
  const visible = results.slice(0, limit);
  const listId = `${id}-matches`;
  const popupOpen = typing && visible.length > 0;

  useEffect(() => {
    if (activeIndex < 0) listRef.current?.scrollTo({ top: 0 });
    else listRef.current?.children.item(activeIndex)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, value]);

  function closeLookup() { setLookup(false); setActiveIndex(-1); }
  function pick(suggestion: InventorySuggestion) { onPick(suggestion); closeLookup(); }
  function handleKeys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (typing && event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); closeLookup();
    } else if (popupOpen && event.key === "Enter") {
      event.preventDefault();
      if (visible[activeIndex]) pick(visible[activeIndex]);
      else closeLookup();
    } else if (event.key === "Enter") {
      // Enter in the name is never an inventory save, including unmatched names.
      event.preventDefault();
      closeLookup();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!typing && value.trim()) { event.preventDefault(); setLookup(true); return; }
      if (!popupOpen) return;
      event.preventDefault();
      setActiveIndex(event.key === "ArrowDown" ? (activeIndex + 1) % visible.length
        : activeIndex <= 0 ? visible.length - 1 : activeIndex - 1);
    }
  }

  return <div className="inv-catalog" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closeLookup();
  }}>
    <div className="inv-name-field"><label htmlFor={`${id}-name`}>نام قلم انبار</label>
      <div className="inv-catalog-input-wrap">
        <input id={`${id}-name`} ref={inputRef} className="text-input inv-catalog-name-input" value={value} maxLength={120}
          autoComplete="off" dir={value.trim() ? "auto" : "rtl"} role="combobox" aria-label="نام قلم انبار" aria-autocomplete="list"
          aria-expanded={popupOpen} aria-controls={popupOpen ? listId : undefined}
          aria-activedescendant={popupOpen && visible[activeIndex] ? `${listId}-${activeIndex}` : undefined}
          placeholder="مثلاً برنج یا دستمال…" onChange={event => {
            onChange(event.target.value); setLookup(true); setActiveIndex(-1); setLimit(RESULTS_PAGE);
          }} onKeyDown={handleKeys} />
        {typing && <div className="inv-lookup" onTouchStart={event => event.stopPropagation()}>
          <div className="inv-lookup-tools"><p role="status">{results.length
            ? /* @copy-text inventory.suggestions_count */ `${toFa(results.length)} قلم پیشنهادی`
            : "پیشنهادی پیدا نشد؛ نام خودتان را ثبت کنید."}</p>
            <button type="button" className="inv-lookup-close" aria-label="بستن پیشنهادهای نام" onClick={() => {
              closeLookup(); inputRef.current?.focus();
            }}><Icon name="i-x" size={18} /></button></div>
          {popupOpen && <ul id={listId} ref={listRef} className="inv-catalog-list" role="listbox" aria-label="پیشنهادهای نام کالا">
            {visible.map((suggestion, index) => <li key={suggestion.id ?? suggestion.title} role="presentation">
              <button id={`${listId}-${index}`} type="button" role="option" aria-selected={index === activeIndex}
                onPointerDown={event => event.preventDefault()}
                onClick={() => { pick(suggestion); inputRef.current?.focus({ preventScroll: true }); }}>
                <bdi>{suggestion.title}</bdi></button></li>)}
          </ul>}
          {results.length > limit && <button type="button" className="btn-ghost inv-catalog-more" onClick={() => {
            setLimit(previous => previous + RESULTS_PAGE); setActiveIndex(limit);
          }}>پیشنهادهای بیشتر</button>}
        </div>}
      </div>
    </div>
    <InventoryCategorySelect value={category} onChange={onCategoryChange} />
  </div>;
}
