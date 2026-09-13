/* ابزارهای مشترک نشان‌های برند — رنگ خوانا، نوشتهٔ روی نشان، و ستاره.

   چرا فایل جدا؟ نشان برند سه خانوادهٔ جداست (رمزارز، پرچم، فلز) و هر سه
   به این چند تابع نیاز دارند. اگر در BrandMark می‌ماندند، FlagMark که خودش
   از BrandMark صدا زده می‌شود باید از آن import می‌کرد و حلقهٔ وابستگی
   می‌ساخت. این‌جا هیچ‌کس به بالادست وابسته نیست. */

/** آیا روی این رنگ، متن سفید خوانا است؟ (روشنایی نسبی WCAG)

    بدون این، «تتر» روی سفید پرچم ژاپن یا زرد یوان ناپیدا می‌شد. */
export function isLight(hex: string): boolean {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const lin = (c: number) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.45;
}

/** رنگ متن خوانا روی یک پس‌زمینه */
export function inkOn(hex: string): string {
  return isLight(hex) ? "#1b1f24" : "#ffffff";
}

/* اندازه‌ی قلم نشان با طول نوشته کم می‌شود — «₿» جا دارد ولی «NEAR»
   با همان اندازه از دایره بیرون می‌زند. اعداد بر حسب viewBox ۴۸ است. */
function glyphSize(glyph: string): number {
  const n = [...glyph].length;
  if (n <= 1) return 26;
  if (n === 2) return 19;
  if (n === 3) return 15;
  return 12;
}

export function Glyph({
  text,
  fill,
  y = 24,
}: {
  text: string;
  fill: string;
  y?: number;
}) {
  return (
    <text
      x="24"
      y={y}
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={glyphSize(text)}
      fontWeight="700"
      fill={fill}
      /* فونت ارثی نه: نشان باید در هر دستگاهی یک شکل باشد و علامت‌های
         ارز (₺ ₽ ₾) در فونت فارسی اپ همه‌جا موجود نیستند. */
      fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
    >
      {text}
    </text>
  );
}

/* ── ستاره ────────────────────────────────────────────────────
   ستاره در این فهرست پنج‌بار تکرار می‌شود (چین، آمریکا، اروپا، استرالیا،
   ترکیه/مالزی/پاکستان). دستی‌نوشتن مختصات ده رأس برای هر کدام یعنی ده
   فرصت برای غلط تایپی که فقط چشمی دیده می‌شود؛ این‌جا یک‌بار حساب می‌شود. */

/** مسیر ستارهٔ پنج‌پر رو به بالا. `rot` برای ستاره‌های چرخیدهٔ پرچم چین. */
export function starPath(cx: number, cy: number, r: number, rot = -90): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rad = ((rot + i * 36) * Math.PI) / 180;
    // نسبت ۰٫۳۸۲ همان نسبت ستارهٔ پنج‌پر منتظم است؛ کم‌تر از آن لاغر
    // و بیش‌تر از آن شبیه ده‌ضلعی می‌شود.
    const rr = i % 2 === 0 ? r : r * 0.382;
    pts.push(
      `${(cx + rr * Math.cos(rad)).toFixed(2)},${(cy + rr * Math.sin(rad)).toFixed(2)}`,
    );
  }
  return `M${pts.join("L")}Z`;
}

/** ستارهٔ چهارپر — نشان استلار و چند لوگوی رمزارز */
export function star4Path(cx: number, cy: number, r: number): string {
  const i = r * 0.3;
  return (
    `M${cx},${cy - r} L${cx + i},${cy - i} L${cx + r},${cy} ` +
    `L${cx + i},${cy + i} L${cx},${cy + r} L${cx - i},${cy + i} ` +
    `L${cx - r},${cy} L${cx - i},${cy - i} Z`
  );
}

/** شش‌ضلعی نوک‌بالا — پایهٔ نشان چین‌لینک و پالیگان */
export function hexPath(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const rad = ((-90 + i * 60) * Math.PI) / 180;
    pts.push(
      `${(cx + r * Math.cos(rad)).toFixed(2)},${(cy + r * Math.sin(rad)).toFixed(2)}`,
    );
  }
  return `M${pts.join("L")}Z`;
}
