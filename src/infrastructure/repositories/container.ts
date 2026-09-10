/* کانتینر وابستگی‌ها — تنها نقطه ساخت پیاده‌سازی‌های infrastructure
   UI فقط از طریق این container به مخازن دسترسی دارد. */

import { createSecureStorage } from "@/infrastructure/storage/secureStorage.adapter";
import { RestClient } from "@/infrastructure/api/restClient";
import { SessionRepository } from "./sessionRepository";
import { SupabaseAuthRepository } from "./authRepository";
import { SupabaseFamilyRepository } from "./familyRepository";
import { SupabaseTransactionRepository } from "./transactionRepository";
import { SupabaseSmsRepository } from "./smsRepository";
import { SupabaseAccountRepository } from "./accountRepository";
import { SupabaseBridgeRepository } from "./bridgeRepository";
import { SupabaseSubcategoryRepository } from "./subcategoryRepository";
import { SupabaseCustomCategoryRepository } from "./customCategoryRepository";
import { SupabaseEventRepository } from "./eventRepository";
import { SupabaseCategoryBudgetRepository } from "./categoryBudgetRepository";
import type { SecureStorage } from "@/infrastructure/storage/secureStorage.adapter";

export interface Repositories {
  auth: SupabaseAuthRepository;
  family: SupabaseFamilyRepository;
  transactions: SupabaseTransactionRepository;
  sms: SupabaseSmsRepository;
  accounts: SupabaseAccountRepository;
  bridges: SupabaseBridgeRepository;
  subcategories: SupabaseSubcategoryRepository;
  customCategories: SupabaseCustomCategoryRepository;
  events: SupabaseEventRepository;
  categoryBudgets: SupabaseCategoryBudgetRepository;
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
      /* یک نمونهٔ واحدِ RestClient که به همهٔ مخازن تزریق می‌شود؛ توکن را از
         SessionRepository (به‌عنوان TokenProvider) به‌صورت خودکار در هدر می‌گذارد. */
      const client = new RestClient(tokenProvider);
      return {
        storage,
        session,
        repos: {
          auth: new SupabaseAuthRepository(client),
          family: new SupabaseFamilyRepository(client),
          transactions: new SupabaseTransactionRepository(client),
          sms: new SupabaseSmsRepository(client),
          accounts: new SupabaseAccountRepository(client),
          bridges: new SupabaseBridgeRepository(client),
          subcategories: new SupabaseSubcategoryRepository(client),
          customCategories: new SupabaseCustomCategoryRepository(client),
          events: new SupabaseEventRepository(client),
          categoryBudgets: new SupabaseCategoryBudgetRepository(client),
        },
      };
    })();
  }
  return containerPromise;
}
