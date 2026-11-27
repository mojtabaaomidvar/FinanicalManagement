import type { InventoryCatalogRepository, InventorySuggestion } from "@/domain/inventory/inventory.catalog";
import { isInventoryCatalogGroup } from "@/domain/inventory/inventory.catalog";
import type { RestClient } from "@/infrastructure/api/restClient";

export class RestInventoryCatalogRepository implements InventoryCatalogRepository {
  constructor(private readonly client: RestClient) {}

  async list(): Promise<InventorySuggestion[]> {
    const entries = await this.client.get<InventorySuggestion[]>("/inventory/catalog");
    return entries.filter(entry => isInventoryCatalogGroup(entry.group));
  }
}
