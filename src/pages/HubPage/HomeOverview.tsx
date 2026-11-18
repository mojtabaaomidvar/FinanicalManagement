import { useState } from "react";
import type { HomeOverview as Overview, HomeOverviewInput } from "@/domain/home/homeOverview.rules";
import type { AppNotification, NotificationRef } from "@/domain/notification/notification.types";
import { formatLong, isoToJalali } from "@/shared/lib/jalali";
import { toFa } from "@/shared/lib/digits";
import { Icon } from "@/shared/ui";

export interface HomeRow {
  item: AppNotification;
  title: string;
  sub: string;
  icon: string;
  sourceId: string;
}

/** Only titles and permitted deadlines are presented; no notes, files or financial details. */
export const homeRow = (item: AppNotification, data: HomeOverviewInput, todayIso: string): HomeRow | null => {
  const ref = item.ref;
  const date = item.dateIso ? formatLong(isoToJalali(item.dateIso)) : "";
  let title: string | undefined;
  let label = "";
  let icon = "i-clock";
  let sourceId = "";
  switch (ref.kind) {
    case "tasks": {
      const task = data.tasks?.find((row) => row.id === ref.taskId && !row.completed);
      title = task?.title; sourceId = ref.taskId; icon = "i-check";
      label = task?.assigneeId === data.memberId ? "کار من"
        : task?.assigneeId ? "کار خانواده" : "کار بدون مسئول";
      break;
    }
    case "bills":
      title = data.bills.find((row) => row.id === ref.billId && row.state === "unpaid")?.title;
      sourceId = ref.billId; label = "سررسید قبض"; icon = "i-bill";
      break;
    case "event":
      title = data.events.find((row) => row.id === ref.eventId && row.kind !== "activity"
        && row.date === ref.dateIso)?.title;
      sourceId = ref.eventId; label = "مناسبت خانواده"; icon = "i-gift";
      break;
    case "equipment":
      title = data.equipment?.find((row) => row.id === ref.equipmentId)?.title;
      sourceId = ref.equipmentId; icon = "i-grid4";
      label = ref.reason === "service" ? "موعد سرویس" : "پایان گارانتی";
      break;
    case "vehicles": {
      const vehicle = data.vehicles?.find((row) => row.id === ref.vehicleId);
      title = vehicle?.title; sourceId = ref.vehicleId; icon = "i-car";
      label = ref.reason === "insurance" ? "پایان بیمه"
        : ref.reason === "inspection" ? "پایان معاینهٔ فنی" : "موعد سرویس";
      if (vehicle && ref.reason === "service" && vehicle.serviceDueOdometer !== null
        && vehicle.odometer >= vehicle.serviceDueOdometer && (!item.dateIso || item.dateIso > todayIso)) {
        const mileage = toFa(vehicle.serviceDueOdometer.toLocaleString("en-US"));
        return { item, title: vehicle.title, sourceId, icon,
          sub: `سرویس در ${mileage} کیلومتر · ${vehicle.odometer > vehicle.serviceDueOdometer
            ? "از موعد کیلومتر گذشته" : "به موعد کیلومتر رسیده"}` };
      }
      break;
    }
    case "goals":
      title = data.goals?.find((row) => row.id === ref.goalId && row.ownerId === data.memberId
        && row.status === "active")?.title;
      sourceId = ref.goalId; label = "هدف شخصی من"; icon = "i-heart";
      break;
    case "activities":
      title = data.activities?.find((row) => row.id === ref.activityId && row.status === "planned")?.title;
      sourceId = ref.activityId; label = "برنامهٔ خانواده"; icon = "i-fun";
      break;
    default: return null;
  }
  return title ? { item, title, sourceId, icon, sub: `${label} · ${date}` } : null;
};

export function HomeOverview({ overview, data, todayIso, loading, incomplete, offline, onOpen, onRetry }: {
  overview: Overview; data: HomeOverviewInput; todayIso: string;
  loading: boolean; incomplete: boolean; offline: boolean;
  onOpen: (ref: NotificationRef) => void; onRetry: () => void;
}) {
  const groups = [
    { id: "overdue", title: "عقب‌افتاده", items: overview.overdue },
    { id: "today", title: "امروز", items: overview.today },
    { id: "upcoming", title: "فردا", items: overview.upcoming },
  ];
  const count = overview.overdue.length + overview.today.length + overview.upcoming.length;
  return (
    <section className="hub-overview" aria-labelledby="home-overview-title" aria-busy={loading}>
      <div className="hub-overview-head">
        <div>
          <h2 id="home-overview-title">امروز و فردا</h2>
          <p>{formatLong(isoToJalali(todayIso))}</p>
        </div>
        <Icon name="i-clock" size={24} />
      </div>
      {offline ? <p className="hub-overview-status">در حالت آفلاین، موعدهای کارهای خانه نمایش داده می‌شوند.</p> : null}
      {loading ? <p className="hub-overview-status" role="status">در حال دریافت وضعیت خانه…</p> : null}
      {!loading && incomplete && !offline ? (
        <div className="hub-overview-status" role="status">
          <span>بخشی از اطلاعات دریافت نشد.</span>
          <button type="button" className="hub-overview-more" onClick={onRetry}>تلاش دوباره</button>
        </div>
      ) : null}
      {groups.map((group) => {
        const rows = group.items.map((item) => homeRow(item, data, todayIso)).filter((row): row is HomeRow => row !== null);
        return rows.length ? <HomeGroup key={group.id} id={group.id} title={group.title} rows={rows} onOpen={onOpen} /> : null;
      })}
      {!count && !loading ? <p className="hub-overview-empty">
        {incomplete ? "در اطلاعات دریافت‌شده، موعدی برای این بازه نیست."
          : offline ? "کار دارای موعدی برای این بازه در داده‌های آفلاین نیست."
            : "برای امروز و فردا، کار یا موعدی ثبت نشده است."}
      </p> : null}
    </section>
  );
}

function HomeGroup({ id, title, rows, onOpen }: {
  id: string; title: string; rows: HomeRow[]; onOpen: (ref: NotificationRef) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, 3);
  return (
    <section className={`hub-overview-group is-${id}`} data-home-group={id} aria-label={title}>
      <div className="hub-overview-group-head">
        <h3>{title}</h3><span>{toFa(rows.length)} مورد</span>
      </div>
      <ul className="hub-overview-list">
        {visible.map(({ item, title: rowTitle, sub, icon, sourceId }) => (
          <li key={item.id}>
            <button type="button" className="hub-overview-row" data-home-item-id={item.id}
              data-home-ref-kind={item.ref.kind} data-home-ref-id={sourceId} onClick={() => onOpen(item.ref)}>
              <span className="hub-overview-icon" aria-hidden="true"><Icon name={icon} size={20} /></span>
              <span className="hub-overview-text"><b>{rowTitle}</b><span>{sub}</span></span>
              <Icon name="i-arrow-l" size={16} />
            </button>
          </li>
        ))}
      </ul>
      {rows.length > 3 ? <button type="button" className="hub-overview-more" aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}>
        {expanded ? "نمایش کمتر" : `نمایش همهٔ ${toFa(rows.length)} مورد`}
      </button> : null}
    </section>
  );
}
