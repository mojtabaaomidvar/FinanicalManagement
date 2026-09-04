/* رنگ پاستلی هر دسته — پس‌زمینه آیکون دسته‌ها و حلقه‌های پیشرفت بودجه
   (پالت مکمل برند؛ پالت اصلی در ناوبری و دکمه‌ها دست‌نخورده می‌ماند) */

const FALLBACK_PALETTE = [
  "#FCD34D",
  "#93C5FD",
  "#FCA5A5",
  "#6EE7B7",
  "#C4B5FD",
  "#FDBA74",
  "#5EEAD4",
  "#F9A8D4",
] as const;

export const CATEGORY_COLORS: Record<string, string> = {
  /* ── هزینه ── */
  food: "#FCD34D",
  home: "#93C5FD",
  bills: "#FCA5A5",
  transport: "#7DD3FC",
  health: "#6EE7B7",
  clothing: "#F9A8D4",
  edu: "#C4B5FD",
  fun: "#FDBA74",
  shopping: "#5EEAD4",
  comm: "#D8B4FE",
  finance: "#86EFAC",
  insurance: "#BEF264",
  gifte: "#F0ABFC",
  family: "#FDE047",
  beauty: "#FDA4AF",
  sport: "#67E8F9",
  pet: "#A5B4FC",

  /* ── درآمد ── */
  salary: "#6EE7B7",
  business: "#86EFAC",
  invest: "#5EEAD4",
  sale: "#FCD34D",
  gift: "#F9A8D4",

  /* ── انتقال ── */
  transfer: "#6EE7B7",
};

function hashOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** رنگ دسته — دسته‌های سفارشی/نامعلوم از پالت عمومی انتخاب می‌شوند */
export function categoryColor(id: string): string {
  return CATEGORY_COLORS[id] ?? FALLBACK_PALETTE[hashOf(id) % FALLBACK_PALETTE.length];
}
