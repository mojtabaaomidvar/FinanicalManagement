/* انتیتی تراکنش و ورودی آن */

export type TxType = "expense" | "income";

export interface Transaction {
  id: string;
  familyId: string;
  memberId: string;
  type: TxType;
  amount: number;
  category: string;
  /** تاریخ میلادی ISO — "YYYY-MM-DD" */
  date: string;
  note: string | null;
  /** حساب منشا/مقصد (اختیاری) */
  accountId: string | null;
  createdAt: string;
}

export interface TransactionInput {
  memberId: string;
  type: TxType;
  amount: number;
  category: string;
  /** "YYYY-MM-DD" میلادی */
  date: string;
  note?: string | null;
  /** حساب منشا/مقصد (اختیاری) */
  accountId?: string | null;
}
