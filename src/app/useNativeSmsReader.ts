/* چسب اپ: خواندن نیتیو پیامک روی اندروید.

   قاعده‌ی حاکم (بند ۱ و ۳ اسپک پیامک): تا وقتی دست‌کم یک حساب بانکی
   «تشخیص از پیامک» را روشن نکرده، این هوک هیچ کاری نمی‌کند — نه مجوز
   پیامک می‌خواهد، نه به پیامک‌ها گوش می‌دهد، نه چیزی به سرور می‌فرستد.
   پیش‌تر به‌محض ورود مجوز می‌گرفت و متن هر پیامک را می‌فرستاد و فقط
   «ذخیره»ی سمت سرور سد می‌شد؛ یعنی پیامک‌های شخصی هم — هرچند دور
   ریخته می‌شدند — از گوشی بیرون می‌رفتند.

   وقتی رضایت هست، متن هر پیامک از مسیر ingestRawSms می‌رود و سرور
   تصمیم می‌گیرد بانکی هست یا نه (پارس در یک جا انجام می‌شود: وب،
   اندروید و پل فورواردر همگی یک منطق دارند).

   روی وب/iOS بی‌صدا رد می‌شود؛ پل فورواردر همچنان فالبک است. */

import { useEffect, useMemo, useState } from "react";
import { useApp } from "./providers/AppProvider";
import type { PluginListenerHandle } from "@capacitor/core";
import { SmsReader, isSmsReaderAvailable } from "@/shared/native/smsReader";

/** فرستنده‌ی نرمال‌شده‌ی سرور را به «زیررشته‌ی قابل‌تطبیق» روی اندروید تبدیل می‌کند.

    سرور فرستنده را می‌شوید: فاصله/خط‌تیره/`+` را برمی‌دارد و ۹۸۹xxxxxxxxx را
    به ۰۹xxxxxxxxx تبدیل می‌کند. پلاگین نیتیو اما آدرسِ خامِ اپراتور را فقط
    حروف‌کوچک می‌کند و `contains` می‌زند. پس برای سرشماره‌های کوتاه (۶۰۳۷،
    BANKMELLAT) هر دو یکی‌اند، ولی برای شماره‌ی موبایل نه: مقدارِ ذخیره‌شده
    «۰۹۱۲…» است و آدرسِ واقعی «+۹۸۹۱۲…»، و «۰۹۱۲…» زیررشته‌ی آن نیست —
    پیامک بی‌صدا حذف می‌شد. صفرِ ابتدایی برداشته می‌شود تا زیررشته‌ی هر دو
    شکل باشد. */
function nativeSenderNeedle(sender: string): string {
  return /^09\d{9}$/.test(sender) ? sender.slice(1) : sender;
}

export function useNativeSmsReader(onIngested?: () => void): void {
  const { phase, useCases, accounts } = useApp();

  /* حساب‌هایی که کاربر صراحتاً رضایت داده — شرط «مثبت» (=== bank) تا با
     نگهبان‌های یوزکیس و سرور یکی بماند */
  const consentedIds = useMemo(
    () =>
      accounts
        .filter((a) => a.kind === "bank" && a.smsEnabled)
        .map((a) => a.id)
        .sort()
        .join(","),
    [accounts],
  );

  const armed = phase === "ready" && useCases !== null && consentedIds !== "";

  /* فیلتر فرستنده‌ی سمت گوشی. null یعنی «هنوز نمی‌دانیم» و تا آن موقع
     گوش‌دادن شروع نمی‌شود؛ [] یعنی «بدون فیلتر».

     این فیلتر یک بهینه‌سازیِ محرمانگی است، نه دروازه‌ی رضایت؛ دروازه
     همان `armed` است. پس اگر کاربر فقط سرشماره‌ای اضافه/حذف کند (بدون
     تغییرِ کلیدِ هیچ حسابی)، این فهرست تا اجرای بعدیِ برنامه تازه نمی‌شود
     و آسیبی هم ندارد: حالتِ «سرشماره اضافه شد» فقط یعنی موقتاً پیامکِ
     بیشتری بررسی می‌شود، و حالتِ «سرشماره حذف شد» یعنی همان سرشماره
     فعلاً هم عبور می‌کند و سرور با نامِ بانک تشخیص می‌دهد — چیزی از دست
     نمی‌رود. روشن/خاموش‌کردنِ هر حساب اما بلافاصله بازمحاسبه می‌کند،
     چون `consentedIds` عوض می‌شود. */
  const [senderFilter, setSenderFilter] = useState<string[] | null>(null);

  useEffect(() => {
    if (!armed || !useCases) {
      setSenderFilter(null);
      return;
    }
    let cancelled = false;
    void useCases.listSmsSenders
      .execute()
      .then((all) => {
        if (cancelled) return;
        const ids = consentedIds.split(",");
        /* فیلتر فقط وقتی گذاشته می‌شود که «همه»ی حساب‌های روشن دست‌کم یک
           سرشماره داشته باشند. اگر حتی یک حساب بی‌سرشماره باشد، تشخیصش
           به نام بانکِ داخل متن تکیه دارد و فیلترِ سرشماره‌ای پیامکش را
           بی‌صدا حذف می‌کرد — خرابیِ خاموش، بدترین نوعش. */
        const covered = ids.every((id) =>
          all.some((s) => s.accountId === id),
        );
        setSenderFilter(
          covered
            ? [
                ...new Set(
                  all
                    .filter((s) => ids.includes(s.accountId))
                    .map((s) => nativeSenderNeedle(s.sender)),
                ),
              ]
            : [],
        );
      })
      .catch(() => {
        /* فهرست نیامد → محافظه‌کارانه بدون فیلتر، تا پیامکی از دست نرود */
        if (!cancelled) setSenderFilter([]);
      });
    return () => {
      cancelled = true;
    };
  }, [armed, useCases, consentedIds]);

  /* کلید پایدار برای وابستگی افکت — آرایه هر رندر هویت تازه دارد */
  const filterKey = senderFilter === null ? null : senderFilter.join(",");

  useEffect(() => {
    if (!armed || !useCases || filterKey === null) return;
    if (!isSmsReaderAvailable()) return;

    let cancelled = false;
    let handle: PluginListenerHandle | undefined;
    const filter = filterKey === "" ? [] : filterKey.split(",");

    void (async () => {
      try {
        /* مجوز تازه اینجا خواسته می‌شود — یعنی بعد از اینکه کاربر خودش
           حسابی را روشن کرده. پرسیدنش پیش از آن، درخواستِ دسترسی برای
           قابلیتی بود که کاربر هنوز نخواسته. رد کاربر = بی‌صدا صرف‌نظر. */
        let perm = await SmsReader.checkPermissions();
        if (perm.sms !== "granted") {
          perm = await SmsReader.requestSmsPermission();
        }
        if (cancelled || perm.sms !== "granted") return;

        handle = await SmsReader.addListener("smsReceived", (ev) => {
          const text = (ev?.rawText ?? "").trim();
          if (!text) return;
          void useCases.ingestRawSms
            .execute(text, ev?.sender ?? null)
            .then((n) => {
              if (n > 0) onIngested?.();
            })
            .catch(() => {
              /* بی‌صدا؛ ثبت دستی پیامک همچنان کار می‌کند */
            });
        });

        if (cancelled) {
          void handle.remove();
          return;
        }
        await SmsReader.startWatching(
          filter.length ? { senderFilter: filter } : undefined,
        );
      } catch {
        /* پلاگین در دسترس نیست یا خطای نیتیو — نادیده */
      }
    })();

    return () => {
      cancelled = true;
      void SmsReader.stopWatching().catch(() => {});
      void handle?.remove();
    };
  }, [armed, useCases, filterKey, onIngested]);
}
