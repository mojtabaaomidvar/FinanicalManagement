/* esc — HTML escaping برای رشته‌های کاربر */

export function esc(s: unknown): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return String(s ?? "").replace(/[&<>"']/g, (c) => map[c]);
}
