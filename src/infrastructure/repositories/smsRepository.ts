/* مخزن پیامک‌های بانکی */

import type { SmsRepository } from "@/domain/sms/sms.repository";
import type { BankSms, NewBankSms, SmsStatus } from "@/domain/sms/sms.types";
import { rpc } from "@/infrastructure/api/httpClient";
import { mapSms, toSmsItems, type SmsRow } from "./mappers";
import type { TokenProvider } from "./sessionRepository";

export class SupabaseSmsRepository implements SmsRepository {
  constructor(private readonly tokenProvider: TokenProvider) {}

  private async tok(): Promise<string> {
    const t = await this.tokenProvider.getToken();
    if (!t) throw new Error("NO_SESSION");
    return t;
  }

  async list(status?: SmsStatus): Promise<BankSms[]> {
    const rows = await rpc<SmsRow[]>("list_sms", {
      p_token: await this.tok(),
      p_status: status ?? null,
    });
    return (rows ?? []).map(mapSms);
  }

  async addBatch(items: NewBankSms[]): Promise<number> {
    if (!items.length) return 0;
    return rpc<number>("add_sms_messages", {
      p_token: await this.tok(),
      p_items: toSmsItems(items),
    });
  }

  async setStatus(id: string, status: SmsStatus): Promise<void> {
    await rpc("set_sms_status", {
      p_token: await this.tok(),
      p_sms_id: id,
      p_status: status,
    });
  }
}
