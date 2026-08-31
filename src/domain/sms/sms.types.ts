/* انتیتی پیامک بانکی */

import type { TxType } from "../transaction/transaction.types";

export type SmsStatus = "pending" | "recorded" | "ignored";

export interface BankSms {
  id: string;
  familyId: string;
  memberId: string | null;
  rawText: string;
  bank: string | null;
  type: TxType | null;
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
  type: TxType | null;
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
