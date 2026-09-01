/* کارت اعضای خانواده — لیست + افزودن عضو توسط مدیر + حذف */

import { useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { Card, Field, Modal, TextInput } from "@/shared/ui";
import { normalizePhone } from "@/domain/auth/auth.rules";
import { toEn } from "@/shared/lib/digits";
import { InviteFeature } from "@/features/invite";

export function MembersCard() {
  const { member, members, family, useCases, refreshData } = useApp();
  const { show } = useToast();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  const isOwner = member?.role === "owner";

  async function addMember() {
    const p = normalizePhone(toEn(phone));
    if (!name.trim()) return show("نام عضو را وارد کنید");
    if (!p) return show("شماره موبایل معتبر نیست (۰۹xxxxxxxxx)");
    setBusy(true);
    try {
      await useCases!.addMemberByManager.execute(name.trim(), p);
      setOpen(false);
      setName("");
      setPhone("");
      show("عضو اضافه شد — با ثبت‌نام خودش فعال می‌شود");
      await refreshData();
    } catch (e) {
      show((e as Error).message || "خطا در افزودن عضو");
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(mId: string, mName: string) {
    if (!confirm(`«${mName}» از خانواده حذف شود؟`)) return;
    try {
      await useCases!.removeMember.execute(mId);
      show("حذف شد");
      await refreshData();
    } catch (e) {
      show((e as Error).message || "خطا در حذف");
    }
  }

  return (
    <Card
      title="اعضای خانواده"
      action={
        <span className="badge">
          {family ? `کد: ${family.code}` : "—"}
        </span>
      }
    >
      <div className="settings-members">
        {members.map((m) => (
          <div className="settings-member" key={m.id}>
            <span className="member-avatar">{m.name.charAt(0)}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h5>
                {m.name}
                {m.status === "pending" ? (
                  <span className="member-status-badge">در انتظار ثبت‌نام</span>
                ) : null}
              </h5>
              <p>
                {m.role === "owner" ? "مدیر خانواده" : "عضو"}
                {m.phone ? ` · ${m.phone}` : ""}
              </p>
            </div>
            {isOwner && m.role !== "owner" ? (
              <button
                type="button"
                className="member-remove-btn"
                onClick={() => removeMember(m.id, m.name)}
              >
                حذف
              </button>
            ) : null}
          </div>
        ))}
      </div>

      {isOwner ? (
        <>
          <button
            className="btn-primary btn-block"
            onClick={() => setOpen(true)}
            style={{ marginBottom: 12 }}
          >
            + افزودن عضو (نام و شماره)
          </button>
          <InviteFeature />
        </>
      ) : null}

      <Modal open={open} onClose={() => setOpen(false)} title="افزودن عضو جدید">
        <p className="modal-sub">
          فقط نام و شماره موبایل عضو را وارد کنید — عضو با ثبت‌نام خودش
          (با همین شماره) به‌صورت کامل به خانواده می‌پیوندد.
        </p>
        <div className="form-grid">
          <div className="form-row full">
            <Field label="نام عضو">
              <TextInput value={name} onChange={setName} autoFocus />
            </Field>
          </div>
          <div className="form-row full">
            <Field label="شماره موبایل">
              <TextInput
                value={phone}
                onChange={setPhone}
                placeholder="۰۹۱۲۳۴۵۶۷۸۹"
                dir="ltr"
                inputMode="tel"
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
    </Card>
  );
}
