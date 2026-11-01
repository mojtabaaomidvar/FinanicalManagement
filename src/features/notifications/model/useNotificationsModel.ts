/* §۷ — مدلِ مرکزِ اعلان.

   این مدل اعلان نمی‌سازد؛ فهرست را از تابعِ خالصِ
   `domain/notification/deriveNotifications` می‌گیرد. کارِ این‌جا فقط
   جمع‌کردنِ ورودی‌های آن تابع است: بخشی از AppProvider می‌آید (تراکنش و
   رویداد، که هر دو از قبل بارگذاری شده‌اند) و بخشی باید جدا گرفته شود
   (ترجیحات/نادیده‌گرفته‌ها و درخواست‌های عضویت).

   ── چرا درخواست‌های عضویت شرطی گرفته می‌شود ──
   `GET /auth/join-requests` پشتِ `require_admin_tenant` است، پس عضوِ
   غیرمدیر ۴۰۳ می‌گیرد. صدا‌زدنش برای همه یعنی یک خطای قابلِ‌پیش‌بینی در هر
   بار باز‌شدنِ نرم‌افزار برای اکثرِ کاربران. گاردِ نقش این‌جا *کارایی* است،
   نه مجوز — مجوزِ واقعی سمتِ سرور است و `deriveNotifications` هم خودش
   دوباره گارد دارد.

   ── آفلاین ──
   هیچ‌کدام از این درخواست‌ها خطایشان را بالا نمی‌دهند. کاربرِ آفلاین نوارِ
   «اتصال نیست» را از §۸.۶ می‌بیند؛ زنگ نباید رویش خطای دوم بیندازد. در آن
   حالت زنگ صفر نشان می‌دهد که راست است: چیزی برای نشان‌دادن نداریم. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { deriveNotifications } from "@/domain/notification/notification.rules";
import type {
  AppNotification,
  NotificationPrefs,
} from "@/domain/notification/notification.types";
import { DEFAULT_NOTIFICATION_PREFS } from "@/domain/notification/notification.types";
import type { JoinRequest } from "@/domain/family/family.types";
import { today } from "@/shared/lib/jalali";

export interface NotificationsModel {
  list: AppNotification[];
  count: number;
  open: boolean;
  setOpen: (v: boolean) => void;
  /** کلیدِ درحالِ‌پردازش — برای غیرفعال‌کردنِ دکمه */
  busy: string | null;
  dismiss: (n: AppNotification) => Promise<void>;
  reload: () => Promise<void>;
  /** بیرون داده می‌شود چون UI برای ساختنِ برچسب («فلانی می‌خواهد عضو شود»)
   *  به خودِ ردیف نیاز دارد و قاعده‌های دامنه عمداً فقط `ref` می‌دهند. */
  joinRequests: JoinRequest[];
}

export function useNotificationsModel(refreshKey: number): NotificationsModel {
  const { useCases, member, txs, events, bills, inventory, shoppingLists } =
    useApp();
  const [prefs, setPrefs] = useState<NotificationPrefs>(
    DEFAULT_NOTIFICATION_PREFS,
  );
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const role = member?.role ?? "member";

  const reload = useCallback(async () => {
    if (!useCases) return;
    try {
      const state = await useCases.getNotificationState.execute();
      setPrefs(state.prefs);
      setDismissed(new Set(state.dismissed));
    } catch {
      /* بی‌صدا — دلیلش در یادداشتِ بالای فایل */
    }
    if (role !== "owner") {
      /* اگر کاربری از مدیریت برداشته شد، فهرستِ قبلی باید پاک شود وگرنه
         اعلانِ عضویت تا رفرشِ بعدی روی صفحه می‌ماند. */
      setJoinRequests([]);
      return;
    }
    try {
      setJoinRequests(await useCases.listJoinRequests.execute());
    } catch {
      /* بی‌صدا */
    }
  }, [useCases, role]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  const list = useMemo(
    () =>
      deriveNotifications({
        txs,
        bills,
        events,
        joinRequests,
        inventory,
        shoppingLists,
        role,
        prefs,
        dismissed,
        todayJ: today(),
      }),
    [
      txs,
      bills,
      events,
      joinRequests,
      inventory,
      shoppingLists,
      role,
      prefs,
      dismissed,
    ],
  );

  const dismiss = useCallback(
    async (n: AppNotification) => {
      if (!useCases || !n.dismissible || busy) return;
      setBusy(n.id);
      /* خوش‌بینانه پیش می‌رویم تا مورد بی‌درنگ از فهرست برود؛ اگر سرور رد
         کرد، reload حالتِ راست را برمی‌گرداند. */
      setDismissed((prev) => new Set(prev).add(n.id));
      try {
        await useCases.dismissNotification.execute(n.id);
      } catch {
        await reload();
      } finally {
        setBusy(null);
      }
    },
    [useCases, busy, reload],
  );

  return {
    list,
    count: list.length,
    open,
    setOpen,
    busy,
    dismiss,
    reload,
    joinRequests,
  };
}
