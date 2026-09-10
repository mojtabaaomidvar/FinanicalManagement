/* مخزن پل پیامک — اندپوینت‌های REST بک‌اندِ اختصاصی (/sms/bridge).
   پیشوندِ «Supabase» در نامِ کلاس میراثی است؛ مخزن اکنون REST-محور است و از
   RestClient استفاده می‌کند (توکن خودکار از هدر). */

import type { BridgeRepository } from "@/domain/sms/bridge.repository";
import type { SmsBridge } from "@/domain/sms/sms.types";
import type { RestClient } from "@/infrastructure/api/restClient";

export class SupabaseBridgeRepository implements BridgeRepository {
  constructor(private readonly client: RestClient) {}

  async get(): Promise<SmsBridge | null> {
    const r = await this.client.get<{
      token: string;
      member_id: string;
    } | null>("/sms/bridge");
    return r ? { token: r.token, memberId: r.member_id } : null;
  }

  async create(): Promise<string> {
    return this.client.post<string>("/sms/bridge");
  }
}
