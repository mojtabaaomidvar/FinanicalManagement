import { useApp } from "@/app/providers/AppProvider";
import type { usePendingSmsModel } from "@/features/pending-sms/model/usePendingSmsModel";
import { SmsImportFeature } from "@/features/sms-import";
import { Icon } from "@/shared/ui";
import { smsAmountInToman } from "@/domain/sms/sms.rules";
import { currencyDisplayLabel } from "@/shared/lib/uiLabels";
import { formatAmount, formatAccountAmount } from "@/shared/lib/format";
import { formatLong, isoToJalali } from "@/shared/lib/jalali";
import "./SmsPage.css";

export function SmsPage({ model: m, onImported }: {
  model: ReturnType<typeof usePendingSmsModel>; onImported: () => Promise<void>;
}) {
  const { member, cur } = useApp();
  return <section className="page active sms-page">
    <header className="app-header"><div className="header-title"><h1>پیامک‌های بانکی</h1>
      <p>ثبت‌های ناتمام را هر وقت خواستی ادامه بده</p></div>
      <div className="header-actions"><SmsImportFeature onImported={onImported} /></div>
    </header>
    <div className="sms-page-content">
      <div className="sms-inbox-head"><h2>پیامک‌های ثبت‌نشده</h2>
        <button type="button" className="icon-btn" aria-label="دریافت دوباره پیامک‌ها" disabled={m.loading || m.busy} onClick={() => void m.load()}>
          <Icon name="i-repeat" size={20} /></button>
      </div>
      <p className="section-hint">پیامک‌ها تا ثبت نهایی یا نادیده‌گرفتن در این فهرست باقی می‌مانند.</p>
      {m.loading ? <p role="status" className="section-hint">در حال دریافت پیامک‌ها…</p> : null}
      {m.loadError ? <div role="alert" className="sms-inbox-error"><p>{m.loadError}</p>
        <button type="button" className="btn-secondary" onClick={() => void m.load()}>تلاش دوباره</button></div> : null}
      {!m.loading && !m.loadError && !m.list.length ? <p className="sms-inbox-empty">پیامک ثبت‌نشده‌ای نداری؛ از دکمهٔ بالای صفحه متن پیامک را وارد کن.</p> : null}
      <div className="sms-inbox-list">{m.list.map(sms => {
        const baseAmount = smsAmountInToman(sms.rawText, sms.amount);
        return <button key={sms.id} type="button" className="sms-inbox-row" disabled={m.busy || m.loading}
          data-sms-id={sms.id} onClick={() => void m.load({ review: true, smsId: sms.id })}>
          <span className="sms-inbox-icon" aria-hidden="true"><Icon name="i-sms" size={20} /></span>
          <span className="sms-inbox-copy"><b>{sms.bank ?? "بانک نامشخص"}<span> · </span>{sms.type === "income" ? "واریز" : sms.type === "expense" ? "برداشت" : "نیازمند بررسی"}</b>
            <span>{baseAmount === null ? sms.amount === null ? "مبلغ نامشخص" : formatAmount(sms.amount) : formatAccountAmount(baseAmount, cur)}
              <span> </span>{baseAmount === null ? "واحد نامشخص" : currencyDisplayLabel(cur)}<span> · </span>
              {sms.date ? formatLong(isoToJalali(sms.date)) : "بدون تاریخ"}<span> · </span>{member?.name}</span></span>
          <Icon name="i-arrow-l" size={17} />
        </button>;
      })}</div>
    </div>
  </section>;
}
