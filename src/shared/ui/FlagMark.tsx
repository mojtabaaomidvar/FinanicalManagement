/* پرچم یک ارز — داخل دایرهٔ نشان.

   چرا این‌همه چیدمان جدا و نه «دو نوار رنگی»؟ نسخهٔ قبلی هر پرچم دورنگ
   را دو نوار افقی می‌کشید. نتیجه این شد که ژاپن، ترکیه، کانادا، سوئیس،
   دانمارک و نروژ همگی «قرمز روی سفید» شدند — یعنی همه شبیه پرچم لهستان،
   و این دقیقاً چیزی است که کاربر گزارش کرد.

   درس: در اندازهٔ ۴۰ پیکسل آن‌چه چشم تشخیص می‌دهد **چیدمان** است نه رنگ.
   صلیب سوئیس، دایرهٔ ژاپن، نوار عمودی کانادا و صلیب کج‌شدهٔ نروژ هر
   کدام در یک نگاه از هم جدا می‌شوند، حتی وقتی رنگشان یکی است.

   هندسه‌ها ساده‌شده‌اند و باید هم باشند: نشان ملی پرجزئیات در این اندازه
   به لکه تبدیل می‌شود. هدف «تشخیص» است نه «بازتولید». */

import type {
  Brand,
  FlagEmblem,
  FlagLayout,
} from "@/domain/market/market.brand";
import { starPath } from "./markInk";

/* مرکز نشان پرچم. چیپ علامت ارز گوشهٔ پایین-راست می‌نشیند، پس نشان
   تک‌قطعه کمی به بالا-چپ می‌رود تا زیرش نرود. نشان‌های پخش‌شده (ستاره‌های
   اروپا، نوارها) عمداً جابه‌جا نمی‌شوند: آن‌ها تمام پرچم‌اند و جابه‌جایی
   شکلشان را خراب می‌کند؛ چیپ فقط گوشه‌ای از آن‌ها را می‌پوشاند. */
const EM_X = 21;
const EM_Y = 21;

/** هلال + ستاره — ترکیه، پاکستان، سنگاپور، مالزی، آذربایجان.
    `bg` رنگ زیر هلال است؛ بدون آن، بریدگی هلال روی نوار اشتباه می‌افتد. */
function Crescent({
  cx,
  cy,
  r,
  fill,
  bg,
}: {
  cx: number;
  cy: number;
  r: number;
  fill: string;
  bg: string;
}) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={fill} />
      {/* دایرهٔ دوم هم‌رنگ زمینه، ماه را به هلال تبدیل می‌کند */}
      <circle cx={cx + r * 0.34} cy={cy} r={r * 0.82} fill={bg} />
      <path d={starPath(cx + r * 1.05, cy, r * 0.5)} fill={fill} />
    </g>
  );
}

/** نشان وسط پرچم. `bg` رنگ نواری است که نشان رویش می‌نشیند. */
function Emblem({
  kind,
  color,
  bg,
  cx = EM_X,
  cy = EM_Y,
}: {
  kind: FlagEmblem;
  color: string;
  bg: string;
  cx?: number;
  cy?: number;
}) {
  switch (kind) {
    case "disc":
      return <circle cx={cx} cy={cy} r="10" fill={color} />;

    case "crescent":
      return <Crescent cx={cx - 3} cy={cy} r={7} fill={color} bg={bg} />;

    /* چین — ستارهٔ بزرگ و چهار ستارهٔ کوچک که همه رو به آن می‌چرخند.
       چرخش کوچک‌ها حذف شده: در ۴۰ پیکسل دیده نمی‌شود و فقط کد را
       شلوغ می‌کند. */
    case "starsCN":
      return (
        <g fill={color}>
          <path d={starPath(15, 15, 7.5)} />
          <path d={starPath(25, 8, 2.6)} />
          <path d={starPath(29.5, 13, 2.6)} />
          <path d={starPath(29.5, 19.5, 2.6)} />
          <path d={starPath(25, 24.5, 2.6)} />
        </g>
      );

    /* اروپا — دوازده ستاره روی دایره‌ای به مرکز خود نشان */
    case "starsEU":
      return (
        <g fill={color}>
          {Array.from({ length: 12 }, (_, i) => {
            const a = ((i * 30 - 90) * Math.PI) / 180;
            return (
              <path
                key={i}
                d={starPath(24 + 14 * Math.cos(a), 24 + 14 * Math.sin(a), 3.1)}
              />
            );
          })}
        </g>
      );

    /* استرالیا — ستارهٔ مشترک‌المنافع + صلیب جنوبی در نیمهٔ راست */
    case "starsAU":
      return (
        <g fill={color}>
          <path d={starPath(12, 34, 4.2)} />
          <path d={starPath(34, 12, 3)} />
          <path d={starPath(39, 22, 2.6)} />
          <path d={starPath(33, 30, 3)} />
          <path d={starPath(28, 21, 2.2)} />
        </g>
      );

    /* نیوزیلند — فقط چهار ستارهٔ صلیب جنوبی، بدون ستارهٔ بزرگ.
       هر ستاره دولایه است: سفید بزرگ‌تر زیر، قرمز کوچک‌تر رو. قرمز تنها
       روی سرمه‌ای تیره‌روی‌تیره می‌شد و از دور یک لکه به نظر می‌رسید؛
       خود پرچم واقعی هم همین حاشیهٔ سفید را دارد. */
    case "starsNZ":
      return (
        <g>
          {(
            [
              [34, 12, 3.2],
              [39.5, 23, 2.8],
              [32, 32, 3.2],
              [27, 21, 2.6],
            ] as const
          ).map(([x, y, r]) => (
            <g key={`${x}-${y}`}>
              <path d={starPath(x, y, r + 1.2)} fill="#FFFFFF" />
              <path d={starPath(x, y, r)} fill={color} />
            </g>
          ))}
        </g>
      );

    case "star3":
      return (
        <g fill={color}>
          <path d={starPath(14, cy, 4)} />
          <path d={starPath(24, cy, 4)} />
          <path d={starPath(34, cy, 4)} />
        </g>
      );

    /* برگ افرا — مسیر در جعبهٔ ۱۰۰×۱۰۰ نوشته شده و بعد کوچک می‌شود،
       چون نوشتن مختصات اعشاری در مقیاس نهایی خواندنش را غیرممکن می‌کرد. */
    case "maple":
      return (
        <g
          transform={`translate(${cx - 9} ${cy - 9}) scale(0.18)`}
          fill={color}
        >
          <path
            d="M50 4 L57 26 L70 19 L66 36 L86 32 L78 45 L96 54 L78 62
               L86 75 L66 71 L70 88 L57 81 L53 96 L47 96 L43 81 L30 88
               L34 71 L14 75 L22 62 L4 54 L22 45 L14 32 L34 36 L30 19
               L43 26 Z"
          />
        </g>
      );

    /* چرخهٔ آشوکا — حلقه + دوازده پره (۲۴ پره در این اندازه توده می‌شود) */
    case "chakra":
      return (
        <g stroke={color} fill="none">
          <circle cx={cx} cy={cy} r="7.5" strokeWidth="1.6" />
          <circle cx={cx} cy={cy} r="1.6" fill={color} stroke="none" />
          {Array.from({ length: 12 }, (_, i) => {
            const a = (i * 30 * Math.PI) / 180;
            return (
              <line
                key={i}
                x1={cx + 2 * Math.cos(a)}
                y1={cy + 2 * Math.sin(a)}
                x2={cx + 7 * Math.cos(a)}
                y2={cy + 7 * Math.sin(a)}
                strokeWidth="1"
              />
            );
          })}
        </g>
      );

    case "sun":
      return (
        <g fill={color}>
          <circle cx={cx} cy={cy} r="4.5" />
          {Array.from({ length: 12 }, (_, i) => {
            const a = (i * 30 * Math.PI) / 180;
            return (
              <line
                key={i}
                x1={cx + 5.5 * Math.cos(a)}
                y1={cy + 5.5 * Math.sin(a)}
                x2={cx + 9.5 * Math.cos(a)}
                y2={cy + 9.5 * Math.sin(a)}
                stroke={color}
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            );
          })}
        </g>
      );

    /* سرو لبنان — سه ردیف مثلثی + تنه */
    case "cedar":
      return (
        <g fill={color}>
          <path
            d={`M${cx} ${cy - 9} L${cx + 5} ${cy - 2} L${cx - 5} ${cy - 2} Z`}
          />
          <path
            d={`M${cx} ${cy - 5} L${cx + 7} ${cy + 2.5} L${cx - 7} ${cy + 2.5} Z`}
          />
          <path
            d={`M${cx} ${cy - 1} L${cx + 8.5} ${cy + 6} L${cx - 8.5} ${cy + 6} Z`}
          />
          <rect x={cx - 1.3} y={cy + 5} width="2.6" height="4" />
        </g>
      );

    /* گل باهینیا — پنج گلبرگ چرخیده دور مرکز */
    case "bauhinia":
      return (
        <g fill={color}>
          {Array.from({ length: 5 }, (_, i) => (
            <ellipse
              key={i}
              cx={cx}
              cy={cy - 5.5}
              rx="2.6"
              ry="5.5"
              transform={`rotate(${i * 72} ${cx} ${cy})`}
            />
          ))}
        </g>
      );

    /* تَگوک کره — دو نیم چرخان قرمز و آبی + چهار نشان سیاه.
       color این‌جا استفاده نمی‌شود چون رنگ‌های این نشان ثابت‌اند. */
    case "taegeuk":
      return (
        <g>
          <circle cx={cx} cy={cy} r="8" fill="#C60C30" />
          <path
            d={`M${cx - 8} ${cy} A4 4 0 0 1 ${cx} ${cy} A4 4 0 0 0 ${cx + 8} ${cy}
                A8 8 0 0 1 ${cx - 8} ${cy} Z`}
            fill="#003478"
          />
          <g stroke="#000" strokeWidth="1.1" strokeLinecap="round">
            <line x1={cx - 13} y1={cy - 11} x2={cx - 9} y2={cy - 7} />
            <line x1={cx + 9} y1={cy + 7} x2={cx + 13} y2={cy + 11} />
            <line x1={cx + 9} y1={cy - 7} x2={cx + 13} y2={cy - 11} />
            <line x1={cx - 13} y1={cy + 11} x2={cx - 9} y2={cy + 7} />
          </g>
        </g>
      );

    /* عربستان — خط نوشته (دو نوار افقی) + شمشیر زیر آن */
    case "sword":
      return (
        <g fill={color}>
          <rect x={cx - 11} y={cy - 8} width="22" height="2.4" rx="1.2" />
          <rect x={cx - 8} y={cy - 3.5} width="16" height="2.4" rx="1.2" />
          <rect x={cx - 11} y={cy + 3} width="20" height="2" rx="1" />
          <path d={`M${cx + 9} ${cy + 1} l4 3 -4 3 Z`} />
        </g>
      );

    case "script":
      return (
        <g fill={color}>
          <rect x={cx - 10} y={cy - 2.5} width="9" height="2.2" rx="1.1" />
          <rect x={cx + 1} y={cy - 2.5} width="9" height="2.2" rx="1.1" />
          <circle cx={cx - 5.5} cy={cy + 2.5} r="1.2" />
          <circle cx={cx + 5.5} cy={cy + 2.5} r="1.2" />
        </g>
      );

    /* عقاب مصر — بازتولیدش در این اندازه ممکن نیست؛ سپر بال‌دار
       همان چیزی است که چشم به‌عنوان «نشان طلایی وسط» می‌گیرد. */
    case "eagle":
      return (
        <g fill={color}>
          <path d={`M${cx} ${cy - 7} l7 3 -7 2 -7 -2 Z`} />
          <path d={`M${cx - 4.5} ${cy - 1} h9 v4 l-4.5 5 -4.5 -5 Z`} />
        </g>
      );

    /* گرجستان — چهار صلیب بولنیزی گوشه (صلیب اصلی در چیدمان است) */
    case "cross4":
      return (
        <g fill={color}>
          {[
            [12, 12],
            [36, 12],
            [12, 36],
            [36, 36],
          ].map(([x, y]) => (
            <g key={`${x}-${y}`}>
              <rect x={x - 1.2} y={y - 4} width="2.4" height="8" rx="0.6" />
              <rect x={x - 4} y={y - 1.2} width="8" height="2.4" rx="0.6" />
            </g>
          ))}
        </g>
      );
  }
}

/** نوارها/چیدمان زمینهٔ پرچم */
function Field({ layout, brand }: { layout: FlagLayout; brand: Brand }) {
  const c1 = brand.color;
  const c2 = brand.color2 ?? brand.color;
  const c3 = brand.color3 ?? c2;
  const c4 = brand.color4 ?? c1;

  switch (layout) {
    case "h2":
      return (
        <>
          <rect x="0" y="0" width="48" height="24" fill={c1} />
          <rect x="0" y="24" width="48" height="24" fill={c2} />
        </>
      );

    case "h3":
      return (
        <>
          <rect x="0" y="0" width="48" height="16" fill={c1} />
          <rect x="0" y="16" width="48" height="16" fill={c2} />
          <rect x="0" y="32" width="48" height="16" fill={c3} />
        </>
      );

    /* لبنان — نوار میانی دو برابر نوارهای کناری */
    case "h3wide":
      return (
        <>
          <rect x="0" y="0" width="48" height="12" fill={c1} />
          <rect x="0" y="12" width="48" height="24" fill={c2} />
          <rect x="0" y="36" width="48" height="12" fill={c1} />
        </>
      );

    /* تایلند — پنج نوار با نوار میانی پهن */
    case "h5":
      return (
        <>
          <rect x="0" y="0" width="48" height="8" fill={c1} />
          <rect x="0" y="8" width="48" height="8" fill={c2} />
          <rect x="0" y="16" width="48" height="16" fill={c3} />
          <rect x="0" y="32" width="48" height="8" fill={c2} />
          <rect x="0" y="40" width="48" height="8" fill={c1} />
        </>
      );

    case "v3":
      return (
        <>
          <rect x="0" y="0" width="16" height="48" fill={c1} />
          <rect x="16" y="0" width="16" height="48" fill={c2} />
          <rect x="32" y="0" width="16" height="48" fill={c3} />
        </>
      );

    /* کانادا — نوار سفید میانی نصف پهنا */
    case "v3wide":
      return (
        <>
          <rect x="0" y="0" width="12" height="48" fill={c1} />
          <rect x="12" y="0" width="24" height="48" fill={c2} />
          <rect x="36" y="0" width="12" height="48" fill={c1} />
        </>
      );

    case "solid":
      return <rect x="0" y="0" width="48" height="48" fill={c1} />;

    /* صلیب مرکزی — سوئیس و گرجستان */
    case "cross":
      return (
        <>
          <rect x="0" y="0" width="48" height="48" fill={c1} />
          <rect x="20" y="4" width="8" height="40" fill={c2} />
          <rect x="4" y="20" width="40" height="8" fill={c2} />
        </>
      );

    /* صلیب اسکاندیناویایی — بازوی عمودی به سمت میله (چپ) کشیده است.
       همین جابه‌جایی کوچک است که دانمارک را از سوئیس جدا نگه می‌دارد. */
    case "nordic":
      return (
        <>
          <rect x="0" y="0" width="48" height="48" fill={c1} />
          <rect x="14" y="0" width="9" height="48" fill={c2} />
          <rect x="0" y="19.5" width="48" height="9" fill={c2} />
        </>
      );

    /* نروژ — صلیب آبی با حاشیهٔ سفید روی قرمز */
    case "nordic2":
      return (
        <>
          <rect x="0" y="0" width="48" height="48" fill={c1} />
          <rect x="12.5" y="0" width="12" height="48" fill={c2} />
          <rect x="0" y="18" width="48" height="12" fill={c2} />
          <rect x="15.5" y="0" width="6" height="48" fill={c3} />
          <rect x="0" y="21" width="48" height="6" fill={c3} />
        </>
      );

    /* یونیون‌جک — قطرها اول، بعد صلیب عمود. ترتیب مهم است. */
    case "union":
      return (
        <>
          <rect x="0" y="0" width="48" height="48" fill={c1} />
          <g stroke={c2} strokeWidth="10">
            <line x1="0" y1="0" x2="48" y2="48" />
            <line x1="48" y1="0" x2="0" y2="48" />
          </g>
          <g stroke={c3} strokeWidth="4">
            <line x1="0" y1="0" x2="48" y2="48" />
            <line x1="48" y1="0" x2="0" y2="48" />
          </g>
          <rect x="17" y="0" width="14" height="48" fill={c2} />
          <rect x="0" y="17" width="48" height="14" fill={c2} />
          <rect x="19.5" y="0" width="9" height="48" fill={c3} />
          <rect x="0" y="19.5" width="48" height="9" fill={c3} />
        </>
      );

    /* استرالیا/نیوزیلند — یونیون‌جک کوچک در ربع بالا-چپ */
    case "canton":
      return (
        <>
          <rect x="0" y="0" width="48" height="48" fill={c1} />
          <g>
            <rect x="0" y="0" width="24" height="20" fill={c1} />
            <g stroke={c2} strokeWidth="5">
              <line x1="0" y1="0" x2="24" y2="20" />
              <line x1="24" y1="0" x2="0" y2="20" />
            </g>
            <g stroke={c3} strokeWidth="2">
              <line x1="0" y1="0" x2="24" y2="20" />
              <line x1="24" y1="0" x2="0" y2="20" />
            </g>
            <rect x="9" y="0" width="6" height="20" fill={c2} />
            <rect x="0" y="7" width="24" height="6" fill={c2} />
            <rect x="10.5" y="0" width="3" height="20" fill={c3} />
            <rect x="0" y="8.5" width="24" height="3" fill={c3} />
          </g>
        </>
      );

    /* آمریکا — سیزده نوار + کانتون سرمه‌ای با ستاره‌های ریز */
    case "stripes":
      return (
        <>
          <rect x="0" y="0" width="48" height="48" fill={c2} />
          {Array.from({ length: 7 }, (_, i) => (
            <rect
              key={i}
              x="0"
              y={(i * 48) / 6.5}
              width="48"
              height={48 / 13}
              fill={c1}
            />
          ))}
          <rect x="0" y="0" width="24" height={(48 / 13) * 7} fill={c4} />
          <g fill={c2}>
            {Array.from({ length: 12 }, (_, i) => (
              <circle
                key={i}
                cx={4 + (i % 4) * 5.5}
                cy={4 + Math.floor(i / 4) * 6}
                r="1.5"
              />
            ))}
          </g>
        </>
      );

    /* مالزی — نوارهای قرمز/سفید + کانتون سرمه‌ای (هلالش نشان است) */
    case "stripesCanton":
      return (
        <>
          <rect x="0" y="0" width="48" height="48" fill={c2} />
          {Array.from({ length: 4 }, (_, i) => (
            <rect key={i} x="0" y={i * 12} width="48" height="6" fill={c1} />
          ))}
          <rect x="0" y="0" width="26" height="24" fill={c4} />
        </>
      );

    /* امارات و عمان — نوار عمودی کنار میله + سه نوار افقی */
    case "hoist3":
      return (
        <>
          <rect x="0" y="0" width="48" height="16" fill={c1} />
          <rect x="0" y="16" width="48" height="16" fill={c2} />
          <rect x="0" y="32" width="48" height="16" fill={c3} />
          <rect x="0" y="0" width="14" height="48" fill={c4} />
        </>
      );

    /* کویت — گوهٔ مثلثی سیاه کنار میله */
    case "hoistWedge":
      return (
        <>
          <rect x="0" y="0" width="48" height="16" fill={c1} />
          <rect x="0" y="16" width="48" height="16" fill={c2} />
          <rect x="0" y="32" width="48" height="16" fill={c3} />
          <path d="M0 0 L16 16 L16 32 L0 48 Z" fill={c4} />
        </>
      );

    /* پاکستان — نوار سفید کنار میله + زمینهٔ سبز */
    case "hoistBar":
      return (
        <>
          <rect x="0" y="0" width="48" height="48" fill={c1} />
          <rect x="0" y="0" width="12" height="48" fill={c2} />
        </>
      );

    /* بحرین — پنج دندانهٔ مثلثی به‌جای مرز صاف */
    case "zigzag":
      return (
        <>
          <rect x="0" y="0" width="48" height="48" fill={c1} />
          <path
            d="M0 0 H16 L22 6 L16 12 L22 18 L16 24 L22 30 L16 36 L22 42 L16 48 H0 Z"
            fill={c2}
          />
        </>
      );

    /* قطر — همان ایده با نُه دندانهٔ ریزتر و زرشکی تیره.
       تعداد دندانه تنها چیزی است که این دو پرچم را از هم جدا می‌کند، پس
       مسیر این‌جا محاسبه می‌شود تا ۹ و ۵ واقعاً فرق کنند نه این‌که هر دو
       «یک نوار دندانه‌دار» باشند. */
    case "zigzag9": {
      const teeth = 9;
      const h = 48 / teeth;
      let d = "M0 0 H15";
      for (let i = 0; i < teeth; i++) {
        d += ` L20 ${h * (i + 0.5)} L15 ${h * (i + 1)}`;
      }
      d += " H0 Z";
      return (
        <>
          <rect x="0" y="0" width="48" height="48" fill={c1} />
          <path d={d} fill={c2} />
        </>
      );
    }
  }
}

/* رنگ نواری که نشان رویش می‌نشیند — هلال باید بریدگی‌اش را هم‌رنگ
   همان نوار بزند وگرنه یک نیم‌دایرهٔ بدرنگ می‌ماند. */
function emblemBg(layout: FlagLayout, brand: Brand): string {
  if (layout === "h3" || layout === "h5") return brand.color2 ?? brand.color;
  if (layout === "h3wide") return brand.color2 ?? brand.color;
  if (layout === "v3wide") return brand.color2 ?? brand.color;
  if (layout === "h2") return brand.color; // سنگاپور: هلال در نوار بالا
  if (layout === "hoistBar") return brand.color;
  if (layout === "stripesCanton") return brand.color4 ?? brand.color;
  return brand.color;
}

/** مرکز نشان — چند چیدمان مرکز خاص خودشان را دارند */
function emblemAt(layout: FlagLayout, kind: FlagEmblem): [number, number] {
  if (kind === "starsEU" || kind === "starsAU" || kind === "starsNZ")
    return [24, 24];
  if (kind === "starsCN" || kind === "cross4") return [24, 24];
  if (layout === "h2") return [16, 12]; // سنگاپور — هلال در نوار قرمز بالا
  if (layout === "stripesCanton") return [13, 12]; // مالزی — هلال در کانتون
  if (layout === "hoistBar") return [28, 22]; // پاکستان — هلال در زمینهٔ سبز
  if (layout === "h3") return [EM_X, 24]; // نوار میانی
  return [EM_X, EM_Y];
}

export function FlagMark({ brand, clipId }: { brand: Brand; clipId: string }) {
  const layout = brand.layout ?? "h2";
  const emblem = brand.emblem;
  const [ex, ey] = emblem ? emblemAt(layout, emblem) : [EM_X, EM_Y];

  return (
    <>
      <defs>
        <clipPath id={clipId}>
          <circle cx="24" cy="24" r="24" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <Field layout={layout} brand={brand} />
        {emblem ? (
          <Emblem
            kind={emblem}
            color={brand.emblemColor ?? brand.color2 ?? brand.color}
            bg={emblemBg(layout, brand)}
            cx={ex}
            cy={ey}
          />
        ) : null}
      </g>
      {/* حلقهٔ لبه — بدون آن پرچم سفیدزمینه (ژاپن، کره، گرجستان، روسیه)
          روی کارت روشن لبه ندارد و کاربر آن را «بی‌پرچم» می‌بیند: چیزی که
          دیده می‌شود فقط نشان وسط است، معلق در هوا. ۰٫۱۲ برای این کار کم
          بود. در تم تیره هم مزاحم نیست چون پرچم سفید آن‌جا خودش لبه دارد. */}
      <circle
        cx="24"
        cy="24"
        r="23"
        fill="none"
        stroke="rgba(0,0,0,0.22)"
        strokeWidth="2"
      />
    </>
  );
}
