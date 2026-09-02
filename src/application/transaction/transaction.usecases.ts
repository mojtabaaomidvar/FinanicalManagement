/* Use-caseهای تراکنش — اعتبارسنجی دامنه + مخزن */

import type { TransactionRepository } from "@/domain/transaction/transaction.repository";
import { validateTransaction } from "@/domain/transaction/transaction.rules";
import type {
  Transaction,
  TransactionInput,
} from "@/domain/transaction/transaction.types";
import { AppError } from "@/shared/lib/appError";

export class ListTransactionsUseCase {
  constructor(private readonly repo: TransactionRepository) {}
  execute(): Promise<Transaction[]> {
    return this.repo.list();
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

export class UploadTxPhotoUseCase {
  constructor(private readonly repo: TransactionRepository) {}
  execute(dataUrl: string): Promise<string> {
    return this.repo.uploadPhoto(dataUrl);
  }
}

export class AddTxPhotoUseCase {
  constructor(private readonly repo: TransactionRepository) {}
  execute(txId: string, url: string, caption: string | null): Promise<void> {
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
