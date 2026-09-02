/* مخزن خانواده و اعضا */

import type {
  FamilyRepository,
} from "@/domain/family/family.repository";
import type {
  Family,
  FamilySettings,
  Member,
  ProfileInput,
} from "@/domain/family/family.types";
import { rpc } from "@/infrastructure/api/httpClient";
import {
  mapFamily,
  mapMember,
  type FamilyRow,
  type MemberRow,
} from "./mappers";
import type { TokenProvider } from "./sessionRepository";

export class SupabaseFamilyRepository implements FamilyRepository {
  constructor(private readonly tokenProvider: TokenProvider) {}

  private async tok(): Promise<string> {
    const t = await this.tokenProvider.getToken();
    if (!t) throw new Error("NO_SESSION");
    return t;
  }

  async getFamily(): Promise<Family> {
    const row = await rpc<FamilyRow>("get_family", {
      p_token: await this.tok(),
    });
    return mapFamily(row);
  }

  async getMembers(): Promise<Member[]> {
    const rows = await rpc<MemberRow[]>("get_members", {
      p_token: await this.tok(),
    });
    return (rows ?? []).map(mapMember);
  }

  async updateSettings(s: FamilySettings): Promise<void> {
    await rpc("update_family_settings", {
      p_token: await this.tok(),
      p_budget: s.budget,
      p_currency: s.currency,
      p_dark: s.dark,
    });
  }

  async removeMember(memberId: string): Promise<void> {
    await rpc("remove_member", {
      p_token: await this.tok(),
      p_member_id: memberId,
    });
  }

  async updateOwnProfile(input: ProfileInput): Promise<Member> {
    const row = await rpc<MemberRow>("update_member_profile", {
      p_token: await this.tok(),
      p_name: input.name,
      p_gender: input.gender,
      p_birth_date: input.birthDate,
      p_national_id: input.nationalId,
      p_avatar_url: input.avatarUrl,
      p_theme: input.theme ?? null,
    });
    return mapMember(row);
  }

  async addMemberByManager(
    name: string,
    phone: string,
    relation: string,
  ): Promise<Member> {
    const row = await rpc<MemberRow>("add_member_by_manager", {
      p_token: await this.tok(),
      p_name: name,
      p_phone: phone,
      p_relation: relation,
    });
    return mapMember(row);
  }

  async setTheme(theme: "light" | "dark" | "auto"): Promise<void> {
    await rpc("set_member_theme", {
      p_token: await this.tok(),
      p_theme: theme,
    });
  }
}
