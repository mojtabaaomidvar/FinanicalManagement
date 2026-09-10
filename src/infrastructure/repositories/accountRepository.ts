/* مخزن کارت‌ها/حساب‌های بانکی — اندپوینت‌های REST بک‌اندِ اختصاصی (/accounts).
   پیشوندِ «Supabase» در نامِ کلاس میراثی است؛ مخزن اکنون REST-محور است و از
   RestClient استفاده می‌کند (توکن خودکار از هدر). */

import type { AccountRepository } from "@/domain/account/account.repository";
import type {
  Account,
  AccountInput,
  AccountPatch,
} from "@/domain/account/account.types";
import type { RestClient } from "@/infrastructure/api/restClient";
import { mapAccount, type AccountRow } from "./mappers";

export class SupabaseAccountRepository implements AccountRepository {
  constructor(private readonly client: RestClient) {}

  async list(): Promise<Account[]> {
    const rows = await this.client.get<AccountRow[]>("/accounts");
    return (rows ?? []).map(mapAccount);
  }

  async add(input: AccountInput): Promise<Account> {
    const row = await this.client.post<AccountRow>("/accounts", {
      member_id: input.memberId,
      title: input.title,
      bank: input.bank ?? null,
      card_number: input.cardNumber ?? null,
      kind: input.kind ?? "bank",
      initial_balance: input.initialBalance ?? 0,
    });
    return mapAccount(row);
  }

  async update(patch: AccountPatch): Promise<Account> {
    const row = await this.client.patch<AccountRow>(
      `/accounts/${encodeURIComponent(patch.id)}`,
      {
        title: patch.title,
        bank: patch.bank ?? null,
        card_number: patch.cardNumber ?? null,
        /* null = دست‌نزن؛ سرور مقدار فعلی را نگه می‌دارد */
        initial_balance: patch.initialBalance ?? null,
      },
    );
    return mapAccount(row);
  }

  async remove(id: string): Promise<void> {
    await this.client.del<void>(`/accounts/${encodeURIComponent(id)}`);
  }
}
