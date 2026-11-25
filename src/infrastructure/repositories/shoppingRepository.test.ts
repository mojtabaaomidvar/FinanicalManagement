import { describe, expect, it, vi } from "vitest";
import type { RestClient } from "@/infrastructure/api/restClient";
import { RestShoppingRepository } from "./shoppingRepository";
import { formatMoney } from "@/shared/lib/money";
import { parseShoppingPrice } from "@/domain/shopping/shopping.rules";

const item = { id: "item", list_id: "list", title: "User item", qty: "3.00", checked: true };
const list = { id: "list", title: "User list", items: [] };

describe("exact shopping financial boundary", () => {
  it.each(["9999999999999.99", "0.1", "0.01", "1200.25"])("retains %s through read, unit switches, unchanged edit and checkout", async price => {
    const get = vi.fn().mockResolvedValue([{ ...list, items: [{ ...item, price }] }]);
    const patch = vi.fn().mockResolvedValue({ ...item, price });
    const post = vi.fn().mockResolvedValue({ list, total: price, item_count: 1, transaction_id: "tx" });
    const repository = new RestShoppingRepository({ get, patch, post } as unknown as RestClient);
    const [loaded] = await repository.listLists();
    expect(loaded.items[0].price).toBe(price);
    for (const currency of ["تومان", "ریال"]) {
      const unchanged = parseShoppingPrice(formatMoney(price, currency), currency);
      expect(unchanged).toBe(price);
      expect((await repository.updateItem(item.id, { title: item.title, price: unchanged })).price).toBe(price);
      expect(patch.mock.calls.at(-1)?.[1].price).toBe(price);
    }
    expect((await repository.completeTrip(list.id, {})).total).toBe(price);
  });
  it.each([0.1, 9007199254740992, "1e3", ""])("rejects invalid wire price and total: %s", async price => {
    const get = vi.fn().mockResolvedValue([{ ...list, items: [{ ...item, price }] }]);
    const post = vi.fn().mockResolvedValue({ list, total: price, item_count: 1 });
    const repository = new RestShoppingRepository({ get, post } as unknown as RestClient);
    await expect(repository.listLists()).rejects.toThrow("Invalid exact decimal");
    await expect(repository.completeTrip(list.id, {})).rejects.toThrow("Invalid exact decimal");
  });
});
