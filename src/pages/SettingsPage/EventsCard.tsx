/* کارت رویدادهای مهم خانواده — ثبت/حذف + گزینه‌های پیشنهادی */

import { useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import {
  Card,
  Field,
  JalaliDateInput,
  Modal,
  Select,
  TextInput,
} from "@/shared/ui";
import {
  isoToJalali,
  jalaliToIso,
  parse,
  today,
  formatLong,
} from "@/shared/lib/jalali";

/** رویدادهای رایج خانواده‌های ایرانی — قابل انتخاب یا تایپ دلخواه */
const EVENT_PRESETS = [
  "تولد",
  "سالگرد ازدواج",
  "ورود به مدرسه",
  "فارغ‌التحصیلی",
  "جشن نامزدی",
  "خرید خانه",
  "شروع کار",
  "بازنشستگی",
] as const;

export function EventsCard() {
  const { events, members, useCases, refreshData, member } = useApp();
  const { show } = useToast();

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [forMemberId, setForMemberId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const activeMembers = members.filter((m) => m.status === "active");
  const memberNameOf = (id: string | null) =>
    id ? activeMembers.find((m) => m.id === id)?.name ?? null : null;

  async function add() {
    setBusy(true);
    try {
      const parsed = parse(date) ?? today();
      await useCases!.addEvent.execute({
        title: title.trim(),
        date: jalaliToIso(parsed),
        note: note.trim() || null,
        forMemberId: forMemberId || null,
      });
      setOpen(false);
      setTitle("");
      setDate("");
      setForMemberId("");
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
      const msg = (e as Error).message || "خطا در حذف";
      if (/یافت نشد/.test(msg)) {
        show("فقط مدیر یا سازنده رویداد می‌تواند آن را حذف کند");
      } else {
        show(msg);
      }
    }
  }

  /* مدیر: رویدادِ متعلق به دیگری را نمی‌تواند بزند جز خودش — حذف عادی کار می‌کند */
  const canDelete = (ev: { memberId: string | null }) =>
    member?.role === "owner" || ev.memberId === member?.id;

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
          const forName = memberNameOf(ev.forMemberId);
          return (
            <div className="event-item" key={ev.id}>
              <div className="event-date-badge">
                <b>{jd[2]}</b>
                <span>{formatLong(jd).split(" ")[1]}</span>
              </div>
              <div className="event-info">
                <h5>{ev.title}</h5>
                {forName && !ev.title.includes(forName) ? (
                  <span className="event-member">
                    <i>{forName.charAt(0)}</i>
                    {forName}
                  </span>
                ) : null}
                {ev.note ? <p>{ev.note}</p> : null}
                <p>{formatLong(jd)}</p>
              </div>
              {canDelete(ev) ? (
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
              ) : null}
            </div>
          );
        })
      ) : (
        <p className="form-note">
          تولدها، سالگردها و مناسبت‌های مهم خانواده را ثبت کنید
        </p>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="رویداد جدید">
        {/* گزینه‌های پیشنهادی */}
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

        <div className="form-grid">
          <div className="form-row full">
            <Field label="عنوان">
              <TextInput value={title} onChange={setTitle} autoFocus />
            </Field>
          </div>
          <div className="form-row full">
            <Field label="تاریخ">
              <JalaliDateInput value={date} onChange={setDate} />
            </Field>
          </div>
          {activeMembers.length ? (
            <div className="form-row full">
              <Field label="متعلق به کدام عضو؟ (اختیاری)">
                <Select
                  value={forMemberId}
                  onChange={setForMemberId}
                  options={[
                    { value: "", label: "بدون عضو خاص" },
                    ...activeMembers.map((m) => ({
                      value: m.id,
                      label: m.name,
                    })),
                  ]}
                />
              </Field>
            </div>
          ) : null}
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
