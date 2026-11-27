import { BANK_CATALOG } from "./bankCatalog";
import { toEn } from "./digits";

// Existing stored names remain valid when official wording differs.
const BANK_ALIASES: Record<string, string> = {
  "بانک ملی": "melli", "بانک صادرات": "saderat", "بانک رفاه": "refah",
  "بانک ایران‌زمین": "iran-zamin", "بانک توسعه صادرات": "tosee-saderat",
  "بانک انصاری": "sepah", "بانک انصار": "sepah", "بانک حکمت": "sepah",
};
export const BANK_NAMES = BANK_CATALOG.map(bank => bank.value);
export const BANK_OPTIONS = BANK_CATALOG.map(bank => ({ value: bank.value, label: bank.label }));
export const BANK_BINS = Object.fromEntries(BANK_CATALOG.map(bank => [bank.value, bank.bins]));
export function bankEntryFor(value: string) {
  return BANK_CATALOG.find(bank => bank.value === value || bank.id === value || bank.id === BANK_ALIASES[value]);
}
export function bankDisplayLabel(value: string): string { return bankEntryFor(value)?.label ?? value; }
function cardCandidates(cardNumber: string) {
  const digits = toEn(cardNumber).replace(/\D/g, "");
  if (digits.length < 6) return [];
  const matching = BANK_CATALOG.flatMap(bank => bank.bins
    .filter(bin => digits.startsWith(bin)).map(bin => ({ bank, length: bin.length })));
  const longest = Math.max(0, ...matching.map(item => item.length));
  return matching.filter(item => item.length === longest).map(item => item.bank);
}
/** Shared prefixes require a choice; eight digits take priority over six. */
export function bankOfCard(cardNumber: string): string | null {
  const candidates = cardCandidates(cardNumber);
  return candidates.length === 1 ? candidates[0].value : null;
}
export function cardMatchesBank(cardNumber: string, value: string): boolean {
  const selected = bankEntryFor(value), candidates = cardCandidates(cardNumber);
  if (!selected || !candidates.length) return true;
  return candidates.some(bank => bank.id === selected.id || bank.parentId === selected.id
    || selected.parentId === bank.id || (!!selected.parentId && selected.parentId === bank.parentId));
}
