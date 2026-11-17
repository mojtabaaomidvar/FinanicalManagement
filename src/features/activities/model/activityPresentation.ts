import type { Activity, ActivityStatus } from "@/domain/activity/activity.types";

export type ActivityFilter = "all" | ActivityStatus;
const searchText = (text: string) => text.replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/\u200c/g, " ").trim().toLocaleLowerCase("fa");
export function filterActivities(items: Activity[], status: ActivityFilter, query: string): Activity[] {
  const needle = searchText(query);
  return items.filter((item) => (status === "all" || item.status === status)
    && (!needle || searchText(`${item.title} ${item.note ?? ""} ${item.location ?? ""}`).includes(needle)))
    .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}
export const activityStatusLabel = (status: ActivityStatus) => status === "done" ? "انجام‌شده" : status === "cancelled" ? "لغوشده" : "برنامه‌ریزی‌شده";
