/* مخزن خانواده و اعضا — اندپوینت‌های REST بک‌اند اختصاصی.
   پیشوند «Supabase» در نام کلاس میراثی است؛ مخزن اکنون REST-محور است و از
   RestClient استفاده می‌کند (توکن خودکار از هدر).

   مسیرها ترکیبی‌اند:
   - خانواده/اعضا (خواندن و مدیریت مالک): زیر /auth/* (get_tenant_member).
   - تنظیمات خانواده و پروفایل عضو (بیرون از RLS، members.py): زیر /family/* و /members/*. */

import type { FamilyRepository } from "@/domain/family/family.repository";
import type { HomePreferences, HomePreferencesSnapshot } from "@/domain/home/homePreferences.types";
import { normalizeHomePreferences } from "@/domain/home/homePreferences.rules";
import type {
  Family,
  JoinRequest,
  Member,
  ProfileInput,
} from "@/domain/family/family.types";
import type { RestClient, ReqOpts } from "@/infrastructure/api/restClient";
import type { TokenProvider } from "./sessionRepository";
import { AppError } from "@/shared/lib/appError";
import {
  mapFamily,
  mapJoinRequest,
  mapMember,
  type FamilyRow,
  type JoinRequestRow,
  type MemberRow,
} from "./mappers";

export class SupabaseFamilyRepository implements FamilyRepository {
  constructor(private readonly client: RestClient, private readonly tokenProvider: TokenProvider) {}

  private async homeOptions(): Promise<ReqOpts> {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      throw new AppError("NETWORK", "ذخیرهٔ چیدمان در حساب به اتصال اینترنت نیاز دارد.");
    }
    const bearer = await this.tokenProvider.getToken();
    if (!bearer) throw new AppError("SESSION_EXPIRED", "نشست تغییر کرده است؛ صفحه را دوباره باز کنید.");
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      throw new AppError("NETWORK", "ذخیرهٔ چیدمان در حساب به اتصال اینترنت نیاز دارد.");
    }
    return { bearer, cache: "no-store" };
  }

  async getFamily(): Promise<Family> {
    const row = await this.client.get<FamilyRow>("/auth/family");
    return mapFamily(row);
  }

  async getMembers(): Promise<Member[]> {
    const rows = await this.client.get<MemberRow[]>("/auth/members");
    return (rows ?? []).map(mapMember);
  }

  async getHomePreferences(): Promise<HomePreferencesSnapshot> {
    const row = await this.client.get<HomePreferencesSnapshot>("/members/me/home-preferences", await this.homeOptions());
    return {
      revision: row.revision,
      preferences: row.preferences === null ? null : normalizeHomePreferences(row.preferences),
    };
  }

  async setHomePreferences(revision: number, preferences: HomePreferences): Promise<HomePreferencesSnapshot> {
    const row = await this.client.patch<HomePreferencesSnapshot>("/members/me/home-preferences", {
      revision,
      preferences: normalizeHomePreferences(preferences),
    }, await this.homeOptions());
    return {
      revision: row.revision,
      preferences: row.preferences === null ? null : normalizeHomePreferences(row.preferences),
    };
  }

  async setMonthlyBudget(budget: number, snapshot?: { budget: number; total: number }): Promise<void> {
    /* واحد پول و تم از v5.8 شخصی شدند؛ اینجا فقط سقف بودجهٔ خانواده به‌روز می‌شود. */
    await this.client.patch<void>("/family/settings", { budget,
      ...(snapshot ? { expected_budget: snapshot.budget, expected_budget_total: snapshot.total } : {}) });
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

  /* ── §۲.۶ تأییدِ عضویت — زیرِ /auth/* چون require_admin_tenant لازم دارند ── */

  async listJoinRequests(): Promise<JoinRequest[]> {
    const rows = await this.client.get<JoinRequestRow[]>("/auth/join-requests");
    return (rows ?? []).map(mapJoinRequest);
  }

  async approveJoinRequest(requestId: string): Promise<Member> {
    const row = await this.client.post<MemberRow>(
      `/auth/join-requests/${encodeURIComponent(requestId)}/approve`,
    );
    return mapMember(row);
  }

  async rejectJoinRequest(requestId: string): Promise<void> {
    await this.client.post<{ ok: boolean }>(
      `/auth/join-requests/${encodeURIComponent(requestId)}/reject`,
    );
  }
}
