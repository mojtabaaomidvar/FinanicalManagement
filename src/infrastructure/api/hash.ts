/* هش رمز عبور: SHA-256(phone:password) — هگز
   همان الگوریتم نسخه‌های قبلی (سازگار با داده‌های موجود) */

export async function hashPassword(
  phone: string,
  password: string,
): Promise<string> {
  const data = new TextEncoder().encode(phone + ":" + password);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
