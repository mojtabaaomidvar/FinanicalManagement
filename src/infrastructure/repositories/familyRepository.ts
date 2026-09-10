/* مخزن خانواده و اعضا — اندپوینت‌های REST بک‌اندِ اختصاصی.
   پیشوندِ «Supabase» در نامِ کلاس میراثی است؛ مخزن اکنون REST-محور است و از
   RestClient استفاده می‌کند (توکن خودکار از هدر).

   مسیرها ترکیبی‌اند:
   - خانواده/اعضا (خواندن و مدیریت مالک): زیرِ /auth/* (get_tenant_member).
   - تنظیماتِ خانواده و پروفایلِ عضو (بیرون از RLS، members.py): زیرِ /family/* و /members/*. */

import type { FamilyRepository } from "@/domain/family/family.repository";
import type {
  Family,
  Member,
  ProfileInput,
} from "@/domain/family/family.types";
import type { RestClient } from "@/infrastructure/api/restClient";
import {
  mapFamily,
  mapMember,
  type FamilyRow,
  type MemberRow,
} from "./mappers";

export class SupabaseFamilyRepository implements FamilyRepository {
  constructor(private readonly client: RestClient) {}

  async getFamily(): Promise<Family> {
    const row = await this.client.get<FamilyRow>("/auth/family");
    return mapFamily(row);
  }

  async getMembers(): Promise<Member[]> {
    const rows = await this.client.get<MemberRow[]>("/auth/members");
    return (rows ?? []).map(mapMember);
  }

  async setMonthlyBudget(budget: number): Promise<void> {
    /* واحد پول و تم از v5.8 شخصی شدند؛ اینجا فقط سقفِ بودجهٔ خانواده به‌روز می‌شود. */
    await this.client.patch<void>("/family/settings", { budget });
  }

  async removeMember(memberId: string): Promise<void> {
    await this.client.del<void>(
      `/auth/members/${encodeURIComponent(memberId)}`,
    );
  }

  async updateOwnProfile(input: ProfileInput): Promise<Member> {
    const row = await this.client.patch<MemberRow>("/members/me", {
      name: input.name,
      gender: input.gender,
      birth_date: input.birthDate,
      avatar_url: input.avatarUrl,
      theme: input.theme ?? null,
    });
    return mapMember(row);
  }

  async addMemberByManager(
    name: string,
    phone: string,
    relation: string,
  ): Promise<Member> {
    const row = await this.client.post<MemberRow>("/auth/members", {
      name,
      phone,
      relation,
    });
    return mapMember(row);
  }

  async setTheme(theme: "light" | "dark" | "auto"): Promise<void> {
    await this.client.patch<void>("/members/me/theme", { theme });
  }

  async setCurrency(currency: string): Promise<Member> {
    const row = await this.client.patch<MemberRow>("/members/me/currency", {
      currency,
    });
    return mapMember(row);
  }

  async setMemberRelation(memberId: string, relation: string): Promise<Member> {
    const row = await this.client.patch<MemberRow>(
      `/members/${encodeURIComponent(memberId)}/relation`,
      { relation },
    );
    return mapMember(row);
  }
}
