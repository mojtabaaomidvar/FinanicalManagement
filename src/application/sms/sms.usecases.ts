/* Use-caseهای پیامک بانکی — پارس، ثبت دسته‌ای، رسیدگی به pending */

import type { SmsRepository } from "@/domain/sms/sms.repository";
import type { BankSms, NewBankSms } from "@/domain/sms/sms.types";
import type { TransactionInput } from "@/domain/transaction/transaction.types";
import { parseSms, splitSmsBlocks } from "@/shared/lib/sms-parser";
import { jalaliToIso } from "@/shared/lib/jalali";
import { AddTransactionUseCase } from "@/application/transaction/transaction.usecases";

/** پارس متن خام چند پیامک → رکوردهای جدید */
export class ParseSmsImportUseCase {
  execute(rawText: string): NewBankSms[] {
    return splitSmsBlocks(rawText)
      .map((block) => {
        const p = parseSms(block);
        if (!p) return null;
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

  async execute(sms: BankSms, input: TransactionInput): Promise<void> {
    await this.addTx.execute(input);
    await this.repo.setStatus(sms.id, "recorded");
  }
}
