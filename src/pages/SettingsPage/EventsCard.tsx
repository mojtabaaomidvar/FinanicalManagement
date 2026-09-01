/* کارت رویدادهای مهم خانواده — ثبت/حذف */

import { useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import {
  Card,
  Field,
  JalaliDateInput,
  Modal,
  TextInput,
} from "@/shared/ui";
import {
  isoToJalali,
  jalaliToIso,
  parse,
  today,
  formatLong,
} from "@/shared/lib/jalali";

export function EventsCard() {
  const { events, useCases, refreshData } = useApp();
  const { show } = useToast();

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    try {
      const parsed = parse(date) ?? today();
      await useCases!.addEvent.execute({
        title: title.trim(),
        date: jalaliToIso(parsed),
        note: note.trim() || null,
      });
      setOpen(false);
      setTitle("");
      setDate("");
      setNote("");
      show("رویداد ثبت شد");
      await refreshData();
    } catch (e) {
      show((e as Error).message || "خطا در ثبت رویداد");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, eventTitle: string) {
    if (!confirm(`رویداد «${eventTitle}» حذف شود؟`)) return;
    try {
      await useCases!.deleteEvent.execute(id);
      show("حذف شد");
      await refreshData();
    } catch (e) {
      show((e as Error).message || "خطا در حذف");
    }
  }

  return (
    <Card
      title="رویدادهای مهم خانواده"
      action={
        <button className="link-btn" onClick={() => setOpen(true)}>
          + افزودن
        </button>
      }
    >
      {events.length ? (
        events.map((ev) => {
          const jd = isoToJalali(ev.date);
          return (
            <div className="event-item" key={ev.id}>
              <div className="event-date-badge">
                <b>{jd[2]}</b>
                <span>{formatLong(jd).split(" ")[1]}</span>
              </div>
              <div className="event-info">
                <h5>{ev.title}</h5>
                {ev.note ? <p>{ev.note}</p> : null}
                <p>{formatLong(jd)}</p>
              </div>
              <button
                type="button"
                className="icon-btn small danger"
                aria-label="حذف"
                onClick={() => remove(ev.id, ev.title)}
              >
                <svg>
                  <use href="#i-trash" />
                </svg>
              </button>
            </div>
          );
        })
      ) : (
        <p className="form-note">
          تولدها، سالگردها و مناسبت‌های مهم خانواده را ثبت کنید
        </p>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="رویداد جدید">
        <div className="form-grid">
          <div className="form-row full">
            <Field label="عنوان (مثلاً: تولد علی)">
              <TextInput value={title} onChange={setTitle} autoFocus />
            </Field>
          </div>
          <div className="form-row full">
            <Field label="تاریخ">
              <JalaliDateInput value={date} onChange={setDate} />
            </Field>
          </div>
          <div className="form-row full">
            <Field label="توضیح (اختیاری)">
              <TextInput value={note} onChange={setNote} />
            </Field>
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={() => setOpen(false)}>
            انصراف
          </button>
          <button className="btn-primary" disabled={busy} onClick={add}>
            {busy ? "…" : "ثبت"}
          </button>
        </div>
      </Modal>
    </Card>
  );
}
