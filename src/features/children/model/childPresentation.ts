import type { Child } from "@/domain/child/child.types";
import { toFa } from "@/shared/lib/digits";

export const childAgeLabel = (child: Pick<Child, "ageYears">): string => child.ageYears === null
  ? "سن مشخص نشده" : child.ageYears === 0 ? "کمتر از یک سال" : `${toFa(child.ageYears)} سال`;
export const childStatusLabel = (child: Pick<Child, "status">): string => child.status === "active" ? "حساب فعال" : "ثبت‌شده توسط مدیر";
export function filterChildren(children: Child[], query: string): Child[] {
  const search = query.trim().toLocaleLowerCase("fa");
  return search ? children.filter((child) => child.name.toLocaleLowerCase("fa").includes(search)) : children;
}
