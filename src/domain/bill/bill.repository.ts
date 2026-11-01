/* §۱.۹ — درزِ مخزنِ قبض (پیاده‌سازی در infrastructure).

   حالتِ قبض (`state`) در `BillInput` نیست و این عمدی است: حالت فقط با کنش
   عوض می‌شود (`pay`/`unpay`/`cancel`)، نه با یک ویرایشِ آزاد. وگرنه کلاینت
   می‌توانست قبض را «پرداخت‌شده» کند بی‌آنکه خرجی ثبت شود — یعنی خرجِ ماه
   کم‌تر از واقع. */

import type { Bill, BillInput, BillPayInput } from "./bill.types";

export interface BillRepository {
  /** پرداخت‌نشده‌ها اول (به‌ترتیبِ سررسید) — ترتیب از سرور می‌آید */
  list(): Promise<Bill[]>;
  add(input: BillInput): Promise<Bill>;
  update(id: string, input: BillInput): Promise<Bill>;
  remove(id: string): Promise<void>;
  /** قبض را می‌بندد **و** تراکنشِ هزینه می‌سازد (رابطهٔ §۴.۷) */
  pay(id: string, input: BillPayInput): Promise<Bill>;
  /** برگرداندنِ پرداخت — تراکنشش هم حذف می‌شود */
  unpay(id: string): Promise<Bill>;
  /** «نمی‌پردازم» — بی‌ساختِ تراکنش، و سند می‌ماند */
  cancel(id: string): Promise<Bill>;
}
