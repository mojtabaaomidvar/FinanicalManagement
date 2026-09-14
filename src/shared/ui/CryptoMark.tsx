/* نشان رمزارز — لوگوی رسمی، وگرنه شکل ساده‌شدهٔ دستی.

   دو بار این نشان‌ها دستی کشیده شدند و هر دو بار کاربر درست ایراد گرفت:
   «لوگوها زشت و نقشی هستند». مسئله مهارت رسم نبود، خود کار بود — نشان
   برند یعنی همان شکل رسمی، و شکل شبیه‌سازی‌شده در بهترین حالت «شبیه»
   است. حالا لوگوی واقعی از cryptoLogos می‌آید: از بستهٔ @web3icons/core
   با لایسنس MIT استخراج و در مخزن ذخیره شده.

   شکل‌های دستی پاک نشدند چون هنوز کار دارند: هر رمزارزی که فردا اضافه
   شود و در آن ۳۰تا نباشد به همین‌ها عقب‌نشینی می‌کند.

   رنگ علامت‌ها از inkOn می‌آید نه سفید ثابت. نسخهٔ قبلی همه را سفید
   می‌کشید و روی زرد بایننس و سبز روشن آپتوس عملاً نامرئی بود. */

import { useId } from "react";
import type { Brand, CryptoShape } from "@/domain/market/market.brand";
import { CRYPTO_LOGOS, MONO_LOGOS } from "./cryptoLogos";
import { Glyph, hexPath, inkOn, star4Path } from "./markInk";

export function CryptoMark({
  shape,
  brand,
}: {
  shape: CryptoShape;
  brand: Brand;
}) {
  const { color, glyph = "", sym = "" } = brand;
  const ink = inkOn(color);
  const logo = CRYPTO_LOGOS[sym];

  /* شناسهٔ یکتا برای گرادیان‌های داخل لوگو. چهار لوگو (SOL، MATIC، APT،
     ICP) گرادیان دارند و شناسه‌شان در فایل با __ID__ نشانوند شده؛ بدون
     یکتاسازی، دو کاشی هم‌نماد در یک صفحه شناسهٔ تکراری می‌سازند و مرورگر
     گرادیان اولی را به دومی هم می‌دهد. همان دلیل clipId در BrandMark. */
  const uid = `cm${useId().replace(/:/g, "")}`;

  if (logo) {
    /* لوگوها در دستگاه ۲۴×۲۴ کشیده شده‌اند و قاب ما ۴۸×۴۸ است. */
    const scaled = (
      <g
        transform="scale(2)"
        dangerouslySetInnerHTML={{ __html: logo.replace(/__ID__/g, uid) }}
      />
    );

    /* تک‌رنگ‌ها (سفید یا سیاه) روی کاشی خوانا نیستند، پس دیسک رنگی برند
       می‌گیرند و fillشان از گروه والد می‌آید. بقیه رنگ رسمی خودشان را
       دارند و دیسک فقط کدرشان می‌کرد — پس‌زمینهٔ ملایم کاشی پشتشان
       کافی است. */
    return MONO_LOGOS.has(sym) ? (
      <>
        <circle cx="24" cy="24" r="24" fill={color} />
        <g fill={ink}>{scaled}</g>
      </>
    ) : (
      scaled
    );
  }

  return (
    <>
      <circle cx="24" cy="24" r="24" fill={color} />
      <Mark shape={shape} ink={ink} color={color} glyph={glyph} />
    </>
  );
}

function Mark({
  shape,
  ink,
  color,
  glyph,
}: {
  shape: CryptoShape;
  ink: string;
  color: string;
  glyph: string;
}) {
  switch (shape) {
    /* دایرهٔ ساده با نوشته — سکه‌های نویسه‌دار (₿ ₮ Ð Ł) و هر سکهٔ
       ناشناخته‌ای که فردا اضافه شود */
    case "disc":
      return <Glyph text={glyph} fill={ink} />;

    /* اتریوم — لوزی دوتکه، شناخته‌شده‌ترین شکل بی‌نوشته‌ی این فهرست */
    case "eth":
      return (
        <g fill={ink}>
          <path d="M24 8 L34 24.2 L24 30.2 L14 24.2 Z" fillOpacity="0.95" />
          <path d="M24 32.2 L34 26.2 L24 40 L14 26.2 Z" fillOpacity="0.7" />
        </g>
      );

    /* سولانا — سه نوار مورب */
    case "sol":
      return (
        <g fill={ink}>
          <path d="M14 17.5 h20 l-4.5 5 h-20 Z" />
          <path d="M9.5 25.5 h20 l4.5 5 h-20 Z" fillOpacity="0.85" />
          <path d="M14 33.5 h20 l-4.5 5 h-20 Z" fillOpacity="0.7" />
        </g>
      );

    /* بایننس — لوزی مرکزی با چهار لوزی پیرامون */
    case "bnb":
      return (
        <g fill={ink}>
          <rect
            x="19.5"
            y="19.5"
            width="9"
            height="9"
            transform="rotate(45 24 24)"
          />
          <rect
            x="20.5"
            y="7.5"
            width="7"
            height="7"
            transform="rotate(45 24 11)"
          />
          <rect
            x="20.5"
            y="33.5"
            width="7"
            height="7"
            transform="rotate(45 24 37)"
          />
          <rect
            x="7.5"
            y="20.5"
            width="7"
            height="7"
            transform="rotate(45 11 24)"
          />
          <rect
            x="33.5"
            y="20.5"
            width="7"
            height="7"
            transform="rotate(45 37 24)"
          />
        </g>
      );

    /* ریپل — شکل X */
    case "xrp":
      return (
        <g stroke={ink} strokeWidth="4" strokeLinecap="round" fill="none">
          <path d="M13 13 L24 23 L35 13" />
          <path d="M13 35 L24 25 L35 35" />
        </g>
      );

    /* کاردانو — خوشهٔ نقطه‌ها؛ سه حلقه با نقطه‌های ریزشونده.
       نشان واقعی همین است: یک «مولکول» از دایره‌های هم‌مرکز. */
    case "ada":
      return (
        <g fill={ink}>
          <circle cx="24" cy="24" r="3.2" />
          {Array.from({ length: 6 }, (_, i) => {
            const a = ((i * 60 - 90) * Math.PI) / 180;
            return (
              <circle
                key={`in${i}`}
                cx={24 + 9.5 * Math.cos(a)}
                cy={24 + 9.5 * Math.sin(a)}
                r="2.3"
              />
            );
          })}
          {Array.from({ length: 6 }, (_, i) => {
            const a = ((i * 60 - 60) * Math.PI) / 180;
            return (
              <circle
                key={`out${i}`}
                cx={24 + 17 * Math.cos(a)}
                cy={24 + 17 * Math.sin(a)}
                r="1.5"
              />
            );
          })}
        </g>
      );

    /* ترون — مثلث زاویه‌دار با خط تاخوردگی */
    case "trx":
      return (
        <g>
          <path d="M9 15 L39 19 L26 39 Z" fill={ink} />
          <g stroke={color} strokeWidth="1.7" fill="none">
            <path d="M9 15 L26 39" />
            <path d="M39 19 L19 23" />
          </g>
        </g>
      );

    /* پولکادات — شش بیضی چرخیده دور یک نقطهٔ مرکزی */
    case "dot":
      return (
        <g fill={ink}>
          <circle cx="24" cy="24" r="3" />
          {Array.from({ length: 6 }, (_, i) => (
            <ellipse
              key={i}
              cx="24"
              cy="12.5"
              rx="4.2"
              ry="2.8"
              transform={`rotate(${i * 60} 24 24)`}
            />
          ))}
        </g>
      );

    /* چین‌لینک — شش‌ضلعی تو‌خالی (مکعب ایزومتریک نشان رسمی) */
    case "link":
      return (
        <path
          d={hexPath(24, 24, 15)}
          fill="none"
          stroke={ink}
          strokeWidth="5"
          strokeLinejoin="round"
        />
      );

    /* پالیگان — شش‌ضلعی تو‌پر.
       عمداً تو‌پر در برابر تو‌خالی چین‌لینک: هر دو نشان شش‌ضلعی دارند و
       در این اندازه تنها چیزی که از هم جدایشان می‌کند همین است (رنگشان هم
       بنفش در برابر آبی است). */
    case "matic":
      return <path d={hexPath(24, 24, 15)} fill={ink} />;

    /* کازماس — هستهٔ اتم با سه مدار بیضی */
    case "atom":
      return (
        <g>
          <circle cx="24" cy="24" r="3.4" fill={ink} />
          {[0, 60, 120].map((deg) => (
            <ellipse
              key={deg}
              cx="24"
              cy="24"
              rx="16"
              ry="6.5"
              fill="none"
              stroke={ink}
              strokeWidth="1.8"
              transform={`rotate(${deg} 24 24)`}
            />
          ))}
        </g>
      );

    /* آوالانچ — مثلث کوه با بریدگی کوچک سمت راست */
    case "avax":
      return (
        <g>
          <path d="M24 9 L40 37 L8 37 Z" fill={ink} />
          <path d="M30.5 21 L37 33 L24 33 Z" fill={color} />
        </g>
      );

    /* استلار — ستارهٔ چهارپر.
       نشان رسمی یک شاتل انتزاعی است که در ۴۰ پیکسل به لکه تبدیل می‌شود؛
       ستاره هم به نام «استلار» وفادار است و هم در این اندازه خوانا. */
    case "xlm":
      return <path d={star4Path(24, 24, 16)} fill={ink} />;

    /* سویی — قطرهٔ آب */
    case "sui":
      return (
        <path
          d="M24 8 C24 8 36 21 36 29 A12 12 0 0 1 12 29 C12 21 24 8 24 8 Z"
          fill={ink}
        />
      );

    /* نییر — مربع گوشه‌گرد با قطر «N» */
    case "near":
      return (
        <g stroke={ink} fill="none" strokeWidth="4" strokeLinecap="round">
          <path d="M15 34 V15 L33 34 V15" strokeLinejoin="round" />
        </g>
      );

    /* تون — گوهر کریستالی با دو وجه داخلی */
    case "ton":
      return (
        <g>
          <path d="M11 17 H37 L24 39 Z" fill={ink} />
          <g stroke={color} strokeWidth="1.8" fill="none">
            <path d="M24 17 V39" />
            <path d="M11 17 L24 26 L37 17" />
          </g>
        </g>
      );

    /* یواس‌دی‌سی — حلقهٔ بیرونی + علامت دلار */
    case "usdc":
      return (
        <g>
          <circle
            cx="24"
            cy="24"
            r="17"
            fill="none"
            stroke={ink}
            strokeWidth="2.4"
          />
          <Glyph text="$" fill={ink} />
        </g>
      );

    /* په‌په — صورت قورباغه؛ چشم‌های درشت و دهان پهن.
       رنگ چشم و مردمک ثابت است چون این نشان در ذهن کاربر تصویر است نه
       شکل هندسی؛ چشم هم‌رنگ زمینه دیگر قورباغه نیست. */
    case "pepe":
      return (
        <g>
          <circle cx="17" cy="19" r="7" fill="#ffffff" />
          <circle cx="31" cy="19" r="7" fill="#ffffff" />
          <circle cx="17.5" cy="20" r="2.6" fill="#111111" />
          <circle cx="30.5" cy="20" r="2.6" fill="#111111" />
          <path
            d="M12 29 Q24 39 36 29"
            fill="none"
            stroke="#111111"
            strokeWidth="2.6"
            strokeLinecap="round"
          />
        </g>
      );

    /* شیبا — صورت سگ؛ دو گوش مثلثی + پوزه */
    case "shib":
      return (
        <g fill={ink}>
          <path d="M11 10 L20 18 L12 24 Z" />
          <path d="M37 10 L28 18 L36 24 Z" />
          <circle cx="24" cy="26" r="11" />
          <g fill={color}>
            <circle cx="20" cy="24" r="1.8" />
            <circle cx="28" cy="24" r="1.8" />
            <path d="M24 28 l3 2.5 -3 2.5 -3 -2.5 Z" />
          </g>
        </g>
      );
  }
}
