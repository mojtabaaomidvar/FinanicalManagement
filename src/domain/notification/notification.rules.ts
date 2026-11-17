/* §۷ — مشتق‌سازیِ اعلان از دادهٔ موجود
   ──────────────────────────────────────
   یک تابعِ **خالص**: ورودی بگیر، فهرستِ مرتب بده. نه fetch، نه تاریخِ سیستم،
   نه state. `todayJ` هم پارامتر است نه `today()`ِ درونی — چون تابعی که ساعتِ
   سیستم را خودش می‌خواند آزمون‌پذیر نیست و مرزِ «۳ روزِ آینده» دقیقاً همان
   چیزی است که باید آزمون شود.

   ── همهٔ حسابِ تاریخ در *یک* تقویم ──
   کلِ مقایسه‌ها جلالی‌اند. تلهٔ ثبت‌شدهٔ این مخزن این است که `Transaction.date`
   و `FamilyEvent.date` میلادی‌اند، پس اگر یکی جلالی و دیگری میلادی مقایسه
   می‌شد خطا بی‌صدا می‌ماند. ورودی‌های میلادی همان ابتدا با `isoToJalali` تبدیل
   می‌شوند و از آن به بعد فقط `cmp` کار می‌کند. */

import type { JDate } from "@/shared/lib/jalali";
import { addDays, cmp, isoToJalali } from "@/shared/lib/jalali";
import { pendingDueList } from "@/domain/transaction/recurring.rules";
import type { Transaction } from "@/domain/transaction/transaction.types";
import type { Bill } from "@/domain/bill/bill.types";
import type { Task } from "@/domain/task/task.types";
import type { HouseDocument } from "@/domain/document/document.types";
import type { Equipment } from "@/domain/equipment/equipment.types";
import type { Vehicle } from "@/domain/vehicle/vehicle.types";
import type { Goal } from "@/domain/goal/goal.types";
import type { Activity } from "@/domain/activity/activity.types";
import type { FamilyEvent } from "@/domain/event/event.types";
import type { JoinRequest, MemberRole } from "@/domain/family/family.types";
import type {
  InventoryItem,
  ShoppingList,
} from "@/domain/shopping/shopping.types";
import { lowItems, queuedInventoryIds } from "@/domain/shopping/shopping.rules";
import type {
  AppNotification,
  NotificationDomain,
  NotificationPrefs,
  NotificationSeverity,
} from "./notification.types";
import { MAX_LEAD_DAYS } from "./notification.types";

export interface DeriveInput {
  txs: Transaction[];
  bills: Bill[];
  events: FamilyEvent[];
  /** فهرستِ درخواست‌ها. سرور خودش به `pending` و «فقط مدیر» محدود کرده، ولی
   *  این‌جا دوباره فیلتر می‌شود — نگاه کن به یادداشتِ `membership` پایین. */
  joinRequests: JoinRequest[];
  /** §۱.۸ — انبارِ خانه، منبعِ `InventoryBelowThreshold` */
  inventory: InventoryItem[];
  /** لیست‌های خرید. برای اعلانِ انبار لازم است، نه برای خودِ لیست: قلمی که
   *  از قبل در لیست منتظر است دیگر اعلان نمی‌گیرد. */
  shoppingLists: ShoppingList[];
  tasks?: Task[];
  /** فقط متادیتای مجازِ دریافت‌شده در نشست آنلاین؛ در کش آفلاین نمی‌رود. */
  documents?: HouseDocument[];
  /** فقط وسایل مجاز دریافت‌شده در نشست آنلاین؛ بدون تصویر آفلاین. */
  equipment?: Equipment[];
  /** فقط اطلاعات خودرو که سرور برای عضو فعلی مجاز دانسته است؛ بدون کش. */
  vehicles?: Vehicle[];
  /** دادهٔ خصوصی مالک فعلی، فقط از snapshot مجاز آنلاین. */
  goals?: Goal[];
  /** برنامه‌های مجاز خانواده در snapshot آنلاین؛ همان شناسهٔ رویداد تقویم. */
  activities?: Activity[];
  memberId?: string;
  role: MemberRole;
  prefs: NotificationPrefs;
  /** شناسه‌های نادیده‌گرفته‌شده (فقط رویداد از آن اثر می‌گیرد) */
  dismissed: ReadonlySet<string>;
  todayJ: JDate;
  /** Home shows due work even when its optional reminder is muted. */
  purpose?: "home";
}

/** ترتیبِ شدت. کوچک‌تر = بالاتر در فهرست. */
const SEVERITY_RANK: Record<NotificationSeverity, number> = {
  overdue: 0,
  pending: 1,
  soon: 2,
};

/** پیش‌هنگامِ سالم: عددِ صحیحِ بین ۰ و سقف.
 *  ورودی از بک‌اند/ذخیره‌سازی می‌آید، پس می‌تواند NaN یا منفی یا کسری باشد؛
 *  بی این مهار، `addDays(today, NaN)` کلِ فهرست را بی‌صدا خالی می‌کرد. */
function safeLead(prefs: NotificationPrefs, domain: NotificationDomain): number {
  const raw = prefs.leadDays?.[domain];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  return Math.min(MAX_LEAD_DAYS, Math.max(0, Math.floor(raw)));
}

function domainOn(prefs: NotificationPrefs, domain: NotificationDomain): boolean {
  if (!prefs.enabled) return false;
  /* نبودِ کلید = روشن. دلیل: اگر دامنهٔ تازه‌ای اضافه شود و ترجیحاتِ
     ذخیره‌شدهٔ کاربر هنوز کلیدش را نداشته باشد، پیش‌فرض باید «می‌بینم» باشد
     نه «بی‌صدا پنهان». سکوتِ پیش‌فرض همان باگی است که کسی گزارش نمی‌کند. */
  return prefs.domains?.[domain] !== false;
}

/* ── سررسیدِ تراکنش‌های تکرارشونده (معادلِ BillDueSoonِ §۷.۱) ──

   تلهٔ مهم: `dueOccurrences` سقفش `min(today, repeatEnd)` است، یعنی فقط
   سررسیدهای **رسیده/گذشته** را می‌دهد. وسوسه این بود که افقِ خودِ آن تابع به
   آینده کشیده شود تا «۳ روز پیش از سررسید» در بیاید — که ویجتِ
   widgets/due-recurring را خراب می‌کرد: آن ویجت از مدیر می‌پرسد «انجام شد؟» و
   با افقِ آینده شروع می‌کرد دربارهٔ تاریخ‌هایی بپرسد که هنوز نرسیده‌اند.
   پس `dueOccurrences` دست‌نخورده ماند و «نزدیک» را این‌جا با افقِ جداگانه
   می‌گیریم و بعد روی «امروز» به دو شدت می‌شکنیم.

   گاردِ نقش: فقط مدیر. این ویجتِ موجود هم همین بود و دلیلش کنش است نه حریمِ
   خصوصی — رسیدگی به سررسید کارِ مدیر است، پس نشان‌دادنش به عضوی که نمی‌تواند
   کاری بکند فقط نگرانیِ بی‌فایده می‌ساخت. */
function recurringNotes(input: DeriveInput): AppNotification[] {
  if (input.role !== "owner") return [];
  const lead = safeLead(input.prefs, "recurring");
  const horizon = addDays(input.todayJ, lead);
  const out: AppNotification[] = [];

  /* حلقه‌ی «برای هر تراکنش → سررسیدهای رسیدگی‌نشده» در خودِ دامنه‌ی تراکنش
     است، نه این‌جا: ویجتِ widgets/due-recurring هم همان را لازم دارد و دو
     نسخه‌ی جداگانه می‌توانست درّه بردارد. این‌جا فقط شدت را تعیین می‌کنیم. */
  for (const { tx, dueIso } of pendingDueList(input.txs, horizon)) {
    const isFuture = cmp(isoToJalali(dueIso), input.todayJ) > 0;
    out.push({
      id: `recurring:${tx.id}:${dueIso}`,
      domain: "recurring",
      severity: isFuture ? "soon" : "overdue",
      dateIso: dueIso,
      dismissible: false,
      ref: { kind: "recurring", txId: tx.id, dueIso },
    });
  }
  return out;
}

/* ── قبض‌های پرداخت‌نشده (BillDueSoonِ §۷.۱) ──

   برخلافِ سررسیدِ تکرارشونده، این‌جا مبلغ از قبل معلوم است (قبض آمده)، پس
   هیچ محاسبه‌ای لازم نیست — فقط فیلترِ حالت و بازهٔ تاریخ.

   `cancelled` و `paid` نمی‌آیند: پرداخت خودش قبض را از فهرست می‌برد، و لغو
   یعنی کاربر گفته «نمی‌پردازم». پس این دامنه هم مثلِ بقیه خودپاک‌کن است و
   `dismissible` ندارد — دادنِ «نادیده بگیر» به یک بدهی، راهی برای پنهان‌کردنِ
   کارِ انجام‌نشده می‌ساخت.

   گاردِ نقش ندارد: قبضِ خانه دادهٔ HOUSEHOLD_SHAREDِ §۵.۲ است و همهٔ اعضا
   باید بدانند برقِ خانه سرِ سررسید است، نه فقط مدیر. */
function billNotes(input: DeriveInput): AppNotification[] {
  const lead = safeLead(input.prefs, "bills");
  const horizon = addDays(input.todayJ, lead);
  const out: AppNotification[] = [];

  for (const bill of input.bills) {
    if (bill.state !== "unpaid") continue;
    const when = isoToJalali(bill.dueDate);
    /* گذشته از سررسید همیشه می‌آید، هر چه پیش‌هنگام باشد — بدهیِ معوق با
       گذشتنِ زمان مهم‌تر می‌شود نه کم‌اهمیت‌تر. */
    const overdue = cmp(when, input.todayJ) < 0;
    if (!overdue && cmp(when, horizon) > 0) continue;
    out.push({
      id: `bills:${bill.id}`,
      domain: "bills",
      severity: overdue ? "overdue" : "soon",
      dateIso: bill.dueDate,
      dismissible: false,
      ref: { kind: "bills", billId: bill.id, dueIso: bill.dueDate },
    });
  }
  return out;
}

/* ── رویداد و تولدِ نزدیک (CalendarEventUpcomingِ §۷.۱) ──

   بازه: [امروز, امروز + پیش‌هنگام]. رویدادِ گذشته نمی‌آید.

   همگام‌سازی تولد همان ردیف را به نزدیک‌ترین نوبت شمسی از امروز تهران
   به‌روز می‌کند؛ اینجا تاریخ مجاز سرور مصرف می‌شود و تکرار دیگری ساخته نمی‌شود.
   • شناسه **تاریخ را هم در خود دارد** (`event:<id>:<date>`) نه فقط id. چون
     هم‌گام‌سازی همان ردیف را سرِ جا به سالِ بعد به‌روز می‌کند، اگر شناسه فقط
     id بود «نادیده گرفتم»ِ تولدِ امسال، تولدِ همهٔ سال‌های بعد را هم برای
     همیشه خفه می‌کرد. */
function eventNotes(input: DeriveInput): AppNotification[] {
  const lead = safeLead(input.prefs, "event");
  const horizon = addDays(input.todayJ, lead);
  const out: AppNotification[] = [];

  for (const ev of input.events) {
    if (ev.kind === "activity") continue;
    const when = isoToJalali(ev.date);
    if (cmp(when, input.todayJ) < 0) continue;
    if (cmp(when, horizon) > 0) continue;
    const id = `event:${ev.id}:${ev.date}`;
    if (input.dismissed.has(id)) continue;
    out.push({
      id,
      domain: "event",
      severity: cmp(when, input.todayJ) === 0 ? "pending" : "soon",
      dateIso: ev.date,
      dismissible: true,
      ref: { kind: "event", eventId: ev.id, dateIso: ev.date },
    });
  }
  return out;
}

/* ── درخواستِ عضویتِ در انتظار (MembershipRequestPendingِ §۷.۱، «Admin only») ──

   §۷.۵: «اعلان نباید دادهٔ غیرمجاز را نشان دهد». مجوزِ واقعی سمتِ سرور است —
   `GET /auth/join-requests` پشتِ `require_admin_tenant` است و خودش هم فقط
   `state == "pending"` را می‌دهد، پس عضوِ غیرمدیر این داده را اصلاً نمی‌گیرد.

   با این حال هر دو فیلتر این‌جا تکرار شده‌اند، و این دوباره‌کاریِ بی‌دلیل
   نیست: این تابع خالص است و هر چه به آن بدهند باور می‌کند. اگر به فهرستِ
   فیلترنشده یا به نقشِ کهنه (عضوی که همین حالا از مدیریت برداشته شده ولی
   فهرستش در حافظه مانده) تکیه می‌کرد، در انزوا نادرست می‌شد. مجوز سمتِ سرور
   است؛ این‌جا فقط «تابع به‌تنهایی هم درست باشد». */
function membershipNotes(input: DeriveInput): AppNotification[] {
  if (input.role !== "owner") return [];
  const out: AppNotification[] = [];
  for (const req of input.joinRequests) {
    if (req.state !== "pending") continue;
    out.push({
      id: `membership:${req.id}`,
      domain: "membership",
      severity: "pending",
      dateIso: null,
      dismissible: false,
      ref: { kind: "membership", requestId: req.id },
    });
  }
  return out;
}

/* ── اقلامِ زیرِ آستانهٔ انبار (`InventoryBelowThreshold`ِ §۴.۹ → دامنهٔ
   خرید، §۷.۱) ──

   سه تصمیمِ این دامنه:

   **۱) پیش‌هنگام ندارد و شدتش همیشه `pending` است.** این یک *حالت* است نه
   رخدادِ تقویمی: «برنج تمام شده» تاریخِ آینده‌ای ندارد که بتوان «۳ روز
   قبلش» را حساب کرد. `pending` هم دقیقاً درست است — منتظرِ کنشِ شماست.

   **۲) قلمی که از قبل در لیستِ خرید است اعلان نمی‌گیرد.** این همان چیزی
   است که دامنه را **خودپاک‌کن** می‌کند، مثلِ بقیه: «به لیست اضافه کن» را
   زدی، اعلان رفت. بی این شرط، اعلان تا پر‌شدنِ انبار می‌ماند و کاربر را
   وادار می‌کرد همان کاری را که کرده دوباره بکند — و دقیقاً به همین دلیل
   `dismissible` هم لازم نیست.

   **۳) گاردِ نقش ندارد.** انبارِ خانه دادهٔ HOUSEHOLD_SHAREDِ §۵.۲ است؛ هر
   کسی که سرِ راهش از فروشگاه می‌گذرد باید بداند شیر تمام شده، نه فقط مدیر.
   همان استدلالِ قبض. */
function inventoryNotes(input: DeriveInput): AppNotification[] {
  const queued = queuedInventoryIds(input.shoppingLists);
  const out: AppNotification[] = [];
  for (const item of lowItems(input.inventory)) {
    if (queued.has(item.id)) continue;
    out.push({
      id: `inventory:${item.id}`,
      domain: "inventory",
      severity: "pending",
      dateIso: null,
      dismissible: false,
      ref: { kind: "inventory", itemId: item.id },
    });
  }
  return out;
}

function taskNotes(input: DeriveInput): AppNotification[] {
  if (!input.memberId) return [];
  const horizon = addDays(input.todayJ, safeLead(input.prefs, "tasks"));
  return (input.tasks ?? []).flatMap((task): AppNotification[] => {
    if (task.completed || (input.purpose !== "home" && task.assigneeId !== input.memberId)) return [];
    // An assignment is actionable immediately; a deadline increases its urgency.
    const when = task.dueDate ? isoToJalali(task.dueDate) : null;
    const relative = when ? cmp(when, input.todayJ) : null;
    const severity: NotificationSeverity = relative !== null && relative < 0
      ? "overdue" : relative === 0 || !when ? "pending"
        : cmp(when, horizon) <= 0 ? "soon" : "pending";
    return [{
      id: `tasks:${task.id}`,
      domain: "tasks", severity, dateIso: task.dueDate,
      dismissible: false, ref: { kind: "tasks", taskId: task.id },
    }];
  });
}

function documentNotes(input: DeriveInput): AppNotification[] {
  if (!input.memberId) return [];
  const horizon = addDays(input.todayJ, safeLead(input.prefs, "documents"));
  return (input.documents ?? []).flatMap((document): AppNotification[] => {
    if (!document.reminderEnabled || !document.expiryDate) return [];
    // مجوز اصلی در سرور است؛ دادهٔ خصوصیِ عضو دیگر در این تابع هم رد می‌شود.
    if (document.visibility !== "shared"
      && (document.visibility !== "private" || document.ownerId !== input.memberId)) return [];
    const when = isoToJalali(document.expiryDate);
    if (cmp(when, horizon) > 0) return [];
    const relative = cmp(when, input.todayJ);
    return [{
      id: `documents:${document.id}`,
      domain: "documents",
      severity: relative < 0 ? "overdue" : relative === 0 ? "pending" : "soon",
      dateIso: document.expiryDate,
      dismissible: false,
      ref: { kind: "documents", documentId: document.id },
    }];
  });
}

function equipmentNotes(input: DeriveInput): AppNotification[] {
  if (!input.memberId) return [];
  const horizon = addDays(input.todayJ, safeLead(input.prefs, "equipment"));
  const out: AppNotification[] = [];
  for (const item of input.equipment ?? []) {
    const dates = [
      { reason: "service", date: input.purpose === "home" || item.serviceReminderEnabled ? item.serviceDueDate : null },
      { reason: "warranty", date: item.warrantyUntil },
    ] as const;
    for (const { reason, date } of dates) {
      if (!date) continue;
      const when = isoToJalali(date);
      if (cmp(when, horizon) > 0) continue;
      const relative = cmp(when, input.todayJ);
      out.push({
        id: `equipment:${item.id}:${reason}:${date}`,
        domain: "equipment",
        severity: relative < 0 ? "overdue" : relative === 0 ? "pending" : "soon",
        dateIso: date,
        dismissible: false,
        ref: { kind: "equipment", equipmentId: item.id, reason },
      });
    }
  }
  return out;
}

function vehicleNotes(input: DeriveInput): AppNotification[] {
  if (!input.memberId) return [];
  const horizon = addDays(input.todayJ, safeLead(input.prefs, "vehicles"));
  const out: AppNotification[] = [];
  for (const item of input.vehicles ?? []) {
    const serviceDate = item.serviceDueDate ? isoToJalali(item.serviceDueDate) : null;
    const dateReached = serviceDate !== null && cmp(serviceDate, horizon) <= 0;
    const mileageReached = item.serviceDueOdometer !== null
      && item.odometer >= item.serviceDueOdometer;
    if ((input.purpose === "home" || item.serviceReminderEnabled) && (dateReached || mileageReached)) {
      const dateRelative = serviceDate ? cmp(serviceDate, input.todayJ) : null;
      const mileagePassed = item.serviceDueOdometer !== null
        && item.odometer > item.serviceDueOdometer;
      out.push({
        // شناسه به برنامهٔ سرویس وصل است، نه کیلومتر فعلی که مرتب تغییر می‌کند.
        id: `vehicles:${item.id}:service:${item.serviceDueDate ?? "none"}:${item.serviceDueOdometer ?? "none"}`,
        domain: "vehicles",
        severity: (dateRelative !== null && dateRelative < 0) || mileagePassed
          ? "overdue" : dateRelative === 0 || mileageReached ? "pending" : "soon",
        dateIso: item.serviceDueDate,
        dismissible: false,
        ref: { kind: "vehicles", vehicleId: item.id, reason: "service" },
      });
    }
    // بیمه و معاینهٔ عضو محدود سنی در پاسخ سرور خالی‌اند؛ این‌جا دادهٔ تازه
    // یا جزئیات حساس به مرجع اعلان اضافه نمی‌شود.
    const dates = [
      { reason: "insurance", date: item.insuranceUntil },
      { reason: "inspection", date: item.inspectionUntil },
    ] as const;
    for (const { reason, date } of dates) {
      if (!date) continue;
      const when = isoToJalali(date);
      if (cmp(when, horizon) > 0) continue;
      const relative = cmp(when, input.todayJ);
      out.push({
        id: `vehicles:${item.id}:${reason}:${date}`,
        domain: "vehicles",
        severity: relative < 0 ? "overdue" : relative === 0 ? "pending" : "soon",
        dateIso: date,
        dismissible: false,
        ref: { kind: "vehicles", vehicleId: item.id, reason },
      });
    }
  }
  return out;
}

function goalNotes(input: DeriveInput): AppNotification[] {
  if (!input.memberId) return [];
  const horizon = addDays(input.todayJ, safeLead(input.prefs, "goals"));
  return (input.goals ?? []).flatMap((item): AppNotification[] => {
    // مدیر یا والد هم به هدف خصوصی عضو دیگر دسترسی ندارد.
    if (item.ownerId !== input.memberId || item.status !== "active"
      || (input.purpose !== "home" && !item.reminderEnabled) || !item.targetDate) return [];
    const when = isoToJalali(item.targetDate);
    if (cmp(when, horizon) > 0) return [];
    const relative = cmp(when, input.todayJ);
    return [{
      id: `goals:${item.id}:${item.targetDate}`,
      domain: "goals",
      severity: relative < 0 ? "overdue" : relative === 0 ? "pending" : "soon",
      dateIso: item.targetDate,
      dismissible: false,
      ref: { kind: "goals", goalId: item.id },
    }];
  });
}

function activityNotes(input: DeriveInput): AppNotification[] {
  if (!input.memberId) return [];
  const horizon = addDays(input.todayJ, safeLead(input.prefs, "activities"));
  return (input.activities ?? []).flatMap((item): AppNotification[] => {
    if (item.status !== "planned" || (input.purpose !== "home" && !item.reminderEnabled)) return [];
    const when = isoToJalali(item.date);
    if (cmp(when, horizon) > 0) return [];
    const relative = cmp(when, input.todayJ);
    return [{
      id: `activities:${item.id}:${item.date}`,
      domain: "activities",
      severity: relative < 0 ? "overdue" : relative === 0 ? "pending" : "soon",
      dateIso: item.date,
      dismissible: false,
      ref: { kind: "activities", activityId: item.id },
    }];
  });
}

const BUILDERS: Record<
  NotificationDomain,
  (input: DeriveInput) => AppNotification[]
> = {
  recurring: recurringNotes,
  bills: billNotes,
  event: eventNotes,
  membership: membershipNotes,
  inventory: inventoryNotes,
  tasks: taskNotes,
  documents: documentNotes,
  equipment: equipmentNotes,
  vehicles: vehicleNotes,
  goals: goalNotes,
  activities: activityNotes,
};

/**
 * همهٔ اعلان‌های زندهٔ این عضو، مرتب‌شده.
 *
 * ترتیب: شدت (گذشته → منتظر → نزدیک)، بعد تاریخ صعودی، بعد شناسه.
 * شکستنِ تساوی با شناسه عمدی است: بی آن، ترتیبِ دو موردِ هم‌شدت و هم‌تاریخ
 * به ترتیبِ ورودی گره می‌خورد و فهرست بینِ دو رفرش جابه‌جا می‌شد.
 */
export function deriveNotifications(input: DeriveInput): AppNotification[] {
  if (!input.prefs.enabled) return [];

  const out: AppNotification[] = [];
  for (const domain of Object.keys(BUILDERS) as NotificationDomain[]) {
    if (!domainOn(input.prefs, domain)) continue;
    out.push(...BUILDERS[domain](input));
  }

  out.sort((a, b) => {
    const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (s !== 0) return s;
    /* null (درخواستِ عضویت) آخرِ گروهِ خودش می‌نشیند، نه اولش */
    if (a.dateIso !== b.dateIso) {
      if (a.dateIso === null) return 1;
      if (b.dateIso === null) return -1;
      return a.dateIso < b.dateIso ? -1 : 1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return out;
}

/** شمارندهٔ زنگ = تعدادِ موردِ زنده.
 *  جدا نگه داشته شد تا هیچ‌جا «تعدادِ نخوانده» از جای دیگری حساب نشود. */
export function notificationCount(list: AppNotification[]): number {
  return list.length;
}
