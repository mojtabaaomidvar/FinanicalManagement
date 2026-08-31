/* کانتینر وابستگی‌ها — تنها نقطه ساخت پیاده‌سازی‌های infrastructure
   UI فقط از طریق این container به مخازن دسترسی دارد. */

import { createSecureStorage } from "@/infrastructure/storage/secureStorage.adapter";
import { SessionRepository } from "./sessionRepository";
import { SupabaseAuthRepository } from "./authRepository";
import { SupabaseFamilyRepository } from "./familyRepository";
import { SupabaseTransactionRepository } from "./transactionRepository";
import { SupabaseSmsRepository } from "./smsRepository";
import { SupabaseAccountRepository } from "./accountRepository";
import type { SecureStorage } from "@/infrastructure/storage/secureStorage.adapter";

export interface Repositories {
  auth: SupabaseAuthRepository;
  family: SupabaseFamilyRepository;
  transactions: SupabaseTransactionRepository;
  sms: SupabaseSmsRepository;
  accounts: SupabaseAccountRepository;
}

export interface Container {
  storage: SecureStorage;
  session: SessionRepository;
  repos: Repositories;
}

let containerPromise: Promise<Container> | null = null;

export function getContainer(): Promise<Container> {
  if (!containerPromise) {
    containerPromise = (async () => {
      const storage = await createSecureStorage();
      const session = new SessionRepository(storage);
      const tokenProvider = session;
      return {
        storage,
        session,
        repos: {
          auth: new SupabaseAuthRepository(tokenProvider),
          family: new SupabaseFamilyRepository(tokenProvider),
          transactions: new SupabaseTransactionRepository(tokenProvider),
          sms: new SupabaseSmsRepository(tokenProvider),
          accounts: new SupabaseAccountRepository(tokenProvider),
        },
      };
    })();
  }
  return containerPromise;
}
