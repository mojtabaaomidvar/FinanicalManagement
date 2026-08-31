/* مخزن کارت‌ها/حساب‌های بانکی */

import type { AccountRepository } from "@/domain/account/account.repository";
import type { Account, AccountInput } from "@/domain/account/account.types";
import { rpc } from "@/infrastructure/api/httpClient";
import { mapAccount, type AccountRow } from "./mappers";
import type { TokenProvider } from "./sessionRepository";

export class SupabaseAccountRepository implements AccountRepository {
  constructor(private readonly tokenProvider: TokenProvider) {}

  private async tok(): Promise<string> {
    const t = await this.tokenProvider.getToken();
    if (!t) throw new Error("NO_SESSION");
    return t;
  }

  async list(): Promise<Account[]> {
    const rows = await rpc<AccountRow[]>("list_accounts", {
      p_token: await this.tok(),
    });
    return (rows ?? []).map(mapAccount);
  }

  async add(input: AccountInput): Promise<Account> {
    const row = await rpc<AccountRow>("add_account", {
      p_token: await this.tok(),
      p_member_id: input.memberId,
      p_title: input.title,
      p_bank: input.bank ?? null,
      p_card_number: input.cardNumber ?? null,
      p_account_number: input.accountNumber ?? null,
      p_sheba: input.sheba ?? null,
    });
    return mapAccount(row);
  }

  async remove(id: string): Promise<void> {
    await rpc("delete_account", {
      p_token: await this.tok(),
      p_account_id: id,
    });
  }
}
