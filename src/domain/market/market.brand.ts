/* هویت بصری هر قلم بازار — رنگ و نشان.

   چرا رنگ این‌جاست و توکن CSS نیست؟ این‌ها رنگ *برند*اند نه رنگ تم:
   سبز تتر در تم روشن و تیره یک عدد است، چون اگر عوض شود دیگر سبز تتر
   نیست. توکن‌های --t-*-fg اپ برعکس، عمداً با تم عوض می‌شوند. پس این دو
   نباید قاطی شوند؛ پس‌زمینهٔ ملایم کاشی در CSS با color-mix از همین رنگ
   ساخته می‌شود تا رنگ فقط یک‌بار تعریف شده باشد.

   نگاشت دو کلید دارد چون بالادست دو جور نام‌گذاری می‌کند:
   رمزارز نماد لاتین دارد (BTC/USDT) ولی ارز و طلا فقط نام فارسی
   («دلار آمریکا»، «سکه امامی»). هر کدام با کلید خودش جست‌وجو می‌شود.

   قلم ناشناخته بی‌نشان نمی‌ماند: از روی نامش یک رنگ پایدار از پالت
   خود اپ می‌گیرد (هش)، تا سکه یا ارز تازه‌ای که فردا اضافه شود هم
   کاشی بی‌رنگ و بدقواره ندهد. */

/** چیدمان هندسی پرچم — هر کدام در FlagMark یک مسیر رسم متفاوت است.

    چرا این‌همه نوع؟ چون نسخهٔ قبلی *همه*ی پرچم‌های دورنگ را دو نوار افقی
    می‌کشید و نتیجه این شد که ژاپن و ترکیه و کانادا و سوئیس و دانمارک و
    نروژ همگی «قرمز روی سفید» یعنی عملاً پرچم لهستان شدند. تشخیص پرچم به
    *چیدمان* است نه فقط رنگ: صلیب، نوار عمودی، نشان وسط. */
export type FlagLayout =
  | "h2" // دو نوار افقی
  | "h3" // سه نوار افقی
  | "h3wide" // سه نوار افقی با نوار میانی پهن (لبنان، کانادا نیست)
  | "h5" // پنج نوار افقی (تایلند)
  | "v3" // سه نوار عمودی
  | "v3wide" // سه نوار عمودی با میانهٔ پهن (کانادا)
  | "solid" // یک‌رنگ — همه‌چیز روی نشان وسط است (ژاپن، چین، عربستان)
  | "cross" // صلیب مرکزی (سوئیس، گرجستان)
  | "nordic" // صلیب اسکاندیناویایی — بازوی عمودی به سمت میله
  | "nordic2" // صلیب اسکاندیناویایی دولایه (نروژ)
  | "union" // یونیون‌جک بریتانیا
  | "canton" // یونیون‌جک گوشه + ستاره (استرالیا، نیوزیلند)
  | "stripes" // نوارهای متعدد + کانتون گوشه (آمریکا)
  | "stripesCanton" // نوار دورنگ + کانتون با هلال (مالزی)
  | "hoist3" // نوار عمودی کنار میله + سه نوار افقی (امارات، عمان)
  | "hoistWedge" // گوهٔ مثلثی کنار میله (کویت)
  | "hoistBar" // نوار عمودی کنار میله + زمینهٔ یک‌رنگ (پاکستان)
  | "zigzag" // نوار دندانه‌دار با پنج دندانه (بحرین)
  | "zigzag9"; // نوار دندانه‌دار با نُه دندانه (قطر)

/** نشان روی پرچم — جدا از چیدمان چون یک چیدمان چند نشان می‌گیرد */
export type FlagEmblem =
  | "disc" // دایرهٔ تو‌پر (ژاپن)
  | "crescent" // هلال + ستاره (ترکیه، پاکستان، سنگاپور، مالزی، آذربایجان)
  | "starsCN" // یک ستارهٔ بزرگ + چهار کوچک (چین)
  | "starsEU" // حلقهٔ دوازده ستاره (اروپا)
  | "starsAU" // ستاره‌های صلیب جنوبی (استرالیا)
  | "starsNZ" // چهار ستارهٔ نیوزیلند
  | "star3" // سه ستاره در یک ردیف (سوریه)
  | "maple" // برگ افرا (کانادا)
  | "chakra" // چرخهٔ آشوکا (هند)
  | "sun" // خورشید پرتودار (اقلیم کردستان)
  | "cedar" // سرو لبنان
  | "bauhinia" // گل پنج‌پر هنگ‌کنگ
  | "taegeuk" // نشان پرچم کره
  | "sword" // شمشیر + خط نوشته (عربستان)
  | "script" // خط نوشتهٔ ساده‌شده (عراق)
  | "eagle" // عقاب ساده‌شده (مصر)
  | "cross4"; // چهار صلیب کوچک گوشه (گرجستان)

/** یک هویت بصری — رنگ برند + نوع نشانی که BrandMark می‌کشد */
export type Brand = {
  /** رنگ اصلی؛ هم نشان و هم پس‌زمینهٔ ملایم کاشی از این ساخته می‌شود */
  color: string;
  /** شکل نشان — هر کدام در BrandMark/CryptoMark یک مسیر SVG متفاوت دارد */
  shape: CryptoShape | "flag" | "coin" | "bar";
  /** نوشتهٔ روی نشان (برای disc/flag/coin) — کوتاه، حداکثر ۴ نویسه */
  glyph?: string;
  /** رنگ دوم پرچم — فقط برای shape="flag" */
  color2?: string;
  /** رنگ سوم پرچم — پرچم‌های سه‌رنگ */
  color3?: string;
  /** رنگ چهارم — نوار کنار میله یا کانتون (امارات، کویت، مالزی) */
  color4?: string;
  /** چیدمان پرچم — نبودش یعنی همان دو نوار افقی ساده */
  layout?: FlagLayout;
  /** نشان روی پرچم */
  emblem?: FlagEmblem;
  /** رنگ نشان — نبودش یعنی رنگ دوم، وگرنه رنگ اول */
  emblemColor?: string;
};

/** شکل نشان رمزارز — «disc» یعنی دایرهٔ رنگی با نوشته */
export type CryptoShape =
  | "disc"
  | "eth"
  | "sol"
  | "bnb"
  | "xrp"
  | "ada"
  | "trx"
  | "dot"
  | "link"
  | "atom"
  | "matic"
  | "avax"
  | "xlm"
  | "sui"
  | "near"
  | "ton"
  | "usdc"
  | "pepe"
  | "shib";

/* ── رمزارز ───────────────────────────────────────────────────
   کلید = نماد لاتین بالادست (همان چیزی که _CRYPTO_SYMBOLS در
   backend/app/services/market.py می‌شناسد).

   قاعده: تا جایی که با چند مسیر ساده در ۴۰ پیکسل قابل تشخیص باشد، شکل
   واقعی نشان کشیده می‌شود؛ آن‌جا که نشان تصویری است (سگ شیبا، اسب
   یونی‌سواپ) نوشته می‌ماند. «دایره با نماد نوشته‌شده» لوگو نیست و کاربر
   درست گفت — ولی لوگوی بدشکل هم از نوشته بدتر است.

   چند رنگ عمداً رنگ رسمی نیست: XRP و TON و NEAR و APT نشان رسمی‌شان
   سیاه/سفید است و روی کارت سفید ناپیدا و در تم تیره گم می‌شود. */
const CRYPTO: Record<string, Brand> = {
  BTC: { color: "#F7931A", shape: "disc", glyph: "₿" },
  ETH: { color: "#627EEA", shape: "eth" },
  USDT: { color: "#26A17B", shape: "disc", glyph: "₮" },
  USDC: { color: "#2775CA", shape: "usdc" },
  BNB: { color: "#F0B90B", shape: "bnb" },
  SOL: { color: "#9945FF", shape: "sol" },
  XRP: { color: "#0085C0", shape: "xrp" }, // آبی قدیمی ریپل — نشان فعلی سیاه است
  ADA: { color: "#0033AD", shape: "ada" },
  DOGE: { color: "#C2A633", shape: "disc", glyph: "Ð" },
  TRX: { color: "#EF0027", shape: "trx" },
  LINK: { color: "#2A5ADA", shape: "link" },
  XLM: { color: "#3E1BDB", shape: "xlm" }, // نشان رسمی سیاه است
  AVAX: { color: "#E84142", shape: "avax" },
  SHIB: { color: "#FFA409", shape: "shib" },
  LTC: { color: "#345D9D", shape: "disc", glyph: "Ł" },
  DOT: { color: "#E6007A", shape: "dot" },
  UNI: { color: "#FF007A", shape: "disc", glyph: "UNI" }, // اسب تک‌شاخ ساده‌شدنی نیست
  FIL: { color: "#0090FF", shape: "disc", glyph: "FIL" },
  ATOM: { color: "#2E3148", shape: "atom" },
  MATIC: { color: "#8247E5", shape: "matic" },
  TON: { color: "#0098EA", shape: "ton" },
  BCH: { color: "#8DC351", shape: "disc", glyph: "₿" },
  NEAR: { color: "#00C08B", shape: "near" }, // سبز برند به‌جای سیاه رسمی
  APT: { color: "#06F7A1", shape: "disc", glyph: "APT" },
  ARB: { color: "#213147", shape: "disc", glyph: "ARB" },
  OP: { color: "#FF0420", shape: "disc", glyph: "OP" },
  PEPE: { color: "#3D8130", shape: "pepe" },
  SUI: { color: "#4DA2FF", shape: "sui" },
  ICP: { color: "#F15A24", shape: "disc", glyph: "∞" },
  ETC: { color: "#328332", shape: "eth" }, // همان لوزی اتریوم با سبز کلاسیک
};

/* ── ارز ──────────────────────────────────────────────────────
   کلید = نشانهٔ شناسایی ارز در نام فارسی، نه نام کاملش.

   چرا نام کامل نه؟ چون نسخهٔ قبلی جدول را با کلید *دقیق* جست‌وجو می‌کرد
   («دلارآمریکا») و هر تفاوت کوچک املا در نام بالادست یعنی پرچم گم‌شده.
   کاربر شش ارز بی‌پرچم گزارش کرد (پوند، ین، خود دلار، یوآن، دینار عراق،
   ریال قطر) و علت دقیقاً همین بود: «یوآن» با الف مَدّی می‌آید ولی کلید
   «یوان» بود، عراق با کلید ساختگی «دیناربغداد» نوشته شده بود، و قطر
   اصلاً در جدول نبود.

   پس حالا مثل GOLD_RULES فهرست ترتیبی است و با «شامل بودن» تطبیق می‌خورد.
   **ترتیب حیاتی است**: نام کشور همیشه پیش از نام خود واحد پول می‌آید،
   وگرنه «دلار» خالی پرچم آمریکا را به دلار کانادا و استرالیا و سنگاپور
   هم می‌چسباند.

   لایهٔ دوم (BARE) عمداً با startsWith تطبیق می‌خورد نه includes: «ین» در
   «یوانچین» هم هست و با includes، یوآن چین پرچم ژاپن می‌گرفت.

   هر پرچم چیدمان واقعی خودش را دارد. نسخهٔ قبلی همه را دو نوار افقی
   می‌کشید و کاربر درست گفت که «اکثراً شبیه پرچم لهستان‌اند»: ژاپن،
   ترکیه، کانادا، سوئیس، دانمارک و نروژ همگی قرمز-روی-سفید می‌شدند.

   هدف هنوز بازتولید دقیق پرچم نیست — در ۴۰ پیکسل نشان ملی ریز به لکه
   تبدیل می‌شود — ولی چیدمان (صلیب، نوار عمودی، دایرهٔ وسط) همان چیزی است
   که چشم در این اندازه تشخیص می‌دهد، پس چیدمان باید درست باشد.

   ترتیب color/color2/color3 مهم است: tintOf اولین رنگ غیر سفید/سیاه را
   برای کف کاشی برمی‌دارد، پس رنگ *شناسه*ی هر ارز باید جلوتر بیاید. */
const FIAT: Record<string, Brand> = {
  دلارآمریکا: {
    color: "#B22234",
    color2: "#FFFFFF",
    color4: "#3C3B6E",
    shape: "flag",
    layout: "stripes",
    glyph: "$",
  },
  یورو: {
    color: "#003399",
    color2: "#FFCC00",
    shape: "flag",
    layout: "solid",
    emblem: "starsEU",
    glyph: "€",
  },
  پوندانگلیس: {
    color: "#012169",
    color2: "#FFFFFF",
    color3: "#C8102E",
    shape: "flag",
    layout: "union",
    glyph: "£",
  },
  درهمامارات: {
    color: "#00732F",
    color2: "#FFFFFF",
    color3: "#000000",
    color4: "#FF0000",
    shape: "flag",
    layout: "hoist3",
    glyph: "د.إ",
  },
  لیرترکیه: {
    color: "#E30A17",
    color2: "#FFFFFF",
    shape: "flag",
    layout: "solid",
    emblem: "crescent",
    glyph: "₺",
  },
  ینژاپن: {
    color: "#FFFFFF",
    color2: "#BC002D",
    shape: "flag",
    layout: "solid",
    emblem: "disc",
    glyph: "¥",
  },
  یوانچین: {
    color: "#EE1C25",
    color2: "#FFDE00",
    shape: "flag",
    layout: "solid",
    emblem: "starsCN",
    glyph: "¥",
  },
  دلارکانادا: {
    color: "#FF0000",
    color2: "#FFFFFF",
    shape: "flag",
    layout: "v3wide",
    emblem: "maple",
    emblemColor: "#FF0000",
    glyph: "$",
  },
  دلاراسترالیا: {
    color: "#00008B",
    color2: "#FFFFFF",
    color3: "#FF0000",
    shape: "flag",
    layout: "canton",
    emblem: "starsAU",
    emblemColor: "#FFFFFF",
    glyph: "$",
  },
  فرانکسوئیس: {
    color: "#FF0000",
    color2: "#FFFFFF",
    shape: "flag",
    layout: "cross",
    glyph: "Fr",
  },
  روبلروسیه: {
    /* ترتیب واقعی: سفید، آبی، قرمز — نه آبی اول. color اولین نوار است. */
    color: "#FFFFFF",
    color2: "#0039A6",
    color3: "#D52B1E",
    shape: "flag",
    layout: "h3",
    glyph: "₽",
  },
  ریالعربستان: {
    color: "#006C35",
    color2: "#FFFFFF",
    shape: "flag",
    layout: "solid",
    emblem: "sword",
    glyph: "﷼",
  },
  دینارکویت: {
    color: "#007A3D",
    color2: "#FFFFFF",
    color3: "#CE1126",
    color4: "#000000",
    shape: "flag",
    layout: "hoistWedge",
    glyph: "د.ك",
  },
  دیناربحرین: {
    color: "#CE1126",
    color2: "#FFFFFF",
    shape: "flag",
    layout: "zigzag",
    glyph: "د.ب",
  },
  ریالعمان: {
    /* سفید/قرمز/سبز با نوار عمودی قرمز کنار میله */
    color: "#FFFFFF",
    color2: "#DB161B",
    color3: "#008000",
    color4: "#DB161B",
    shape: "flag",
    layout: "hoist3",
    glyph: "﷼",
  },
  /* کلید «دیناربغداد» بود — نامی که بالادست هیچ‌وقت نمی‌فرستد، پس این
     پرچم از روز اول گم بود. */
  دینارعراق: {
    color: "#CE1126",
    color2: "#FFFFFF",
    color3: "#000000",
    shape: "flag",
    layout: "h3",
    emblem: "script",
    emblemColor: "#007A3D",
    glyph: "د.ع",
  },
  /* قطر — اصلاً در جدول نبود. دندانهٔ نُه‌تایی و زرشکی تیره، در برابر
     دندانهٔ پنج‌تایی قرمز بحرین؛ همین دو تفاوت در ۴۰ پیکسل کافی است. */
  ریالقطر: {
    color: "#8D1B3D",
    color2: "#FFFFFF",
    shape: "flag",
    layout: "zigzag9",
    glyph: "﷼",
  },
  دیناراقلیم: {
    color: "#ED2024",
    color2: "#FFFFFF",
    color3: "#278E43",
    shape: "flag",
    layout: "h3",
    emblem: "sun",
    emblemColor: "#FEBD11",
    glyph: "د.ع",
  },
  لیرسوریه: {
    color: "#007A3D",
    color2: "#FFFFFF",
    color3: "#000000",
    shape: "flag",
    layout: "h3",
    emblem: "star3",
    emblemColor: "#CE1126",
    glyph: "£",
  },
  روپیههند: {
    color: "#FF9933",
    color2: "#FFFFFF",
    color3: "#138808",
    shape: "flag",
    layout: "h3",
    emblem: "chakra",
    emblemColor: "#000080",
    glyph: "₹",
  },
  روپیهپاکستان: {
    color: "#01411C",
    color2: "#FFFFFF",
    shape: "flag",
    layout: "hoistBar",
    emblem: "crescent",
    glyph: "₨",
  },
  افغانی: {
    /* سه نوار عمودی به ترتیب سیاه، قرمز، سبز (از سمت میله) */
    color: "#000000",
    color2: "#D32011",
    color3: "#007A36",
    shape: "flag",
    layout: "v3",
    glyph: "؋",
  },
  کرونسوئد: {
    color: "#006AA7",
    color2: "#FECC00",
    shape: "flag",
    layout: "nordic",
    glyph: "kr",
  },
  کروننروژ: {
    color: "#BA0C2F",
    color2: "#FFFFFF",
    color3: "#00205B",
    shape: "flag",
    layout: "nordic2",
    glyph: "kr",
  },
  کروندانمارک: {
    color: "#C60C30",
    color2: "#FFFFFF",
    shape: "flag",
    layout: "nordic",
    glyph: "kr",
  },
  دلارسنگاپور: {
    color: "#ED2939",
    color2: "#FFFFFF",
    shape: "flag",
    layout: "h2",
    emblem: "crescent",
    emblemColor: "#FFFFFF",
    glyph: "$",
  },
  دلارهنگکنگ: {
    color: "#DE2910",
    color2: "#FFFFFF",
    shape: "flag",
    layout: "solid",
    emblem: "bauhinia",
    glyph: "$",
  },
  دلارنیوزیلند: {
    color: "#00247D",
    color2: "#FFFFFF",
    color3: "#CC142B",
    shape: "flag",
    layout: "canton",
    emblem: "starsNZ",
    emblemColor: "#CC142B",
    glyph: "$",
  },
  رینگیتمالزی: {
    color: "#CC0001",
    color2: "#FFFFFF",
    color3: "#FFCC00",
    color4: "#010066",
    shape: "flag",
    layout: "stripesCanton",
    /* بدون این، کانتون یک مستطیل سرمه‌ای خالی بود */
    emblem: "crescent",
    emblemColor: "#FFCC00",
    glyph: "RM",
  },
  باتتایلند: {
    color: "#A51931",
    color2: "#F4F5F8",
    color3: "#2D2A4A",
    shape: "flag",
    layout: "h5",
    glyph: "฿",
  },
  وناکرهجنوبی: {
    /* زمینه سفید است نه قرمز. قرمز نیمهٔ بالای تَگوک روی زمینهٔ قرمز
       ناپدید می‌شد و نشان نصفه به نظر می‌رسید. رنگ‌های خود تَگوک در
       FlagMark ثابت‌اند، پس emblemColor این‌جا نمی‌آید. */
    color: "#FFFFFF",
    color2: "#C60C30",
    color3: "#003478",
    shape: "flag",
    layout: "solid",
    emblem: "taegeuk",
    glyph: "₩",
  },
  لاریگرجستان: {
    /* زمینه سفید و صلیب قرمز — برعکس سوئیس. قبلاً وارونه بود و چهار
       صلیب گوشه هم سفید روی سفید یعنی نامرئی می‌شدند. */
    color: "#FFFFFF",
    color2: "#FF0000",
    shape: "flag",
    layout: "cross",
    emblem: "cross4",
    emblemColor: "#FF0000",
    glyph: "₾",
  },
  مناتآذربایجان: {
    color: "#00B5E2",
    color2: "#EF3340",
    color3: "#509E2F",
    shape: "flag",
    layout: "h3",
    emblem: "crescent",
    emblemColor: "#FFFFFF",
    glyph: "₼",
  },
  درامارمنستان: {
    color: "#D90012",
    color2: "#0033A0",
    color3: "#F2A800",
    shape: "flag",
    layout: "h3",
    glyph: "֏",
  },
  لیرلبنان: {
    color: "#ED1C24",
    color2: "#FFFFFF",
    shape: "flag",
    layout: "h3wide",
    emblem: "cedar",
    emblemColor: "#00A651",
    glyph: "ل.ل",
  },
  پوندمصر: {
    color: "#CE1126",
    color2: "#FFFFFF",
    color3: "#000000",
    shape: "flag",
    layout: "h3",
    emblem: "eagle",
    emblemColor: "#C09300",
    glyph: "£",
  },
};

/* ── طلا و سکه ────────────────────────────────────────────────
   این‌ها برند نیستند، جنس‌اند. پس نشانشان شکل خود جنس است: سکه
   گرد، شمش/آبشده مستطیل. رنگ هم از خود فلز می‌آید نه از پالت اپ. */
const GOLD_TONE = "#C9A227"; // طلایی
const SILVER_TONE = "#9AA3AD"; // نقره‌ای
const PLATINUM_TONE = "#7E8B99"; // پلاتین/پالادیوم

/* ترتیب مهم است: «نیمسکه» پیش از «سکه» می‌آید چون شامل آن است و
   اگر بعد بیاید هیچ‌وقت تطبیق نمی‌خورد. */
const GOLD_RULES: { key: string; brand: Brand }[] = [
  { key: "نقره", brand: { color: SILVER_TONE, shape: "bar", glyph: "Ag" } },
  { key: "پلاتین", brand: { color: PLATINUM_TONE, shape: "bar", glyph: "Pt" } },
  {
    key: "پالادیوم",
    brand: { color: PLATINUM_TONE, shape: "bar", glyph: "Pd" },
  },
  { key: "ربعسکه", brand: { color: GOLD_TONE, shape: "coin", glyph: "¼" } },
  { key: "نیمسکه", brand: { color: GOLD_TONE, shape: "coin", glyph: "½" } },
  { key: "سکهگرمی", brand: { color: GOLD_TONE, shape: "coin", glyph: "۱g" } },
  { key: "سکه", brand: { color: GOLD_TONE, shape: "coin", glyph: "۱" } },
  { key: "آبشده", brand: { color: GOLD_TONE, shape: "bar", glyph: "Au" } },
  { key: "انس", brand: { color: GOLD_TONE, shape: "bar", glyph: "oz" } },
  { key: "طلا", brand: { color: GOLD_TONE, shape: "bar", glyph: "Au" } },
];

/* پالت پشتیبان — از توکن‌های خود اپ نیست چون این رنگ‌ها باید در هر دو
   تم ثابت بمانند (کاشی امروز آبی، فردا بعد از سوییچ تم سبز، گیج‌کننده
   است). این‌ها نسخهٔ میانی همان هشت آهنگ رنگی اپ‌اند. */
const FALLBACK_COLORS = [
  "#3f6fa8", // sky
  "#2f7d70", // teal
  "#8a6a0f", // amber
  "#6b4a91", // violet
  "#9f3f52", // rose
  "#2f7d52", // emerald
  "#4a5a96", // indigo
  "#6f7d2a", // lime
];

/** نام فارسی نرمال‌شده — همان قاعدهٔ `_norm_search` در بک‌اند.

    «آ» به «ا» تبدیل می‌شود و همین نکتهٔ اصلی است: بالادست «یوآن چین» را با
    الف مَدّی می‌فرستد ولی کلید جدول «یوان» نوشته شده بود، پس پرچم چین
    هیچ‌وقت پیدا نمی‌شد. یک حرف، چند پرچم گم‌شده. */
function norm(s: string): string {
  return (s || "")
    .replace(/[يﻱﻲ]/g, "ی")
    .replace(/[كﻙﻚ]/g, "ک")
    .replace(/[آأإٱ]/g, "ا")
    .replace(/[ةۀ]/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/[ً-ْ]/g, "") // اعراب
    .replace(/[\s‌ـ]/g, "");
}

/* قواعد تطبیق ارز — ترتیب حیاتی است.

   لایهٔ اول: نام کشور. اگر نام کشور در نام ارز باشد همان حرف آخر را
   می‌زند. این لایه باید جلو باشد چون «دلار» تنها، هم دلار آمریکاست هم
   کانادا هم استرالیا هم سنگاپور هم هنگ‌کنگ هم نیوزیلند.

   لایهٔ دوم: نام خود واحد پول، برای وقتی بالادست کشور را ننویسد
   («دلار» خالی). این لایه با startsWith تطبیق می‌خورد نه includes، وگرنه
   «ین» که در «یوانچین» هم هست، یوآن چین را پرچم ژاپن می‌کرد. */
const FIAT_BY_COUNTRY: { key: string; to: string }[] = [
  { key: "امریکا", to: "دلارآمریکا" },
  { key: "کانادا", to: "دلارکانادا" },
  { key: "استرالیا", to: "دلاراسترالیا" },
  { key: "نیوزیلند", to: "دلارنیوزیلند" },
  { key: "سنگاپور", to: "دلارسنگاپور" },
  { key: "هنگکنگ", to: "دلارهنگکنگ" },
  /* «انگل» و نه «انگلیس»: بالادست هم «انگلیس» می‌نویسد هم «انگلستان» */
  { key: "انگل", to: "پوندانگلیس" },
  { key: "بریتانیا", to: "پوندانگلیس" },
  { key: "ژاپن", to: "ینژاپن" },
  { key: "چین", to: "یوانچین" },
  { key: "امارات", to: "درهمامارات" },
  { key: "ترکیه", to: "لیرترکیه" },
  { key: "سوئیس", to: "فرانکسوئیس" },
  { key: "سویس", to: "فرانکسوئیس" },
  { key: "روسیه", to: "روبلروسیه" },
  { key: "عربستان", to: "ریالعربستان" },
  { key: "کویت", to: "دینارکویت" },
  { key: "بحرین", to: "دیناربحرین" },
  { key: "عمان", to: "ریالعمان" },
  { key: "قطر", to: "ریالقطر" },
  /* «اقلیم» پیش از «عراق»: دینار اقلیم کردستان پرچم خودش را دارد و
     نامش گاهی «دینار عراق (اقلیم)» است، پس اگر عراق جلو بیفتد هیچ‌وقت
     نوبت به اقلیم نمی‌رسد. */
  { key: "اقلیم", to: "دیناراقلیم" },
  { key: "کردستان", to: "دیناراقلیم" },
  { key: "عراق", to: "دینارعراق" },
  { key: "بغداد", to: "دینارعراق" },
  { key: "سوریه", to: "لیرسوریه" },
  { key: "هند", to: "روپیههند" },
  { key: "پاکستان", to: "روپیهپاکستان" },
  { key: "افغان", to: "افغانی" },
  { key: "سوئد", to: "کرونسوئد" },
  { key: "سوید", to: "کرونسوئد" },
  { key: "نروژ", to: "کروننروژ" },
  { key: "دانمارک", to: "کروندانمارک" },
  { key: "مالزی", to: "رینگیتمالزی" },
  { key: "تایلند", to: "باتتایلند" },
  { key: "کرهجنوبی", to: "وناکرهجنوبی" },
  { key: "گرجستان", to: "لاریگرجستان" },
  { key: "اذربایجان", to: "مناتآذربایجان" },
  { key: "ارمنستان", to: "درامارمنستان" },
  { key: "لبنان", to: "لیرلبنان" },
  { key: "مصر", to: "پوندمصر" },
];

const FIAT_BY_CURRENCY: { key: string; to: string }[] = [
  { key: "یورو", to: "یورو" },
  { key: "دلار", to: "دلارآمریکا" },
  { key: "پوند", to: "پوندانگلیس" },
  { key: "ین", to: "ینژاپن" },
  { key: "یوان", to: "یوانچین" },
  { key: "فرانک", to: "فرانکسوئیس" },
  { key: "روبل", to: "روبلروسیه" },
  { key: "درهم", to: "درهمامارات" },
  { key: "افغانی", to: "افغانی" },
  /* «ریال»، «دینار»، «کرون»، «لیر» و «روپیه» عمداً این‌جا نیستند: هر کدام
     چند کشور دارند و بدون نام کشور حدس زدنشان یعنی پرچم غلط — که از
     بی‌پرچمی بدتر است. */
];

/** جدول ارز با کلید نرمال‌شده — کلیدهای خود FIAT «آ» و «ئ» دارند و
    بدون این یک‌بار نرمال‌سازی، تطبیق نام نرمال‌شده با آن‌ها جور نمی‌شد. */
const FIAT_NORM: Record<string, Brand> = Object.fromEntries(
  Object.entries(FIAT).map(([k, v]) => [norm(k), v]),
);

/** پرچم یک ارز از روی نامش — null یعنی در جدول نیست. */
function fiatBrand(name: string): Brand | null {
  const n = norm(name);
  if (!n) return null;

  const direct = FIAT_NORM[n];
  if (direct) return direct;

  for (const r of FIAT_BY_COUNTRY) {
    if (n.includes(norm(r.key))) return FIAT_NORM[norm(r.to)] ?? null;
  }
  for (const r of FIAT_BY_CURRENCY) {
    if (n.startsWith(norm(r.key))) return FIAT_NORM[norm(r.to)] ?? null;
  }
  return null;
}

/* هش پایدار (djb2) — همان نام همیشه همان رنگ را می‌دهد، حتی بعد از
   ری‌لود. اگر به‌جایش از ایندکس آرایه استفاده می‌کردیم، با هر بار عوض
   شدن ترتیب فهرست رنگ همه‌ی کاشی‌ها می‌پرید. */
function hashColor(seed: string): string {
  let h = 5381;
  for (let i = 0; i < seed.length; i++)
    h = ((h << 5) + h + seed.charCodeAt(i)) | 0;
  return FALLBACK_COLORS[Math.abs(h) % FALLBACK_COLORS.length];
}

/** دو نویسه‌ی اول نام — نشان پشتیبان برای قلم ناشناخته */
function initials(name: string): string {
  const clean = (name || "").trim();
  if (!clean) return "؟";
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return words[0][0] + words[1][0];
  return clean.slice(0, 2);
}

/** هویت بصری یک قلم. هیچ‌وقت null نمی‌دهد — قلم ناشناخته هم نشان می‌گیرد. */
export function brandOf(
  kind: "gold" | "currency" | "crypto" | "stock",
  symbol: string,
  name: string,
): Brand {
  if (kind === "crypto") {
    const hit = CRYPTO[(symbol || "").trim().toUpperCase()];
    if (hit) return hit;
    // رمزارز تازه که هنوز در فهرست نیست
    return {
      color: hashColor(symbol || name),
      shape: "disc",
      glyph: (symbol || initials(name)).slice(0, 4).toUpperCase(),
    };
  }

  if (kind === "gold") {
    const n = norm(name);
    const rule = GOLD_RULES.find((r) => n.includes(r.key));
    if (rule) return rule.brand;
    return { color: GOLD_TONE, shape: "coin", glyph: initials(name) };
  }

  if (kind === "currency") {
    const hit = fiatBrand(name);
    if (hit) return hit;
    return { color: hashColor(name), shape: "disc", glyph: initials(name) };
  }

  // سهم — نماد فارسی دارد و لوگو ندارد؛ حروف اول روی رنگ پایدار
  return {
    color: hashColor(symbol || name),
    shape: "disc",
    glyph: initials(symbol || name),
  };
}

/* رنگی که پس‌زمینهٔ ملایم کاشی از آن ساخته می‌شود — همیشه همان
   brand.color نیست.

   دو دلیل: (۱) خوانایی — رنگ سفید وقتی با کارت تم تیره مخلوط شود آن را
   روشن می‌کند و واحد خاکستری کنار قیمت تقریباً محو می‌شود (نسبت ۱٫۸
   در برابر ۳٫۱ پایه). (۲) هویت — سفید پرچم روسیه یا سیاه پرچم
   افغانستان رنگ *شناسه*ی آن ارز نیست؛ آبی و قرمز است.

   پس اولین رنگ غیر سفید/سیاه پرچم انتخاب می‌شود. خود نشان دست‌نخورده
   می‌ماند و پرچم با رنگ‌های واقعی‌اش کشیده می‌شود — این فقط کف کاشی است. */
export function tintOf(brand: Brand): string {
  const extreme = (c: string) => {
    const h = c.replace("#", "").toLowerCase();
    const full =
      h.length === 3
        ? h
            .split("")
            .map((x) => x + x)
            .join("")
        : h;
    return full === "ffffff" || full === "000000";
  };
  for (const c of [brand.color, brand.color2, brand.color3]) {
    if (c && !extreme(c)) return c;
  }
  return GOLD_TONE; // هر سه رنگ سفید/سیاه — عملاً پیش نمی‌آید
}
