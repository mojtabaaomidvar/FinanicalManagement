/* §۷.۳ + §۷.۴ — زیرصفحهٔ «اعلان‌ها» در تنظیمات.

   ── چرا این‌جا و نه در قیفِ آغازین ──
   §۷.۳ می‌گوید کلیدِ کلی «در گامِ ششمِ §۳.۸» تنظیم می‌شود و §۷.۲ به «گامِ
   Reminders Opt-Inِ §۳.۹» ارجاع می‌دهد. هر دو ارجاع بی‌مقصدند: §۳.۹ در سند
   وجود ندارد و آن صفحه در یادداشتِ ۱۴۰۵/۰۷/۰۳ جزوِ پنج صفحهٔ ساخته‌نشدنی
   است. تصمیمِ مالک: کلیدها این‌جا، قیفِ آغازین دست‌نخورده.

   ── چه چیزی عمداً این‌جا نیست ──
   «ساعاتِ سکوت»ِ §۷.۳. به‌حکمِ متنِ خودِ آن بند فقط **پوش** را مهار می‌کند و
   اعلانِ درون‌نرم‌افزاری «طبقِ معمول در صف می‌ماند». پوش ساخته نشده، پس
   کلیدش هیچ رفتاری را عوض نمی‌کرد.

   ── صداقتِ متن ──
   هیچ ردیفی نمی‌گوید «اعلان روی گوشی» یا «نوتیفیکیشن»، چون چنین چیزی وجود
   ندارد؛ همه‌جا «در خانه‌یار» آمده تا کاربر روی چیزی حساب نکند که نمی‌رسد. */

import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { SettingsCard, SettingsRow } from "@/pages/SettingsPage/SettingsCard";
import type {
  NotificationDomain,
  NotificationPrefs,
} from "@/domain/notification/notification.types";
import {
  DEFAULT_NOTIFICATION_PREFS,
  DOMAIN_LABELS,
} from "@/domain/notification/notification.types";

const DOMAIN_HINT: Record<NotificationDomain, string> = {
  recurring: "قسط، اجاره و تراکنش‌های تکرارشوندهٔ امروز و فردا",
  bills: "قبض برق و آب و گاز و اینترنت و شارژ ساختمان که پرداخت نشده",
  event: "تولدها و مناسبت‌های ثبت‌شده در تقویم خانواده",
  membership: "وقتی کسی با کد یا لینک می‌خواهد عضو خانواده شود",
  tasks: "کارهایی که مسئولشان هستید؛ یادآور با انجام‌شدن کار حذف می‌شود",
  documents: "پایان اعتبار اسناد قابل مشاهده؛ یادآور هر سند را می‌توانید جدا خاموش کنید",
  equipment: "موعد سرویس و پایان گارانتی وسایل خانه؛ یادآور سرویس هر وسیله جدا تنظیم می‌شود",
  vehicles: "موعد سرویس، بیمه و معاینهٔ فنی خودروها؛ سرویس با تاریخ یا رسیدن کیلومتر یادآور می‌گیرد",
  goals: "موعد اهداف و آرزوهای خودتان؛ با انجام‌شدن یا خاموش‌کردن یادآور آن مورد حذف می‌شود",
  activities: "تفریح‌ها و برنامه‌های خانوادگی برنامه‌ریزی‌شده؛ با انجام یا لغو برنامه یادآور حذف می‌شود",
};

export function NotificationSettingsFeature({
  onChanged,
}: {
  /** پس از هر ذخیره صدا زده می‌شود تا زنگِ هاب دوباره بخواند.
   *  بی این، کاربر یک دامنه را خاموش می‌کرد و نشانِ قرمزِ زنگ تا رفرشِ
   *  بعدیِ داده همان عددِ قبلی را نشان می‌داد. */
  onChanged?: () => void;
}) {
  const { useCases } = useApp();
  const { show } = useToast();
  const [prefs, setPrefs] = useState<NotificationPrefs>(
    DEFAULT_NOTIFICATION_PREFS,
  );
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!useCases) return;
    let alive = true;
    void (async () => {
      try {
        const state = await useCases.getNotificationState.execute();
        if (alive) setPrefs(state.prefs);
      } catch {
        /* بی‌صدا — پیش‌فرض‌ها نمایش داده می‌شوند */
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [useCases]);

  const save = useCallback(
    async (patch: Parameters<
      NonNullable<typeof useCases>["updateNotificationPrefs"]["execute"]
    >[0]) => {
      if (!useCases || busy) return;
      setBusy(true);
      try {
        const state = await useCases.updateNotificationPrefs.execute(patch);
        setPrefs(state.prefs);
        onChanged?.();
      } catch (e) {
        show((e as Error).message || "ذخیرهٔ تنظیمات اعلان ناموفق بود");
      } finally {
        setBusy(false);
      }
    },
    [useCases, busy, onChanged, show],
  );

  return (
    <>
      <SettingsCard title="اعلان‌ها">
        <SettingsRow
          icon="bell"
          label="اعلان‌ها در خانه‌یار"
          sub="زنگِ بالای صفحهٔ خانه. چیزی روی گوشی فرستاده نمی‌شود."
          trailing={{
            type: "toggle",
            on: prefs.enabled,
            onChange: (next) => void save({ enabled: next }),
          }}
        />
      </SettingsCard>

      {/* با خاموشیِ کلیدِ کلی، این دو کارت پنهان می‌شوند نه غیرفعال:
          کلیدی که روی هیچ‌چیز اثر ندارد بدتر از نبودنش است. */}
      {prefs.enabled ? (
        <>
          <SettingsCard title="کدام اعلان‌ها">
            {(Object.keys(DOMAIN_LABELS) as NotificationDomain[]).map((d) => (
              <SettingsRow
                key={d}
                icon="bell"
                label={DOMAIN_LABELS[d]}
                sub={DOMAIN_HINT[d]}
                trailing={{
                  type: "toggle",
                  on: prefs.domains[d],
                  onChange: (next) => void save({ domains: { [d]: next } }),
                }}
              />
            ))}
          </SettingsCard>

          <SettingsCard title="زمان یادآوری">
            <div className="set-row"><div className="set-row-body">
              <p className="set-row-label">امروز و فردا</p>
              <p className="set-row-sub">یادآوری‌های تاریخ‌دار فقط برای امروز و فردا نمایش داده می‌شوند.</p>
            </div></div>
          </SettingsCard>

          {/* §۷.۴ می‌گوید پیش‌هنگام باید دامنه‌ای باشد؛ این توضیح می‌گوید
              چرا «درخواست‌های عضویت» تنظیمِ روز ندارد، وگرنه نبودش شبیهِ
              جا‌افتادگی به‌نظر می‌رسید. */}
          <p className="modal-sub">
            درخواست عضویت، کمبود انبار و کارهای بدون موعد همان لحظه نمایش داده می‌شوند؛ سرویس خودرو با رسیدن کیلومتر به موعد هم یادآوری می‌شود.
          </p>
        </>
      ) : null}

      {!loaded ? <p className="modal-sub">در حال خواندن تنظیمات…</p> : null}
    </>
  );
}
