/* Use-caseهای پیامک بانکی — پارس، ثبت دسته‌ای، رسیدگی به pending */

import type { SmsRepository } from "@/domain/sms/sms.repository";
import type { BankSms, NewBankSms } from "@/domain/sms/sms.types";
import type { Transaction, TransactionInput } from "@/domain/transaction/transaction.types";
import { parseSms, splitSmsBlocks } from "@/shared/lib/sms-parser";
import { jalaliToIso } from "@/shared/lib/jalali";
import { AddTransactionUseCase } from "@/application/transaction/transaction.usecases";

/** پارس متن خام چند پیامک → رکوردهای جدید */
export class ParseSmsImportUseCase {
  execute(rawText: string): NewBankSms[] {
    return splitSmsBlocks(rawText)
      .map((block): NewBankSms | null => {
        const p = parseSms(block);
        if (!p?.type || p.amount == null || !Number.isFinite(p.amount) || p.amount <= 0) return null;
        return {
          rawText: block,
          bank: p.bank,
          type: p.type,
          amount: p.amount,
          balance: p.balance,
          date: p.date ? jalaliToIso(p.date.jalali) : null,
        } satisfies NewBankSms;
      })
      .filter((x): x is NewBankSms => x !== null);
  }
}

export class AddSmsBatchUseCase {
  constructor(private readonly repo: SmsRepository) {}
  execute(items: NewBankSms[]): Promise<number> {
    return this.repo.addBatch(items);
  }
}

/** ثبت یک متن خام پیامک — در فاز ۹ به «POST /sms/ingest» سرور منتقل شد: پارس و
   تشخیص بانکی‌بودن اکنون سمت سرور انجام می‌شود (پارس سمت کلاینت فقط برای واردکردن
   دستی متن باقی می‌ماند). تعداد رکورد افزوده را برمی‌گرداند (۰ = پیامک بانکی نبود).
   فرستنده (در خواندن نیتیو موجود است) برای کمک به تشخیص بانک فوروارد می‌شود. */
export class IngestRawSmsUseCase {
  constructor(private readonly repo: SmsRepository) {}
  execute(rawText: string, sender?: string | null): Promise<number> {
    return this.repo.ingestRaw(rawText, sender ?? null);
  }
}

export class ListPendingSmsUseCase {
  constructor(private readonly repo: SmsRepository) {}
  execute(): Promise<BankSms[]> {
    return this.repo.list("pending");
  }
}

export class IgnoreSmsUseCase {
  constructor(private readonly repo: SmsRepository) {}
  execute(id: string): Promise<void> {
    return this.repo.setStatus(id, "ignored");
  }
}

/** ثبت پیامک pending به‌عنوان تراکنش + علامت‌گذاری recorded */
export class RecordSmsUseCase {
  constructor(
    private readonly repo: SmsRepository,
    private readonly addTx: AddTransactionUseCase,
  ) {}

  async execute(sms: BankSms, input: TransactionInput, recovery?: {
    transactionId?: string;
    onCreated?: (transaction: Transaction) => void;
    isCurrent?: () => boolean;
  }): Promise<void> {
    if (!recovery?.transactionId) {
      const transaction = await this.addTx.execute(input);
      recovery?.onCreated?.(transaction);
    }
    if (!recovery?.isCurrent || recovery.isCurrent()) await this.repo.setStatus(sms.id, "recorded");
  }
}
