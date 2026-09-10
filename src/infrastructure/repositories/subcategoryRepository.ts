/* مخزن زیردسته‌ها — اندپوینت‌های REST بک‌اندِ اختصاصی (/subcategories).
   پیشوندِ «Supabase» در نامِ کلاس میراثی است؛ مخزن اکنون REST-محور است و از
   RestClient استفاده می‌کند (توکن خودکار از هدر). */

import type {
  Subcategory,
  SubcategoryRepository,
} from "@/domain/category/subcategory.types";
import type { RestClient } from "@/infrastructure/api/restClient";

interface SubcategoryRow {
  id: string;
  family_id: string;
  category: string;
  name: string;
  created_at: string;
}

function mapSubcategory(r: SubcategoryRow): Subcategory {
  return {
    id: r.id,
    familyId: r.family_id,
    category: r.category,
    name: r.name,
    createdAt: r.created_at,
  };
}

export class SupabaseSubcategoryRepository implements SubcategoryRepository {
  constructor(private readonly client: RestClient) {}

  async list(): Promise<Subcategory[]> {
    const rows = await this.client.get<SubcategoryRow[]>("/subcategories");
    return (rows ?? []).map(mapSubcategory);
  }

  async add(category: string, name: string): Promise<Subcategory> {
    const row = await this.client.post<SubcategoryRow>("/subcategories", {
      category,
      name,
    });
    return mapSubcategory(row);
  }

  async remove(id: string): Promise<void> {
    await this.client.del<void>(`/subcategories/${encodeURIComponent(id)}`);
  }
}
