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
      p_time: input.time ?? null,
      p_note: input.note ?? null,
      p_account_id: input.accountId ?? null,
      p_subcategory_id: input.subcategoryId ?? null,
      p_to_account_id: input.toAccountId ?? null,
      p_repeat: input.repeat ?? "none",
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
      p_time: input.time ?? null,
      p_note: input.note ?? null,
      p_account_id: input.accountId ?? null,
      p_subcategory_id: input.subcategoryId ?? null,
      p_to_account_id: input.toAccountId ?? null,
      p_repeat: input.repeat ?? "none",
    });
  }

  async remove(id: string): Promise<void> {
    await rpc("delete_transaction", {
      p_token: await this.tok(),
      p_tx_id: id,
    });
  }

  async uploadPhoto(dataUrl: string): Promise<string> {
    const token = await this.tok();
    let res: Response;
    try {
      res = await fetch("/api/upload-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, image: dataUrl }),
      });
    } catch {
      throw new Error("خطای شبکه — اتصال اینترنت را بررسی کنید");
    }
    const text = await res.text();
    let data: { ok?: boolean; url?: string; error?: string; detail?: string } = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      /* بدنه غیر JSON */
    }
    if (!res.ok || !data.ok || !data.url) {
      if (data.error === "IMAGE_TOO_LARGE") {
        throw new Error("عکس بزرگ است — حداکثر ۱ مگابایت");
      }
      if (data.error === "INVALID_IMAGE") {
        throw new Error("فقط عکس PNG/JPG/WebP پذیرفته می‌شود");
      }
      if (data.error === "SERVER_NOT_CONFIGURED") {
        throw new Error("تنظیمات سرور آپلود ناقص است (SUPABASE_URL/SERVICE_KEY)");
      }
      if (data.error === "INVALID_TOKEN" || data.error === "SESSION_EXPIRED") {
        throw new Error("نشست منقضی شده — دوباره وارد شوید");
      }
      if (!text.startsWith("{")) {
        /* پاسخ HTML → تابع سرور اجرا نشده (مثلاً اجرای محلی بدون vercel dev) */
        throw new Error(
          "سرور آپلود در دسترس نیست — آپلود فقط روی نسخه دپلوی‌شده (یا vercel dev) کار می‌کند",
        );
      }
      if (data.detail) console.error("upload-photo:", data.detail);
      throw new Error("آپلود ناموفق بود — دوباره تلاش کنید");
    }
    return data.url;
  }

  async addPhoto(
    txId: string,
    url: string,
    caption: string | null,
  ): Promise<void> {
    await rpc("add_tx_photo", {
      p_token: await this.tok(),
      p_tx_id: txId,
      p_url: url,
      p_caption: caption,
    });
  }

  async updatePhotoCaption(
    photoId: string,
    caption: string | null,
  ): Promise<void> {
    await rpc("update_tx_photo_caption", {
      p_token: await this.tok(),
      p_photo_id: photoId,
      p_caption: caption,
    });
  }

  async removePhoto(photoId: string): Promise<void> {
    await rpc("delete_tx_photo", {
      p_token: await this.tok(),
      p_photo_id: photoId,
    });
  }
}
