import { useRef, useState } from "react";
import type { Settings } from "./api";
import { environmentLabels, secretKeys } from "./labels";
import { configurationTemplate, parseConfiguration, type ImportedConfiguration } from "./configuration.rules";
import { downloadBlob } from "./xlsx";

export function ConfigurationImport({ data, values, disabled, update }: {
  data: Settings; values: Record<string, string | boolean>; disabled: boolean;
  update: (key: string, value: string) => void;
}) {
  const [preview, setPreview] = useState<ImportedConfiguration | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const supported = (key: string) => !(key.startsWith("AI_") || key === "DEEPSEEK_API_KEY") || Boolean(data.ai_controls_supported);
  const clear = () => { generation.current++; setPreview(null); setSelected(new Set()); setBusy(false); };
  async function importFile(file: File | undefined) {
    clear(); setMessage("");
    if (!file || disabled) return;
    const current = generation.current;
    setBusy(true);
    try {
      if (file.size > 65536) throw new Error("حجم فایل تنظیمات باید کمتر از ۶۴ کیلوبایت باشد.");
      const parsed = parseConfiguration(await file.text());
      if (current !== generation.current) return;
      setPreview(parsed); setSelected(new Set(Object.keys(parsed.values).filter(supported)));
    } catch (error) {
      if (current === generation.current) setMessage(error instanceof Error ? error.message : "خواندن فایل تنظیمات انجام نشد.");
    } finally { if (current === generation.current) setBusy(false); }
  }
  function template(env: boolean) {
    const content = env ? Object.keys(environmentLabels).map(key => key + "=").join("\n") + "\n" : configurationTemplate();
    try { downloadBlob(new Blob([content], { type: env ? "text/plain;charset=utf-8" : "application/json;charset=utf-8" }), `khaneyar-sms-ai-template.${env ? "env" : "json"}`); }
    catch { setMessage("دریافت فایل نمونه انجام نشد؛ دوباره تلاش کنید."); }
  }
  return <section className="mg-section" aria-labelledby="mg-configuration-import-title">
    <div className="mg-section-heading"><h2 id="mg-configuration-import-title">ورود تنظیمات پیامک و AI از فایل</h2>
      <p>فایل JSON یا env با مقادیر واقعی خودتان را انتخاب کنید. فقط تنظیمات مجاز همین سرویس‌ها پذیرفته می‌شوند؛ فایل اجرا یا برای بررسی ارسال نمی‌شود.</p></div>
    <div className="mg-form-grid"><label>فایل تنظیمات JSON یا env<input type="file" accept=".json,.env,.txt,application/json,text/plain"
      disabled={disabled || busy} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void importFile(file); }} /></label></div>
    <div className="mg-actions"><button type="button" disabled={disabled || busy} onClick={() => template(false)}>دریافت نمونهٔ تنظیمات JSON</button>
      <button type="button" disabled={disabled || busy} onClick={() => template(true)}>دریافت نمونهٔ تنظیمات env</button></div>
    <p className="mg-hint">مقادیر خالی، حذف‌شده از فایل یا انتخاب‌نشده، مقدار فعلی را حفظ می‌کنند. انتخاب فایل چیزی را ذخیره نمی‌کند؛ ابتدا به فرم اضافه کنید و سپس تغییرها را بررسی و تأیید کنید. فایل می‌تواند کلید محرمانه داشته باشد؛ در مرورگر ذخیرهٔ ماندگار نمی‌شود.</p>
    <p className="mg-hint">قالب نمونه، مقدار پیش‌فرض تحمیل نمی‌کند. سرویس یا مدل تازه فقط در صورت پشتیبانی API قابل استفاده است؛ واردکردن نام ارائه‌دهندهٔ پیاده‌سازی‌نشده آن را فعال نمی‌کند.</p>
    {busy && <p role="status">در حال خواندن و بررسی فایل تنظیمات…</p>}
    {message && <p role="status">{message}</p>}
    {preview && <div role="region" aria-label="پیش‌نمایش ورود تنظیمات"><div className="mg-table-wrap"><table><thead><tr>
      <th>انتخاب</th><th>تنظیم</th><th>کلید فایل</th><th>مقدار فعلی</th><th>مقدار فایل</th>
    </tr></thead><tbody>{Object.entries(preview.values).map(([key, incoming]) => <tr key={key}>
      <td><input type="checkbox" aria-label={environmentLabels[key]} checked={selected.has(key)} disabled={disabled || !supported(key)}
        onChange={event => setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(key); else next.delete(key); return next; })} /></td>
      <th scope="row">{environmentLabels[key]}{!supported(key) && <p className="mg-hint">به API سازگار نیاز دارد.</p>}</th><td><bdi dir="ltr">{key}</bdi></td>
      <td>{secretKeys.has(key) ? (values[key] || data.environment[key] ? "کلید موجود است؛ نمایش داده نمی‌شود." : "کلیدی تنظیم نشده است.") : String(values[key] ?? "") || "بدون مقدار"}</td>
      <td>{secretKeys.has(key) ? "کلید تازه؛ نمایش داده نمی‌شود." : <bdi dir="ltr">{incoming}</bdi>}</td>
    </tr>)}</tbody></table></div>
      {preview.empty.length > 0 && <p className="mg-hint">فیلدهای خالی فایل کنار گذاشته شدند؛ مقادیر فعلی آن‌ها حفظ می‌شود.</p>}
      <div className="mg-actions"><button type="button" disabled={disabled || !selected.size} onClick={() => {
        for (const key of selected) update(key, preview.values[key]);
        clear(); setMessage("تنظیمات انتخاب‌شده به فرم اضافه شدند؛ هنوز ذخیره نشده‌اند. برای اعمال، تغییرها را بررسی و تأیید کنید.");
      }}>افزودن تنظیمات انتخاب‌شده به فرم</button><button type="button" onClick={() => { clear(); setMessage(""); }}>انصراف از ورود فایل</button></div>
    </div>}
  </section>;
}
