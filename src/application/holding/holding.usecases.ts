/* Use-caseهای دارایی — اعتبارسنجی دامنه + مخزن */

import type { HoldingRepository } from "@/domain/holding/holding.repository";
import {
  roundQuantity,
  validateHoldingInput,
  validateQuantity,
} from "@/domain/holding/holding.rules";
import type {
  Holding,
  HoldingInput,
  HoldingList,
  HoldingPatch,
} from "@/domain/holding/holding.types";
import { AppError } from "@/shared/lib/appError";

/* پیام‌های خطای مشترکِ افزودن و ویرایش — کدها از holding.rules می‌آیند */
const HOLDING_ERRORS: Record<string, string> = {
  INVALID_KIND: "نوع دارایی معتبر نیست",
  INVALID_NAME: "نام دارایی معتبر نیست (حداکثر ۸۰ کاراکتر)",
  INVALID_QUANTITY: "مقدار معتبر نیست",
  ZERO_QUANTITY: "مقدار باید بیشتر از صفر باشد",
  HUGE_QUANTITY: "مقدار بیش از حد مجاز است",
};

function fail(code: string | undefined): never {
  throw new AppError(
    "INVALID_HOLDING",
    HOLDING_ERRORS[code ?? ""] ?? "اطلاعات دارایی معتبر نیست",
  );
}

export class ListHoldingsUseCase {
  constructor(private readonly repo: HoldingRepository) {}
  execute(): Promise<HoldingList> {
    return this.repo.list();
  }
}

export class AddHoldingUseCase {
  constructor(private readonly repo: HoldingRepository) {}
  async execute(input: HoldingInput): Promise<Holding> {
    const v = validateHoldingInput(input);
    if (!v.ok) fail(v.error);
    /* گِردکردن پیش از ارسال: ستون Numeric(18,6) است و اگر عددِ درازتری
       برود، سرور/دیتابیس بی‌صدا گِردش می‌کند. این‌جا صریح انجامش می‌دهیم
       تا چیزی که ذخیره می‌شود دقیقاً همانی باشد که اعتبارسنجی شده. */
    return this.repo.add({
      ...input,
      symbol: input.symbol.trim(),
      name: input.name.trim(),
      unit: input.unit.trim(),
      quantity: roundQuantity(input.quantity),
    });
  }
}

export class UpdateHoldingUseCase {
  constructor(private readonly repo: HoldingRepository) {}
  async execute(patch: HoldingPatch): Promise<Holding> {
    const v = validateQuantity(patch.quantity);
    if (!v.ok) fail(v.error);
    return this.repo.update({
      id: patch.id,
      quantity: roundQuantity(patch.quantity),
    });
  }
}

export class DeleteHoldingUseCase {
  constructor(private readonly repo: HoldingRepository) {}
  execute(id: string): Promise<void> {
    return this.repo.remove(id);
  }
}
