/* مخزن تراکنش‌ها */

import type { TransactionRepository } from "@/domain/transaction/transaction.repository";
import type {
  Transaction,
  TransactionInput,
} from "@/domain/transaction/transaction.types";
import { rpc } from "@/infrastructure/api/httpClient";
import { mapTransaction, type TransactionRow } from "./mappers";
import type { TokenProvider } from "./sessionRepository";

export class SupabaseTransactionRepository implements TransactionRepository {
  constructor(private readonly tokenProvider: TokenProvider) {}

  private async tok(): Promise<string> {
    const t = await this.tokenProvider.getToken();
    if (!t) throw new Error("NO_SESSION");
    return t;
  }

  async list(): Promise<Transaction[]> {
    const rows = await rpc<TransactionRow[]>("list_transactions", {
      p_token: await this.tok(),
    });
    return (rows ?? []).map(mapTransaction);
  }

  async add(input: TransactionInput): Promise<Transaction> {
    const row = await rpc<TransactionRow>("add_transaction", {
      p_token: await this.tok(),
      p_member_id: input.memberId,
      p_type: input.type,
      p_amount: input.amount,
      p_category: input.category,
      p_date: input.date,
      p_note: input.note ?? null,
      p_account_id: input.accountId ?? null,
    });
    return mapTransaction(row);
  }

  async update(id: string, input: TransactionInput): Promise<void> {
    await rpc("update_transaction", {
      p_token: await this.tok(),
      p_tx_id: id,
      p_member_id: input.memberId,
      p_type: input.type,
      p_amount: input.amount,
      p_category: input.category,
      p_date: input.date,
      p_note: input.note ?? null,
      p_account_id: input.accountId ?? null,
    });
  }

  async remove(id: string): Promise<void> {
    await rpc("delete_transaction", {
      p_token: await this.tok(),
      p_tx_id: id,
    });
  }
}
