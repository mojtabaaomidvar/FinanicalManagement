/* مخزن زیردسته‌ها */

import type {
  Subcategory,
  SubcategoryRepository,
} from "@/domain/category/subcategory.types";
import { rpc } from "@/infrastructure/api/httpClient";
import type { TokenProvider } from "./sessionRepository";

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
  constructor(private readonly tokenProvider: TokenProvider) {}

  private async tok(): Promise<string> {
    const t = await this.tokenProvider.getToken();
    if (!t) throw new Error("NO_SESSION");
    return t;
  }

  async list(): Promise<Subcategory[]> {
    const rows = await rpc<SubcategoryRow[]>("list_subcategories", {
      p_token: await this.tok(),
    });
    return (rows ?? []).map(mapSubcategory);
  }

  async add(category: string, name: string): Promise<Subcategory> {
    const row = await rpc<SubcategoryRow>("add_subcategory", {
      p_token: await this.tok(),
      p_category: category,
      p_name: name,
    });
    return mapSubcategory(row);
  }

  async remove(id: string): Promise<void> {
    await rpc("delete_subcategory", {
      p_token: await this.tok(),
      p_subcategory_id: id,
    });
  }
}
