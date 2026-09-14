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
  /** فرستنده همان‌طور که رسیده (سرشماره یا نام) — برای ساختن فرستنده مجاز */
  sender: string | null;
  /**
   * حسابی که پیامک به آن نسبت داده شد.
   *
   * null یعنی «نیازمند بررسی»: پیامک از منبعی مجاز آمده ولی سرور نتوانسته
   * قطعی بگوید مال کدام حساب است (مثلا دو حساب از یک بانک). هرگز به معنای
   * «رد شد» نیست؛ پیامک رد شده اصلا ذخیره نمی‌شود.
   */
  accountId: string | null;
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
