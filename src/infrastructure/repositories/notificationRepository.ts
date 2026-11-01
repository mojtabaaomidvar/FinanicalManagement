/* مخزنِ §۷ اعلان‌ها — اندپوینت‌های REST بک‌اند (/notifications/...).

   نام‌گذاری بدون پیشوند «Supabase» است چون از ابتدا REST-محور ساخته شده و
   هرگز روی سوپابیس نبوده (همان قاعدهٔ smsSettingsRepository). */

import type {
  NotificationPrefsPatch,
  NotificationRepository,
  NotificationState,
} from "@/domain/notification/notification.repository";
import type {
  NotificationDomain,
  NotificationPrefs,
} from "@/domain/notification/notification.types";
import { DEFAULT_NOTIFICATION_PREFS } from "@/domain/notification/notification.types";
import type { RestClient } from "@/infrastructure/api/restClient";

type PrefsRow = {
  enabled: boolean;
  domains: Record<string, boolean> | null;
  lead_days: Record<string, number> | null;
  dismissed: string[] | null;
};

/* ── ادغام با پیش‌فرض، نه جانشینیِ آن ──

   سرور فقط کلیدهایی را برمی‌گرداند که کاربر *صریحاً* ثبت کرده (نقشهٔ خالی
   یعنی «هیچ ترجیحی ندارم»). پس نقشهٔ سرور را نمی‌شود عیناً جای پیش‌فرض نشاند:
   آن‌وقت `leadDays` تهی می‌ماند و `safeLead` همه را صفر می‌خواند — یعنی
   «پیش‌هنگام» بی‌صدا از کار می‌افتاد و هیچ اعلانِ «نزدیک»ی ساخته نمی‌شد.

   به همین دلیل روی پیش‌فرض *سوار* می‌شود. مقدارِ غیرعددی/غیربولی هم دور
   انداخته می‌شود تا یک ردیفِ خرابِ JSONB نتواند کلِ منطق را بی‌اثر کند؛
   قاعده‌های دامنه خودشان هم مقاوم‌اند، ولی تمیز‌کردن در مرزِ ورود ارزان‌تر
   از اعتماد به لایه‌های بعدی است. */
function mapPrefs(r: PrefsRow): NotificationPrefs {
  const domains = { ...DEFAULT_NOTIFICATION_PREFS.domains };
  const leadDays = { ...DEFAULT_NOTIFICATION_PREFS.leadDays };

  for (const [key, value] of Object.entries(r.domains ?? {})) {
    if (key in domains && typeof value === "boolean") {
      domains[key as NotificationDomain] = value;
    }
  }
  for (const [key, value] of Object.entries(r.lead_days ?? {})) {
    if (key in leadDays && typeof value === "number" && Number.isFinite(value)) {
      leadDays[key as NotificationDomain] = value;
    }
  }

  return { enabled: r.enabled !== false, domains, leadDays };
}

function mapState(r: PrefsRow): NotificationState {
  return { prefs: mapPrefs(r), dismissed: r.dismissed ?? [] };
}

export class RestNotificationRepository implements NotificationRepository {
  constructor(private readonly client: RestClient) {}

  async getState(): Promise<NotificationState> {
    const row = await this.client.get<PrefsRow>("/notifications/prefs");
    return mapState(row);
  }

  async updatePrefs(patch: NotificationPrefsPatch): Promise<NotificationState> {
    /* نامِ فیلد روی سیم snake_case است (قاعدهٔ کلِ API)، و فیلدِ غایب
       فرستاده نمی‌شود تا سرور «دست نزن» بفهمد نه «خالی کن». */
    const body: Record<string, unknown> = {};
    if (patch.enabled !== undefined) body.enabled = patch.enabled;
    if (patch.domains !== undefined) body.domains = patch.domains;
    if (patch.leadDays !== undefined) body.lead_days = patch.leadDays;

    const row = await this.client.patch<PrefsRow>("/notifications/prefs", body);
    return mapState(row);
  }

  async dismiss(key: string): Promise<void> {
    await this.client.post<void>("/notifications/dismissals", { key });
  }

  async undismiss(key: string): Promise<void> {
    /* شناسهٔ اعلان خودش «:» دارد («event:<uuid>:<date>»)، پس مسیرِ سرور
       {key:path} است. encodeURIComponent باز هم لازم است تا نویسهٔ
       غیرمنتظره در شناسه مسیر را نشکند. */
    await this.client.del<void>(
      `/notifications/dismissals/${encodeURIComponent(key)}`,
    );
  }
}
