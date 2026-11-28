import { useEffect, useState } from "react";
import history from "virtual:release-history";
import { RELEASE_COMPONENTS, type ReleaseComponent } from "@/domain/release-history/release-history";
import { COMPONENT_LABELS, ReleaseHistoryList } from "@/features/release-history/ReleaseHistoryList";
import { managementApi, type Overview } from "./api";

export function ReleaseHistoryPanel({ refresh }: { refresh: number }) {
  const [component, setComponent] = useState<ReleaseComponent>("pwa");
  const [status, setStatus] = useState<{ refresh: number; value?: Overview; failed?: boolean }>();
  useEffect(() => {
    const controller = new AbortController();
    void managementApi.get<Overview>("/state/overview", controller.signal)
      .then(value => { if (!controller.signal.aborted) setStatus({ refresh, value }); })
      .catch(() => { if (!controller.signal.aborted) setStatus({ refresh, failed: true }); });
    return () => controller.abort();
  }, [refresh]);
  const current = status?.refresh === refresh ? status : undefined;
  // Health's package version is not a verifiable API release identifier.
  const activeVersion = component === "pwa" ? current?.value?.software_version
    : component === "management" ? current?.value?.management_version : null;
  const releases = history.releases.filter(release => release.component === component);
  const found = activeVersion && releases.some(release => release.version === activeVersion);
  return <section className="mg-section" aria-labelledby="management-release-history-title">
    <h2 id="management-release-history-title">تغییرات نسخه‌ها</h2>
    <p className="mg-hint">یادداشت‌های همراه این ساخت پنل؛ وجود یک یادداشت به معنی نصب آن نسخه نیست.</p>
    <label htmlFor="management-history-component">بخش نرم‌افزار</label>
    <select id="management-history-component" value={component} onChange={event => setComponent(event.target.value as ReleaseComponent)}>
      {RELEASE_COMPONENTS.map(key => <option key={key} value={key}>{COMPONENT_LABELS[key]}</option>)}
    </select>
    {!current ? <p className="mg-hint" role="status">در حال بررسی نسخهٔ فعال؛ تاریخچه قابل‌مشاهده است.</p>
      : current.failed ? <p className="mg-hint" role="status">نسخهٔ فعال دریافت نشد؛ یادداشت‌های محلی همچنان در دسترس‌اند.</p>
      : <p className="mg-hint">نسخهٔ فعال: {activeVersion ? <bdi dir="ltr">{activeVersion}</bdi> : <span>نامشخص</span>}</p>}
    {activeVersion && !found ? <p className="mg-hint">یادداشت این نسخه در این ساخت موجود نیست.</p> : null}
    <ReleaseHistoryList key={component} releases={releases} activeVersion={activeVersion} technical management />
  </section>;
}
