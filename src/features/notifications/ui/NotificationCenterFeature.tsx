import { AppPage } from "@/shared/ui/AppPage";
import { currencyDisplayLabel } from "@/shared/lib/uiLabels";
import { recurringTemplate } from "@/domain/transaction/recurring.rules";
/* §۷ — مرکزِ اعلان (زنگ + فهرست).

   ── متن کجا ساخته می‌شود و چرا این‌جا ──
   `deriveNotifications` عمداً هیچ رشتهٔ آماده‌ای نمی‌دهد (دلیلش در
   notification.types.ts): قالب‌بندیِ مبلغ به واحدِ پولِ عضو وابسته است و §۷.۵
   هم می‌گوید اعلان نباید دادهٔ غیرمجاز را *در خودش* جا دهد. پس برچسب‌ها
   این‌جا از `ref` و دادهٔ از‌قبل‌بارگذاری‌شده ساخته می‌شوند.

   ── هر مورد باید جایی برود ──
   سررسید → فرمِ تراکنش برای همان رخداد · درخواستِ عضویت → همان زیرصفحهٔ
   تنظیمات (نه فهرستِ تنظیمات) · رویداد → روز همان رویداد در تقویم.
   اعلانی که جایی نمی‌برد، فقط نگرانی تولید می‌کند. */

import { useMemo } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { Icon } from "@/shared/ui";
import { buildCategoryResolver } from "@/domain/category/resolve";
import type { AppNotification, NotificationDomain } from "@/domain/notification/notification.types";
import { DOMAIN_LABELS } from "@/domain/notification/notification.types";
import type { JoinRequest } from "@/domain/family/family.types";
import type { Transaction } from "@/domain/transaction/transaction.types";
import type { FamilyEvent } from "@/domain/event/event.types";
import type { Bill } from "@/domain/bill/bill.types";
import { BILL_KINDS } from "@/domain/bill/bill.types";
import { formatLong, isoToJalali } from "@/shared/lib/jalali";
import { formatAmount } from "@/shared/lib/format";
import { toDisplay } from "@/shared/lib/currency";
import { toFa } from "@/shared/lib/digits";
import type { TxFormModel } from "@/features/transaction-form";
import type { NotificationsModel } from "../model/useNotificationsModel";
import "./NotificationsPage.css";

/* آیکونِ هر دامنه — همان مجموعهٔ اسپریتِ index.html */
const DOMAIN_ICON: Partial<Record<NotificationDomain, string>> = {
  recurring: "i-repeat",
  bills: "i-bill",
  event: "i-gift",
  membership: "i-users",
  tasks: "i-check",
  documents: "i-briefcase",
  equipment: "i-grid4",
  vehicles: "i-car",
  goals: "i-heart",
  activities: "i-gift",
};

export function NotificationCenterFeature({
  m,
  form,
  joinRequests,
  onOpenJoinRequests,
  onOpenBills,
  onOpenTasks,
  onOpenDocuments,
  onOpenEquipment,
  onOpenVehicles,
  onOpenGoal,
  onOpenActivity,
  onOpenCalendar,
  sms,
  onOpenSms,
}: {
  m: NotificationsModel;
  form: TxFormModel;
  joinRequests: JoinRequest[];
  onOpenJoinRequests: () => void;
  onOpenBills: () => void;
  onOpenInventory: () => void;
  onOpenTasks: () => void;
  onOpenDocuments: () => void;
  onOpenEquipment: (equipmentId: string) => void;
  onOpenVehicles: (vehicleId: string) => void;
  onOpenGoal?: (goalId: string) => void;
  onOpenActivity?: (activityId: string) => void;
  onOpenCalendar?: (dateIso: string) => void;
  sms?: { count: number; loading: boolean; error: string | null };
  onOpenSms?: () => void;
}) {
  const { txs, events, cur, customCategories, bills, tasks, member } = useApp();

  const resolve = useMemo(
    () => buildCategoryResolver(customCategories),
    [customCategories],
  );

  /* نگاشتِ شناسه→موجودیت یک‌بار ساخته می‌شود، نه find در هر ردیف.
     فهرست کوچک است، ولی این‌طور هزینه‌اش خطی می‌ماند نه درجه‌دو. */
  const txById = useMemo(() => {
    const map = new Map<string, Transaction>();
    for (const t of txs) map.set(t.id, t);
    return map;
  }, [txs]);

  const eventById = useMemo(() => {
    const map = new Map<string, FamilyEvent>();
    for (const e of events) map.set(e.id, e);
    return map;
  }, [events]);

  const billById = useMemo(() => {
    const map = new Map<string, Bill>();
    for (const b of bills) map.set(b.id, b);
    return map;
  }, [bills]);

  const requestById = useMemo(() => {
    const map = new Map<string, JoinRequest>();
    for (const r of joinRequests) map.set(r.id, r);
    return map;
  }, [joinRequests]);

  function label(n: AppNotification): { title: string; sub: string } | null {
    if (n.ref.kind === "activities") {
      const activityId = n.ref.activityId;
      const item = m.activities.find((row) => row.id === activityId);
      if (!item || item.status !== "planned" || !item.reminderEnabled) return null;
      return { title: item.title, sub: `برنامهٔ خانوادگی · ${formatLong(isoToJalali(item.date))}` };
    }
    if (n.ref.kind === "goals") {
      const goalId = n.ref.goalId;
      const item = m.goals.find((row) => row.id === goalId && row.ownerId === member?.id);
      if (!item || item.status !== "active" || !item.targetDate || !item.reminderEnabled) return null;
      return {
        title: item.title,
        sub: `${item.kind === "wish" ? "موعد آرزو" : "موعد هدف"} · ${formatLong(isoToJalali(item.targetDate))}`,
      };
    }
    if (n.ref.kind === "vehicles") {
      const { vehicleId, reason } = n.ref;
      const item = m.vehicles.find((row) => row.id === vehicleId);
      if (!item) return null;
      if (reason === "service") {
        if (!item.serviceReminderEnabled) return null;
        const schedule = [
          n.dateIso && item.serviceDueDate ? formatLong(isoToJalali(item.serviceDueDate)) : null,
          item.serviceDueOdometer !== null
            ? `${toFa(item.serviceDueOdometer.toLocaleString("en-US"))} کیلومتر` : null,
        ].filter(Boolean);
        if (!schedule.length) return null;
        return { title: item.title, sub: `موعد سرویس · ${schedule.join(" · ")}` };
      }
      const date = reason === "insurance" ? item.insuranceUntil : item.inspectionUntil;
      if (!date) return null;
      return {
        title: item.title,
        sub: `${reason === "insurance" ? "پایان بیمه" : "پایان معاینهٔ فنی"} ${formatLong(isoToJalali(date))}`,
      };
    }
    if (n.ref.kind === "equipment") {
      const { equipmentId, reason } = n.ref;
      const item = m.equipment.find((row) => row.id === equipmentId);
      const date = reason === "service"
        ? item?.serviceReminderEnabled ? item.serviceDueDate : null
        : item?.warrantyUntil;
      if (!item || !date) return null;
      return {
        title: item.title,
        sub: `${reason === "service" ? "موعد سرویس" : "پایان گارانتی"} ${formatLong(isoToJalali(date))}`,
      };
    }
    if (n.ref.kind === "documents") {
      const documentId = n.ref.documentId;
      const document = m.documents.find((row) => row.id === documentId);
      if (!document?.expiryDate || !document.reminderEnabled) return null;
      const access = document.visibility === "private" ? "خصوصی" : "مشترک خانواده";
      return {
        title: document.title,
        sub: `${access} · پایان اعتبار ${formatLong(isoToJalali(document.expiryDate))}`,
      };
    }
    if (n.ref.kind === "tasks") {
      const taskId = n.ref.taskId;
      const task = tasks.find((row) => row.id === taskId);
      if (!task || task.completed) return null;
      return {
        title: task.title,
        sub: task.dueDate
          ? `مسئول این کار هستید · ${formatLong(isoToJalali(task.dueDate))}`
          : "مسئول این کار هستید · بدون موعد",
      };
    }
    if (n.ref.kind === "recurring") {
      const original = txById.get(n.ref.txId);
      const tx = original ? recurringTemplate(original) : undefined;
      /* اگر تراکنش بینِ مشتق‌سازی و رندر حذف شده باشد، ردیف حذف می‌شود نه
         اینکه با «نامشخص» نمایش داده شود — اعلانِ بی‌مرجع بی‌معناست. */
      if (!tx) return null;
      const cat = resolve(tx.category);
      const when = formatLong(isoToJalali(n.ref.dueIso));
      return {
        title: tx.note?.trim() || cat.name,
        sub: `${when} · ${formatAmount(toDisplay(tx.amount, cur))} ${currencyDisplayLabel(cur)}`,
      };
    }
    if (n.ref.kind === "event") {
      const ev = eventById.get(n.ref.eventId);
      if (!ev || ev.kind === "activity" || ev.date !== n.ref.dateIso) return null;
      return {
        title: ev.title,
        sub: formatLong(isoToJalali(n.ref.dateIso)),
      };
    }
    if (n.ref.kind === "bills") {
      const bill = billById.get(n.ref.billId);
      if (!bill) return null;
      const kind = BILL_KINDS.find((k) => k.value === bill.kind);
      const when = formatLong(isoToJalali(n.ref.dueIso));
      /* نامِ نوع هم می‌آید چون عنوانِ کاربر می‌تواند «قبضِ خانه» باشد و از
         آن معلوم نشود برق است یا گاز. */
      return {
        title: bill.title,
        sub: `${kind?.label ?? "قبض"} · ${when} · ${formatAmount(
          toDisplay(bill.amount, cur),
        )} ${currencyDisplayLabel(cur)}`,
      };
    }
    const req = requestById.get(n.ref.requestId);
    if (!req) return null;
    /* نام می‌تواند null باشد (ردیفِ عضو حذف شده و JOIN خالی برگشته) —
       یادداشتِ همین نکته در family.types.ts هست و با `!` ردش نمی‌کنیم. */
    const who = req.memberName?.trim() || req.phone || "متقاضی ناشناس";
    const via = req.via === "code" ? "با کد خانواده" : "با لینک دعوت";
    return { title: `${who} می‌خواهد عضو شود`, sub: via };
  }

  function act(n: AppNotification) {
    if (n.ref.kind === "event") {
      const event = eventById.get(n.ref.eventId);
      if (!event || event.kind === "activity" || event.date !== n.ref.dateIso) return;
      m.setOpen(false);
      onOpenCalendar?.(event.date);
      return;
    }
    if (n.ref.kind === "activities") {
      const activityId = n.ref.activityId;
      if (!m.activities.some((row) => row.id === activityId)) return;
      m.setOpen(false);
      onOpenActivity?.(activityId);
      return;
    }
    if (n.ref.kind === "goals") {
      const goalId = n.ref.goalId;
      if (!m.goals.some((row) => row.id === goalId && row.ownerId === member?.id)) return;
      m.setOpen(false);
      onOpenGoal?.(goalId);
      return;
    }
    if (n.ref.kind === "vehicles") {
      m.setOpen(false);
      onOpenVehicles(n.ref.vehicleId);
      return;
    }
    if (n.ref.kind === "equipment") {
      m.setOpen(false);
      onOpenEquipment(n.ref.equipmentId);
      return;
    }
    if (n.ref.kind === "documents") {
      m.setOpen(false);
      onOpenDocuments();
      return;
    }
    if (n.ref.kind === "tasks") {
      m.setOpen(false);
      onOpenTasks();
      return;
    }
    if (n.ref.kind === "recurring") {
      const tx = txById.get(n.ref.txId);
      if (!tx) return;
      m.setOpen(false);
      form.openForOccurrence(tx, n.ref.dueIso);
      return;
    }
    if (n.ref.kind === "membership") {
      m.setOpen(false);
      onOpenJoinRequests();
      return;
    }
    if (n.ref.kind === "bills") {
      /* به صفحهٔ قبوض می‌رود، نه به فرمِ پرداخت: پرداخت حسابِ مبدأ می‌خواهد
         و تصمیمش مالِ همان صفحه است. */
      m.setOpen(false);
      onOpenBills();
      return;
    }
  }

  /* گروه‌بندی بر پایهٔ دامنه، با حفظِ ترتیبِ خودِ فهرست (که از قاعده‌های
     دامنه می‌آید: گذشته → منتظر → نزدیک). پس گروهی که فوری‌ترین موردش
     بالاتر است، خودش هم بالاتر می‌آید. */
  const groups = useMemo(() => {
    const out: { domain: AppNotification["domain"]; items: AppNotification[] }[] =
      [];
    for (const n of m.list) {
      const last = out.find((g) => g.domain === n.domain);
      if (last) last.items.push(n);
      else out.push({ domain: n.domain, items: [n] });
    }
    return out;
  }, [m.list]);

  const displayedGroups = groups.map(group => ({ ...group, items: group.items.map(n => ({ n, text: label(n) }))
    .filter((item): item is { n: AppNotification; text: { title: string; sub: string } } => item.text !== null) }))
    .filter(group => group.items.length);
  return <AppPage className="page active notifications-page">
    <header className="app-header"><div className="header-title"><h1>اعلان‌ها</h1>
      <p>موضوع و توضیح هر یادآوری، در یک نگاه</p></div>
      <button type="button" className="icon-btn" aria-label="دریافت دوباره اعلان‌ها" onClick={() => void m.reload()}>
        <Icon name="i-repeat" size={21} /></button>
    </header>
    <div className="notifications-content">
      {sms && onOpenSms ? <article className="notif-item sms-inbox-link">
        <button type="button" className="notif-main" onClick={onOpenSms}>
          <span className="notif-ic" aria-hidden="true"><Icon name="i-sms" size={20} /></span>
          <span className="notif-txt"><b>پیامک‌های ثبت‌نشده</b>
            <span>{sms.loading ? "در حال دریافت پیامک‌ها…" : sms.error ? "دریافت پیامک‌ها ناموفق بود؛ فهرست را دوباره بررسی کنید."
              : sms.count ? /* @copy-text notifications.pending_sms */ `${toFa(sms.count)} پیامک برای ثبت یا ادامهٔ بررسی`
                : "متن پیامک جدید وارد کنید یا بررسی‌های ناتمام را ادامه دهید."}</span></span>
          <Icon name="i-arrow-l" size={17} />
        </button>
      </article> : null}
      <p className="notifications-note">یادآوری‌های تاریخ‌دار فقط برای امروز و فردا نمایش داده می‌شوند.</p>
      {m.onlineSummaryState?.loading ? <p role="status" className="section-hint">در حال دریافت اعلان‌ها…</p> : null}
      {m.onlineSummaryState?.failedSources.length ? <div className="notifications-error" role="alert">
        <span>بخشی از اطلاعات اعلان‌ها دریافت نشد.</span>
        <button type="button" className="link-btn" onClick={() => void m.reload()}>تلاش دوباره</button>
      </div> : null}
      {!displayedGroups.length && !m.onlineSummaryState?.loading ? <p className="notifications-empty">فعلاً یادآوری‌ای ندارید.</p> : null}
      <div className="notif-list">{displayedGroups.map(group => <section key={group.domain} className="notif-group">
        <h2 className="notif-group-title">{DOMAIN_LABELS[group.domain]}<span>{toFa(group.items.length)}</span></h2>
        {group.items.map(({ n, text }) => {
          const clickable = n.ref.kind !== "event" || Boolean(onOpenCalendar);
          return <article key={n.id} className={`notif-item sev-${n.severity}`}>
            <button type="button" className="notif-main" disabled={!clickable} onClick={() => act(n)}>
              {DOMAIN_ICON[n.domain] ? <span className="notif-ic" aria-hidden="true"><Icon name={DOMAIN_ICON[n.domain]} size={18} /></span> : null}
              <span className="notif-txt"><b>{text.title}</b><span>{text.sub}</span></span>
              <Icon name="i-arrow-l" size={16} />
            </button>
            {n.dismissible ? <button type="button" className="notif-skip" disabled={m.busy === n.id}
              onClick={() => void m.dismiss(n)}>نادیده بگیر</button> : null}
          </article>;
        })}
      </section>)}</div>
    </div>
  </AppPage>;
}
