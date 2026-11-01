/* اینترفیس مخزن خانواده — پیاده‌سازی در infrastructure/repositories */

import type {
  Family,
  JoinRequest,
  Member,
  ProfileInput,
} from "./family.types";

export interface FamilyRepository {
  getFamily(): Promise<Family>;
  getMembers(): Promise<Member[]>;
  /** سقف بودجه ماهانه خانواده — فقط مدیر خانواده.
      از v5.8 واحد پول و تم اینجا نیستند؛ هر دو شخصی شده‌اند
      (setCurrency و setTheme). */
  setMonthlyBudget(budget: number): Promise<void>;
  removeMember(memberId: string): Promise<void>;
  /** ویرایش پروفایل خود کاربر */
  updateOwnProfile(input: ProfileInput): Promise<Member>;
  /** افزودن عضو توسط مدیر (اسم، شماره و نسبت — عضو pending) */
  addMemberByManager(name: string, phone: string, relation: string): Promise<Member>;
  /** تغییر سریع تم شخصی */
  setTheme(theme: "light" | "dark" | "auto"): Promise<void>;
  /** تغییر واحد پول نمایشی شخصی — عضو به‌روزشده را برمی‌گرداند
      تا کلاینت بدون refreshData کامل، بی‌درنگ نمایش را عوض کند */
  setCurrency(currency: string): Promise<Member>;
  /** تغییر نسبت یک عضو با مدیر خانواده — مدیر همه، عضو فقط خودش */
  setMemberRelation(memberId: string, relation: string): Promise<Member>;

  /* ── §۲.۶ تأییدِ عضویت — هر سه فقط برای مدیر ──────────────────
     سرور با require_admin_tenant می‌بندد؛ پنهان‌کردنِ دکمه در UI فقط
     برای تمیزیِ تجربه است و هیچ نقشِ امنیتی ندارد. */

  /** درخواست‌های پیوستنِ در‌انتظارِ این خانواده (به‌ترتیبِ قدیمی به تازه) */
  listJoinRequests(): Promise<JoinRequest[]>;
  /** تأیید — عضویتِ متقاضی active می‌شود و از آن پس می‌تواند وارد شود */
  approveJoinRequest(requestId: string): Promise<Member>;
  /** رد — عضویت rejected می‌شود؛ ردیف برای ممیزی می‌ماند و پاک نمی‌شود */
  rejectJoinRequest(requestId: string): Promise<void>;
}
