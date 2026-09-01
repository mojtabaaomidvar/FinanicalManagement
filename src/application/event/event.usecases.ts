/* Use-caseهای رویدادهای مهم خانواده */

import type { EventRepository } from "@/domain/event/event.types";
import type { EventInput, FamilyEvent } from "@/domain/event/event.types";
import { AppError } from "@/shared/lib/appError";

export class ListEventsUseCase {
  constructor(private readonly repo: EventRepository) {}
  execute(): Promise<FamilyEvent[]> {
    return this.repo.list();
  }
}

export class AddEventUseCase {
  constructor(private readonly repo: EventRepository) {}
  async execute(input: EventInput): Promise<FamilyEvent> {
    const title = input.title.trim();
    if (!title || title.length > 60) {
      throw new AppError("INVALID_TX", "عنوان رویداد باید ۱ تا ۶۰ کاراکتر باشد");
    }
    if (!input.date) {
      throw new AppError("INVALID_TX", "تاریخ رویداد را وارد کنید");
    }
    return this.repo.add({ ...input, title });
  }
}

export class DeleteEventUseCase {
  constructor(private readonly repo: EventRepository) {}
  execute(id: string): Promise<void> {
    return this.repo.remove(id);
  }
}
