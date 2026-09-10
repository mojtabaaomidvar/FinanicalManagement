/* کارت پروفایل کاربر — آواتار (پیشنهادی/آپلود) + اطلاعات
   ────────────────────────────────────────────────────
   نسبت کاربر با مدیر خانواده هم اینجا دیده می‌شود؛ چه مدیر باشد چه عضو
   عادی. عضو عادی می‌تواند نسبت خودش را اصلاح کند، نسبت مدیر ثابت است. */

import { useEffect, useRef, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import {
  Card,
  Field,
  JalaliDateInput,
  Select,
  TextInput,
} from "@/shared/ui";
import { MEMBER_RELATIONS } from "@/domain/family/family.types";
import { canEditRelation, relationLabel } from "@/domain/family/family.rules";
import { isoToJalali, jalaliToIso, parse, formatISO } from "@/shared/lib/jalali";
import { compressImage } from "@/shared/lib/image";

export function ProfileCard() {
  const { member, useCases, updateMember } = useApp();
  const { show } = useToast();

  const [name, setName] = useState("");
  const [gender, setGender] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [relation, setRelation] = useState("");
  const [busy, setBusy] = useState(false);
  const [savingRelation, setSavingRelation] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!member) return;
    setName(member.name);
    setGender(member.gender ?? "");
    setBirthDate(member.birthDate ? formatISO(isoToJalali(member.birthDate)) : "");
    setAvatarUrl(member.avatarUrl);
    setRelation(member.relation === "خودم" ? "" : (member.relation ?? ""));
  }, [member]);

  /** نسبت جدا از بقیه‌ی پروفایل ذخیره می‌شود چون RPC و مجوز جداگانه دارد
      (update_own_profile نسبت را دست نمی‌زند) */
  async function saveRelation(next: string) {
    if (!member || !next || next === member.relation) return;
    setRelation(next);
    setSavingRelation(true);
    try {
      const updated = await useCases!.setMemberRelation.execute(
        member.id,
        next,
      );
      updateMember(updated);
      show("نسبت ذخیره شد");
    } catch (e) {
      /* برگرداندن به مقدار سرور تا نمایش با واقعیت نخواند */
      setRelation(member.relation === "خودم" ? "" : (member.relation ?? ""));
      show((e as Error).message || "خطا در ذخیره نسبت");
    } finally {
      setSavingRelation(false);
    }
  }

  async function save(overrides?: { avatarUrl?: string }) {
    setBusy(true);
    try {
      const parsedBirth = birthDate && parse(birthDate) ? jalaliToIso(parse(birthDate)!) : null;
      const updated = await useCases!.updateOwnProfile.execute({
        name: name.trim(),
        gender: gender ? (gender as "male" | "female") : null,
        birthDate: parsedBirth,
        avatarUrl: overrides?.avatarUrl ?? avatarUrl ?? null,
      });
      updateMember(updated);
      if (overrides?.avatarUrl) setAvatarUrl(overrides.avatarUrl);

      /* همگام‌سازی رویداد تولد با تاریخ تولد جدید */
      try {
        await useCases!.syncBirthdays.execute();
      } catch {
        /* بی‌صدا */
      }

      show("پروفایل ذخیره شد");
    } catch (e) {
      show((e as Error).message || "خطا در ذخیره پروفایل");
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      /* فشرده‌سازی سمت کلاینت: بزرگ‌ترین ضلع ۵۱۲px → JPEG ~90% */
      const dataUrl = await compressImage(file, 512);
      const url = await useCases!.uploadAvatar.execute(dataUrl);
      await save({ avatarUrl: url });
    } catch (err) {
      show((err as Error).message || "آپلود ناموفق بود");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (!member) return null;

  return (
    <Card title="پروفایل من">
      <div className="profile-head">
        <div className="profile-avatar">
          {avatarUrl ? (
            <img src={avatarUrl} alt={member.name} />
          ) : (
            <svg>
              <use href="#i-users" />
            </svg>
          )}
        </div>
        <div>
          <h4>{member.name}</h4>
          <p>
            {/* نسبت خود کاربر با مدیر خانواده — برای مدیر «مدیر خانواده» */}
            {relationLabel(member)}
            {member.phone ? ` · ${member.phone}` : ""}
          </p>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        style={{ display: "none" }}
        onChange={onFile}
      />
      <button
        type="button"
        className="upload-btn"
        disabled={uploading}
        onClick={() => fileRef.current?.click()}
        style={{ marginBottom: 16 }}
      >
        {uploading ? "در حال آپلود…" : "انتخاب عکس پروفایل"}
      </button>

      <div className="form-grid">
        <div className="form-row full">
          <Field label="نام">
            <TextInput value={name} onChange={setName} placeholder="نام شما" />
          </Field>
        </div>
        <div className="form-row">
          <Field label="جنسیت">
            <Select
              value={gender}
              onChange={setGender}
              options={[
                { value: "", label: "انتخاب کنید" },
                { value: "male", label: "مرد" },
                { value: "female", label: "زن" },
              ]}
            />
          </Field>
        </div>
        <div className="form-row">
          <Field label="تاریخ تولد (اختیاری)">
            <JalaliDateInput
              value={birthDate}
              onChange={setBirthDate}
              minYear={1300}
              maxYear={new Date().getFullYear() - 621}
            />
          </Field>
        </div>
        {/* نسبت با مدیر خانواده — برای مدیر معنا ندارد و نشان داده نمی‌شود.
            بی‌درنگ ذخیره می‌شود، چون RPC جدا از ذخیره پروفایل است */}
        {canEditRelation(member, member) ? (
          <div className="form-row full">
            <Field label="نسبت من با مدیر خانواده">
              <Select
                value={relation}
                onChange={(v) => void saveRelation(v)}
                disabled={savingRelation}
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
        ) : null}
      </div>

      <button
        className="btn-primary btn-block"
        disabled={busy}
        onClick={() => save()}
        style={{ marginTop: 8 }}
      >
        {busy ? "…" : "ذخیره پروفایل"}
      </button>
    </Card>
  );
}
