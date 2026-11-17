import type { PetCareInput } from "@/domain/pet/pet.types";

/** Retries of one care form share an id; edited input starts another operation. */
export class PetCareOperation {
  private current: { key: string; id: string } | null = null;
  reset(): void { this.current = null; }
  idFor(input: PetCareInput): string {
    const key = JSON.stringify([input.title.trim(), input.assigneeId, input.dueDate]);
    if (this.current?.key !== key) this.current = { key, id: crypto.randomUUID() };
    return this.current.id;
  }
}
