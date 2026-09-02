/* انتیتی تراکنش و ورودی آن */

export type TxType = "expense" | "income";

/** تصویر پیوست تراکنش — رسید خرید، عکس محصول و… */
export interface TransactionPhoto {
  id: string;
  url: string;
  caption: string | null;
}

export interface Transaction {
  id: string;
  familyId: string;
  memberId: string;
  type: TxType;
  amount: number;
  category: string;
  /** تاریخ میلادی ISO — "YYYY-MM-DD" */
  date: string;
  /** ساعت ثبت — "HH:MM" یا null */
  time: string | null;
  note: string | null;
  /** حساب منشا/مقصد (الزامی) */
  accountId: string | null;
  /** زیردسته (اختیاری) */
  subcategoryId: string | null;
  photos: TransactionPhoto[];
  createdAt: string;
}

export interface TransactionInput {
  memberId: string;
  type: TxType;
  amount: number;
  category: string;
  /** "YYYY-MM-DD" میلادی */
  date: string;
  /** "HH:MM" — اختیاری */
  time?: string | null;
  note?: string | null;
  /** حساب منشا/مقصد (الزامی) */
  accountId?: string | null;
  /** زیردسته (اختیاری) */
  subcategoryId?: string | null;
}
