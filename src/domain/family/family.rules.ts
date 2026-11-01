/* قواعد خانواده — نسبت اعضا با مدیر خانواده
   ─────────────────────────────────────────
   نسبت همیشه «نسبت به مدیر خانواده» است، نه نسبت به کاربری که دارد
   نگاه می‌کند. پس یک عضو، در پنل خودش و در فهرست اعضا، همان یک نسبت را
   می‌بیند. تا پیش از این هر جا سلیقه‌ای محاسبه می‌شد و برای اعضای
   pending هم اصلاً نمایش داده نمی‌شد؛ این توابع تنها مرجع نمایش‌اند. */

import type { Member } from "./family.types";

/** برچسب نسبت یک عضو با مدیر خانواده — برای نمایش در همه‌جا.
    نسبت خود مدیر «خودم» است که معنای مفیدی ندارد، پس «مدیر خانواده»
    نشان داده می‌شود. اگر نسبت عضوی ثبت نشده باشد «نسبت ثبت نشده» است
    تا با «سایر» (که یک انتخاب واقعی است) اشتباه گرفته نشود. */
export function relationLabel(m: Pick<Member, "role" | "relation">): string {
  if (m.role === "owner") return "مدیر خانواده";
  const r = (m.relation ?? "").trim();
  if (!r || r === "خودم") return "نسبت ثبت نشده";
  return r;
}

/** آیا actor می‌تواند نسبت target را عوض کند؟
    مدیر: نسبت همه‌ی اعضا جز خودش. عضو عادی: فقط نسبت خودش.
    نسبت مدیر ثابت است (سرور هم OWNER_RELATION_FIXED می‌دهد). */
export function canEditRelation(
  actor: Pick<Member, "id" | "role"> | null,
  target: Pick<Member, "id" | "role">,
): boolean {
  if (!actor) return false;
  if (target.role === "owner") return false;
  return actor.role === "owner" || actor.id === target.id;
}

/* ── §۲.۵/§۲.۶ وضعیتِ عضویت ───────────────────────────────────
   این بخش دربارهٔ محورِ `membershipState` است، نه `status`. تفاوتشان در
   family.types.ts نوشته شده و اشتباه‌گرفتنشان همان چیزی بود که باعث شد
   عضوِ تأییدنشده در فهرستِ اعضا «سالم» دیده شود. */

/** برچسبِ وضعیتِ عضویت — `null` یعنی «نشانی لازم نیست».
 *
 *  متن‌ها عمداً از نگاهِ «مدیر» نوشته نشده‌اند («منتظر تأیید مدیر»، نه «منتظر
 *  تأیید شما»)، چون همین فهرست را اعضای عادی هم می‌بینند.
 *
 *  `active` و `null` هر دو `null` برمی‌گردانند ولی به دو دلیلِ متفاوت:
 *  اولی «تأییدشده است» و دومی «سرور نگفته». هیچ‌کدام نباید نشانی بگیرند —
 *  یکی چون خبری نیست، دیگری چون خبری نداریم. */
export function membershipLabel(
  m: Pick<Member, "membershipState">,
): string | null {
  switch (m.membershipState) {
    case "pending":
      return "منتظر تأیید مدیر";
    case "rejected":
      return "عضویت رد شد";
    case "expired":
      return "عضویت منقضی شد";
    case "suspended":
      return "عضویت معلق شد";
    case "removed":
      return "از خانواده حذف شد";
    case "active":
    case null:
    case undefined:
      return null;
  }
}

/** شمارِ اعضایی که منتظرِ تصمیمِ مدیرند — نشانِ ردیفِ «درخواست‌های عضویت».
 *
 *  از روی `members` (که از قبل در حافظه است) شمرده می‌شود تا باز‌کردنِ
 *  تنظیمات یک درخواستِ شبکهٔ دیگر نیاورد. عمداً «تقریبِ محافظه‌کار» است:
 *  اگر ردیفِ عضوی حذف شده باشد ولی درخواستش مانده باشد، اینجا شمرده
 *  نمی‌شود. برای همین ردیفِ تنظیمات همیشه — حتی با شمارِ صفر — برای مدیر
 *  باز می‌ماند؛ فهرستِ معتبر همان چیزی است که خودِ زیرصفحه از سرور می‌گیرد. */
export function pendingApprovalCount(
  members: Pick<Member, "membershipState">[],
): number {
  return members.filter((m) => m.membershipState === "pending").length;
}
