/* انتیتی پیامک بانکی */

export type SmsStatus = "pending" | "recorded" | "ignored";

/** نوع تراکنش قابل استخراج از پیامک — انتقال از پیامک ساخته نمی‌شود */
export type SmsTxType = "expense" | "income";

export interface BankSms {
  id: string;
  familyId: string;
  memberId: string | null;
  rawText: string;
  bank: string | null;
  type: SmsTxType | null;
  amount: number | null;
  balance: number | null;
  /** "YYYY-MM-DD" میلادی */
  date: string | null;
  status: SmsStatus;
  createdAt: string;
}

export interface NewBankSms {
  rawText: string;
  bank: string | null;
  type: SmsTxType | null;
  amount: number | null;
  balance: number | null;
  /** "YYYY-MM-DD" میلادی */
  date: string | null;
}

/** پل پیامک — کلید اتصال اپ فوروادر اندروید برای عضو */
export interface SmsBridge {
  token: string;
  memberId: string;
}
