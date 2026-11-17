import type { Member } from "@/domain/family/family.types";
import type { Activity, ActivityInput } from "./activity.types";

export function isActivityDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const day = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === value;
}

/** Introduced children are selectable even before registering their own account. */
export function activityParticipants(members: Member[], familyId: string): Member[] {
  return members.filter((member) => member.familyId === familyId && member.membershipState === "active");
}

export function activityError(input: ActivityInput, allowedParticipants?: readonly string[]): string {
  if (!input.title.trim()) return "عنوان برنامه را بنویسید.";
  if (input.title.trim().length > 120) return "عنوان باید حداکثر ۱۲۰ نویسه باشد.";
  if ((input.note?.trim().length ?? 0) > 2000) return "توضیح باید حداکثر ۲۰۰۰ نویسه باشد.";
  if ((input.location?.trim().length ?? 0) > 180) return "مکان باید حداکثر ۱۸۰ نویسه باشد.";
  if (!isActivityDay(input.date)) return "تاریخ برنامه را انتخاب کنید.";
  if (!["planned", "done", "cancelled"].includes(input.status)) return "وضعیت برنامه معتبر نیست.";
  if (typeof input.reminderEnabled !== "boolean") return "تنظیم یادآور معتبر نیست.";
  if (!Array.isArray(input.participantIds) || input.participantIds.length > 50
    || input.participantIds.some((id) => typeof id !== "string" || !id.trim())
    || new Set(input.participantIds).size !== input.participantIds.length) return "حداکثر ۵۰ شرکت‌کنندهٔ متفاوت انتخاب کنید.";
  if (allowedParticipants && input.participantIds.some((id) => !allowedParticipants.includes(id))) return "شرکت‌کنندگان را از اعضای فعال خانواده انتخاب کنید.";
  return "";
}

export function activityInput(activity: Activity): ActivityInput {
  return { title: activity.title, note: activity.note, date: activity.date, location: activity.location,
    status: activity.status, participantIds: [...activity.participantIds], reminderEnabled: activity.reminderEnabled };
}
