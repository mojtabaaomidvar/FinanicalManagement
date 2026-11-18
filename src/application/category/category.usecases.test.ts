import { describe, expect, it, vi } from "vitest";
import { AddCustomCategoryUseCase } from "./custom-category.usecases";
import { AddSubcategoryUseCase } from "./subcategory.usecases";
import type { CustomCategoryRepository } from "@/domain/category/custom-category.types";
import type { SubcategoryRepository } from "@/domain/category/subcategory.types";

describe("custom category writes", () => {
  const repo = () => ({ list: vi.fn(), add: vi.fn(), remove: vi.fn() }) satisfies CustomCategoryRepository;

  it("rejects transfer categories before contacting the repository", async () => {
    const repository = repo();
    await expect(new AddCustomCategoryUseCase(repository).execute("transfer", "Name")).rejects.toThrow();
    expect(repository.add).not.toHaveBeenCalled();
  });

  it.each(["", "   ", "x".repeat(31)])("rejects an invalid name before writing: %j", async name => {
    const repository = repo();
    await expect(new AddCustomCategoryUseCase(repository).execute("expense", name)).rejects.toThrow();
    expect(repository.add).not.toHaveBeenCalled();
  });

  it("preserves the server's existing identity and trims only outer whitespace", async () => {
    const repository = repo(), existing = { id: "existing", familyId: "family", type: "income" as const, name: "كيك", createdAt: "now" };
    repository.add.mockResolvedValue(existing);
    expect(await new AddCustomCategoryUseCase(repository).execute("income", "  كيك  ")).toBe(existing);
    expect(repository.add).toHaveBeenCalledExactlyOnceWith("income", "كيك");
  });
});

describe("subcategory writes", () => {
  const repo = () => ({ list: vi.fn(), add: vi.fn(), remove: vi.fn() }) satisfies SubcategoryRepository;

  it.each(["", "   ", "x".repeat(61)])("rejects an invalid parent before writing: %j", async parent => {
    const repository = repo();
    await expect(new AddSubcategoryUseCase(repository).execute(parent, "Label")).rejects.toThrow();
    expect(repository.add).not.toHaveBeenCalled();
  });

  it("preserves the label and existing identity under the trimmed parent", async () => {
    const repository = repo(), existing = { id: "existing", familyId: "family", category: "food", name: "نان", createdAt: "now" };
    repository.add.mockResolvedValue(existing);
    expect(await new AddSubcategoryUseCase(repository).execute(" food ", " نان ")).toBe(existing);
    expect(repository.add).toHaveBeenCalledExactlyOnceWith("food", "نان");
  });
});
