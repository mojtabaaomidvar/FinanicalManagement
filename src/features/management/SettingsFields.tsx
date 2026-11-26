import type { ReactNode } from "react";
import type { Settings } from "./api";
import { environmentLabels, featureLabels, secretKeys } from "./labels";
import { numericSettings } from "./configuration.rules";

export const settingsValues = (data: Settings): Record<string, string | boolean> => ({
  ...data.flags,
  ...Object.fromEntries(Object.keys(featureLabels).map(key => ["feature_" + key, data.features?.[key] ?? "enabled"])),
  ...Object.fromEntries(Object.keys(environmentLabels).filter(key => !secretKeys.has(key)).map(key =>
    [key, data.environment[key] || numericSettings[key]?.default || (key === "AI_CONNECTION_MODE" ? "auto" : "")])),
});

type Props = {
  data: Settings; values: Record<string, string | boolean>; readOnly: boolean;
  update: (key: string, value: string | boolean) => void;
};

const Group = ({ title, note, children }: { title: string; note: string; children: ReactNode }) =>
  <section className="mg-section"><div className="mg-section-heading"><h2>{title}</h2><p>{note}</p></div>{children}</section>;

export function FeatureSettings({ data, values, readOnly, update }: Props) {
  return <Group title="پیکربندی امکانات" note="این کنترل‌ها دسترسی آنلاین را تغییر می‌دهند. اطلاعات قبلی حذف نمی‌شوند؛ نسخهٔ آفلاین دستگاه تا اتصال و همگام‌سازی از تغییر تازه آگاه نمی‌شود.">
    {!data.feature_controls_supported && <p className="mg-error" role="status">کنترل جداگانهٔ امکانات به نصب API سازگار و اتصال مدیریت نیاز دارد.</p>}
    {data.feature_controls_supported && <p className="mg-hint" role="status">{data.runtime_applied ? "اعمال کنترل‌های دسترسی در API تأیید شده است." : "تنظیمات ذخیره‌شده هنوز در API تأیید نشده‌اند؛ اتصال مدیریت را بررسی کنید."}</p>}
    <div className="mg-form-grid">{Object.entries(featureLabels).map(([key, label]) => <label key={key}><span id={`mg-feature-${key}`}>{label}</span>
      <select aria-labelledby={`mg-feature-${key}`} value={String(values["feature_" + key])} onChange={event => update("feature_" + key, event.target.value)}
        disabled={readOnly || !data.feature_controls_supported}>
        <option value="enabled">فعال</option><option value="read_only">فقط‌خواندنی</option><option value="disabled">غیرفعال</option>
      </select></label>)}</div>
    <p className="mg-muted">تغییرهای آفلاین پس از اتصال و اقدام‌های تأییدشدهٔ دستیار نیز با وضعیت فعلی بخش بررسی می‌شوند. ورود، خروج، پشتیبانی و مسیرهای مستقل دریافت و حذف داده مسدود نمی‌شوند.</p>
  </Group>;
}

export function ConnectionSettings({ data, values, readOnly, update }: Props) {
  return <Group title="پیامک و دستیار" note="کلیدهای ذخیره‌شده نمایش داده نمی‌شوند. فیلدهای بدون تغییر حفظ می‌شوند.">
    {!data.ai_controls_supported && <p className="mg-hint">تنظیمات دستیار و سقف‌های مصرف پس از نصب API سازگار فعال می‌شوند.</p>}
    {data.ai_controls_supported && <p className="mg-hint" role="status">{data.ai_configuration_applied ? "اعمال تنظیمات اتصال هوش مصنوعی در API تأیید شده است." : "اعمال تنظیمات ذخیره‌شدهٔ هوش مصنوعی هنوز تأیید نشده است؛ اتصال مدیریت را بررسی کنید."}</p>}
    <div className="mg-form-grid">{Object.entries(environmentLabels).map(([key, label]) => {
      const numeric = numericSettings[key];
      const aiSetting = key.startsWith("AI_") || key === "DEEPSEEK_API_KEY";
      const disabled = readOnly || (aiSetting && !data.ai_controls_supported);
      return <label key={key}><span id={`mg-setting-${key}`}>{label}</span>{secretKeys.has(key) ? <><input aria-labelledby={`mg-setting-${key}`} type="password" autoComplete="new-password" value={String(values[key] ?? "")} onChange={event => update(key, event.target.value)} disabled={disabled} placeholder={data.environment[key] ? "کلید تنظیم شده؛ برای تغییر بنویسید" : "کلیدی تنظیم نشده است"} dir="ltr" /><span className="mg-hint">{data.environment[key] ? "کلید فعلی موجود است." : "این اتصال هنوز کلید ندارد."}</span></>
        : key === "AI_CONNECTION_MODE" ? <select aria-labelledby={`mg-setting-${key}`} value={String(values[key])} onChange={event => update(key, event.target.value)} disabled={disabled}>
          <option value="auto">خودکار؛ درگاه در صورت تنظیم</option><option value="direct">اتصال مستقیم DeepSeek</option>
          <option value="gateway">درگاه خصوصی فعلی</option><option value="disabled">توقف اتصال هوش مصنوعی</option>
        </select>
          : key === "SMS_PROVIDER" ? <select aria-labelledby={`mg-setting-${key}`} value={String(values[key] ?? "")} onChange={event => update(key, event.target.value)} disabled={disabled}><option value="">غیرفعال</option><option value="kavenegar">کاوه‌نگار</option></select>
            : <input aria-labelledby={`mg-setting-${key}`} type={numeric ? "number" : key === "AI_SMS_GATEWAY_URL" ? "url" : "text"} maxLength={1024}
              required={Boolean(numeric)} min={numeric?.min} max={numeric?.max} step={numeric ? 1 : undefined}
              value={String(values[key] ?? "")} onChange={event => update(key, event.target.value)} disabled={disabled} dir="ltr" />}</label>;
    })}</div>
    <p className="mg-muted">صفر در سقف روزانه و هم‌زمان یعنی بدون سقف افزوده. هر تلاش اتصال AI، از جمله تلاش ناموفق، سهم روزانه دارد؛ گزارش چندمرحله‌ای می‌تواند بیش از یک سهم مصرف کند. روز از نیمه‌شب تهران شروع می‌شود.</p>
    <p className="mg-muted">سرویس فعلی DeepSeek است. در حالت درگاه، مدل، کلید سرویس و سقف خروجی در خود درگاه تنظیم می‌شوند؛ کلید اتصال درگاه با کلید سرویس تفاوت دارد. تغییر مدل و کلید این فرم برای اتصال مستقیم است.</p>
  </Group>;
}
