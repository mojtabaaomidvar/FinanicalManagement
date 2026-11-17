import type { ChildRepository } from "@/domain/child/child.repository";
import type { ChildInput } from "@/domain/child/child.types";

export class ListChildrenUseCase {
  constructor(private readonly repo: ChildRepository) {}
  execute() { return this.repo.list(); }
}
export class GetChildUseCase {
  constructor(private readonly repo: ChildRepository) {}
  execute(id: string) { return this.repo.get(id); }
}
export class AddChildUseCase {
  constructor(private readonly repo: ChildRepository) {}
  execute(input: ChildInput) { return this.repo.add(input); }
}
export class UpdateChildUseCase {
  constructor(private readonly repo: ChildRepository) {}
  execute(id: string, input: ChildInput, baseRevision: number) { return this.repo.update(id, input, baseRevision); }
}
