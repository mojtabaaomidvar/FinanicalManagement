/* مخزن تراکنش‌ها — اندپوینت‌های REST بک‌اند اختصاصی (/transactions).
   نکته: پیشوند «Supabase» در نام کلاس صرفاً میراثی است و برای کم‌کردن دامنهٔ تغییر
   حفظ شده؛ این مخزن دیگر با Supabase کار نمی‌کند و از RestClient استفاده می‌کند.
   توکن خودکار از هدر Authorization توسط RestClient تزریق می‌شود. */

import type { TransactionRepository } from "@/domain/transaction/transaction.repository";
import type {
  Transaction,
  TransactionInput,
  TransactionPhoto,
  RecurringUpdate,
  OccurrenceSettle,
  TransferFeeMethod,
} from "@/domain/transaction/transaction.types";
import type { RestClient } from "@/infrastructure/api/restClient";
import { AppError } from "@/shared/lib/appError";
import { mapTransaction, type TransactionRow } from "./mappers";
import { legacyIntegerMoney, type Money } from "@/shared/lib/money";

/** بدنهٔ snake_case مشترک افزودن/ویرایش تراکنش (سازگار با اسکیمای بک‌اند). */
export function toTransactionBody(input: TransactionInput) {
  return {
    member_id: input.memberId,
    ...(input.paymentMethod !== undefined ? { payment_method: input.paymentMethod } : {}),
    ...(input.transferFeeMethod !== undefined ? { transfer_fee_method: input.transferFeeMethod } : {}),
    require_available_balance: input.requireAvailableBalance ?? false,
    type: input.type,
    amount: input.amount,
    category: input.category,
    date: input.date,
    time: input.time ?? null,
    note: input.note ?? null,
    account_id: input.accountId ?? null,
    subcategory_id: input.subcategoryId ?? null,
    to_account_id: input.toAccountId ?? null,
    repeat: input.repeat ?? "none",
    repeat_end:
      input.repeat && input.repeat !== "none"
        ? (input.repeatEnd ?? null)
        : null,
  };
}

export class SupabaseTransactionRepository implements TransactionRepository {
  constructor(private readonly client: RestClient) {}

  async quoteTransferFee(method: TransferFeeMethod, amountRial: Money): Promise<Money> {
    const query = new URLSearchParams({ method, amount_rial: String(amountRial) });
    const result = await this.client.get<{ fee_rial: number }>(`/transactions/transfer-fee?${query}`);
    if (!Number.isSafeInteger(result.fee_rial) || result.fee_rial < 0) throw new AppError("SERVER", "بررسی کارمزد ممکن نشد؛ دوباره تلاش کنید.");
    return legacyIntegerMoney(result.fee_rial);
  }

  async list(): Promise<Transaction[]> {
    const rows = await this.client.get<TransactionRow[]>("/transactions");
    return (rows ?? []).map(mapTransaction);
  }

  async add(input: TransactionInput): Promise<Transaction> {
    const row = await this.client.post<TransactionRow>(
      "/transactions",
      toTransactionBody(input),
    );
    return mapTransaction(row);
  }

  async update(id: string, input: TransactionInput): Promise<void> {
    await this.client.patch<void>(
      `/transactions/${encodeURIComponent(id)}`,
      toTransactionBody(input),
    );
  }

  async remove(id: string): Promise<void> {
    await this.client.del<void>(`/transactions/${encodeURIComponent(id)}`);
  }

  async markOccurrence(id: string, dueDate: string): Promise<void> {
    await this.client.post<void>(
      `/transactions/${encodeURIComponent(id)}/occurrences`,
      { due_date: dueDate },
    );
  }

  async updateRecurring(id: string, input: RecurringUpdate): Promise<Transaction> {
    return mapTransaction(await this.client.patch<TransactionRow>(`/transactions/${encodeURIComponent(id)}/recurring`, {
      amount: input.amount, category: input.category, note: input.note, start_date: input.startDate,
      repeat: input.repeat, repeat_end: input.repeatEnd, revision: input.revision,
    }));
  }
  async settleOccurrence(id: string, input: OccurrenceSettle): Promise<Transaction> {
    return mapTransaction(await this.client.post<TransactionRow>(`/transactions/${encodeURIComponent(id)}/settle`, {
      due_date: input.dueDate, revision: input.revision, account_id: input.accountId, to_account_id: input.toAccountId ?? null,
      ...(input.transaction ? { transaction: toTransactionBody(input.transaction) } : {}),
    }));
  }

  async uploadPhoto(dataUrl: string): Promise<string> {
    /* آپلود به استوریج خصوصی سرور؛ توکن خودکار از هدر می‌رود. مهلت بلندتر برای
       تصویر حجیم. خطاها (INVALID_IMAGE/IMAGE_TOO_LARGE/SERVER_NOT_CONFIGURED/
       SESSION_EXPIRED) در RestClient به پیام فارسی نگاشته می‌شوند. */
    const r = await this.client.post<{ ok?: boolean; url?: string }>(
      "/uploads/photo",
      { image: dataUrl },
      { timeoutMs: 60000 },
    );
    if (!r?.url)
      throw new AppError("SERVER", "آپلود ناموفق بود — دوباره تلاش کنید");
    return r.url;
  }

  async addPhoto(
    txId: string,
    url: string,
    caption: string | null,
  ): Promise<TransactionPhoto> {
    const photo = await this.client.post<TransactionPhoto>(
      `/transactions/${encodeURIComponent(txId)}/photos`,
      { url, caption },
    );
    return { id: photo.id, url: photo.url, caption: photo.caption };
  }

  async updatePhotoCaption(
    photoId: string,
    caption: string | null,
  ): Promise<void> {
    await this.client.patch<void>(`/photos/${encodeURIComponent(photoId)}`, {
      caption,
    });
  }

  async removePhoto(photoId: string): Promise<void> {
    await this.client.del<void>(`/photos/${encodeURIComponent(photoId)}`);
  }
}
