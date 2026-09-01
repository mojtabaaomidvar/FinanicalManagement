/* مخزن دسته‌های سفارشی */

import type {
  CustomCategory,
  CustomCategoryRepository,
} from "@/domain/category/custom-category.types";
import { rpc } from "@/infrastructure/api/httpClient";
import type { TokenProvider } from "./sessionRepository";

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
  constructor(private readonly tokenProvider: TokenProvider) {}

  private async tok(): Promise<string> {
    const t = await this.tokenProvider.getToken();
    if (!t) throw new Error("NO_SESSION");
    return t;
  }

  async list(): Promise<CustomCategory[]> {
    const rows = await rpc<CustomCategoryRow[]>("list_custom_categories", {
      p_token: await this.tok(),
    });
    return (rows ?? []).map(mapCustomCategory);
  }

  async add(
    type: "expense" | "income",
    name: string,
  ): Promise<CustomCategory> {
    const row = await rpc<CustomCategoryRow>("add_custom_category", {
      p_token: await this.tok(),
      p_type: type,
      p_name: name,
    });
    return mapCustomCategory(row);
  }

  async ensureDefaults(): Promise<number> {
    return rpc<number>("ensure_default_subcategories", {
      p_token: await this.tok(),
    });
  }
}
