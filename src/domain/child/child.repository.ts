import type { Child, ChildDetail, ChildInput, ChildList } from "./child.types";

export interface ChildRepository {
  list(): Promise<ChildList>;
  get(id: string): Promise<ChildDetail>;
  add(input: ChildInput): Promise<Child>;
  update(id: string, input: ChildInput, baseRevision: number): Promise<Child>;
}
