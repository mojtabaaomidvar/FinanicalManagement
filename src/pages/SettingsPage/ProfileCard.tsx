/* کارت پروفایل کاربر — آواتار (پیشنهادی/آپلود) + اطلاعات */

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
import { isoToJalali, jalaliToIso, parse, formatISO } from "@/shared/lib/jalali";
import { toEn } from "@/shared/lib/digits";

const PRESET_AVATARS = [
  "/avatars/m1.svg",
  "/avatars/m2.svg",
  "/avatars/m3.svg",
  "/avatars/f1.svg",
  "/avatars/f2.svg",
  "/avatars/f3.svg",
];

const MALE_AVATARS = PRESET_AVATARS.slice(0, 3);
const FEMALE_AVATARS = PRESET_AVATARS.slice(3);

export function ProfileCard() {
  const { member, useCases, updateMember } = useApp();
  const { show } = useToast();

  const [name, setName] = useState("");
  const [gender, setGender] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!member) return;
    setName(member.name);
    setGender(member.gender ?? "");
    setBirthDate(member.birthDate ? formatISO(isoToJalali(member.birthDate)) : "");
    setNationalId(member.nationalId ?? "");
    setAvatarUrl(member.avatarUrl);
  }, [member]);

  /* آواتارهای پیشنهادی بر اساس جنسیت (یا همه) */
  const suggestions = gender === "male" ? MALE_AVATARS : gender === "female" ? FEMALE_AVATARS : PRESET_AVATARS;

  async function save(overrides?: { avatarUrl?: string }) {
    setBusy(true);
    try {
      const parsedBirth = birthDate && parse(birthDate) ? jalaliToIso(parse(birthDate)!) : null;
      const updated = await useCases!.updateOwnProfile.execute({
        name: name.trim(),
        gender: gender ? (gender as "male" | "female") : null,
        birthDate: parsedBirth,
        nationalId: nationalId ? toEn(nationalId).replace(/\D/g, "") : null,
        avatarUrl: overrides?.avatarUrl ?? avatarUrl ?? null,
      });
      updateMember(updated);
      if (overrides?.avatarUrl) setAvatarUrl(overrides.avatarUrl);
      show("پروفایل ذخیره شد");
    } catch (e) {
      show((e as Error).message || "خطا در ذخیره پروفایل");
    } finally {
      setBusy(false);
    }
  }

  async function pickPreset(url: string) {
    await save({ avatarUrl: url });
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1024 * 1024) {
      show("عکس بزرگ است — حداکثر ۱ مگابایت");
      e.target.value = "";
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const url = await useCases!.uploadAvatar.execute(dataUrl);
      await save({ avatarUrl: url });
    } catch (err) {
      show((err as Error).message || "آپلود ناموفق بود");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("خواندن فایل ناموفق بود"));
      reader.readAsDataURL(file);
    });
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
            {member.role === "owner" ? "مدیر خانواده" : "عضو"}
            {member.phone ? ` · ${member.phone}` : ""}
          </p>
        </div>
      </div>

      <p className="form-note" style={{ textAlign: "right", marginBottom: 8 }}>
        آواتار پیشنهادی (بر اساس جنسیت) یا عکس خودتان:
      </p>
      <div className="avatar-picks">
        {suggestions.map((url) => (
          <button
            key={url}
            type="button"
            className={avatarUrl === url ? "active" : ""}
            onClick={() => pickPreset(url)}
            title="انتخاب این آواتار"
          >
            <img src={url} alt="" />
          </button>
        ))}
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
        {uploading ? "در حال آپلود…" : "آپلود عکس پروفایل"}
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
              pickerTitle="تاریخ تولد"
              minYear={1300}
              maxYear={new Date().getFullYear() - 621}
            />
          </Field>
        </div>
        <div className="form-row full">
          <Field label="کد ملی (اختیاری)">
            <TextInput
              value={nationalId}
              onChange={(v) => setNationalId(toEn(v).replace(/\D/g, "").slice(0, 10))}
              placeholder="۱۰ رقم"
              dir="ltr"
              inputMode="numeric"
            />
          </Field>
        </div>
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
