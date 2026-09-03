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
  accountNumber: string | null;
  /** IR + ۲۴ رقم یا null */
  sheba: string | null;
  createdAt: string;
}

export interface AccountInput {
  memberId: string;
  title: string;
  kind?: AccountKind;
  bank?: string | null;
  cardNumber?: string | null;
  accountNumber?: string | null;
  sheba?: string | null;
}
