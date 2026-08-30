/* تنظیمات اتصال به Supabase — از متغیرهای محیطی Vite */

export const supabaseConfig = {
  url: import.meta.env.VITE_SUPABASE_URL ?? "",
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "",
};

export function isSupabaseConfigured(): boolean {
  return (
    /^https:\/\/.+/.test(supabaseConfig.url) &&
    supabaseConfig.anonKey.length > 20
  );
}
