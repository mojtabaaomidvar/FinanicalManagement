/* کانتینر وابستگی‌ها — تنها نقطه ساخت پیاده‌سازی‌های infrastructure
   UI فقط از طریق این container به مخازن دسترسی دارد. */

import { createSecureStorage } from "@/infrastructure/storage/secureStorage.adapter";
import { BrowserOfflineCache } from "@/infrastructure/storage/offlineCache.adapter";
import { RestClient } from "@/infrastructure/api/restClient";
import { SessionRepository } from "./sessionRepository";
import { SupabaseAuthRepository } from "./authRepository";
import { SupabaseFamilyRepository } from "./familyRepository";
import { SupabaseTransactionRepository } from "./transactionRepository";
import { SupabaseSmsRepository } from "./smsRepository";
import { RestSmsSettingsRepository } from "./smsSettingsRepository";
import { SupabaseAccountRepository } from "./accountRepository";
import { RestWalletRepository } from "./walletRepository";
import { RestInventoryCatalogRepository } from "./inventoryCatalogRepository";
import { SupabaseBridgeRepository } from "./bridgeRepository";
import { SupabaseSubcategoryRepository } from "./subcategoryRepository";
import { SupabaseCustomCategoryRepository } from "./customCategoryRepository";
import { SupabaseEventRepository } from "./eventRepository";
import { SupabaseCategoryBudgetRepository } from "./categoryBudgetRepository";
import { RestMarketRepository } from "./marketRepository";
import { RestHoldingRepository } from "./holdingRepository";
import { RestNotificationRepository } from "./notificationRepository";
import { RestBillRepository } from "./billRepository";
import {
  RestInventoryRepository,
  RestShoppingRepository,
} from "./shoppingRepository";
import type { SecureStorage } from "@/infrastructure/storage/secureStorage.adapter";
import { createShoppingOffline, type ShoppingOfflineEngine } from "@/infrastructure/offline/shoppingOffline";
import { OfflineShoppingRepository, OfflineInventoryRepository } from "./offlineShoppingRepository";
import { OfflineTaskRepository } from "./taskRepository";
import { RestDocumentRepository } from "./documentRepository";
import { RestMealRepository } from "./mealRepository";
import { RestEquipmentRepository } from "./equipmentRepository";
import { RestVehicleRepository } from "./vehicleRepository";
import { RestGoalRepository } from "./goalRepository";
import { RestActivityRepository } from "./activityRepository";
import { RestChildRepository } from "./childRepository";
import { RestPetRepository } from "./petRepository";
import { RestAssistantRepository } from "./assistantRepository";
import { watchHouseholdChanges } from "@/infrastructure/realtime/householdChanges";

export interface Repositories {
  inventoryCatalog: RestInventoryCatalogRepository;
  wallets: RestWalletRepository;
  assistant: RestAssistantRepository;
  auth: SupabaseAuthRepository;
  family: SupabaseFamilyRepository;
  transactions: SupabaseTransactionRepository;
  sms: SupabaseSmsRepository;
  smsSettings: RestSmsSettingsRepository;
  accounts: SupabaseAccountRepository;
  bridges: SupabaseBridgeRepository;
  subcategories: SupabaseSubcategoryRepository;
  customCategories: SupabaseCustomCategoryRepository;
  events: SupabaseEventRepository;
  categoryBudgets: SupabaseCategoryBudgetRepository;
  market: RestMarketRepository;
  holdings: RestHoldingRepository;
  notifications: RestNotificationRepository;
  bills: RestBillRepository;
  shopping: OfflineShoppingRepository;
  inventory: OfflineInventoryRepository;
  tasks: OfflineTaskRepository;
  documents: RestDocumentRepository;
  meals: RestMealRepository;
  equipment: RestEquipmentRepository;
  vehicles: RestVehicleRepository;
  goals: RestGoalRepository;
  activities: RestActivityRepository;
  children: RestChildRepository;
  pets: RestPetRepository;
}

export interface Container {
  watchHouseholdChanges: (refresh: () => Promise<void>) => () => void;
  storage: SecureStorage;
  session: SessionRepository;
  shoppingOffline: ShoppingOfflineEngine;
  /** §۸.۵ — پاک‌کنندهٔ کشِ آفلاین؛ LogoutUseCase هنگامِ خروج صدایش می‌زند */
  offlineCache: BrowserOfflineCache;
  repos: Repositories;
}

let containerPromise: Promise<Container> | null = null;

export function getContainer(): Promise<Container> {
  if (!containerPromise) {
    containerPromise = (async () => {
      const storage = await createSecureStorage();
      const session = new SessionRepository(storage);
      const tokenProvider = session;
      /* یک نمونهٔ واحد RestClient که به همهٔ مخازن تزریق می‌شود؛ توکن را از
         SessionRepository (به‌عنوان TokenProvider) به‌صورت خودکار در هدر می‌گذارد. */
      const client = new RestClient(tokenProvider);
      const shoppingOffline = createShoppingOffline(storage);
      return {
        watchHouseholdChanges: refresh => watchHouseholdChanges(client, refresh),
        storage,
        session,
        shoppingOffline,
        offlineCache: new BrowserOfflineCache(() => shoppingOffline.clear()),
        repos: {
          inventoryCatalog: new RestInventoryCatalogRepository(client),
          assistant: new RestAssistantRepository(client),
          auth: new SupabaseAuthRepository(client),
          family: new SupabaseFamilyRepository(client, session),
          transactions: new SupabaseTransactionRepository(client),
          sms: new SupabaseSmsRepository(client),
          smsSettings: new RestSmsSettingsRepository(client),
          accounts: new SupabaseAccountRepository(client),
          wallets: new RestWalletRepository(client, session),
          bridges: new SupabaseBridgeRepository(client),
          subcategories: new SupabaseSubcategoryRepository(client),
          customCategories: new SupabaseCustomCategoryRepository(client),
          events: new SupabaseEventRepository(client),
          categoryBudgets: new SupabaseCategoryBudgetRepository(client),
          market: new RestMarketRepository(client),
          holdings: new RestHoldingRepository(client),
          notifications: new RestNotificationRepository(client),
          bills: new RestBillRepository(client),
          shopping: new OfflineShoppingRepository(new RestShoppingRepository(client), shoppingOffline),
          inventory: new OfflineInventoryRepository(new RestInventoryRepository(client), shoppingOffline),
          tasks: new OfflineTaskRepository(shoppingOffline),
          documents: new RestDocumentRepository(client),
          meals: new RestMealRepository(client, shoppingOffline, tokenProvider),
          equipment: new RestEquipmentRepository(client, tokenProvider),
          vehicles: new RestVehicleRepository(client, tokenProvider),
          goals: new RestGoalRepository(client, tokenProvider),
          activities: new RestActivityRepository(client, tokenProvider),
          children: new RestChildRepository(client, tokenProvider),
          pets: new RestPetRepository(client, tokenProvider),
        },
      };
    })();
  }
  return containerPromise;
}
