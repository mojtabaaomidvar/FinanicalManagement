/* مخزن رویدادهای مهم خانواده */

import type { EventRepository } from "@/domain/event/event.types";
import type { EventInput, FamilyEvent } from "@/domain/event/event.types";
import { rpc } from "@/infrastructure/api/httpClient";
import { mapEvent, type EventRow } from "./mappers";
import type { TokenProvider } from "./sessionRepository";

export class SupabaseEventRepository implements EventRepository {
  constructor(private readonly tokenProvider: TokenProvider) {}

  private async tok(): Promise<string> {
    const t = await this.tokenProvider.getToken();
    if (!t) throw new Error("NO_SESSION");
    return t;
  }

  async list(): Promise<FamilyEvent[]> {
    const rows = await rpc<EventRow[]>("list_events", {
      p_token: await this.tok(),
    });
    return (rows ?? []).map(mapEvent);
  }

  async add(input: EventInput): Promise<FamilyEvent> {
    const row = await rpc<EventRow>("add_event", {
      p_token: await this.tok(),
      p_title: input.title,
      p_date: input.date,
      p_note: input.note ?? null,
      p_member_id: input.memberId ?? null,
    });
    return mapEvent(row);
  }

  async remove(id: string): Promise<void> {
    await rpc("delete_event", {
      p_token: await this.tok(),
      p_event_id: id,
    });
  }

  async syncBirthdays(): Promise<number> {
    return rpc<number>("sync_birthday_events", {
      p_token: await this.tok(),
    });
  }
}
