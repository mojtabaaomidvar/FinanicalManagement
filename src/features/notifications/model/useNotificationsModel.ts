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
   کارهای خانه از تصویر مجاز آفلاین و ترجیح محدود همین دامنه یادآور می‌گیرند؛
   سایر دامنه‌ها در قطع اتصال وارد مرکز اعلان نمی‌شوند. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { deriveNotifications } from "@/domain/notification/notification.rules";
import type {
  AppNotification,
  NotificationPrefs,
} from "@/domain/notification/notification.types";
import { DEFAULT_NOTIFICATION_PREFS } from "@/domain/notification/notification.types";
import type { JoinRequest } from "@/domain/family/family.types";
import type { HouseDocument } from "@/domain/document/document.types";
import type { Equipment } from "@/domain/equipment/equipment.types";
import type { Vehicle } from "@/domain/vehicle/vehicle.types";
import type { Goal } from "@/domain/goal/goal.types";
import type { Activity } from "@/domain/activity/activity.types";
import { useTehranDay } from "@/shared/lib/useTehranDay";
import { useOnline } from "@/shared/lib/useOnline";

const EMPTY_DOCUMENTS: HouseDocument[] = [];
const EMPTY_EQUIPMENT: Equipment[] = [];
const EMPTY_VEHICLES: Vehicle[] = [];
const EMPTY_GOALS: Goal[] = [];
const EMPTY_ACTIVITIES: Activity[] = [];

export type OnlineSummarySource = "documents" | "equipment" | "vehicles" | "goals" | "activities";
export interface OnlineSummaryState {
  loading: boolean;
  failedSources: OnlineSummarySource[];
}

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
  /** فقط برای متن یادآور، در حافظهٔ نشست آنلاین و بدون کش دستگاه. */
  documents: HouseDocument[];
  equipment: Equipment[];
  vehicles: Vehicle[];
  goals: Goal[];
  activities: Activity[];
  /** Completeness of the authorized online snapshots, independent of reminder preferences. */
  onlineSummaryState?: OnlineSummaryState;
}

export function useNotificationsModel(refreshKey: number): NotificationsModel {
  const { todayJ } = useTehranDay();
  const { phase, family, useCases, member, txs, events, bills, inventory, shoppingLists, tasks,
    shoppingSync, offlineSession, taskNotificationPrefs } =
    useApp();
  const [prefs, setPrefs] = useState<NotificationPrefs>(
    DEFAULT_NOTIFICATION_PREFS,
  );
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [documentSnapshot, setDocumentSnapshot] = useState<{
    scope: string;
    rows: HouseDocument[];
  } | null>(null);
  const [equipmentSnapshot, setEquipmentSnapshot] = useState<{
    scope: string;
    rows: Equipment[];
  } | null>(null);
  const [vehicleSnapshot, setVehicleSnapshot] = useState<{
    scope: string;
    rows: Vehicle[];
  } | null>(null);
  const [goalSnapshot, setGoalSnapshot] = useState<{
    scope: string;
    rows: Goal[];
  } | null>(null);
  const [activitySnapshot, setActivitySnapshot] = useState<{
    scope: string;
    rows: Activity[];
  } | null>(null);
  const [summarySnapshot, setSummarySnapshot] = useState<OnlineSummaryState & { scope: string } | null>(null);
  const [open, setOpenState] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const role = member?.role ?? "member";
  const online = useOnline();
  const restricted = !online || shoppingSync.offline || offlineSession;
  const scope = `${phase}:${family?.id ?? ""}:${member?.id ?? ""}:${member?.status ?? ""}:${member?.membershipState ?? ""}:${role}:${member?.birthDate ?? ""}:${member?.relation ?? ""}`;
  const summaryEligible = !restricted && phase === "ready" && Boolean(useCases && family && member)
    && member?.status === "active" && member.membershipState === "active";
  const onlineSummaryState = useMemo<OnlineSummaryState>(() => !summaryEligible
    ? { loading: false, failedSources: [] }
    : summarySnapshot?.scope === scope
      ? { loading: summarySnapshot.loading, failedSources: summarySnapshot.failedSources }
      : { loading: true, failedSources: [] }, [summaryEligible, summarySnapshot, scope]);
  const requestVersion = useRef(0);
  const context = useRef({ scope, restricted });
  if (context.current.scope !== scope || context.current.restricted !== restricted) {
    requestVersion.current += 1;
    context.current = { scope, restricted };
  }
  const documents = !restricted && phase === "ready" && member?.membershipState === "active"
    && documentSnapshot?.scope === scope ? documentSnapshot.rows : EMPTY_DOCUMENTS;
  const equipment = !restricted && phase === "ready" && member?.status === "active"
    && member.membershipState === "active" && equipmentSnapshot?.scope === scope
    ? equipmentSnapshot.rows : EMPTY_EQUIPMENT;
  const vehicles = !restricted && phase === "ready" && member?.status === "active"
    && member.membershipState === "active" && vehicleSnapshot?.scope === scope
    ? vehicleSnapshot.rows : EMPTY_VEHICLES;
  const goals = !restricted && phase === "ready" && member?.status === "active"
    && member.membershipState === "active" && goalSnapshot?.scope === scope
    ? goalSnapshot.rows.filter((row) => row.ownerId === member.id) : EMPTY_GOALS;
  const activities = !restricted && phase === "ready" && member?.status === "active"
    && member.membershipState === "active" && activitySnapshot?.scope === scope
    ? activitySnapshot.rows : EMPTY_ACTIVITIES;
  const activePrefs = useMemo<NotificationPrefs>(() => restricted ? {
    ...DEFAULT_NOTIFICATION_PREFS,
    enabled: taskNotificationPrefs.enabled,
    domains: { ...DEFAULT_NOTIFICATION_PREFS.domains, tasks: taskNotificationPrefs.tasks_enabled },
    leadDays: { ...DEFAULT_NOTIFICATION_PREFS.leadDays, tasks: taskNotificationPrefs.lead_days },
  } : prefs, [restricted, taskNotificationPrefs, prefs]);

  const reload = useCallback(async () => {
    const version = ++requestVersion.current;
    setDocumentSnapshot(null);
    setEquipmentSnapshot(null);
    setVehicleSnapshot(null);
    setGoalSnapshot(null);
    setActivitySnapshot(null);
    setSummarySnapshot(null);
    if (!useCases || phase !== "ready" || !member || !family || restricted) {
      setJoinRequests([]);
      return;
    }
    const failedSources: OnlineSummarySource[] = [];
    setSummarySnapshot({ scope, loading: true, failedSources: [] });
    const current = () => requestVersion.current === version
      && context.current.scope === scope && !context.current.restricted
      && (typeof navigator === "undefined" || navigator.onLine !== false);
    if (role !== "owner") setJoinRequests([]);
    await Promise.allSettled([
      (async () => {
        const state = await useCases.getNotificationState.execute();
        if (!current()) return;
        setPrefs(state.prefs);
        setDismissed(new Set(state.dismissed));
      })(),
      (async () => {
        if (member.membershipState !== "active") return;
        try {
          const rows = await useCases.listDocuments.execute();
          if (current()) setDocumentSnapshot({ scope, rows });
        } catch {
          // قطع اتصال، لغو دسترسی یا رد سند: متادیتای قبلی هم نباید باقی بماند.
          if (current()) { setDocumentSnapshot(null); failedSources.push("documents"); }
        }
      })(),
      (async () => {
        if (member.status !== "active" || member.membershipState !== "active") return;
        try {
          const rows = await useCases.listEquipment.execute();
          if (current()) setEquipmentSnapshot({ scope, rows });
        } catch {
          if (current()) { setEquipmentSnapshot(null); failedSources.push("equipment"); }
        }
      })(),
      (async () => {
        if (member.status !== "active" || member.membershipState !== "active") return;
        try {
          const result = await useCases.listVehicles.execute();
          if (current()) setVehicleSnapshot({ scope, rows: result.vehicles });
        } catch {
          if (current()) { setVehicleSnapshot(null); failedSources.push("vehicles"); }
        }
      })(),
      (async () => {
        if (role !== "owner") return;
        try {
          const requests = await useCases.listJoinRequests.execute();
          if (current()) setJoinRequests(requests);
        } catch {
          if (current()) setJoinRequests([]);
        }
      })(),
      (async () => {
        if (member.status !== "active" || member.membershipState !== "active") return;
        try {
          const result = await useCases.listGoals.execute();
          if (current()) setGoalSnapshot({ scope, rows: result.goals.filter((row) => row.ownerId === member.id) });
        } catch {
          if (current()) { setGoalSnapshot(null); failedSources.push("goals"); }
        }
      })(),
      (async () => {
        if (member.status !== "active" || member.membershipState !== "active") return;
        try {
          const result = await useCases.listActivities.execute();
          if (current()) setActivitySnapshot({ scope, rows: result.activities });
        } catch {
          if (current()) { setActivitySnapshot(null); failedSources.push("activities"); }
        }
      })(),
    ]);
    if (current()) setSummarySnapshot({ scope, loading: false, failedSources });
  }, [useCases, phase, role, member?.id, member?.status, member?.membershipState, family?.id, scope, restricted]);

  useEffect(() => {
    void reload();
    return () => { requestVersion.current += 1; };
  }, [reload, refreshKey]);

  useEffect(() => {
    // خود رویداد، درخواستِ درحال‌پرواز را هم باطل می‌کند؛ حتی اگر قطع و وصل
    // سریع شبکه در یک رندر ادغام شود، پاسخِ قبل از قطع پذیرفته نمی‌شود.
    const forgetOnlineData = () => {
      requestVersion.current += 1;
      setDocumentSnapshot(null);
      setEquipmentSnapshot(null);
      setVehicleSnapshot(null);
      setGoalSnapshot(null);
      setActivitySnapshot(null);
      setSummarySnapshot(null);
    };
    const reconnect = () => { void reload(); };
    window.addEventListener("offline", forgetOnlineData);
    window.addEventListener("online", reconnect);
    window.addEventListener("goals-changed", reconnect);
    window.addEventListener("activities-changed", reconnect);
    return () => {
      window.removeEventListener("offline", forgetOnlineData);
      window.removeEventListener("online", reconnect);
      window.removeEventListener("goals-changed", reconnect);
      window.removeEventListener("activities-changed", reconnect);
    };
  }, [reload]);

  useEffect(() => {
    setPrefs(DEFAULT_NOTIFICATION_PREFS);
    setDismissed(new Set());
    setJoinRequests([]);
    setDocumentSnapshot(null);
    setEquipmentSnapshot(null);
    setVehicleSnapshot(null);
    setGoalSnapshot(null);
    setActivitySnapshot(null);
    setSummarySnapshot(null);
  }, [member?.id]);

  const setOpen = useCallback((value: boolean) => {
    setOpenState(value);
    if (value) void reload();
  }, [reload]);

  const list = useMemo(
    () =>
      deriveNotifications({
        txs: restricted ? [] : txs,
        bills: restricted ? [] : bills,
        events: restricted ? [] : events,
        joinRequests: restricted ? [] : joinRequests,
        inventory: restricted ? [] : inventory,
        shoppingLists,
        tasks,
        documents,
        equipment,
        vehicles,
        goals,
        activities,
        memberId: member?.id,
        role,
        prefs: activePrefs,
        dismissed,
        todayJ,
      }),
    [
      txs,
      bills,
      events,
      joinRequests,
      inventory,
      shoppingLists,
      tasks,
      documents,
      equipment,
      vehicles,
      goals,
      activities,
      member?.id,
      restricted,
      role,
      activePrefs,
      dismissed,
      todayJ,
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
    documents,
    equipment,
    vehicles,
    goals,
    activities,
    onlineSummaryState,
  };
}
