import type { Overview } from "./api";

export function InstalledVersions({ data }: { data: Overview }) {
  return <>
    <div><dt>نسخهٔ برنامه</dt><dd>{data.software_version ? <bdi dir="ltr">{data.software_version}</bdi> : <span className="mg-hint">نامشخص</span>}</dd></div>
    <div><dt>نسخهٔ اعلامی API</dt><dd><bdi dir="ltr">{data.api_version || data.version || "—"}</bdi></dd></div>
    <div><dt>نسخهٔ پنل مدیریت</dt><dd>{data.management_version ? <bdi dir="ltr">{data.management_version}</bdi> : <span className="mg-hint">نامشخص</span>}</dd></div>
  </>;
}
