/* نشان یک قلم بازار — لوگوی رمزارز، پرچم ارز، یا سکه/شمش طلا.

   چرا SVG درون‌مخزنی و نه <img>؟ اپ آفلاین هم کار می‌کند و نباید برای
   ۲۰ کاشی ۲۰ درخواست شبکه بزند. لوگوی رمزارزها از بستهٔ @web3icons/core
   با لایسنس MIT استخراج و در cryptoLogos.ts ذخیره شده؛ پرچم‌ها و طلا
   همین‌جا دستی کشیده می‌شوند چون شکل‌های سادهٔ بی‌مالک‌اند.

   اسپرایت index.html جای این‌ها نبود: آن‌جا آیکون تک‌رنگ رابط است که
   رنگش را از currentColor می‌گیرد، ولی نشان برند چندرنگ و ثابت‌رنگ است.

   این فایل فقط توزیع‌کننده است: قاب SVG را می‌سازد و کار را به FlagMark یا
   CryptoMark می‌سپارد. طلا (سکه/شمش) همین‌جا می‌ماند چون دو شکل ساده است و
   فایل جدا برایش فقط یک لایهٔ اضافه بود. */

import { useId } from "react";
import type { Brand } from "@/domain/market/market.brand";
import { CryptoMark } from "./CryptoMark";
import { FlagMark } from "./FlagMark";
import { Glyph, inkOn } from "./markInk";

/** چیپ علامت ارز در گوشهٔ پرچم.

    چرا جدا از پرچم و نه روی آن؟ روی پرچم چندرنگ هیچ رنگ متنی نیست که
    روی همهٔ نوارها خوانا باشد — «$» سفید روی نوار سفید آمریکا ناپدید
    می‌شود. چیپ سفید جدا این را قطعی حل می‌کند.

    این ترکیب «پرچم کشور + علامت ارز» تصمیم قفل‌شدهٔ طراحی است. */
function CurrencyChip({ glyph }: { glyph: string }) {
  return (
    <>
      <circle cx="34.5" cy="34.5" r="12" fill="#fff" />
      <circle
        cx="34.5"
        cy="34.5"
        r="12"
        fill="none"
        stroke="rgba(0,0,0,0.12)"
      />
      <text
        x="34.5"
        y="34.5"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={[...glyph].length > 2 ? 8 : 13}
        fontWeight="700"
        fill="#1b1f24"
        fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
      >
        {glyph}
      </text>
    </>
  );
}

/** سکه — دایره با حلقه‌ی داخلی */
function CoinMark({ color, glyph }: { color: string; glyph: string }) {
  return (
    <>
      <circle cx="24" cy="24" r="24" fill={color} />
      <circle
        cx="24"
        cy="24"
        r="19"
        fill="none"
        stroke="rgba(255,255,255,0.5)"
        strokeWidth="2"
      />
      <Glyph text={glyph} fill={inkOn(color)} />
    </>
  );
}

/** شمش — مستطیل گوشه‌گرد با لبه‌ی روشن */
function BarMark({ color, glyph }: { color: string; glyph: string }) {
  return (
    <>
      <circle cx="24" cy="24" r="24" fill={color} fillOpacity="0.22" />
      <rect x="8" y="16" width="32" height="17" rx="3" fill={color} />
      <rect
        x="8"
        y="16"
        width="32"
        height="5"
        rx="2.5"
        fill="rgba(255,255,255,0.35)"
      />
      <Glyph text={glyph} fill={inkOn(color)} y={26} />
    </>
  );
}

export function BrandMark({
  brand,
  size = 40,
}: {
  brand: Brand;
  size?: number;
}) {
  const { shape, color, glyph = "" } = brand;
  /* شناسه‌ی یکتا برای clipPath. از روی رنگ ساخته نمی‌شود چون دو ارز
     می‌توانند رنگ یکسان داشته باشند (مثلاً چند پرچم قرمز/سفید) و آن‌وقت
     دو clipPath هم‌نام در DOM می‌نشیند؛ مرورگر اولی را به هر دو می‌دهد. */
  const clipId = `bm${useId().replace(/:/g, "")}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
      className="brand-mark"
    >
      {shape === "flag" ? (
        <>
          <FlagMark brand={brand} clipId={clipId} />
          {glyph ? <CurrencyChip glyph={glyph} /> : null}
        </>
      ) : shape === "coin" ? (
        <CoinMark color={color} glyph={glyph} />
      ) : shape === "bar" ? (
        <BarMark color={color} glyph={glyph} />
      ) : (
        <CryptoMark shape={shape} brand={brand} />
      )}
    </svg>
  );
}
