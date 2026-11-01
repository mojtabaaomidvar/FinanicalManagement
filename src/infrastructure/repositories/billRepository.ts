/* مخزنِ §۱.۹ قبوض — اندپوینت‌های REST بک‌اند (/bills...).

   نام‌گذاری بدون پیشوند «Supabase» چون از ابتدا REST-محور است (همان قاعدهٔ
   smsSettingsRepository و notificationRepository). */

import type { BillRepository } from "@/domain/bill/bill.repository";
import type {
  Bill,
  BillInput,
  BillKind,
  BillPayInput,
  BillState,
} from "@/domain/bill/bill.types";
import type { RestClient } from "@/infrastructure/api/restClient";

type BillRow = {
  id: string;
  kind: string;
  title: string;
  amount: string | number;
  due_date: string;
  bill_no: string | null;
  payment_no: string | null;
  state: string;
  paid_at: string | null;
  paid_by_member_id: string | null;
  transaction_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

const KINDS: BillKind[] = [
  "electricity",
  "water",
  "gas",
  "internet",
  "phone",
  "charge",
  "other",
];

/* مبلغ روی سیم می‌تواند رشته باشد (Numeric پستگرس در JSON رشته می‌شود) —
   عیناً مثلِ مبلغِ تراکنش. Number() یک‌بار این‌جا انجام می‌شود تا هیچ
   مصرف‌کننده‌ای مجبور نباشد حدس بزند. */
function mapBill(r: BillRow): Bill {
  return {
    id: r.id,
    /* نوعِ ناشناس به «سایر» می‌افتد نه به اولین عضوِ فهرست: اگر سرور روزی
       نوعِ تازه‌ای اضافه کند، قبض به‌غلط «برق» نشان داده نمی‌شود. */
    kind: KINDS.includes(r.kind as BillKind) ? (r.kind as BillKind) : "other",
    title: r.title,
    amount: Number(r.amount),
    dueDate: r.due_date,
    billNo: r.bill_no ?? null,
    paymentNo: r.payment_no ?? null,
    /* حالتِ ناشناس به «پرداخت‌نشده» می‌افتد — محافظه‌کارانه‌ترین انتخاب:
       قبضی که وضعش معلوم نیست باید دیده شود، نه پنهان بماند. */
    state: (["unpaid", "paid", "cancelled"] as BillState[]).includes(
      r.state as BillState,
    )
      ? (r.state as BillState)
      : "unpaid",
    paidAt: r.paid_at ?? null,
    paidByMemberId: r.paid_by_member_id ?? null,
    transactionId: r.transaction_id ?? null,
    note: r.note ?? null,
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
  };
}

function body(input: BillInput): Record<string, unknown> {
  return {
    kind: input.kind,
    title: input.title,
    amount: input.amount,
    due_date: input.dueDate,
    bill_no: input.billNo ?? null,
    payment_no: input.paymentNo ?? null,
    note: input.note ?? null,
  };
}

export class RestBillRepository implements BillRepository {
  constructor(private readonly client: RestClient) {}

  async list(): Promise<Bill[]> {
    const rows = await this.client.get<BillRow[]>("/bills");
    return (rows ?? []).map(mapBill);
  }

  async add(input: BillInput): Promise<Bill> {
    return mapBill(await this.client.post<BillRow>("/bills", body(input)));
  }

  async update(id: string, input: BillInput): Promise<Bill> {
    return mapBill(
      await this.client.patch<BillRow>(
        `/bills/${encodeURIComponent(id)}`,
        body(input),
      ),
    );
  }

  async remove(id: string): Promise<void> {
    await this.client.del<void>(`/bills/${encodeURIComponent(id)}`);
  }

  async pay(id: string, input: BillPayInput): Promise<Bill> {
    return mapBill(
      await this.client.post<BillRow>(`/bills/${encodeURIComponent(id)}/pay`, {
        account_id: input.accountId ?? null,
        date: input.date ?? null,
      }),
    );
  }

  async unpay(id: string): Promise<Bill> {
    return mapBill(
      await this.client.post<BillRow>(`/bills/${encodeURIComponent(id)}/unpay`),
    );
  }

  async cancel(id: string): Promise<Bill> {
    return mapBill(
      await this.client.post<BillRow>(
        `/bills/${encodeURIComponent(id)}/cancel`,
      ),
    );
  }
}
