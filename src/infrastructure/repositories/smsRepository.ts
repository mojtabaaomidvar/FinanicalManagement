/* مخزن پیامک‌های بانکی — اندپوینت‌های REST بک‌اندِ اختصاصی (/sms).
   پیشوندِ «Supabase» در نامِ کلاس میراثی است؛ مخزن اکنون REST-محور است و از
   RestClient استفاده می‌کند (توکن خودکار از هدر). */

import type { SmsRepository } from "@/domain/sms/sms.repository";
import type { BankSms, NewBankSms, SmsStatus } from "@/domain/sms/sms.types";
import type { RestClient } from "@/infrastructure/api/restClient";
import { mapSms, toSmsItems, type SmsRow } from "./mappers";

export class SupabaseSmsRepository implements SmsRepository {
  constructor(private readonly client: RestClient) {}

  async list(status?: SmsStatus): Promise<BankSms[]> {
    const q = status ? `?status=${encodeURIComponent(status)}` : "";
    const rows = await this.client.get<SmsRow[]>(`/sms${q}`);
    return (rows ?? []).map(mapSms);
  }

  async addBatch(items: NewBankSms[]): Promise<number> {
    if (!items.length) return 0;
    const n = await this.client.post<number>("/sms", {
      items: toSmsItems(items),
    });
    return n ?? 0;
  }

  async setStatus(id: string, status: SmsStatus): Promise<void> {
    await this.client.patch<void>(`/sms/${encodeURIComponent(id)}`, { status });
  }

  async ingestRaw(rawText: string, sender?: string | null): Promise<number> {
    /* سرور پارس/تشخیص را انجام می‌دهد و آرایهٔ رکوردهای ساخته‌شده را برمی‌گرداند؛
       طولِ آن = تعدادِ افزوده (۰ یعنی پیامکِ بانکی نبود یا تکراری بود). */
    const rows = await this.client.post<unknown[]>("/sms/ingest", {
      items: [{ raw_text: rawText, sender: sender ?? null }],
    });
    return Array.isArray(rows) ? rows.length : 0;
  }
}
