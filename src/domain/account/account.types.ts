/* انتیتی حساب — بانکی یا کیف‌پول (نقد، پس‌انداز، سفر…) */

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
  initialBalance: number;
  createdAt: string;
}

export interface AccountInput {
  memberId: string;
  title: string;
  kind?: AccountKind;
  bank?: string | null;
  cardNumber?: string | null;
  /** موجودی اولیه (پایه) — پیش‌فرض ۰؛ منفی مجاز نیست */
  initialBalance?: number;
}

/** ورودی ویرایش — نوع حساب و مالک تغییر نمی‌کنند */
export interface AccountPatch {
  id: string;
  title: string;
  bank?: string | null;
  cardNumber?: string | null;
  /**
   * موجودی اولیه (پایه). برخلاف افزودن، اینجا منفی هم مجاز است: کاربر
   * «موجودی فعلی» را ویرایش می‌کند و موجودی اولیه = هدف منهای اثر
   * تراکنش‌ها؛ اگر تراکنش‌ها از موجودی واقعی بیشتر باشند، منفی می‌شود.
   */
  initialBalance?: number;
  /** برای اعتبارسنجی الزامی‌بودن شماره کارت — از حساب موجود می‌آید */
  kind: AccountKind;
}
