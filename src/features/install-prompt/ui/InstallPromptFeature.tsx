/* صفحه‌ی «خانه‌یار را به صفحه‌ی اصلی اضافه کنید» — فقط روی گوشی، فقط در مرورگر.

   چرا اولین چیزی است که دیده می‌شود: کاربر با آدرس pwa.khaanehyar.ir
   می‌آید و اگر همان‌جا در تب مرورگر بماند، هر بار باید آدرس را تایپ کند.
   یک‌بار افزودن به صفحه‌ی اصلی این را برای همیشه حل می‌کند.

   شرط‌های نمایش و دلیلشان در useInstallPrompt توضیح داده شده — مهم‌ترینش
   این است که داخل اپِ نصب‌شده‌ی اندروید (که همین URL را لود می‌کند) هرگز
   دیده نشود.

   ── چیدمان (به خواسته‌ی کاربر، بر پایه‌ی نمونه‌ای که فرستاد) ──
   آیکونِ اپ ← عنوان ← شکل ← گام‌ها ← یک دکمه‌ی پهنِ پایین.

   شکل، «نتیجه» را نشان می‌دهد نه مسیر را: صفحه‌ی اصلیِ یک گوشی با چند
   خانه‌ی خالیِ نقطه‌چین، و آیکونِ خانه‌یار که از لبه دارد می‌آید تا در
   یکی از آن‌ها بنشیند. مسیر را گام‌های زیرش می‌گویند، و هر گام به‌جای
   شماره، *همان* نشانی را نشان می‌دهد که کاربر باید در مرورگر پیدا کند —
   حتی واژه‌ی انگلیسیِ روی دکمه، عیناً.

   تنها حرکتِ صفحه نشستنِ همان یک آیکون است. */

import type { ReactNode } from "react";
import { Icon } from "@/shared/ui";
import type {
  InstallPlatform,
  InstallPromptModel,
} from "../model/useInstallPrompt";

interface Step {
  key: string;
  /* نشانه‌ی کنارِ گام: یا آیکونِ همان دکمه‌ی مرورگر، یا عیناً واژه‌ای که
     روی آن دکمه نوشته شده. واژه‌ها انگلیسی‌اند چون مرورگرِ گوشیِ اکثر
     کاربران انگلیسی است و کاربر باید دقیقاً همان را ببیند. */
  glyph: ReactNode;
  text: ReactNode;
}

function word(w: string) {
  return (
    <span className="a2hs-step-w" dir="ltr">
      {w}
    </span>
  );
}

function stepsFor(platform: InstallPlatform): Step[] {
  if (platform === "ios") {
    return [
      {
        key: "share",
        glyph: <Icon name="i-share" size={20} />,
        text: (
          <>
            در نوار پایینِ <b>سافاری</b>، دکمه‌ی اشتراک‌گذاری را بزنید.
          </>
        ),
      },
      {
        key: "add",
        glyph: <Icon name="i-plus" size={20} />,
        text: (
          <>
            فهرست را پایین بکشید و <b>Add to Home Screen</b> را انتخاب کنید.
          </>
        ),
      },
      {
        key: "confirm",
        glyph: word("Add"),
        text: <>بالای صفحه، دکمه‌ی تأیید را بزنید — همین.</>,
      },
    ];
  }
  if (platform === "android") {
    return [
      {
        key: "menu",
        glyph: <Icon name="i-more" size={20} />,
        text: (
          <>
            منوی سه‌نقطه‌ی بالای <b>کروم</b> را باز کنید.
          </>
        ),
      },
      {
        key: "add",
        glyph: <Icon name="i-download" size={20} />,
        text: (
          <>
            <b>نصب برنامه</b> یا <b>Add to Home screen</b> را بزنید.
          </>
        ),
      },
      {
        key: "confirm",
        glyph: word("Install"),
        text: <>در پنجره‌ای که باز می‌شود تأیید کنید — همین.</>,
      },
    ];
  }
  return [
    {
      key: "menu",
      glyph: <Icon name="i-more" size={20} />,
      text: <>منوی مرورگرتان را باز کنید.</>,
    },
    {
      key: "add",
      glyph: <Icon name="i-plus" size={20} />,
      text: (
        <>
          گزینه‌ی <b>افزودن به صفحه‌ی اصلی</b> را بزنید.
        </>
      ),
    },
    {
      key: "confirm",
      glyph: <Icon name="i-check" size={20} />,
      text: <>تأیید کنید — همین.</>,
    },
  ];
}

/* ── آیکونِ اپ ──
   یک تعریف، دو مصرف: نشانِ بالای صفحه، و همان آیکونی که داخلِ شکل روی
   صفحه‌ی اصلی می‌نشیند. رنگش ثابت است و از توکنِ تم نمی‌آید، چون آیکونِ
   اپ در تم روشن و تیره یکی است. */
function AppIconGlyph({
  x,
  y,
  size,
}: {
  x: number;
  y: number;
  size: number;
}) {
  const pad = size * 0.176;
  /* مسیرهای نشان در جعبه‌ی ۹۶×۹۶ کشیده شده‌اند */
  const k = (size - pad * 2) / 96;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={size}
        height={size}
        rx={size * 0.29}
        fill="#0D1B2A"
      />
      <g transform={`translate(${x + pad} ${y + pad}) scale(${k})`}>
        <path fill="#FFFFFF" d="M48 7 85 35H72L48 17 24 35H11L48 7Z" />
        <path fill="#FFFFFF" d="M18 37h17v42H18zM61 37h17v42H61z" />
        <path fill="#34D399" d="M39 79V57c0-5 4-9 9-9s9 4 9 9v22H39Z" />
        <path fill="#FFFFFF" d="M31 79h34v6H31z" />
      </g>
    </g>
  );
}

/* ── شکل: صفحه‌ی اصلیِ گوشی، با خانه‌های خالی و آیکونی که دارد می‌آید ──
   خطِ گوشی و کاشی‌ها نازک و کم‌رنگ‌اند تا تنها چیزِ پُررنگِ شکل، خودِ
   آیکونِ خانه‌یار باشد. */
function PhoneArt() {
  const cols = [83, 110, 137];

  return (
    <svg
      className="a2hs-art"
      viewBox="0 0 240 240"
      role="img"
      aria-label="آیکون خانه‌یار در حال نشستن روی صفحه‌ی اصلی گوشی"
    >
      <circle cx="120" cy="120" r="108" className="a2hs-art-halo" />

      {/* قابِ گوشی + بریدگیِ بالا (سه‌ضلعی، تا خطِ بالا دو تا نشود) */}
      <rect
        x="70"
        y="26"
        width="100"
        height="188"
        rx="17"
        className="a2hs-art-phone"
      />
      <path
        d="M103 26v4a4 4 0 0 0 4 4h26a4 4 0 0 0 4-4v-4"
        className="a2hs-art-phone"
      />

      {/* اپ‌های موجود — بی‌نام، فقط برای اینکه معلوم شود صفحه‌ی اصلی است */}
      {[56, 84].map((y) =>
        cols.map((x) => (
          <rect
            key={`t${x}-${y}`}
            x={x}
            y={y}
            width="20"
            height="20"
            rx="6"
            className="a2hs-art-tile"
          />
        )),
      )}

      {/* خانه‌های خالی — جایی که آیکونِ تازه می‌نشیند */}
      {cols.map((x) => (
        <rect
          key={`e${x}`}
          x={x}
          y="112"
          width="20"
          height="20"
          rx="6"
          className="a2hs-art-empty"
        />
      ))}

      {/* خانه‌یار — تنها چیزی که در صفحه حرکت می‌کند، و تنها چیزِ پُررنگ */}
      <g className="a2hs-art-new">
        <AppIconGlyph x={150} y={76} size={34} />
      </g>
    </svg>
  );
}

export function InstallPromptFeature({ m }: { m: InstallPromptModel }) {
  const steps = stepsFor(m.platform);

  return (
    <div className="a2hs">
      <div className="a2hs-page">
        <svg
          className="a2hs-logo"
          viewBox="0 0 56 56"
          role="img"
          aria-label="خانه‌یار"
        >
          <AppIconGlyph x={0} y={0} size={56} />
        </svg>

        <h1 className="a2hs-title">
          خانه‌یار را به صفحه‌ی اصلی اضافه کنید
        </h1>
        <p className="a2hs-sub">
          بعد از این با یک لمس باز می‌شود — تمام‌صفحه و بدون نوار آدرس، مثل
          یک برنامه.
        </p>

        <PhoneArt />

        <div className="a2hs-foot">
          {m.inAppBrowser ? (
            <div className="a2hs-warn">
              <Icon name="i-alert" size={19} />
              <p>
                این صفحه داخل یک برنامه‌ی دیگر باز شده و از اینجا نمی‌شود چیزی
                نصب کرد. اول از منوی همان برنامه <b>باز کردن در مرورگر</b> را
                بزنید.
              </p>
            </div>
          ) : m.canOneTap ? (
            /* کروم اجازه‌ی نصبِ واقعی داده — گام‌های دستی اضافه‌اند */
            <p className="a2hs-hint">
              چیزی دانلود نمی‌شود؛ فقط یک آیکون به صفحه‌ی اصلی اضافه می‌شود.
            </p>
          ) : (
            <ul className="a2hs-steps">
              {steps.map((s) => (
                <li key={s.key} className="a2hs-step">
                  <p>{s.text}</p>
                  <span className="a2hs-step-g">{s.glyph}</span>
                </li>
              ))}
            </ul>
          )}

          {m.canOneTap ? (
            <>
              <button
                type="button"
                className="btn btn-primary a2hs-cta"
                onClick={m.install}
              >
                <Icon name="i-download" size={20} />
                نصب خانه‌یار
              </button>
              {/* راهِ فرارِ کم‌رنگ، وقتی دکمه‌ی اصلی کارِ دیگری می‌کند */}
              <button type="button" className="a2hs-skip" onClick={m.skip}>
                فعلاً در مرورگر ادامه می‌دهم
              </button>
            </>
          ) : (
            /* تنها کاری که از این صفحه می‌شود کرد «خواندم» است، پس خودش
               دکمه‌ی اصلی می‌شود. عمداً چیزی ذخیره نمی‌کند: خواسته‌ی کاربر
               «هر بار تا نصب نکند» بود، پس دفعه‌ی بعد دوباره همین‌جاست. */
            <button
              type="button"
              className="btn btn-primary a2hs-cta"
              onClick={m.skip}
            >
              متوجه شدم
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
