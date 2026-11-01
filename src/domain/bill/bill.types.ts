/* §۱.۹ — انتیتیِ قبض.

   قبض = **تعهدِ پرداخت‌نشده**، نه نوعِ دیگری از تراکنش. دلیلش و تصمیم‌های
   پشتش در `backend/alembic/versions/0010_bills.py` مستند است. */

/** نوعِ قبض. «charge» شارژِ ساختمان است — موجودیتِ جدا نشد چون تفاوتش
 *  مبلغِ ثابت و نداشتنِ شناسهٔ قبض است و هر دو اختیاری‌اند. */
export type BillKind =
  | "electricity"
  | "water"
  | "gas"
  | "internet"
  | "phone"
  | "charge"
  | "other";

export type BillState = "unpaid" | "paid" | "cancelled";

export const BILL_KINDS: { value: BillKind; label: string; icon: string }[] = [
  { value: "electricity", label: "برق", icon: "i-home-i" },
  { value: "water", label: "آب", icon: "i-home-i" },
  { value: "gas", label: "گاز", icon: "i-home-i" },
  { value: "internet", label: "اینترنت", icon: "i-phone" },
  { value: "phone", label: "تلفن", icon: "i-phone" },
  { value: "charge", label: "شارژ ساختمان", icon: "i-home" },
  { value: "other", label: "سایر", icon: "i-bill" },
];

export interface Bill {
  id: string;
  kind: BillKind;
  title: string;
  /** تومان — واحدِ پایه، عیناً مثلِ Transaction.amount (§۶) */
  amount: number;
  /** "YYYY-MM-DD" **میلادی** — جلالی فقط در نمایش */
  dueDate: string;
  /** شناسهٔ قبض / شناسهٔ پرداختِ ایرانی — رشته می‌ماند چون صفرِ ابتدایی دارند */
  billNo: string | null;
  paymentNo: string | null;
  state: BillState;
  /** ISO با T — میلادی */
  paidAt: string | null;
  paidByMemberId: string | null;
  /** تراکنشِ هزینه‌ای که پرداخت ساخت (رابطهٔ Bill ↕ Finance، §۴.۷) */
  transactionId: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface BillInput {
  kind: BillKind;
  title: string;
  /** تومان */
  amount: number;
  /** "YYYY-MM-DD" میلادی */
  dueDate: string;
  billNo?: string | null;
  paymentNo?: string | null;
  note?: string | null;
}

/** ورودیِ پرداخت. هر دو اختیاری: حساب چون تراکنش هم بی‌حساب می‌پذیرد
 *  (پرداختِ نقدی)، و تاریخ چون نبودش یعنی «امروز». */
export interface BillPayInput {
  accountId?: string | null;
  /** "YYYY-MM-DD" میلادی */
  date?: string | null;
}
