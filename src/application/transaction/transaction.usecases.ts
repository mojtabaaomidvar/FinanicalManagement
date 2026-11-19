/* Use-caseهای تراکنش — اعتبارسنجی دامنه + مخزن */

import type { TransactionRepository } from "@/domain/transaction/transaction.repository";
import { validateTransaction } from "@/domain/transaction/transaction.rules";
import type {
  Transaction,
  TransactionInput,
  TransactionPhoto,
  RecurringUpdate,
  OccurrenceSettle,
} from "@/domain/transaction/transaction.types";
import { AppError } from "@/shared/lib/appError";

export class ListTransactionsUseCase {
  constructor(private readonly repo: TransactionRepository) {}
  execute(): Promise<Transaction[]> {
    return this.repo.list();
  }
}

export class QuoteTransferFeeUseCase {
  constructor(private readonly repo: TransactionRepository) {}
  execute(method: import("@/domain/transaction/transaction.types").TransferFeeMethod, amountRial: number): Promise<number> {
    if (!Number.isSafeInteger(amountRial) || amountRial <= 0) throw new AppError("INVALID_TX", "مبلغ انتقال باید عدد صحیح مثبت به ریال باشد.");
    if (!this.repo.quoteTransferFee) throw new AppError("SERVER", "بررسی کارمزد ممکن نشد؛ دوباره تلاش کنید.");
    return this.repo.quoteTransferFee(method, amountRial);
  }
}

export class AddTransactionUseCase {
  constructor(private readonly repo: TransactionRepository) {}
  async execute(input: TransactionInput): Promise<Transaction> {
    const v = validateTransaction(input);
    if (!v.ok) throw new AppError("INVALID_TX", "اطلاعات تراکنش معتبر نیست");
    return this.repo.add(input);
  }
}

export class UpdateTransactionUseCase {
  constructor(private readonly repo: TransactionRepository) {}
  async execute(id: string, input: TransactionInput): Promise<void> {
    const v = validateTransaction(input);
    if (!v.ok) throw new AppError("INVALID_TX", "اطلاعات تراکنش معتبر نیست");
    await this.repo.update(id, input);
  }
}

export class DeleteTransactionUseCase {
  constructor(private readonly repo: TransactionRepository) {}
  execute(id: string): Promise<void> {
    return this.repo.remove(id);
  }
}

/** ثبت رسیدگی به یک سررسید تراکنش تکرارشونده (ثبت‌شده یا رد‌شده).
    dueDate تاریخ میلادی ISO سررسید است تا دیگر برای همان دوره پرسیده نشود. */
export class MarkRecurringOccurrenceUseCase {
  constructor(private readonly repo: TransactionRepository) {}
  execute(id: string, dueDate: string): Promise<void> {
    return this.repo.markOccurrence(id, dueDate);
  }
}

export class UpdateRecurringUseCase {
  constructor(private readonly repo: TransactionRepository) {}
  execute(id: string, input: RecurringUpdate): Promise<Transaction> {
    if (!this.repo.updateRecurring) throw new AppError("SERVER", "ویرایش تکرار در دسترس نیست");
    return this.repo.updateRecurring(id, input);
  }
}
export class SettleOccurrenceUseCase {
  constructor(private readonly repo: TransactionRepository) {}
  execute(id: string, input: OccurrenceSettle): Promise<Transaction> {
    if (!this.repo.settleOccurrence) throw new AppError("SERVER", "تسویهٔ نوبت در دسترس نیست");
    return this.repo.settleOccurrence(id, input);
  }
}

export class UploadTxPhotoUseCase {
  constructor(private readonly repo: TransactionRepository) {}
  execute(dataUrl: string): Promise<string> {
    return this.repo.uploadPhoto(dataUrl);
  }
}

export class AddTxPhotoUseCase {
  constructor(private readonly repo: TransactionRepository) {}
  execute(txId: string, url: string, caption: string | null): Promise<TransactionPhoto> {
    const c = caption?.trim() ?? "";
    if (c.length > 100) {
      throw new AppError("INVALID_TX", "توضیح تصویر حداکثر ۱۰۰ کاراکتر است");
    }
    return this.repo.addPhoto(txId, url, c || null);
  }
}

export class UpdateTxPhotoCaptionUseCase {
  constructor(private readonly repo: TransactionRepository) {}
  execute(photoId: string, caption: string | null): Promise<void> {
    const c = caption?.trim() ?? "";
    if (c.length > 100) {
      throw new AppError("INVALID_TX", "توضیح تصویر حداکثر ۱۰۰ کاراکتر است");
    }
    return this.repo.updatePhotoCaption(photoId, c || null);
  }
}

export class DeleteTxPhotoUseCase {
  constructor(private readonly repo: TransactionRepository) {}
  execute(photoId: string): Promise<void> {
    return this.repo.removePhoto(photoId);
  }
}
