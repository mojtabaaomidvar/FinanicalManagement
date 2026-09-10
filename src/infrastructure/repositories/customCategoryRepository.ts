/* مخزن دسته‌های سفارشی — اندپوینت‌های REST بک‌اندِ اختصاصی (/custom-categories).
   پیشوندِ «Supabase» در نامِ کلاس میراثی است؛ مخزن اکنون REST-محور است و از
   RestClient استفاده می‌کند (توکن خودکار از هدر). */

import type {
  CustomCategory,
  CustomCategoryRepository,
} from "@/domain/category/custom-category.types";
import type { RestClient } from "@/infrastructure/api/restClient";

interface CustomCategoryRow {
  id: string;
  family_id: string;
  type: "expense" | "income";
  name: string;
  created_at: string;
}

function mapCustomCategory(r: CustomCategoryRow): CustomCategory {
  return {
    id: r.id,
    familyId: r.family_id,
    type: r.type,
    name: r.name,
    createdAt: r.created_at,
  };
}

export class SupabaseCustomCategoryRepository
  implements CustomCategoryRepository
{
  constructor(private readonly client: RestClient) {}

  async list(): Promise<CustomCategory[]> {
    const rows = await this.client.get<CustomCategoryRow[]>(
      "/custom-categories",
    );
    return (rows ?? []).map(mapCustomCategory);
  }

  async add(
    type: "expense" | "income",
    name: string,
  ): Promise<CustomCategory> {
    const row = await this.client.post<CustomCategoryRow>("/custom-categories", {
      type,
      name,
    });
    return mapCustomCategory(row);
  }

  async remove(id: string): Promise<void> {
    await this.client.del<void>(`/custom-categories/${encodeURIComponent(id)}`);
  }
}
