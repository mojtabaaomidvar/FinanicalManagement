import history from "virtual:release-history";
import { NOTE_GROUPS, noteCopyId, summaryCopyId, type DisplayRelease } from "@/domain/release-history/release-history";
import "./release-history.css";

const GROUP_LABELS = { features: "قابلیت‌های تازه", improvements: "بهبودها", fixes: "رفع اشکال‌ها" };
export const COMPONENT_LABELS = { pwa: "برنامهٔ خانه‌یار", api: "API برنامه", management: "پنل مدیریت" };

const ReleaseText = ({ id, text }: { id: string; text: string }) => {
  if (import.meta.env.MODE === "copy-workbench") {
    const source = history.sources[id];
    return <span data-copy-sources={source ? JSON.stringify([source]) : undefined}>{text}</span>;
  }
  return <span>{text}</span>;
};

function ReleaseDate({ release }: { release: DisplayRelease }) {
  return release.released_on ? <time dateTime={release.released_on}>
    {new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeZone: "UTC" })
      .format(new Date(release.released_on + "T12:00:00Z"))}
  </time> : <span className="release-history-hint">تاریخ انتشار ثبت نشده</span>;
}

function PublicReleaseEntry({ release, activeVersion }: { release: DisplayRelease; activeVersion?: string | null }) {
  const titleId = `release-history-${release.id}`;
  return <section className="release-history-entry" data-release-id={release.id} aria-labelledby={titleId}>
    <header className="release-history-entry-heading">
      <h3 id={titleId}>نسخهٔ <bdi dir="ltr">{release.version}</bdi></h3>
      {release.version === activeVersion ? <small>نسخهٔ این برنامه</small> : null}
    </header>
    <ReleaseDate release={release} />
    <div className="release-history-notes">
      {release.user_notes ? <ul>
        <li><ReleaseText id={summaryCopyId(release.id)} text={release.user_notes.summary} /></li>
        {NOTE_GROUPS.flatMap(group => release.user_notes![group]).map(note => <li key={note.id}>
          <ReleaseText id={noteCopyId(release.id, note.id)} text={note.text} />
        </li>)}
      </ul> : null}
      {release.notes_status === "partial" ? <p className="release-history-hint">یادداشت‌های این نسخه کامل نیست؛ فقط تغییرات تأییدشده نمایش داده می‌شوند.</p> : null}
    </div>
  </section>;
}

export function ReleaseHistoryList({ releases, activeVersion, technical = false, management = false }: {
  releases: DisplayRelease[]; activeVersion?: string | null; technical?: boolean; management?: boolean;
}) {
  if (!releases.length) return <p className="release-history-hint">هنوز یادداشت نسخه‌ای در این ساخت موجود نیست.</p>;
  return <div className={`release-history-list${management ? "" : " release-history-list--plain"}`} dir="rtl">
    {releases.map(release => management ? <details className="release-history-entry" key={release.id}
      data-release-id={release.id} open={release.version === activeVersion}>
      <summary><span className="release-history-version"><bdi dir="ltr">{release.version}</bdi>
        {release.version === activeVersion ? <small>نسخهٔ فعال</small> : null}</span>
        <ReleaseDate release={release} />
      </summary>
      <div className="release-history-notes">
        {release.user_notes ? <>
          <p><ReleaseText id={summaryCopyId(release.id)} text={release.user_notes.summary} /></p>
          {NOTE_GROUPS.map(group => release.user_notes![group].length ? <section key={group}>
            <h4>{GROUP_LABELS[group]}</h4>
            <ul>{release.user_notes![group].map(note => <li key={note.id}>
              <ReleaseText id={noteCopyId(release.id, note.id)} text={note.text} />
            </li>)}</ul>
          </section> : null)}
        </> : null}
        {release.notes_status === "partial" ? <p className="release-history-hint">یادداشت‌های این نسخه کامل نیست؛ فقط تغییرات تأییدشده نمایش داده می‌شوند.</p> : null}
        {technical && release.technical_notes?.length ? <section>
          <h4>یادداشت فنی</h4><ul>{release.technical_notes.map(note => <li key={note.id}>
            <ReleaseText id={noteCopyId(release.id, note.id)} text={note.text} />
          </li>)}</ul>
        </section> : null}
      </div>
    </details> : <PublicReleaseEntry key={release.id} release={release} activeVersion={activeVersion} />)}
  </div>;
}
