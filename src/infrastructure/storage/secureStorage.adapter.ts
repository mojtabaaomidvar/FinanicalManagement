/* Secure Storage — رمزنگاری داده حساس پیش از ذخیره
   ─────────────────────────────────────────────────
   - کلید AES-GCM ۲۵۶ بیتیِ غیرقابل استخراج (non-extractable) در IndexedDB
     نگه داشته می‌شود؛ حتی کد JS نمی‌تواند خود کلید را بیرون ببرد.
   - مقادیر همیشه رمزنگاری‌شده (iv + ciphertext) ذخیره می‌شوند.
   - اگر IndexedDB/WebCrypto در دسترس نباشد → حافظه موقت (بدون ماندگاری).

   این تنها نقطه ذخیره‌سازی داده حساس است — هیچ داده مالی/توکنی
   نباید بدون عبور از این adapter در storage بنشیند. */

export interface SecureStorage {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

const DB_NAME = "mali-man-secure";
const STORE = "kv";
const KEY_ID = "__crypto_key__";

interface EncryptedRecord {
  iv: ArrayBuffer;
  ct: ArrayBuffer;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbDelete(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadOrCreateKey(db: IDBDatabase): Promise<CryptoKey> {
  const existing = await idbGet<CryptoKey>(db, KEY_ID);
  if (existing) return existing;

  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false, /* non-extractable */
    ["encrypt", "decrypt"],
  );
  await idbPut(db, KEY_ID, key);
  return key;
}

function createMemoryStorage(): SecureStorage {
  const mem = new Map<string, string>();
  console.warn(
    "[secureStorage] IndexedDB/WebCrypto در دسترس نیست — ذخیره‌سازی فقط در حافظه موقت",
  );
  return {
    async get<T>(key: string) {
      const raw = mem.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    },
    async set<T>(key: string, value: T) {
      mem.set(key, JSON.stringify(value));
    },
    async remove(key: string) {
      mem.delete(key);
    },
  };
}

export async function createSecureStorage(): Promise<SecureStorage> {
  if (typeof indexedDB === "undefined" || !crypto?.subtle) {
    return createMemoryStorage();
  }

  try {
    const db = await openDb();
    const key = await loadOrCreateKey(db);

    return {
      async get<T>(k: string): Promise<T | null> {
        const rec = await idbGet<EncryptedRecord>(db, k);
        if (!rec) return null;
        try {
          const pt = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: new Uint8Array(rec.iv) },
            key,
            rec.ct,
          );
          return JSON.parse(new TextDecoder().decode(pt)) as T;
        } catch {
          /* داده خراب یا کلید عوض شده → مثل نبودن */
          return null;
        }
      },

      async set<T>(k: string, value: T): Promise<void> {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = await crypto.subtle.encrypt(
          { name: "AES-GCM", iv },
          key,
          new TextEncoder().encode(JSON.stringify(value)),
        );
        await idbPut(db, k, {
          iv: iv.buffer as ArrayBuffer,
          ct,
        } satisfies EncryptedRecord);
      },

      async remove(k: string): Promise<void> {
        await idbDelete(db, k);
      },
    };
  } catch {
    return createMemoryStorage();
  }
}
