/* §۱.۱۰ — صفحهٔ تقویم و مناسبت‌ها.

   دادهٔ این ماژول از قبل وجود داشت (`family_events` + مسیرها + هم‌گام‌سازیِ
   تولد) و §۷ هم برایش اعلان می‌داد، ولی کاربر هیچ صفحه‌ای برای دیدنش
   نداشت — یعنی برای تولدی اعلان می‌رفت که جایی برای دیدنش نبود. این صفحه
   همان شکاف را می‌بندد.

   منطقِ شبکه این‌جا نیست؛ در `domain/event/calendar.rules.ts` است و آزمونِ
   اجرایی دارد. دلیلش تلهٔ «یکی جابه‌جا»ست: خانه‌های خالیِ ابتدای ماه و
   سرستونِ روزها هر دو از `weekdayIndex` می‌آیند و اگر آن غلط باشد کلِ ماه
   یک خانه می‌لنگد بی‌آنکه چیزی خطا بدهد.

   تولدها هنگام بازخوانی داده همگام می‌شوند؛ دکمهٔ دستی امکان بازخوانی
   فوری را از خود تقویم فراهم می‌کند. */

import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import {
  Card,
  Field,
  Icon,
  JalaliDateInput,
  Modal,
  TextInput,
} from "@/shared/ui";
import type { FamilyEvent } from "@/domain/event/event.types";
import { EVENT_PRESETS } from "@/domain/event/event.types";
import { deriveCalendarEntries, type CalendarEntry, type CalendarTarget } from "@/domain/event/householdCalendar.rules";
import type { NotificationsModel } from "@/features/notifications/model/useNotificationsModel";
import { useOnline } from "@/shared/lib/useOnline";
import { useTehranDay } from "@/shared/lib/useTehranDay";
import {
  eventCountByDay,
  eventsOnDay,
  monthCells,
  upcomingEvents,
} from "@/domain/event/calendar.rules";
import {
  WEEKDAYS_SHORT,
  addDays,
  formatISO,
  formatLong,
  formatMonth,
  isoToJalali,
  jalaliToIso,
  nextMonth,
  parse,
  prevMonth,
  type JDate,
} from "@/shared/lib/jalali";
import { toFa } from "@/shared/lib/digits";
import "./CalendarPage.css";

// Additional deadlines are views of their source records; existing calendar history stays intact.

/** افقِ فهرستِ «نزدیک» — یک ماه. هم‌راستا با پیش‌هنگامِ ۷ روزهٔ §۷ نیست و
 *  نباید باشد: آن «کِی خبر بده» است، این «چه چیزی در پیش است». */
const UPCOMING_DAYS = 30;

export function CalendarPage({ onOpenItem, initialDate, summary, onRefresh }: {
  onOpenItem: (ref: CalendarTarget) => void; initialDate?: string;
  summary: Pick<NotificationsModel, "equipment" | "vehicles" | "onlineSummaryState">;
  onRefresh: () => Promise<void>;
}) {
  const { events, members, tasks, bills, useCases, member, family, shoppingSync, offlineSession, homeDataStatus } = useApp();
  const { show } = useToast();
  const online = useOnline();
  const restricted = !online || shoppingSync.offline || offlineSession;
  const { todayJ, todayIso } = useTehranDay();
  const loading = !restricted && (homeDataStatus.loading || Boolean(summary.onlineSummaryState?.loading));
  const incomplete = !restricted && (homeDataStatus.incomplete || Boolean(summary.onlineSummaryState?.failedSources
    .some((source) => source === "equipment" || source === "vehicles")));
  const initialDay = initialDate ? isoToJalali(initialDate) : todayJ;
  const [view, setView] = useState<[number, number]>([initialDay[0], initialDay[1]]);
  const [selected, setSelected] = useState<JDate>(initialDay);
  const horizonYear = addDays(todayJ, UPCOMING_DAYS)[0];
  const entries = useMemo(() => restricted ? [] : deriveCalendarEntries({
    events, members, birthdayYears: [view[0], selected[0], todayJ[0], horizonYear],
    tasks, bills, equipment: summary.equipment, vehicles: summary.vehicles,
  }), [restricted, events, members, tasks, bills, summary.equipment, summary.vehicles,
    view[0], selected[0], todayIso, horizonYear]);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);
  const scope = `${family?.id}:${member?.id}:${member?.role}:${member?.birthDate}:${member?.relation}:${restricted}`;
  const access = useRef({ scope, generation: 0 });
  if (access.current.scope !== scope) access.current = { scope, generation: access.current.generation + 1 };
  useEffect(() => {
    setOpen(false); setTitle(""); setNote(""); setDate(""); setBusy(false); setSyncing(false);
  }, [scope]);
  useEffect(() => {
    const invalidate = () => {
      access.current.generation += 1;
      setOpen(false); setTitle(""); setNote(""); setDate(""); setBusy(false); setSyncing(false);
    };
    window.addEventListener("offline", invalidate);
    return () => { access.current.generation += 1; window.removeEventListener("offline", invalidate); };
  }, []);
  const currentRequest = () => {
    const captured = access.current;
    const generation = captured.generation;
    return () => access.current === captured && access.current.generation === generation
      && !restricted && navigator.onLine !== false;
  };

  const [vy, vm] = view;
  const cells = useMemo(() => monthCells(vy, vm), [vy, vm]);
  const counts = useMemo(
    () => eventCountByDay(entries, vy, vm),
    [entries, vy, vm],
  );
  const dayEvents = useMemo(
    () => eventsOnDay(entries, selected),
    [entries, selected],
  );
  const upcoming = useMemo(
    () => upcomingEvents(entries, todayJ, UPCOMING_DAYS),
    [entries, todayIso],
  );

  const isToday = (d: number) =>
    vy === todayJ[0] && vm === todayJ[1] && d === todayJ[2];
  const isSelected = (d: number) =>
    vy === selected[0] && vm === selected[1] && d === selected[2];

  function openAdd(forDay?: JDate) {
    if (restricted) return;
    setTitle("");
    setNote("");
    setDate(formatISO(forDay ?? selected));
    setOpen(true);
  }

  async function add() {
    if (!useCases || busy || restricted) return;
    const t = title.trim();
    if (!t) {
      show("عنوان رویداد را بنویسید");
      return;
    }
    const parsed = parse(date);
    if (!parsed) {
      show("تاریخ را انتخاب کنید");
      return;
    }
    setBusy(true);
    const current = currentRequest();
    try {
      await useCases.addEvent.execute({
        title: t,
        date: jalaliToIso(parsed),
        note: note.trim() || null,
      });
      if (!current()) return;
      await onRefresh();
      if (!current()) return;
      /* روی همان روزی که ثبت شد بمان، تا کاربر نتیجه را ببیند */
      setSelected(parsed);
      setView([parsed[0], parsed[1]]);
      setOpen(false);
      show("رویداد ثبت شد");
    } catch (e) {
      if (current()) show((e as Error).message || "خطا در ثبت رویداد");
    } finally {
      if (current()) setBusy(false);
    }
  }

  async function remove(ev: FamilyEvent) {
    if (ev.kind === "activity") { onOpenItem({ kind: "activities", activityId: ev.id }); return; }
    if (!useCases || restricted) return;
    if (!confirm(`رویداد «${ev.title}» حذف شود؟`)) return;
    const current = currentRequest();
    try {
      await useCases.deleteEvent.execute(ev.id);
      if (!current()) return;
      await onRefresh();
      if (current()) show("حذف شد");
    } catch (e) {
      if (!current()) return;
      const msg = (e as Error).message || "خطا در حذف";
      /* سرور برای رویدادِ دیگری ۴۰۴ می‌دهد نه ۴۰۳ — پیام را قابل‌فهم
         می‌کنیم، همان کاری که EventsCard هم می‌کند. */
      show(
        /یافت نشد/.test(msg)
          ? "فقط مدیر یا سازندهٔ رویداد می‌تواند آن را حذف کند"
          : msg,
      );
    }
  }

  async function syncBirthdays() {
    if (!useCases || syncing || restricted) return;
    setSyncing(true);
    const current = currentRequest();
    try {
      const n = await useCases.syncBirthdays.execute();
      if (!current()) return;
      await onRefresh();
      if (!current()) return;
      show(
        n > 0
          ? `${toFa(n)} تولد به تقویم اضافه شد`
          : "تولدها با تاریخ تولد اعضا همگام شدند.",
      );
    } catch (e) {
      if (current()) show((e as Error).message || "همگام‌سازی ناموفق بود");
    } finally {
      if (current()) setSyncing(false);
    }
  }

  const canDelete = (ev: FamilyEvent) =>
    ev.kind !== "activity" && (member?.role === "owner" || ev.memberId === member?.id);

  const selectDay = (date: string) => {
    const day = isoToJalali(date);
    setSelected(day); setView([day[0], day[1]]);
  };
  const refresh = async () => {
    if (restricted || syncing) return;
    setSyncing(true);
    const current = currentRequest();
    try { await onRefresh(); }
    catch (error) { if (current()) show(error instanceof Error ? error.message : "بازخوانی ناموفق بود."); }
    finally { if (current()) setSyncing(false); }
  };
  const renderEntry = (entry: CalendarEntry, upcomingRow = false) => {
    const eventId = entry.ref.kind === "event" ? entry.ref.eventId
      : entry.ref.kind === "activities" ? entry.ref.activityId : undefined;
    const event = eventId ? events.find((row) => row.id === eventId) : undefined;
    return <CalendarEntryRow key={entry.id} entry={entry} showDate={upcomingRow}
      note={event?.note ?? undefined}
      activityStatus={entry.source === "activity" ? event?.activityStatus : undefined}
      onClick={entry.ref.kind === "event" ? upcomingRow ? () => selectDay(entry.date) : undefined
        : () => onOpenItem(entry.ref)}
      onDelete={event && entry.id === `event:${event.id}` && canDelete(event) ? () => void remove(event) : undefined} />;
  };

  return (
    <section className="page active household-calendar" aria-busy={loading}>
      <header className="app-header">
        <div className="header-title">
          <h1>تقویم و مناسبت‌ها</h1>
          <p>مناسبت‌ها، کارها، قبوض و موعدهای سرویس</p>
        </div>
      </header>

      <div className="content">
        <div className="calendar-toolbar">
          <button type="button" className="btn-secondary" onClick={() => selectDay(todayIso)}>امروز</button>
          <button type="button" className="btn-secondary" disabled={syncing || restricted}
            onClick={() => void refresh()}>{syncing ? "در حال بازخوانی…" : "بازخوانی تقویم"}</button>
        </div>
        {loading ? <p className="calendar-status" role="status">در حال دریافت موعدهای خانه…</p> : null}
        {!loading && incomplete ? <p className="calendar-status" role="status">
          بخشی از اطلاعات دریافت نشد؛ برای دریافت دوباره «بازخوانی تقویم» را بزنید.
        </p> : null}
        <Card>
          {/* ── ناوبریِ ماه ── */}
          <div className="cal-nav">
            <button
              type="button"
              className="cal-nav-btn"
              aria-label="ماه قبل"
              onClick={() => setView(prevMonth(vy, vm))}
            >
              <Icon name="i-arrow-r" size={18} />
            </button>
            <b className="cal-month">{formatMonth(vy, vm)}</b>
            <button
              type="button"
              className="cal-nav-btn"
              aria-label="ماه بعد"
              onClick={() => setView(nextMonth(vy, vm))}
            >
              <Icon name="i-arrow-l" size={18} />
            </button>
          </div>

          {/* ── سرستونِ روزهای هفته — از شنبه ── */}
          <div className="cal-grid cal-head" aria-hidden="true">
            {WEEKDAYS_SHORT.map((w) => (
              <span key={w} className="cal-wd">
                {w}
              </span>
            ))}
          </div>

          {/* ── شبکهٔ ماه ── */}
          <div className="cal-grid" role="grid">
            {cells.map((c) =>
              c.day === null ? (
                <span key={c.key} className="cal-cell is-pad" />
              ) : (
                <button
                  key={c.key}
                  type="button"
                  role="gridcell"
                  className={`cal-cell${isToday(c.day) ? " is-today" : ""}${
                    isSelected(c.day) ? " is-selected" : ""
                  }`}
                  aria-label={`${formatLong([vy, vm, c.day])}${counts.get(c.day) ? `، ${toFa(counts.get(c.day)!)} مورد` : ""}`}
                  aria-selected={isSelected(c.day)}
                  data-calendar-date={jalaliToIso([vy, vm, c.day])}
                  data-calendar-count={counts.get(c.day) ?? 0}
                  onClick={() => setSelected([vy, vm, c.day as number])}
                >
                  {toFa(c.day)}
                  {counts.get(c.day) ? (
                    <span className="calendar-day-count" aria-hidden="true">{toFa(counts.get(c.day)!)}</span>
                  ) : null}
                </button>
              ),
            )}
          </div>
        </Card>

        {/* ── رویدادهای روزِ انتخاب‌شده ── */}
        <Card
          title={formatLong(selected)}
          action={
            <button
              type="button"
              className="link-btn"
              onClick={() => openAdd(selected)}
            >
              + افزودن
            </button>
          }
        >
          <div data-calendar-list="day">
            {dayEvents.length ? dayEvents.map((entry) => renderEntry(entry))
              : !loading ? <p className="form-note">{incomplete ? "در اطلاعات دریافت‌شده، موردی برای این روز نیست." : "برای این روز رویداد یا موعدی ثبت نشده است."}</p> : null}
          </div>
        </Card>

        {/* ── نزدیک‌ها ── */}
        <Card title="۳۰ روز آینده">
          <div data-calendar-list="upcoming">
            {upcoming.length ? (showAllUpcoming ? upcoming : upcoming.slice(0, 8)).map((entry) => renderEntry(entry, true))
              : !loading ? <p className="form-note">{incomplete ? "در اطلاعات دریافت‌شده، موردی برای این بازه نیست." : "در ۳۰ روز آینده رویداد یا موعدی ثبت نشده است."}</p> : null}
            {upcoming.length > 8 ? <button type="button" className="calendar-show-all link-btn" aria-expanded={showAllUpcoming}
              onClick={() => setShowAllUpcoming((value) => !value)}>{showAllUpcoming ? "نمایش کمتر" : `نمایش همهٔ ${toFa(upcoming.length)} مورد`}</button> : null}
          </div>
        </Card>

        {/* ── همگام‌سازیِ تولدها ── */}
        <Card title="تولدها">
          <p className="form-note">
            تولد اعضا و فرزندان هر سال در همان روز و ماه شمسی نمایش داده می‌شود.
            تاریخ تولد را از پروفایل عضو ویرایش یا حذف کنید.
          </p>
          <button
            type="button"
            className="btn-secondary"
            disabled={syncing}
            onClick={() => void syncBirthdays()}
          >
            {syncing ? "…" : "همگام‌سازی تولدها"}
          </button>
        </Card>
      </div>

      {/* ── فرمِ رویدادِ تازه ── */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="رویداد جدید"
        dragToClose
      >
        <p className="form-label">پیشنهادی:</p>
        <div className="subchips" style={{ marginBottom: 12 }}>
          {EVENT_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className={`chip ${title === p ? "active" : ""}`}
              onClick={() => setTitle(p)}
            >
              {p}
            </button>
          ))}
        </div>

        <Field label="عنوان">
          <TextInput value={title} onChange={setTitle} autoFocus />
        </Field>
        <Field label="تاریخ">
          <JalaliDateInput value={date} onChange={setDate} />
        </Field>
        <Field label="توضیح (اختیاری)">
          <TextInput value={note} onChange={setNote} />
        </Field>

        <div className="modal-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setOpen(false)}
          >
            انصراف
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() => void add()}
          >
            {busy ? "…" : "ثبت"}
          </button>
        </div>
      </Modal>
    </section>
  );
}

function CalendarEntryRow({
  entry,
  showDate,
  note,
  activityStatus,
  onClick,
  onDelete,
}: {
  entry: CalendarEntry;
  showDate?: boolean;
  note?: string;
  activityStatus?: FamilyEvent["activityStatus"];
  onClick?: () => void;
  onDelete?: () => void;
}) {
  const jd = isoToJalali(entry.date);
  const ref = entry.ref;
  const sourceId = ref.kind === "event" ? ref.eventId : ref.kind === "activities" ? ref.activityId
    : ref.kind === "tasks" ? ref.taskId : ref.kind === "bills" ? ref.billId
      : ref.kind === "equipment" ? ref.equipmentId : ref.vehicleId;
  const label = ref.kind === "event" ? entry.id === `event:${ref.eventId}` ? "مناسبت خانواده" : "تولد سالانه"
    : ref.kind === "activities" ? "برنامهٔ خانوادگی"
    : ref.kind === "tasks" ? "موعد کار" : ref.kind === "bills" ? "سررسید قبض"
      : ref.kind === "equipment" ? ref.reason === "service" ? "سرویس وسیله" : "پایان گارانتی"
        : ref.reason === "service" ? "سرویس خودرو" : ref.reason === "insurance" ? "پایان بیمه" : "پایان معاینهٔ فنی";
  const content = <>
      <div className="event-date-badge">
        <b>{toFa(jd[2])}</b>
        <span>{formatLong(jd).split(" ")[1]}</span>
      </div>
      <div className="event-info">
        <b className="calendar-entry-title">{entry.title}</b>
        <p>{label}{entry.source === "activity" ? ` · ${activityStatus === "done" ? "انجام‌شده"
          : activityStatus === "cancelled" ? "لغوشده" : "برنامه‌ریزی‌شده"}` : ""}</p>
        {note ? <p>{note}</p> : null}
        {showDate ? <p>{formatLong(jd)}</p> : null}
      </div>
      {onClick ? <Icon name="i-arrow-l" size={16} /> : null}
    </>;
  return (
    <div className="calendar-entry event-item" data-calendar-entry-id={entry.id}
      data-calendar-ref-id={sourceId} data-calendar-ref-kind={ref.kind} data-calendar-source={entry.source}>
      {onClick ? <button type="button" className="calendar-entry-main" onClick={onClick}
        aria-label={`بازکردن ${entry.title} · ${label}`}>{content}</button>
        : <div className="calendar-entry-main">{content}</div>}
      {onDelete ? (
        <button
          type="button"
          className="icon-btn small danger"
          aria-label={`حذف رویداد ${entry.title}`}
          onClick={onDelete}
        >
          <Icon name="i-trash" size={15} />
        </button>
      ) : null}
    </div>
  );
}
