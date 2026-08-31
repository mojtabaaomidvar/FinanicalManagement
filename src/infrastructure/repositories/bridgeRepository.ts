/* مخزن پل پیامک */

import type { BridgeRepository } from "@/domain/sms/bridge.repository";
import type { SmsBridge } from "@/domain/sms/sms.types";
import { rpc } from "@/infrastructure/api/httpClient";
import type { TokenProvider } from "./sessionRepository";

export class SupabaseBridgeRepository implements BridgeRepository {
  constructor(private readonly tokenProvider: TokenProvider) {}

  private async tok(): Promise<string> {
    const t = await this.tokenProvider.getToken();
    if (!t) throw new Error("NO_SESSION");
    return t;
  }

  async get(): Promise<SmsBridge | null> {
    const r = await rpc<{ token: string; member_id: string } | null>(
      "get_bridge",
      { p_token: await this.tok() },
    );
    return r ? { token: r.token, memberId: r.member_id } : null;
  }

  async create(): Promise<string> {
    return rpc<string>("create_bridge", { p_token: await this.tok() });
  }
}
