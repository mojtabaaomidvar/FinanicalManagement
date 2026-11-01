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
  MAX_LEAD_DAYS,
} from "@/domain/notification/notification.types";
import { toFa } from "@/shared/lib/digits";

/* نردبانِ مقادیرِ پیش‌هنگام. `stepper` برای «انتخاب محدود و ترتیبی» ساخته
   شده، پس عددِ آزاد نمی‌گیریم: کاربر لازم نیست بین ۳۷ و ۳۸ روز تصمیم
   بگیرد. آخرین پله = MAX_LEAD_DAYS تا UI نتواند مقداری بسازد که قاعده‌های
   دامنه بعداً بی‌صدا می‌بُرند. */
const LEAD_LADDER = [0, 1, 2, 3, 5, 7, 10, 14, 21, 30, 45, MAX_LEAD_DAYS];

/* دامنه‌هایی که «پیش‌هنگام» برایشان معنا دارد. درخواستِ عضویت و انبار
   نیستند چون تاریخِ آینده‌ای ندارند: اولی همین حالا در انتظار است و دومی
   یک حالت است («زیرِ آستانه هست یا نیست»)، نه رخدادِ تقویمی (§۷.۴). */
const LEAD_DOMAINS: NotificationDomain[] = ["recurring", "bills", "event"];

const DOMAIN_HINT: Record<NotificationDomain, string> = {
  recurring: "قسط و اجاره و هر تراکنشِ تکرارشونده که سر رسیده",
  bills: "قبض برق و آب و گاز و اینترنت و شارژ ساختمان که پرداخت نشده",
  event: "تولدها و مناسبت‌های ثبت‌شده در تقویم خانواده",
  membership: "وقتی کسی با کد یا لینک می‌خواهد عضو خانواده شود",
  inventory:
    "قلم‌هایی از انبار خانه که موجودی‌شان به آستانه رسیده و در لیست خرید هم نیستند",
};

function leadLabel(days: number): string {
  return days === 0 ? "همان روز" : `${toFa(days)} روز قبل`;
}

/** نزدیک‌ترین پلهٔ نردبان به مقدارِ ذخیره‌شده.
 *  لازم است چون مقدارِ JSONB می‌تواند هر عددی باشد (ردیفِ قدیمی، ویرایشِ
 *  دستی)، و اگر indexOf می‌زدیم `-1` می‌گرفتیم و پله‌زدن از اولِ نردبان
 *  شروع می‌شد — یعنی تنظیمِ کاربر بی‌صدا می‌پرید. */
function nearestStep(days: number): number {
  let best = 0;
  for (let i = 1; i < LEAD_LADDER.length; i++) {
    if (
      Math.abs(LEAD_LADDER[i] - days) < Math.abs(LEAD_LADDER[best] - days)
    ) {
      best = i;
    }
  }
  return best;
}

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

  function stepLead(domain: NotificationDomain, dir: 1 | -1) {
    const current = nearestStep(prefs.leadDays[domain]);
    const next = current + dir;
    if (next < 0 || next >= LEAD_LADDER.length) return;
    void save({ leadDays: { [domain]: LEAD_LADDER[next] } });
  }

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

          <SettingsCard title="چند روز قبل خبر بده">
            {LEAD_DOMAINS.map((d) => {
              const idx = nearestStep(prefs.leadDays[d]);
              return (
                <SettingsRow
                  key={d}
                  icon="clock"
                  label={DOMAIN_LABELS[d]}
                  trailing={{
                    type: "stepper",
                    value: leadLabel(LEAD_LADDER[idx]),
                    onStep: (dir) => stepLead(d, dir),
                    canUp: idx < LEAD_LADDER.length - 1,
                    canDown: idx > 0,
                  }}
                />
              );
            })}
          </SettingsCard>

          {/* §۷.۴ می‌گوید پیش‌هنگام باید دامنه‌ای باشد؛ این توضیح می‌گوید
              چرا «درخواست‌های عضویت» تنظیمِ روز ندارد، وگرنه نبودش شبیهِ
              جا‌افتادگی به‌نظر می‌رسید. */}
          <p className="modal-sub">
            درخواست‌های عضویت و اقلامِ انبار تنظیم روز ندارند؛ تاریخ آینده‌ای
            ندارند و همان لحظه‌ای که پیش بیایند نشان داده می‌شوند.
          </p>
        </>
      ) : null}

      {!loaded ? <p className="modal-sub">در حال خواندن تنظیمات…</p> : null}
    </>
  );
}
