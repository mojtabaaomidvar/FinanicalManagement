/* مخزن تراکنش‌ها — اندپوینت‌های REST بک‌اندِ اختصاصی (/transactions).
   نکته: پیشوندِ «Supabase» در نامِ کلاس صرفاً میراثی است و برای کم‌کردنِ دامنهٔ تغییر
   حفظ شده؛ این مخزن دیگر با Supabase کار نمی‌کند و از RestClient استفاده می‌کند.
   توکن خودکار از هدرِ Authorization توسط RestClient تزریق می‌شود. */

import type { TransactionRepository } from "@/domain/transaction/transaction.repository";
import type {
  Transaction,
  TransactionInput,
} from "@/domain/transaction/transaction.types";
import type { RestClient } from "@/infrastructure/api/restClient";
import { AppError } from "@/shared/lib/appError";
import { mapTransaction, type TransactionRow } from "./mappers";

/** بدنهٔ snake_case مشترکِ افزودن/ویرایش تراکنش (سازگار با اسکیمای بک‌اند). */
function toBody(input: TransactionInput) {
  return {
    member_id: input.memberId,
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

  async list(): Promise<Transaction[]> {
    const rows = await this.client.get<TransactionRow[]>("/transactions");
    return (rows ?? []).map(mapTransaction);
  }

  async add(input: TransactionInput): Promise<Transaction> {
    const row = await this.client.post<TransactionRow>(
      "/transactions",
      toBody(input),
    );
    return mapTransaction(row);
  }

  async update(id: string, input: TransactionInput): Promise<void> {
    await this.client.patch<void>(
      `/transactions/${encodeURIComponent(id)}`,
      toBody(input),
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

  async uploadPhoto(dataUrl: string): Promise<string> {
    /* آپلود به استوریجِ خصوصیِ سرور؛ توکن خودکار از هدر می‌رود. مهلتِ بلندتر برای
       تصویرِ حجیم. خطاها (INVALID_IMAGE/IMAGE_TOO_LARGE/SERVER_NOT_CONFIGURED/
       SESSION_EXPIRED) در RestClient به پیامِ فارسی نگاشته می‌شوند. */
    const r = await this.client.post<{ ok?: boolean; url?: string }>(
      "/uploads/photo",
      { image: dataUrl },
      { timeoutMs: 60000 },
    );
    if (!r?.url) throw new AppError("SERVER", "آپلود ناموفق بود — دوباره تلاش کنید");
    return r.url;
  }

  async addPhoto(
    txId: string,
    url: string,
    caption: string | null,
  ): Promise<void> {
    await this.client.post<void>(
      `/transactions/${encodeURIComponent(txId)}/photos`,
      { url, caption },
    );
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
