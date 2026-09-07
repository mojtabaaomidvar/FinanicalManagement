/* قواعد خانواده — نسبت اعضا با مدیر خانواده
   ─────────────────────────────────────────
   نسبت همیشه «نسبت به مدیر خانواده» است، نه نسبت به کاربری که دارد
   نگاه می‌کند. پس یک عضو، در پنل خودش و در فهرست اعضا، همان یک نسبت را
   می‌بیند. تا پیش از این هر جا سلیقه‌ای محاسبه می‌شد و برای اعضای
   pending هم اصلاً نمایش داده نمی‌شد؛ این توابع تنها مرجع نمایش‌اند. */

import type { Member } from "./family.types";

/** برچسب نسبت یک عضو با مدیر خانواده — برای نمایش در همه‌جا.
    نسبتِ خود مدیر «خودم» است که معنای مفیدی ندارد، پس «مدیر خانواده»
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
