import type { Goal, GoalKind, GoalStatus } from "@/domain/goal/goal.types";

export type GoalKindFilter = "all" | GoalKind;
export type GoalStatusFilter = "all" | GoalStatus;
const searchText = (value: string) => value.replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/\u200c/g, " ").trim().toLocaleLowerCase("fa");

export function filterGoals(items: Goal[], kind: GoalKindFilter, status: GoalStatusFilter, query: string): Goal[] {
  const needle = searchText(query);
  return items.filter((item) => (kind === "all" || item.kind === kind) && (status === "all" || item.status === status)
    && (!needle || searchText(`${item.title} ${item.note ?? ""}`).includes(needle)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

export const goalKindLabel = (kind: GoalKind) => kind === "wish" ? "آرزو" : "هدف";
export const goalStatusLabel = (status: GoalStatus) => status === "done" ? "انجام‌شده" : "فعال";
