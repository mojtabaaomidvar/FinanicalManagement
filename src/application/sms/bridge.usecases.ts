/* Use-caseهای پل پیامک — اتصال خودکار از گوشی اندروید */

import type { BridgeRepository } from "@/domain/sms/bridge.repository";
import type { SmsBridge } from "@/domain/sms/sms.types";

export class GetBridgeUseCase {
  constructor(private readonly repo: BridgeRepository) {}
  execute(): Promise<SmsBridge | null> {
    return this.repo.get();
  }
}

export class CreateBridgeUseCase {
  constructor(private readonly repo: BridgeRepository) {}
  execute(): Promise<string> {
    return this.repo.create();
  }
}
