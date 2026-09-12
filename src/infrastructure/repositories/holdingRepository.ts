/* مخزن دارایی‌ها — اندپوینت REST بک‌اندِ اختصاصی (/holdings).

   قیمت و ارزش عمداً در بدنهٔ درخواست نمی‌روند: سرور خودش از اسنپ‌شاتِ بازار
   حساب‌شان می‌کند. اگر کلاینت قیمت می‌فرستاد، کاربرِ بدخواه می‌توانست ارزشِ
   دلخواه بسازد و کاربرِ عادی هم با دادهٔ کهنهٔ تبش عددِ غلط ثبت می‌کرد. */

import type { HoldingRepository } from "@/domain/holding/holding.repository";
import type {
  Holding,
  HoldingInput,
  HoldingKind,
  HoldingList,
  HoldingPatch,
} from "@/domain/holding/holding.types";
import type { RestClient } from "@/infrastructure/api/restClient";

type HoldingRow = {
  id: string;
  family_id: string;
  member_id: string;
  kind: string;
  symbol: string;
  name: string;
  unit: string;
  quantity: number;
  created_at: string;
  price: number;
  value: number;
  priced: boolean;
};

type HoldingListRow = {
  items: HoldingRow[];
  total: number;
  unpriced: number;
  stale: boolean;
};

function mapHolding(r: HoldingRow): Holding {
  return {
    id: r.id,
    familyId: r.family_id,
    memberId: r.member_id,
    // سرور kind را از فهرستِ بسته‌ای اعتبارسنجی می‌کند، پس تبدیل امن است
    kind: r.kind as HoldingKind,
    symbol: r.symbol,
    name: r.name,
    unit: r.unit,
    quantity: r.quantity,
    createdAt: r.created_at,
    price: r.price,
    value: r.value,
    priced: r.priced,
  };
}

export class RestHoldingRepository implements HoldingRepository {
  constructor(private readonly client: RestClient) {}

  async list(): Promise<HoldingList> {
    const r = await this.client.get<HoldingListRow>("/holdings");
    return {
      items: (r.items ?? []).map(mapHolding),
      total: r.total,
      unpriced: r.unpriced,
      stale: r.stale,
    };
  }

  async add(input: HoldingInput): Promise<Holding> {
    /* پاسخِ افزودن عمداً بی‌قیمت است (price/value صفر، priced=false): سرور
       برای یک ردیف، یک فراخوانیِ جداگانهٔ بازار نمی‌زند. مصرف‌کننده باید پس از
       افزودن، فهرست را تازه کند تا قیمت‌ها یک‌جا بیایند. */
    const row = await this.client.post<HoldingRow>("/holdings", {
      kind: input.kind,
      symbol: input.symbol,
      name: input.name,
      unit: input.unit,
      quantity: input.quantity,
    });
    return mapHolding(row);
  }

  async update(patch: HoldingPatch): Promise<Holding> {
    // فقط مقدار؛ نوع و نماد تغییرناپذیرند (ردیفِ تازه جایِ ویرایشِ نماد را می‌گیرد)
    const row = await this.client.patch<HoldingRow>(
      `/holdings/${encodeURIComponent(patch.id)}`,
      { quantity: patch.quantity },
    );
    return mapHolding(row);
  }

  async remove(id: string): Promise<void> {
    await this.client.del<void>(`/holdings/${encodeURIComponent(id)}`);
  }
}
