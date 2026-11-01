/* Use-caseهای §۱.۹ قبوض — orchestration بدون UI و بدون state. */

import type { BillRepository } from "@/domain/bill/bill.repository";
import type { Bill, BillInput, BillPayInput } from "@/domain/bill/bill.types";

export class ListBillsUseCase {
  constructor(private readonly repo: BillRepository) {}
  execute(): Promise<Bill[]> {
    return this.repo.list();
  }
}

export class AddBillUseCase {
  constructor(private readonly repo: BillRepository) {}
  execute(input: BillInput): Promise<Bill> {
    return this.repo.add(input);
  }
}

export class UpdateBillUseCase {
  constructor(private readonly repo: BillRepository) {}
  execute(id: string, input: BillInput): Promise<Bill> {
    return this.repo.update(id, input);
  }
}

export class DeleteBillUseCase {
  constructor(private readonly repo: BillRepository) {}
  execute(id: string): Promise<void> {
    return this.repo.remove(id);
  }
}

/** پرداخت — قبض را می‌بندد **و** تراکنشِ هزینه می‌سازد.
 *  هر دو در یک commitِ سروری (رابطهٔ Bill ↕ Finance، §۴.۷). پس فراخوان باید
 *  بعدش `refreshData` بزند: هم فهرستِ قبض عوض شده هم فهرستِ تراکنش. */
export class PayBillUseCase {
  constructor(private readonly repo: BillRepository) {}
  execute(id: string, input: BillPayInput): Promise<Bill> {
    return this.repo.pay(id, input);
  }
}

/** برگرداندنِ پرداخت — تراکنشش هم حذف می‌شود، پس این هم `refreshData` می‌خواهد */
export class UnpayBillUseCase {
  constructor(private readonly repo: BillRepository) {}
  execute(id: string): Promise<Bill> {
    return this.repo.unpay(id);
  }
}

export class CancelBillUseCase {
  constructor(private readonly repo: BillRepository) {}
  execute(id: string): Promise<Bill> {
    return this.repo.cancel(id);
  }
}
