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

  /** resize + فشرده‌سازی عکس با canvas — خروجی JPEG dataURL */
  function compressImage(file: File, maxSide: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("پردازش تصویر ممکن نیست"));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.9));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("خواندن عکس ناموفق بود"));
      };
      img.src = url;
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
