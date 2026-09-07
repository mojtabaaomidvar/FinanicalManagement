/* کارت اعضای خانواده — لیست (نسبت + وضعیت) + افزودن عضو توسط مدیر
   ───────────────────────────────────────────────────────────────
   نسبت برای همه‌ی اعضا نمایش داده می‌شود؛ حتی اعضای pending که پیش‌تر
   فقط نشان «ثبت‌نام تکمیل نشده» می‌گرفتند و نسبتشان دیده نمی‌شد.
   لمس ردیف عضو، ویرایش نسبت را باز می‌کند (بدون دکمه‌ی جداگانه). */

import { useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { Card, Field, Modal, Select, TextInput } from "@/shared/ui";
import { normalizePhone } from "@/domain/auth/auth.rules";
import { MEMBER_RELATIONS, type Member } from "@/domain/family/family.types";
import { canEditRelation, relationLabel } from "@/domain/family/family.rules";
import { toEn } from "@/shared/lib/digits";
import { InviteFeature } from "@/features/invite";

/** گزینه‌های نسبت — «خودم» فقط مخصوص مدیر است و انتخاب‌شدنی نیست */
const RELATION_OPTIONS = [
  { value: "", label: "انتخاب کنید" },
  ...MEMBER_RELATIONS.filter((r) => r !== "خودم").map((r) => ({
    value: r,
    label: r,
  })),
];

export function MembersCard() {
  const { member, members, family, useCases, refreshData, updateMember } =
    useApp();
  const { show } = useToast();

  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("");
  const [busy, setBusy] = useState(false);

  /* ویرایش نسبت یک عضو */
  const [editing, setEditing] = useState<Member | null>(null);
  const [editRelation, setEditRelation] = useState("");

  const isOwner = member?.role === "owner";

  function openRelation(m: Member) {
    if (!canEditRelation(member, m)) return;
    setEditRelation(m.relation === "خودم" ? "" : (m.relation ?? ""));
    setEditing(m);
  }

  async function saveRelation() {
    if (!editing) return;
    if (!editRelation) return show("نسبت را انتخاب کنید");
    setBusy(true);
    try {
      const updated = await useCases!.setMemberRelation.execute(
        editing.id,
        editRelation,
      );
      /* updateMember هم member فعلی و هم ردیف متناظر در members را
         به‌روز می‌کند — refreshData هرگز member را تازه نمی‌کند */
      updateMember(updated);
      setEditing(null);
      show("نسبت ذخیره شد");
    } catch (e) {
      show((e as Error).message || "خطا در ذخیره نسبت");
    } finally {
      setBusy(false);
    }
  }

  async function addMember() {
    const p = normalizePhone(toEn(phone));
    if (!p) return show("شماره موبایل معتبر نیست (۰۹xxxxxxxxx)");
    if (!name.trim()) return show("نام عضو را وارد کنید");
    if (!relation) return show("نسبت عضو با مدیر خانواده را انتخاب کنید");
    setBusy(true);
    try {
      await useCases!.addMemberByManager.execute(name.trim(), p, relation);
      setOpen(false);
      setPhone("");
      setName("");
      setRelation("");
      show("عضو اضافه شد — با ثبت‌نام خودش فعال می‌شود");
      await refreshData();
    } catch (e) {
      show((e as Error).message || "خطا در افزودن عضو");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="اعضای خانواده"
      action={
        <span className="badge">{family ? `کد: ${family.code}` : "—"}</span>
      }
    >
      <div className="settings-members">
        {members.map((m) => {
          const editable = canEditRelation(member, m);
          return (
            <div
              className={`settings-member${editable ? " tappable" : ""}`}
              key={m.id}
              role={editable ? "button" : undefined}
              tabIndex={editable ? 0 : undefined}
              onClick={editable ? () => openRelation(m) : undefined}
              onKeyDown={
                editable
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openRelation(m);
                      }
                    }
                  : undefined
              }
            >
              <span className="member-avatar">{m.name.charAt(0)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h5>
                  {m.name}
                  {m.id === member?.id ? (
                    <span className="member-you">شما</span>
                  ) : null}
                </h5>
                <p>
                  {/* نسبت همیشه نمایش داده می‌شود — نشان pending در کنارش
                      می‌آید، نه به‌جایش */}
                  {relationLabel(m)}
                  {m.phone ? ` · ${m.phone}` : ""}
                  {m.status === "pending" ? (
                    <span className="member-status-badge">
                      ثبت‌نام تکمیل نشده
                    </span>
                  ) : null}
                </p>
              </div>
              {editable ? (
                <svg className="set-chev" aria-hidden="true">
                  <use href="#i-arrow-l" />
                </svg>
              ) : null}
            </div>
          );
        })}
      </div>

      {isOwner ? (
        <>
          <button
            className="btn-primary btn-block"
            onClick={() => setOpen(true)}
            style={{ marginBottom: 12 }}
          >
            + افزودن عضو
          </button>
          <InviteFeature />
        </>
      ) : null}

      <Modal open={open} onClose={() => setOpen(false)} title="افزودن عضو جدید">
        <p className="modal-sub">
          پس از تکمیل مشخصات عضو محترم خانواده‌تون در چارچوب فرم زیر، با تکمیل
          ثبت نام با همین شماره‌ای که معرفی میکنید ایشون به خانواده شما در نرم
          افزار اضافه میشن
        </p>
        <div className="form-grid">
          <div className="form-row full">
            <Field label="شماره موبایل عضو">
              <TextInput
                value={phone}
                onChange={setPhone}
                placeholder="۰۹۱۲۳۴۵۶۷۸۹"
                dir="ltr"
                inputMode="tel"
                autoFocus
              />
            </Field>
          </div>
          <div className="form-row full">
            <Field label="نام عضو">
              <TextInput value={name} onChange={setName} />
            </Field>
          </div>
          <div className="form-row full">
            <Field label="نسبت با مدیر خانواده">
              <Select
                value={relation}
                onChange={setRelation}
                options={RELATION_OPTIONS}
              />
            </Field>
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={() => setOpen(false)}>
            انصراف
          </button>
          <button className="btn-primary" disabled={busy} onClick={addMember}>
            {busy ? "…" : "افزودن"}
          </button>
        </div>
      </Modal>

      {/* ویرایش نسبت — با لمس خود ردیف عضو باز می‌شود */}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`نسبت ${editing?.name ?? ""}`}
      >
        <p className="modal-sub">
          نسبت همیشه نسبت به مدیر خانواده سنجیده می‌شود — نه نسبت به کسی که آن
          را می‌بیند.
        </p>
        <div className="form-grid">
          <div className="form-row full">
            <Field label="نسبت با مدیر خانواده">
              <Select
                value={editRelation}
                onChange={setEditRelation}
                options={RELATION_OPTIONS}
              />
            </Field>
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={() => setEditing(null)}>
            انصراف
          </button>
          <button
            className="btn-primary"
            disabled={busy}
            onClick={() => void saveRelation()}
          >
            {busy ? "…" : "ذخیره"}
          </button>
        </div>
      </Modal>
    </Card>
  );
}
