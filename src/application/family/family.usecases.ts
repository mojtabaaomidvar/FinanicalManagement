/* Use-caseهای خانواده، بودجه و خروجی داده */

import type { FamilyRepository } from "@/domain/family/family.repository";
import type {
  Family,
  JoinRequest,
  Member,
  ProfileInput,
} from "@/domain/family/family.types";
import type { Transaction } from "@/domain/transaction/transaction.types";
import { budgetStatus, type BudgetStatus } from "@/domain/budget/budget.rules";
import { txsInJalaliMonth } from "@/domain/transaction/transaction.rules";
import { sumByType } from "@/domain/report/report.rules";
import { today } from "@/shared/lib/jalali";
import { AppError } from "@/shared/lib/appError";

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

export class UpdateOwnProfileUseCase {
  constructor(private readonly repo: FamilyRepository) {}
  async execute(input: ProfileInput): Promise<Member> {
    const name = input.name.trim();
    if (!name || name.length > 40) {
      throw new AppError("INVALID_TX", "نام باید ۱ تا ۴۰ کاراکتر باشد");
    }
    /* اعتبارسنجی کد ملی حذف شد (۲۰۲۶-۰۹-۰۸): کدملی از برنامه حذف شد */
    return this.repo.updateOwnProfile({ ...input, name });
  }
}

/** تغییر تم شخصی */
export class SetThemeUseCase {
  constructor(private readonly repo: FamilyRepository) {}
  execute(theme: "light" | "dark" | "auto"): Promise<void> {
    return this.repo.setTheme(theme);
  }
}

/** تغییر واحد پول نمایشی شخصی (v5.8) — پیش‌تر روی کل خانواده بود */
export class SetCurrencyUseCase {
  constructor(private readonly repo: FamilyRepository) {}
  execute(currency: string): Promise<Member> {
    if (currency !== "تومان" && currency !== "ریال") {
      throw new AppError("INVALID_TX", "واحد پول باید تومان یا ریال باشد");
    }
    return this.repo.setCurrency(currency);
  }
}

/** تغییر نسبت یک عضو با مدیر خانواده */
export class SetMemberRelationUseCase {
  constructor(private readonly repo: FamilyRepository) {}
  execute(memberId: string, relation: string): Promise<Member> {
    const r = relation.trim();
    if (!r) {
      throw new AppError("INVALID_TX", "نسبت را انتخاب کنید");
    }
    return this.repo.setMemberRelation(memberId, r);
  }
}

export class AddMemberByManagerUseCase {
  constructor(private readonly repo: FamilyRepository) {}
  async execute(
    name: string,
    phone: string,
    relation: string,
  ): Promise<Member> {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 40) {
      throw new AppError(
        "INVALID_TX",
        "نام عضو را وارد کنید (حداکثر ۴۰ کاراکتر)",
      );
    }
    if (!/^09\d{9}$/.test(phone)) {
      throw new AppError("INVALID_TX", "شماره موبایل معتبر نیست (۰۹xxxxxxxxx)");
    }
    if (!relation.trim()) {
      throw new AppError(
        "INVALID_TX",
        "نسبت عضو با مدیر خانواده را انتخاب کنید",
      );
    }
    return this.repo.addMemberByManager(trimmed, phone, relation.trim());
  }
}

/** سقف بودجه ماهانه خانواده — از v5.8 فقط بودجه (واحد پول و تم شخصی شدند) */
export class SetMonthlyBudgetUseCase {
  constructor(private readonly repo: FamilyRepository) {}
  execute(budget: number): Promise<void> {
    return this.repo.setMonthlyBudget(Math.max(0, Math.round(budget)));
  }
}

export class RemoveMemberUseCase {
  constructor(private readonly repo: FamilyRepository) {}
  execute(memberId: string): Promise<void> {
    return this.repo.removeMember(memberId);
  }
}

/* ── §۲.۶ تأییدِ عضویت ────────────────────────────────────────
   هیچ‌کدام گاردِ «آیا مدیرم؟» ندارند و نباید داشته باشند: تصمیمِ مجاز‌بودن
   سمتِ سرور (require_admin_tenant) گرفته می‌شود و تکرارِ آن اینجا فقط
   این توهم را می‌سازد که پنهان‌کردنِ دکمه کافی است. */

export class ListJoinRequestsUseCase {
  constructor(private readonly repo: FamilyRepository) {}
  execute(): Promise<JoinRequest[]> {
    return this.repo.listJoinRequests();
  }
}

/** تأیید — عضوِ به‌روزشده را برمی‌گرداند تا فهرستِ اعضا بدون بارگیریِ
    دوباره درست شود. */
export class ApproveJoinRequestUseCase {
  constructor(private readonly repo: FamilyRepository) {}
  execute(requestId: string): Promise<Member> {
    if (!requestId) {
      throw new AppError("INVALID_TX", "شناسهٔ درخواست نامعتبر است");
    }
    return this.repo.approveJoinRequest(requestId);
  }
}

export class RejectJoinRequestUseCase {
  constructor(private readonly repo: FamilyRepository) {}
  execute(requestId: string): Promise<void> {
    if (!requestId) {
      throw new AppError("INVALID_TX", "شناسهٔ درخواست نامعتبر است");
    }
    return this.repo.rejectJoinRequest(requestId);
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
