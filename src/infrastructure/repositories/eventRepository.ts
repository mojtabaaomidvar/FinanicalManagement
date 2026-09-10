/* مخزن رویدادهای مهم خانواده — اندپوینت‌های REST بک‌اندِ اختصاصی (/events).
   پیشوندِ «Supabase» در نامِ کلاس میراثی است؛ مخزن اکنون REST-محور است و از
   RestClient استفاده می‌کند (توکن خودکار از هدر). */

import type { EventRepository } from "@/domain/event/event.types";
import type { EventInput, FamilyEvent } from "@/domain/event/event.types";
import type { RestClient } from "@/infrastructure/api/restClient";
import { mapEvent, type EventRow } from "./mappers";

export class SupabaseEventRepository implements EventRepository {
  constructor(private readonly client: RestClient) {}

  async list(): Promise<FamilyEvent[]> {
    const rows = await this.client.get<EventRow[]>("/events");
    return (rows ?? []).map(mapEvent);
  }

  async add(input: EventInput): Promise<FamilyEvent> {
    const row = await this.client.post<EventRow>("/events", {
      title: input.title,
      date: input.date,
      note: input.note ?? null,
      member_id: input.memberId ?? null,
      for_member_id: input.forMemberId ?? null,
    });
    return mapEvent(row);
  }

  async remove(id: string): Promise<void> {
    await this.client.del<void>(`/events/${encodeURIComponent(id)}`);
  }

  async syncBirthdays(): Promise<number> {
    const n = await this.client.post<number>("/events/sync-birthdays");
    return n ?? 0;
  }
}
