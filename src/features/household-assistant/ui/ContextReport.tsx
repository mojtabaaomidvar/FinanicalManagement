import type { ContextFact, ContextRow, ContextSection, HouseholdSection, JsonValue } from "@/domain/assistant/contextual.types";
import { toFa } from "@/shared/lib/digits";

export const SECTION_LABELS: Record<HouseholdSection, string> = {
  inventory: "انبار خانه", shopping: "لیست‌های خرید", meals: "غذاها و برنامهٔ غذایی", tasks: "کارهای خانه",
  events: "تقویم", equipment: "وسایل و نگهداری", vehicles: "خودرو و سرویس", bills: "قبوض",
  finance: "اطلاعات مالی مجاز", goals: "هدف‌ها", activities: "فعالیت‌ها", children: "فرزندان",
  pets: "حیوانات خانگی", documents: "اطلاعات نمایشی اسناد", holdings: "دارایی‌ها", market: "قیمت‌های ذخیره‌شدهٔ بازار",
};
const STATUS_LABELS = {
  ok: "بررسی شد", empty: "در این محدوده رکوردی نیست", limited: "پوشش محدود؛ نتیجه کامل نیست",
  forbidden: "اجازهٔ مشاهده ندارید", unavailable: "دریافت اطلاعات ممکن نشد",
};
const FOOD_LABELS = {
  available: "مقدار ثبت‌شده کافی است", missing: "مواد ثبت‌شده کافی نیست", unknown: "امکان تهیه روشن نیست",
};
const FIELD_LABELS: Record<string, string> = {
  title: "عنوان", name: "نام", quantity: "موجودی ثبت‌شده", qty: "مقدار", amount: "مبلغ ثبت‌شده به تومان",
  initial_balance: "موجودی اولیه به تومان", date: "تاریخ", due_date: "موعد", note: "توضیح",
  description: "توضیح", unit: "واحد", location: "محل", brand: "برند", model: "مدل",
  odometer: "کیلومتر ثبت‌شده", warranty_until: "پایان ضمانت", insurance_until: "پایان بیمه",
  inspection_until: "معاینهٔ فنی تا", service_due_date: "موعد سرویس", target_date: "روز هدف",
  expiry_date: "تاریخ انقضا", price: "قیمت ذخیره‌شده", cached_at: "زمان ذخیرهٔ قیمت",
  age_years: "سن ثبت‌شده", species: "نوع حیوان", birth_date: "روز تولد", performed_on: "روز سرویس",
  next_due_date: "سرویس بعدی", cost_amount: "هزینهٔ ثبت‌شده به تومان",
};

function scalar(value: JsonValue): value is string | number { return typeof value === "string" || typeof value === "number"; }
export function ContextRows({ rows }: { rows: ContextRow[] }) {
  return <ul className="assistant-source-rows">{rows.map((row, index) => <li key={String(row.id ?? index)}>
    <dl>{Object.entries(row).filter(([key, value]) => FIELD_LABELS[key] && scalar(value)).map(([key, value]) =>
      <div key={key}><dt>{FIELD_LABELS[key]}</dt><dd><bdi>{typeof value === "number" ? toFa(value) : String(value)}</bdi></dd></div>)}</dl>
    {typeof row.completed === "boolean" ? <p>{row.completed ? "کار انجام شده" : "کار باز"}</p> : null}
    {typeof row.stale === "boolean" && row.stale ? <p>قیمت ذخیره‌شده قدیمی است؛ قیمت روز نیست.</p> : null}
    {row.meal_type ? <p>{row.meal_type === "breakfast" ? "صبحانه" : row.meal_type === "lunch" ? "ناهار" : "شام"}</p> : null}
    {Object.entries(row).filter(([, value]) => Array.isArray(value) || value && typeof value === "object").map(([key, value]) =>
      <ContextRows key={key} rows={(Array.isArray(value) ? value : [value]).filter(item => item && typeof item === "object" && !Array.isArray(item)) as ContextRow[]} />)}
  </li>)}</ul>;
}

export function ContextSources({ sections }: { sections: ContextSection[] }) {
  return <section className="assistant-results"><h4>بخش‌های بررسی‌شده</h4>
    <p>مبنا اطلاعات ثبت‌شدهٔ همین بررسی است، نه مشاهدهٔ موجودی فیزیکی یا وضعیت زندهٔ خانه.</p>
    {sections.map(source => <details key={source.section} className="assistant-proposal">
      <summary>{SECTION_LABELS[source.section]} · {STATUS_LABELS[source.status]}</summary>
      <p>تاریخ مبنا: <bdi>{toFa(source.reference_date)}</bdi></p>
      <p>رکوردها و بازهٔ خواندن محدودند؛ نبود رکورد، به معنی نبودن آن در خانه نیست.</p>
      <ContextRows rows={source.rows} />
    </details>)}
  </section>;
}

export function GroundedFinding({ fact }: { fact: ContextFact }) {
  if (fact.kind === "section") return <article className="assistant-proposal">
    <strong>{SECTION_LABELS[fact.section]}</strong><p>{STATUS_LABELS[fact.status]}</p><ContextRows rows={fact.rows} />
  </article>;
  if (fact.kind === "stock") return <article className="assistant-proposal">
    <strong>{fact.title}</strong>
    <p>{fact.status === "unknown" ? "موجودی ثبت‌نشده یا نامعلوم است؛ صفر فرض نمی‌کنیم." : fact.status === "missing" ? "موجودی ثبت‌شده صفر است." : "موجودی ثبت‌شده مثبت است."}</p>
    {fact.conflicts_with_request ? <p className="assistant-review-note">گفتهٔ شما با رکورد مثبت اختلاف دارد؛ پیش از تصمیم، موجودی واقعی را روشن کنید. انبار را خودکار تغییر نمی‌دهیم.</p> : null}
    <ContextRows rows={fact.rows} />
  </article>;
  return <article className="assistant-proposal"><strong>{fact.title}</strong><p>{FOOD_LABELS[fact.status]}</p>
    <p>مقایسه برای مقدار دستور ثبت‌شده است؛ تعداد نفرات یا مناسب‌بودن قطعی برای صبحانه فرض نشده است.</p>
    {!fact.ingredients.length ? <p>مواد لازم این غذا ثبت نشده‌اند.</p> : <ul>{fact.ingredients.map((ingredient, index) => <li key={index}>
      <bdi>{ingredient.title}</bdi> · {ingredient.status === "available" ? "کافی" : ingredient.status === "missing" ? "کسری ثبت‌شده" : "مقدار یا واحد نامعلوم"}
      {ingredient.shortage !== null && ingredient.status === "missing" ? <>: <bdi>{toFa(ingredient.shortage)} {ingredient.unit}</bdi></> : null}
    </li>)}</ul>}
    {fact.planned.length ? <><p>وعده‌های ثبت‌شدهٔ این غذا</p><ContextRows rows={fact.planned} /></> : <p>در هفتهٔ بررسی‌شده، وعده‌ای برای این غذا ثبت نشده است.</p>}
  </article>;
}
