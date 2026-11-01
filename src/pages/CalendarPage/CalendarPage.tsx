/* §۱.۱۰ — صفحهٔ تقویم و مناسبت‌ها.

   دادهٔ این ماژول از قبل وجود داشت (`family_events` + مسیرها + هم‌گام‌سازیِ
   تولد) و §۷ هم برایش اعلان می‌داد، ولی کاربر هیچ صفحه‌ای برای دیدنش
   نداشت — یعنی برای تولدی اعلان می‌رفت که جایی برای دیدنش نبود. این صفحه
   همان شکاف را می‌بندد.

   منطقِ شبکه این‌جا نیست؛ در `domain/event/calendar.rules.ts` است و آزمونِ
   اجرایی دارد. دلیلش تلهٔ «یکی جابه‌جا»ست: خانه‌های خالیِ ابتدای ماه و
   سرستونِ روزها هر دو از `weekdayIndex` می‌آیند و اگر آن غلط باشد کلِ ماه
   یک خانه می‌لنگد بی‌آنکه چیزی خطا بدهد.

   دکمهٔ «همگام‌سازی تولدها» عمدی است و شکافِ یافته‌شده را می‌بندد:
   `syncBirthdays` تا امروز فقط از `ProfileCard` صدا زده می‌شد، یعنی عضوی
   که تاریخ تولدش را قبلاً گذاشته و دیگر پروفایل را دست نزده، رویدادِ تولد
   نداشت. */

import { useMemo, useState } from "react";
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
import {
  eventCountByDay,
  eventsOnDay,
  monthCells,
  upcomingEvents,
} from "@/domain/event/calendar.rules";
import {
  WEEKDAYS_SHORT,
  formatISO,
  formatLong,
  formatMonth,
  isoToJalali,
  jalaliToIso,
  nextMonth,
  parse,
  prevMonth,
  today,
  type JDate,
} from "@/shared/lib/jalali";
import { toFa } from "@/shared/lib/digits";

/** افقِ فهرستِ «نزدیک» — یک ماه. هم‌راستا با پیش‌هنگامِ ۷ روزهٔ §۷ نیست و
 *  نباید باشد: آن «کِی خبر بده» است، این «چه چیزی در پیش است». */
const UPCOMING_DAYS = 30;

export function CalendarPage() {
  const { events, useCases, member, refreshData } = useApp();
  const { show } = useToast();

  const todayJ = today();
  const [view, setView] = useState<[number, number]>([todayJ[0], todayJ[1]]);
  const [selected, setSelected] = useState<JDate>(todayJ);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [vy, vm] = view;
  const cells = useMemo(() => monthCells(vy, vm), [vy, vm]);
  const counts = useMemo(
    () => eventCountByDay(events, vy, vm),
    [events, vy, vm],
  );
  const dayEvents = useMemo(
    () => eventsOnDay(events, selected),
    [events, selected],
  );
  const upcoming = useMemo(
    () => upcomingEvents(events, todayJ, UPCOMING_DAYS),
    [events, todayJ],
  );

  const isToday = (d: number) =>
    vy === todayJ[0] && vm === todayJ[1] && d === todayJ[2];
  const isSelected = (d: number) =>
    vy === selected[0] && vm === selected[1] && d === selected[2];

  function openAdd(forDay?: JDate) {
    setTitle("");
    setNote("");
    setDate(formatISO(forDay ?? selected));
    setOpen(true);
  }

  async function add() {
    if (!useCases || busy) return;
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
    try {
      await useCases.addEvent.execute({
        title: t,
        date: jalaliToIso(parsed),
        note: note.trim() || null,
      });
      await refreshData();
      /* روی همان روزی که ثبت شد بمان، تا کاربر نتیجه را ببیند */
      setSelected(parsed);
      setView([parsed[0], parsed[1]]);
      setOpen(false);
      show("رویداد ثبت شد");
    } catch (e) {
      show((e as Error).message || "خطا در ثبت رویداد");
    } finally {
      setBusy(false);
    }
  }

  async function remove(ev: FamilyEvent) {
    if (!useCases) return;
    if (!confirm(`رویداد «${ev.title}» حذف شود؟`)) return;
    try {
      await useCases.deleteEvent.execute(ev.id);
      await refreshData();
      show("حذف شد");
    } catch (e) {
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
    if (!useCases || syncing) return;
    setSyncing(true);
    try {
      const n = await useCases.syncBirthdays.execute();
      await refreshData();
      show(
        n > 0
          ? `${toFa(n)} تولد به تقویم اضافه شد`
          : "تولدی برای افزودن نبود — تاریخ تولد اعضا را در پروفایلشان بگذارید",
      );
    } catch (e) {
      show((e as Error).message || "همگام‌سازی ناموفق بود");
    } finally {
      setSyncing(false);
    }
  }

  const canDelete = (ev: FamilyEvent) =>
    member?.role === "owner" || ev.memberId === member?.id;

  return (
    <section className="page active">
      <header className="app-header">
        <div className="header-title">
          <h1>تقویم و مناسبت‌ها</h1>
          <p>تولدها، سالگردها و مناسبت‌های خانواده</p>
        </div>
      </header>

      <div className="content">
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
                  aria-label={formatLong([vy, vm, c.day])}
                  aria-selected={isSelected(c.day)}
                  onClick={() => setSelected([vy, vm, c.day as number])}
                >
                  {toFa(c.day)}
                  {counts.get(c.day) ? (
                    <span className="cal-dot" aria-hidden="true" />
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
          {dayEvents.length ? (
            dayEvents.map((ev) => (
              <EventRow
                key={ev.id}
                ev={ev}
                onDelete={canDelete(ev) ? () => void remove(ev) : undefined}
              />
            ))
          ) : (
            <p className="form-note">این روز رویدادی ندارد</p>
          )}
        </Card>

        {/* ── نزدیک‌ها ── */}
        <Card title={`یک ماه آینده`}>
          {upcoming.length ? (
            upcoming.map((ev) => (
              <EventRow
                key={ev.id}
                ev={ev}
                showDate
                onClick={() => {
                  const d = isoToJalali(ev.date);
                  setSelected(d);
                  setView([d[0], d[1]]);
                }}
              />
            ))
          ) : (
            <p className="form-note">در یک ماه آینده رویدادی ثبت نشده</p>
          )}
        </Card>

        {/* ── همگام‌سازیِ تولدها ── */}
        <Card title="تولدها">
          <p className="form-note">
            تاریخ تولدی که اعضا در پروفایلشان گذاشته‌اند را به تقویم می‌آورد و
            هر سال به‌روز می‌کند.
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

function EventRow({
  ev,
  showDate,
  onClick,
  onDelete,
}: {
  ev: FamilyEvent;
  showDate?: boolean;
  onClick?: () => void;
  onDelete?: () => void;
}) {
  const jd = isoToJalali(ev.date);
  const clickable = Boolean(onClick);

  return (
    <div
      className="event-item"
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
    >
      <div className="event-date-badge">
        <b>{toFa(jd[2])}</b>
        <span>{formatLong(jd).split(" ")[1]}</span>
      </div>
      <div className="event-info">
        <h5>{ev.title}</h5>
        {ev.note ? <p>{ev.note}</p> : null}
        {showDate ? <p>{formatLong(jd)}</p> : null}
      </div>
      {onDelete ? (
        <button
          type="button"
          className="icon-btn small danger"
          aria-label="حذف"
          /* stopPropagation — قاعدهٔ ثبت‌شده: دکمهٔ درونی نباید کنشِ کارت
             را هم بزند. این ردیف در فهرستِ «نزدیک» کلیک‌پذیر است. */
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Icon name="i-trash" size={15} />
        </button>
      ) : null}
    </div>
  );
}
