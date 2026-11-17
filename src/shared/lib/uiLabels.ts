import { MEMBER_RELATIONS } from "@/domain/family/family.types";

// Display names stay separate from values stored by forms and money calculations.
const displayUnitLabels = { toman: "تومان", rial: "ریال" };
const memberDisplayLabels = ["خودم", "همسر", "فرزند", "پدر/مادر", "خواهر/برادر", "سایر"];

export function currencyDisplayLabel(value: string | null | undefined): string {
  if (!value || value === "تومان") return displayUnitLabels.toman;
  return value === "ریال" ? displayUnitLabels.rial : value;
}

export function memberRelationLabel(value: string): string {
  const index = MEMBER_RELATIONS.indexOf(value as typeof MEMBER_RELATIONS[number]);
  return index < 0 ? value : memberDisplayLabels[index];
}
