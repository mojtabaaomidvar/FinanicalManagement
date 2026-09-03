/* انتیتی تراکنش و ورودی آن */

export type TxType = "expense" | "income" | "transfer";

/** دوره تکرار تراکنش (برای قسط/حقوق/اجاره و…) */
export type TxRepeat = "none" | "weekly" | "monthly" | "yearly";

export const TX_REPEATS: { value: TxRepeat; label: string }[] = [
  { value: "none", label: "بدون تکرار" },
  { value: "weekly", label: "هفتگی" },
  { value: "monthly", label: "ماهانه" },
  { value: "yearly", label: "سالانه" },
];

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
  /** حساب منشا (هزینه/انتقال) یا مقصد واریز (درآمد) — الزامی */
  accountId: string | null;
  /** حساب مقصد انتقال — فقط type=transfer */
  toAccountId: string | null;
  /** زیردسته (اختیاری) */
  subcategoryId: string | null;
  /** تکرار دوره‌ای — پیش‌فرض none */
  repeat: TxRepeat;
  /** تاریخ پایان تکرار (میلادی ISO) — الزامی وقتی repeat ≠ none */
  repeatEnd: string | null;
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
  /** حساب منشا (هزینه/انتقال) یا مقصد واریز (درآمد) — الزامی */
  accountId?: string | null;
  /** حساب مقصد انتقال — الزامی برای type=transfer */
  toAccountId?: string | null;
  /** زیردسته (اختیاری) */
  subcategoryId?: string | null;
  /** تکرار دوره‌ای */
  repeat?: TxRepeat;
  /** تاریخ پایان تکرار (میلادی ISO) — الزامی وقتی repeat ≠ none؛ باید بعد از date باشد */
  repeatEnd?: string | null;
}
