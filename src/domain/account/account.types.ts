/* انتیتی حساب — بانکی یا کیف‌پول (نقد، پس‌انداز، سفر…) */

import type { Money } from "@/shared/lib/money";
export type AccountKind = "bank" | "wallet";

export interface Account {
  id: string;
  familyId: string;
  memberId: string;
  title: string;
  /** bank = حساب/کارت بانکی؛ wallet = کیف‌پول (نقد، پس‌انداز، پروژه) */
  kind: AccountKind;
  bank: string | null;
  /** ۱۶ رقم یا null */
  cardNumber: string | null;
  /** موجودی اولیه (پایه — تومان) — تراکنش‌ها روی آن جمع می‌شوند */
  initialBalance: Money;
  /**
   * رضایت صریح کاربر برای تشخیص تراکنش از پیامک — فقط همین حساب.
   *
   * عمدا در AccountInput و AccountPatch نیست: رضایت نباید عارضه جانبی
   * «ساختن حساب» یا «ویرایش عنوان» باشد. تنها راه تغییرش اندپوینت
   * اختصاصی خودش است تا هر بار یک تصمیم آگاهانه ثبت شود.
   */
  smsEnabled: boolean;
  createdAt: string;
}

export interface AccountInput {
  memberId: string;
  title: string;
  kind?: AccountKind;
  bank?: string | null;
  cardNumber?: string | null;
  /** موجودی اولیه (پایه) — پیش‌فرض ۰؛ منفی مجاز نیست */
  initialBalance?: Money;
}

/** ورودی ویرایش — نوع حساب و مالک تغییر نمی‌کنند */
export interface AccountPatch {
  confirmCardChange?: boolean;
  id: string;
  title: string;
  bank?: string | null;
  cardNumber?: string | null;
  /** Compatibility-only unchanged opening value; corrections have their own command. */
  initialBalance?: Money;
  /** برای اعتبارسنجی الزامی‌بودن شماره کارت — از حساب موجود می‌آید */
  kind: AccountKind;
}
/** Destination routing only; never includes a peer's balance or bank details. */
export type AccountTransferTarget = Pick<Account, "id" | "familyId" | "memberId" | "kind">;
