/* کارت اعضای خانواده — لیست (نسبت + وضعیت) + افزودن عضو توسط مدیر */

import { useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { Card, Field, Modal, Select, TextInput } from "@/shared/ui";
import { normalizePhone } from "@/domain/auth/auth.rules";
import { MEMBER_RELATIONS } from "@/domain/family/family.types";
import { toEn } from "@/shared/lib/digits";
import { InviteFeature } from "@/features/invite";

export function MembersCard() {
  const { member, members, family, useCases, refreshData } = useApp();
  const { show } = useToast();

  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("");
  const [busy, setBusy] = useState(false);

  const isOwner = member?.role === "owner";

  async function addMember() {
    const p = normalizePhone(toEn(phone));
    if (!p) return show("شماره موبایل معتبر نیست (۰۹xxxxxxxxx)");
    if (!name.trim()) return show("نام عضو را وارد کنید");
    if (!relation) return show("نسبت عضو با شما را انتخاب کنید");
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
              <h5>{m.name}</h5>
              <p>
                {m.status === "pending" ? (
                  <span className="member-status-badge">
                    ثبت‌نام تکمیل نشده
                  </span>
                ) : m.role === "owner" ? (
                  "مدیر خانواده"
                ) : (
                  m.relation || "عضو"
                )}
                {m.phone ? ` · ${m.phone}` : ""}
              </p>
            </div>
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
            + افزودن عضو
          </button>
          <InviteFeature />
        </>
      ) : null}

      <Modal open={open} onClose={() => setOpen(false)} title="افزودن عضو جدید">
        <p className="modal-sub">
          شماره و نام عضو را وارد کنید — عضو با ثبت‌نام خودش (با همین شماره)
          به‌صورت کامل به خانواده می‌پیوندد.
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
            <Field label="نسبت با شما">
              <Select
                value={relation}
                onChange={setRelation}
                options={[
                  { value: "", label: "انتخاب کنید" },
                  ...MEMBER_RELATIONS.filter((r) => r !== "خودم").map((r) => ({
                    value: r,
                    label: r,
                  })),
                ]}
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
