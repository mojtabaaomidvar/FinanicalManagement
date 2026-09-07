/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** زمان build به ISO (UTC) — از vite.config.ts تزریق می‌شود */
declare const __BUILD_TIME__: string;
