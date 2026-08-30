/* مخزن نشست — ذخیره امن (رمزنگاری‌شده) + تأمین توکن برای بقیه مخازن */

import type { SessionStore } from "@/domain/auth/auth.repository";
import type { StoredSession } from "@/domain/auth/auth.types";
import type { SecureStorage } from "@/infrastructure/storage/secureStorage.adapter";

const SESSION_KEY = "session";

export interface TokenProvider {
  getToken(): Promise<string | null>;
}

export class SessionRepository implements SessionStore, TokenProvider {
  private cache: StoredSession | null | undefined;

  constructor(private readonly storage: SecureStorage) {}

  async load(): Promise<StoredSession | null> {
    if (this.cache !== undefined) return this.cache;
    this.cache = await this.storage.get<StoredSession>(SESSION_KEY);
    return this.cache;
  }

  async save(session: StoredSession): Promise<void> {
    this.cache = session;
    await this.storage.set(SESSION_KEY, session);
  }

  async clear(): Promise<void> {
    this.cache = null;
    await this.storage.remove(SESSION_KEY);
  }

  async getToken(): Promise<string | null> {
    return (await this.load())?.token ?? null;
  }
}
