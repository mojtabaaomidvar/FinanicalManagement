/* انتیتی کارت/حساب بانکی */

export interface Account {
  id: string;
  familyId: string;
  memberId: string;
  title: string;
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
  bank?: string | null;
  cardNumber?: string | null;
  accountNumber?: string | null;
  sheba?: string | null;
}
