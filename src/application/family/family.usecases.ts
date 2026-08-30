/* Use-caseهای خانواده، بودجه و خروجی داده */

import type { FamilyRepository } from "@/domain/family/family.repository";
import type {
  Family,
  FamilySettings,
  Member,
} from "@/domain/family/family.types";
import type { Transaction } from "@/domain/transaction/transaction.types";
import { budgetStatus, type BudgetStatus } from "@/domain/budget/budget.rules";
import { txsInJalaliMonth } from "@/domain/transaction/transaction.rules";
import { sumByType } from "@/domain/report/report.rules";
import { today } from "@/shared/lib/jalali";

export class GetFamilyUseCase {
  constructor(private readonly repo: FamilyRepository) {}
  execute(): Promise<Family> {
    return this.repo.getFamily();
  }
}

export class GetMembersUseCase {
  constructor(private readonly repo: FamilyRepository) {}
  execute(): Promise<Member[]> {
    return this.repo.getMembers();
  }
}

export class UpdateFamilySettingsUseCase {
  constructor(private readonly repo: FamilyRepository) {}
  execute(settings: FamilySettings): Promise<void> {
    return this.repo.updateSettings(settings);
  }
}

export class RemoveMemberUseCase {
  constructor(private readonly repo: FamilyRepository) {}
  execute(memberId: string): Promise<void> {
    return this.repo.removeMember(memberId);
  }
}

/** وضعیت بودجه ماه جاری بر اساس تراکنش‌های موجود */
export class CheckBudgetStatusUseCase {
  execute(budget: number, txs: Transaction[]): BudgetStatus {
    const [jy, jm] = today();
    const spent = sumByType(txsInJalaliMonth(txs, jy, jm), "expense");
    return budgetStatus(budget, spent);
  }
}

/** خروجی JSON پشتیبان — ساخت داده و دانلود در لایه UI جدا است */
export class BuildBackupJsonUseCase {
  execute(input: {
    family: Family;
    members: Member[];
    transactions: Transaction[];
  }): Record<string, unknown> {
    return {
      app: "mali-man",
      version: 4,
      family: input.family.name,
      exportedAt: new Date().toISOString(),
      members: input.members,
      transactions: input.transactions,
    };
  }
}
