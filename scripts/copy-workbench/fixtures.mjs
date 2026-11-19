import { randomUUID } from 'node:crypto';

function samplePdfBytes() {
  const stream = '0.95 0.97 0.95 rg 0 0 640 420 re f\n0.12 0.28 0.24 rg\nBT /F1 24 Tf 120 220 Td (Sample household document) Tj ET\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 640 420] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
  ];
  let document = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(document)); document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(document);
  document += 'xref\n0 6\n0000000000 65535 f \n' + offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('');
  document += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(document);
}
const samplePdf = samplePdfBytes();
const samplePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHqkAAAAASUVORK5CYII=', 'base64');

/** Fictional, in-memory API for the copy workbench. No network or database access. */
export const SCENARIOS = [
  { id: 'full-owner', label: 'اطلاعات کامل · مدیر خانواده', role: 'owner', mode: 'full', description: 'همهٔ بخش‌ها با نمونهٔ اطلاعات، موعدها، هشدارها و سابقه‌ها.' },
  { id: 'full-admin', label: 'اطلاعات کامل · مدیر دوم', role: 'admin', mode: 'full', description: 'امکانات و پیام‌های نقش مدیر دوم.' },
  { id: 'full-member', label: 'اطلاعات کامل · عضو', role: 'member', mode: 'full', description: 'اطلاعات شخصی عضو و بخش‌های مشترک، همراه محدودیت‌های مدیریت.' },
  { id: 'minor-member', label: 'عضو زیر ۱۸ سال', role: 'member', mode: 'minor', description: 'پیام‌های مربوط به محدودیت سن در خودرو و اسناد.' },
  { id: 'missing-birth', label: 'تاریخ تولد ثبت نشده', role: 'member', mode: 'missing-birth', description: 'راهنماهای تکمیل پروفایل و محدودیت‌های بدون تاریخ تولد.' },
  { id: 'empty-owner', label: 'خانهٔ خالی', role: 'owner', mode: 'empty', description: 'حالت‌های خالی و راهنمای شروع تمام بخش‌ها.' },
  { id: 'loading', label: 'در حال دریافت اطلاعات', role: 'owner', mode: 'loading', description: 'پیش‌نمایش پیام‌ها و نشانگرهای انتظار؛ پاسخ داده‌ها با تأخیر می‌رسد.' },
  { id: 'errors', label: 'خطا در دریافت اطلاعات', role: 'owner', mode: 'errors', description: 'خطاهای دریافت، اطلاعات ناقص و دکمه‌های تلاش دوباره.' },
  { id: 'save-errors', label: 'خطا در ذخیره', role: 'owner', mode: 'save-errors', description: 'اطلاعات نمایش داده می‌شود؛ عملیات ذخیره خطای نمونه برمی‌گرداند.' },
  { id: 'conflict', label: 'تغییر هم‌زمان اطلاعات', role: 'owner', mode: 'conflict', description: 'پیام‌های تعارض نسخه و بررسی اطلاعات جدیدتر.' },
  { id: 'offline', label: 'قطع اینترنت', role: 'owner', mode: 'offline', description: 'پس از ورود نمونه، وضعیت آفلاین و دسترسی محدود نمایش داده می‌شود.' },
  { id: 'reminders-off', label: 'اعلان‌های غیرفعال', role: 'owner', mode: 'reminders-off', description: 'پیام‌های راهنمای فعال‌کردن اعلان‌ها؛ موعدهای خانه همچنان موجودند.' },
  { id: 'sms-pending', label: 'پیامک بانکی در انتظار ثبت', role: 'owner', mode: 'sms-pending', description: 'پیام‌ها و فرم ثبت یا نادیده‌گرفتن پیامک بانکی نمونه.' },
  { id: 'auth-login', label: 'ورود', role: 'owner', mode: 'auth', route: 'auth', description: 'فرم ورود و بازیابی رمز؛ ورود خودکار انجام نمی‌شود.' },
  { id: 'auth-register', label: 'ثبت‌نام', role: 'owner', mode: 'register', route: 'auth', description: 'فرم ثبت‌نام، ایجاد خانواده و پیوستن با کد.' },
  { id: 'auth-otp', label: 'ورود با کد تأیید', role: 'owner', mode: 'otp', route: 'auth', description: 'کد تأیید نمونهٔ ۱۲۳۴۵۶ و پیام‌های تأیید شماره.' },
  { id: 'auth-invalid', label: 'شماره یا رمز اشتباه', role: 'owner', mode: 'invalid-login', route: 'auth', description: 'ارسال فرم ورود، پیام خطای اطلاعات ورود را نمایش می‌دهد.' },
  { id: 'auth-suspended', label: 'عضویت غیرفعال', role: 'member', mode: 'suspended', route: 'auth', description: 'ارسال فرم ورود، پیام عضویت غیرفعال را نمایش می‌دهد.' },
  { id: 'auth-pre-registered', label: 'عضو معرفی‌شده توسط مدیر', role: 'member', mode: 'pre-registered', route: 'auth', description: 'ثبت‌نام برای فردی که قبلاً توسط مدیر معرفی شده است.' },
  { id: 'invite-valid', label: 'دعوت معتبر', role: 'member', mode: 'invite', route: 'invite', description: 'فرم پذیرش دعوت و درخواست تأیید عضویت.' },
  { id: 'invite-expired', label: 'دعوت منقضی', role: 'member', mode: 'invite-expired', route: 'invite', description: 'پیام دعوت نامعتبر یا منقضی‌شده.' },
  { id: 'invite-pending', label: 'درخواست عضویت ثبت‌شده', role: 'member', mode: 'invite-pending', route: 'invite', description: 'پس از ارسال فرم دعوت، پیام انتظار برای تأیید مدیر.' },
  { id: 'intro', label: 'معرفی آغاز برنامه', role: 'owner', mode: 'intro', description: 'همهٔ مرحله‌های معرفی و پرسش‌های آغازین.' },
  { id: 'install', label: 'راهنمای نصب روی گوشی', role: 'owner', mode: 'install', description: 'راهنمای افزودن برنامه به صفحهٔ اصلی در نمایش موبایل.' },
];

const baseRoutes = [
  ['hub', 'خانه'], ['dashboard', 'خرج و درآمد'], ['transactions', 'تراکنش‌ها'], ['reports', 'گزارش‌ها'],
  ['accounts', 'کیف پول'], ['budgets', 'بودجه‌ها'], ['bills', 'قبوض و شارژ'], ['calendar', 'تقویم و مناسبت‌ها'],
  ['shopping', 'لیست خرید'], ['inventory', 'انبار خانه'], ['tasks', 'کارهای خانه'], ['documents', 'اسناد خانه'],
  ['meals', 'برنامهٔ غذایی'], ['equipment', 'وسایل خانه'], ['vehicles', 'خودرو و نگهداری'], ['goals', 'اهداف و آرزوها'],
  ['activities', 'برنامه‌های خانوادگی'], ['children', 'فرزندان'], ['pets', 'حیوانات خانگی'], ['market', 'بازار'],
  ['settings', 'تنظیمات'], ['auth', 'ورود و ثبت‌نام'], ['invite', 'پذیرش دعوت'],
];
const settingsRoutes = [
  ['profile', 'پروفایل'], ['premium', 'نسخه پرمیوم'], ['family', 'اعضای خانواده'], ['joinRequests', 'درخواست‌های عضویت'],
  ['events', 'رویدادهای مهم خانواده'], ['accounts', 'کارت‌ها و حساب‌ها'], ['scheduled', 'تراکنش‌های تکرارشونده'],
  ['categories', 'دسته‌ها'], ['labels', 'برچسب‌ها'], ['export', 'خروجی گرفتن از داده‌ها'],
  ['sms', 'تشخیص تراکنش از پیامک'], ['notifications', 'اعلان‌ها'], ['about', 'درباره'],
];
export const ROUTES = [
  { id: 'sections', label: 'بخش‌های خانه' },
  ...baseRoutes.map(([id, label]) => ({ id, label })),
  ...settingsRoutes.map(([section, sectionLabel]) => ({ id: `settings/${section}`, label: `تنظیمات · ${sectionLabel}`, baseRoute: 'settings', section, sectionLabel })),
];

const id = number => `cf000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const clone = value => structuredClone(value);
const dayOffset = (date, offset) => new Date(Date.parse(`${date}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
const todayInTehran = now => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(now);
const homePreferences = () => ({
  version: 1, layout: 'grouped', pins: ['chores', 'shopping', 'calendar'], openGroups: [],
  groupOrder: ['money', 'daily', 'belongings', 'family'],
  groupModules: { money: ['finance', 'transactions', 'accounts', 'budgets', 'bills', 'market', 'reports'],
    daily: ['chores', 'shopping', 'inventory', 'meals'], belongings: ['equipment', 'vehicles', 'docs'],
    family: ['calendar', 'activities', 'children', 'pets', 'goals'] },
  flatOrder: ['finance', 'transactions', 'accounts', 'budgets', 'bills', 'market', 'reports', 'chores', 'shopping', 'inventory',
    'meals', 'equipment', 'vehicles', 'docs', 'calendar', 'activities', 'children', 'pets', 'goals'],
});
const familyId = id(100);
const guestModes = new Set(['auth', 'register', 'otp', 'invalid-login', 'suspended', 'pre-registered', 'invite', 'invite-expired', 'invite-pending', 'intro', 'install']);

function makeData(scenario, now) {
  const today = todayInTehran(now), timestamp = now.toISOString(), date = offset => dayOffset(today, offset);
  const isManager = scenario.role !== 'member';
  const actorId = scenario.role === 'owner' ? id(1) : scenario.role === 'admin' ? id(3) : id(2);
  const row = (number, extra = {}) => ({ id: id(number), family_id: familyId, created_at: timestamp, updated_at: timestamp,
    revision: 1, created_by: actorId, can_edit: true, can_delete: true, ...extra });
  const members = [
    { id: id(1), name: 'مدیر خانوادهٔ نمونه', role: 'owner', phone: '09000000001', gender: 'female', birth_date: '1986-04-14', relation: 'خودم' },
    { id: id(2), name: 'عضو خانوادهٔ نمونه', role: 'member', phone: '09000000002', gender: 'male', birth_date: '1987-08-12', relation: 'همسر' },
    { id: id(3), name: 'مدیر دوم نمونه', role: 'admin', phone: '09000000003', gender: 'female', birth_date: '1965-12-01', relation: 'پدر/مادر' },
    { id: id(4), name: 'فرزند نمونه', role: 'member', phone: null, gender: null, birth_date: '2017-06-12', relation: 'فرزند' },
    { id: id(5), name: 'متقاضی عضویت نمونه', role: 'member', phone: '09000000005', gender: null, birth_date: null, relation: 'سایر', membership_state: 'pending' },
  ].map(member => ({ family_id: familyId, avatar_url: null, status: 'active', membership_state: 'active', theme: 'light', currency: 'تومان', created_at: timestamp, ...member }));
  if (scenario.mode === 'minor') members[1].birth_date = '2012-07-10';
  if (scenario.mode === 'missing-birth') { members[1].birth_date = null; members[1].relation = 'فرزند'; }
  const actor = members.find(member => member.id === actorId);
  const family = { id: familyId, name: 'خانهٔ نمونه برای بازبینی متن', code: '700001', budget: 18_000_000, currency: 'تومان', dark: false, created_at: timestamp };
  const accounts = [row(201, { member_id: actorId, title: 'نمونه: حساب روزمره', kind: 'bank', bank: 'melli', card_number: '6037990000000001', initial_balance: 2_000_000, sms_enabled: true }),
    row(202, { member_id: id(1), title: 'نمونه: کیف پول نقدی', kind: 'wallet', bank: null, card_number: null, initial_balance: 500_000, sms_enabled: false })];
  const transactions = [
    row(301, { member_id: actorId, type: 'income', amount: 14_000_000, category: 'salary', date: date(-5), time: '10:30', note: 'نمونه: درآمد ماهانه', account_id: id(201), to_account_id: null, subcategory_id: null, repeat: 'monthly', repeat_end: date(90), handled_occurrences: [], photos: [] }),
    row(302, { member_id: actorId, type: 'expense', amount: 1_250_000, category: 'food', date: today, time: '12:20', note: 'نمونه: خرید مواد غذایی', account_id: id(201), to_account_id: null, subcategory_id: id(210), repeat: 'none', repeat_end: null, handled_occurrences: [], photos: [] }),
    row(303, { member_id: id(1), type: 'expense', amount: 5_000_000, category: 'home', date: date(-1), time: '08:10', note: 'نمونه: اجارهٔ ماهانه', account_id: id(201), to_account_id: null, subcategory_id: null, repeat: 'monthly', repeat_end: date(120), handled_occurrences: [], photos: [] }),
    row(304, { member_id: actorId, type: 'transfer', amount: 300_000, category: 'transfer', date: date(-2), time: '15:00', note: 'نمونه: جابه‌جایی بین حساب‌ها', account_id: id(201), to_account_id: id(202), subcategory_id: null, repeat: 'none', repeat_end: null, handled_occurrences: [], photos: [] }),
    row(305, { member_id: id(1), type: 'expense', amount: 80_000, category: 'bills', date: date(-35), time: '09:10', note: 'نمونه: پرداخت تکرارشونده', account_id: id(201), to_account_id: null, subcategory_id: null, repeat: 'monthly', repeat_end: date(90), handled_occurrences: [], photos: [] }),
  ];
  const inventory = [row(501, { title: 'نمونه: برنج', unit: 'کیلوگرم', quantity: 0.5, threshold: 2, note: 'نمونه: کمبود موجودی' }),
    row(502, { title: 'نمونه: روغن', unit: 'بطری', quantity: 3, threshold: 1, note: null }),
    row(503, { title: 'نمونه: شیر', unit: 'بسته', quantity: 0, threshold: 2, note: null })];
  const lists = [row(510, { title: 'نمونه: خرید این هفته', items: [
    row(511, { list_id: id(510), title: 'نمونه: برنج', qty: 2, unit: 'کیلوگرم', price: 280_000, checked: false, bought_at: null, bought_by_member_id: null, transaction_id: null, inventory_item_id: id(501), note: 'نمونه: قلم دارای قیمت' }),
    row(512, { list_id: id(510), title: 'نمونه: شیر', qty: 2, unit: 'بسته', price: null, checked: false, bought_at: null, bought_by_member_id: null, transaction_id: null, inventory_item_id: id(503), note: null }),
    row(513, { list_id: id(510), title: 'نمونه: روغن', qty: 1, unit: 'بطری', price: 120_000, checked: true, bought_at: timestamp, bought_by_member_id: actorId, transaction_id: id(302), inventory_item_id: id(502), note: null }),
  ] }), row(514, { title: 'نمونه: فهرست بدون قلم', items: [] })];
  const tasks = [
    row(601, { title: 'نمونه: کار عقب‌افتاده', description: 'نمونه: توضیح کار خانه', assignee_id: actorId, due_date: date(-2), completed: false, completed_at: null, completed_by: null, completion_photo_url: null }),
    row(602, { title: 'نمونه: کار امروز', description: null, assignee_id: id(2), due_date: today, completed: false, completed_at: null, completed_by: null, completion_photo_url: null }),
    row(603, { title: 'نمونه: کار روزهای آینده', description: null, assignee_id: null, due_date: date(3), completed: false, completed_at: null, completed_by: null, completion_photo_url: null }),
    row(604, { title: 'نمونه: کار انجام‌شده', description: null, assignee_id: actorId, due_date: date(-1), completed: true, completed_at: timestamp, completed_by: actorId, completion_photo_url: '/__copy/sample-image.svg' }),
    row(605, { title: 'نمونه: کار بدون موعد', description: null, assignee_id: id(4), due_date: null, completed: false, completed_at: null, completed_by: null, completion_photo_url: null }),
  ];
  const bills = [row(701, { kind: 'electricity', title: 'نمونه: قبض عقب‌افتادهٔ برق', amount: 260_000, due_date: date(-2), state: 'unpaid', bill_no: '70000000001', payment_no: '80000000001', paid_at: null, paid_by_member_id: null, transaction_id: null, note: null }),
    row(702, { kind: 'internet', title: 'نمونه: اینترنت خانه', amount: 450_000, due_date: date(3), state: 'unpaid', bill_no: null, payment_no: null, paid_at: null, paid_by_member_id: null, transaction_id: null, note: 'نمونه: موعد نزدیک' }),
    row(703, { kind: 'water', title: 'نمونه: قبض پرداخت‌شدهٔ آب', amount: 180_000, due_date: date(-10), state: 'paid', bill_no: null, payment_no: null, paid_at: timestamp, paid_by_member_id: actorId, transaction_id: null, note: null }),
    row(704, { kind: 'charge', title: 'نمونه: شارژ لغوشده', amount: 300_000, due_date: date(5), state: 'cancelled', bill_no: null, payment_no: null, paid_at: null, paid_by_member_id: null, transaction_id: null, note: null })];
  const documents = [row(801, { title: 'نمونه: سند مشترک با اعتبار نزدیک', category: 'گارانتی', visibility: 'shared', expiry_date: date(4), reminder_enabled: true, owner_id: id(1), mime_type: 'application/pdf', file_name: 'sample-document.pdf', file_size: samplePdf.length, can_change_visibility: actorId === id(1), can_edit: isManager || actorId === id(1), can_delete: isManager || actorId === id(1) }),
    row(802, { title: 'نمونه: سند شخصی من', category: 'بیمه', visibility: 'private', expiry_date: date(-3), reminder_enabled: true, owner_id: actorId, mime_type: 'image/png', file_name: 'sample-document.png', file_size: samplePng.length, can_change_visibility: true })];
  const equipment = [row(901, { title: 'نمونه: ماشین لباس‌شویی', brand: 'برند نمونه', model: 'مدل نمونه', purchase_date: date(-400), warranty_until: date(5), warranty_document_id: id(801), service_task_id: id(603), service_due_date: date(-1), service_reminder_enabled: true }),
    row(902, { title: 'نمونه: وسیله بدون گارانتی', brand: null, model: null, purchase_date: null, warranty_until: null, warranty_document_id: null, service_task_id: null, service_due_date: date(30), service_reminder_enabled: false, created_by: id(1), can_edit: isManager, can_delete: isManager })];
  const vehicles = [row(1001, { title: 'نمونه: خودروی خانواده', brand: 'برند نمونه', model: 'مدل نمونه', plate: '۱۲ ب ۳۴۵ ایران ۶۷', purchase_date: date(-700), odometer: 75_000, insurance_until: date(2), inspection_until: date(-10), document_id: id(801), service_task_id: id(603), service_due_date: date(1), service_due_odometer: 74_000, service_reminder_enabled: true, can_view_history: true }),
    row(1002, { title: 'نمونه: خودرو با سرویس آینده', brand: null, model: null, plate: null, purchase_date: null, odometer: 12_000, insurance_until: date(120), inspection_until: null, document_id: null, service_task_id: null, service_due_date: date(60), service_due_odometer: 18_000, service_reminder_enabled: false, can_view_history: true, created_by: id(1), can_edit: isManager, can_delete: isManager })];
  if (['minor', 'missing-birth'].includes(scenario.mode)) for (const vehicle of vehicles) {
    Object.assign(vehicle, { plate: null, insurance_until: null, inspection_until: null, document_id: null,
      can_edit: false, can_delete: false, can_view_history: false });
  }
  const goals = [row(1101, { owner_id: actorId, kind: 'goal', title: 'نمونه: هدف نزدیک', note: 'نمونه: توضیح هدف', target_date: date(2), status: 'active', reminder_enabled: true }),
    row(1102, { owner_id: actorId, kind: 'wish', title: 'نمونه: آرزوی بدون موعد', note: null, target_date: null, status: 'active', reminder_enabled: false }),
    row(1103, { owner_id: actorId, kind: 'goal', title: 'نمونه: هدف تکمیل‌شده', note: null, target_date: date(-30), status: 'done', reminder_enabled: false })];
  const activities = [row(1201, { title: 'نمونه: برنامهٔ امروز خانواده', note: 'نمونه: توضیح برنامه', date: today, location: 'محل نمونه', status: 'planned', participant_ids: [actorId, id(4)], reminder_enabled: true }),
    row(1202, { title: 'نمونه: برنامهٔ آینده', note: null, date: date(5), location: null, status: 'planned', participant_ids: [id(1), id(2)], reminder_enabled: true, created_by: id(1), can_edit: isManager || actorId === id(1), can_delete: isManager || actorId === id(1) }),
    row(1203, { title: 'نمونه: برنامهٔ انجام‌شده', note: null, date: date(-5), location: null, status: 'done', participant_ids: [actorId], reminder_enabled: false }),
    row(1204, { title: 'نمونه: برنامهٔ لغوشده', note: null, date: date(10), location: null, status: 'cancelled', participant_ids: [], reminder_enabled: false })];
  const events = [row(1301, { member_id: actorId, for_member_id: null, title: 'نمونه: مناسبت نزدیک', date: date(2), note: 'نمونه: یادداشت مناسبت', kind: 'event', reminder_enabled: true }),
    row(1302, { member_id: actorId, for_member_id: id(4), title: 'تولد فرزند نمونه', date: date(4), note: null, kind: 'event', reminder_enabled: true }),
    ...activities.map(item => ({ id: item.id, family_id: familyId, member_id: item.created_by, for_member_id: null, title: item.title, date: item.date, note: item.note, kind: 'activity', activity_status: item.status, reminder_enabled: item.reminder_enabled, revision: item.revision, created_at: timestamp }))];
  const children = [{ id: id(4), name: members[3].name, birth_date: members[3].birth_date, age_years: now.getUTCFullYear() - 2017, status: 'active', revision: 1, can_edit: isManager },
    { id: id(6), name: 'فرزند دوم نمونه', birth_date: null, age_years: null, status: 'pending', revision: 1, can_edit: isManager }];
  const pets = [row(1401, { name: 'نمونه: گربهٔ خانه', species: 'گربه', breed: 'نژاد نمونه', birth_date: '2022-05-18', can_edit: isManager, can_delete: isManager }),
    row(1402, { name: 'نمونه: پرندهٔ خانه', species: 'پرنده', breed: null, birth_date: null, can_edit: isManager, can_delete: isManager })];
  const dishes = [row(1501, { title: 'نمونه: غذای هفته', ingredients: [{ title: 'نمونه: برنج', qty: 2, unit: 'پیمانه' }, { title: 'نمونه: مرغ', qty: 1, unit: 'کیلوگرم' }] }),
    row(1502, { title: 'نمونه: صبحانه', ingredients: [{ title: 'نمونه: نان', qty: 1, unit: 'عدد' }] })];
  const mealEntries = [row(1511, { date: today, meal_type: 'lunch', dish_id: id(1501) }), row(1512, { date: date(1), meal_type: 'breakfast', dish_id: id(1502) })];
  const prefs = { enabled: scenario.mode !== 'reminders-off', domains: {}, lead_days: {}, dismissed: [] };
  const data = { today, timestamp, family, members, actor, accounts, transactions, lists, inventory, tasks, bills, documents, equipment,
    vehicles, goals, activities, events, children, pets, dishes, mealEntries, prefs, home: { revision: 0, preferences: homePreferences() },
    categoryBudgets: [row(220, { category: 'food', amount: 1_000_000 }), row(221, { category: 'home', amount: 5_500_000 })],
    subcategories: [{ id: id(210), family_id: familyId, category: 'food', name: 'نمونه: خرید روزمره', created_at: timestamp }],
    customCategories: [{ id: id(211), family_id: familyId, name: 'نمونه: دستهٔ سفارشی', icon: 'i-heart', type: 'expense', created_at: timestamp }],
    joinRequests: [{ id: id(1601), member_id: id(5), member_name: members[4].name, phone: members[4].phone, relation: 'سایر', via: 'link', state: 'pending', requested_at: timestamp }],
    sms: [row(1701, { member_id: actorId, raw_text: 'نمونه: متن پیامک بانکی', bank: 'melli', type: 'expense', amount: 50_000, balance: 1_000_000, date: today, status: 'recorded', sender: '+987000', account_id: id(201) })],
    senders: [{ id: id(1702), account_id: id(201), sender: '+987000' }],
    numbers: [{ id: id(1703), member_id: actorId, phone: actor.phone, label: 'نمونه: شمارهٔ من', verified: true, active: true }],
    holdings: [row(1801, { member_id: actorId, kind: 'currency', symbol: 'USD', name: 'دلار آمریکا', unit: 'تومان', quantity: 100, price: 110_000, value: 11_000_000, priced: true }),
      row(1802, { member_id: actorId, kind: 'gold', symbol: 'IR_GOLD_18K', name: 'نمونه: طلای ۱۸ عیار', unit: 'گرم', quantity: 3, price: 5_000_000, value: 15_000_000, priced: true }),
      row(1803, { member_id: actorId, kind: 'stock', symbol: 'نمونه', name: 'نمونه: دارایی بدون قیمت', unit: 'سهم', quantity: 10, price: 0, value: 0, priced: false })],
    equipmentServices: [row(1901, { equipment_id: id(901), performed_on: date(-90), description: 'نمونه: سرویس انجام‌شده', next_due_date: date(-1) })],
    vehicleServices: [row(1902, { vehicle_id: id(1001), performed_on: date(-60), description: 'نمونه: سرویس با هزینهٔ ثبت‌شده', performed_odometer: 65_000, next_due_date: date(1), next_due_odometer: 74_000, transaction_id: id(302), cost_amount: 750_000, cost_status: 'recorded' }),
      row(1903, { vehicle_id: id(1001), performed_on: date(-120), description: 'نمونه: سابقه بدون هزینه', performed_odometer: 55_000, next_due_date: null, next_due_odometer: null, transaction_id: null, cost_amount: null, cost_status: 'none' }),
      row(1904, { vehicle_id: id(1001), performed_on: date(-150), description: 'نمونه: هزینهٔ در دسترس نیست', performed_odometer: 45_000, next_due_date: null, next_due_odometer: null, transaction_id: null, cost_amount: null, cost_status: 'unavailable' })],
    petCare: new Map([[id(1401), [id(601), id(602)]], [id(1402), []]]), receipts: new Map(), requests: [] };
  if (scenario.mode === 'empty') {
    for (const key of ['accounts', 'transactions', 'lists', 'inventory', 'tasks', 'bills', 'documents', 'equipment', 'vehicles', 'goals', 'activities', 'events', 'children', 'pets', 'dishes', 'mealEntries', 'categoryBudgets', 'subcategories', 'customCategories', 'joinRequests', 'sms', 'senders', 'numbers', 'holdings', 'equipmentServices', 'vehicleServices']) data[key] = [];
    data.members = [actor]; data.family.budget = 0;
  }
  if (scenario.mode === 'sms-pending') data.sms[0].status = 'pending';
  return data;
}

export function createPreviewSession(scenarioId = 'full-owner', route, options = {}) {
  const scenario = SCENARIOS.find(item => item.id === scenarioId);
  if (!scenario) throw new Error('Unknown copy preview scenario');
  const routeId = route || scenario.route || 'hub';
  const routeInfo = ROUTES.find(item => item.id === routeId);
  if (!routeInfo) throw new Error('Unknown copy preview route');
  const now = options.now ? new Date(options.now) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error('Invalid fixture clock');
  const data = makeData(scenario, now);
  return { id: randomUUID(), scenario: clone(scenario), route: routeId, routeInfo: clone(routeInfo),
    credentials: { phone: data.actor.phone, password: 'Test12345!' }, guest: guestModes.has(scenario.mode) || ['auth', 'invite'].includes(routeId),
    token: `copy-preview-${scenario.id}-${'0'.repeat(64)}`, data };
}

function offlineSnapshot(data) {
  return { lists: data.lists.map(list => ({ id: list.id, title: list.title, revision: list.revision, created_at: list.created_at,
    items: list.items.map(item => ({ id: item.id, list_id: item.list_id, title: item.title, qty: item.qty, unit: item.unit,
      checked: item.checked, inventory_item_id: item.inventory_item_id, note: item.note, revision: item.revision, created_at: item.created_at })) })),
    inventory: data.inventory.map(item => ({ id: item.id, title: item.title, unit: item.unit, quantity: item.quantity,
      threshold: item.threshold, note: item.note, revision: item.revision, created_at: item.created_at, updated_at: item.updated_at })),
    tasks: clone(data.tasks), task_notification_prefs: { enabled: data.prefs.enabled, tasks_enabled: data.prefs.domains.tasks !== false, lead_days: data.prefs.lead_days.tasks ?? 0 } };
}
const response = (body, status = 200, extra = {}) => ({ status, body: clone(body), headers: { 'Cache-Control': 'no-store' }, ...extra });
const error = (code, message, status = 400) => response({ error: code, message }, status);
const actorAuth = session => response({ member: session.data.actor, family: session.data.family, session_token: session.token });
const managersOnly = session => session.scenario.role !== 'member';
const collectionKeys = { transactions: 'transactions', accounts: 'accounts', bills: 'bills', events: 'events', inventory: 'inventory', tasks: 'tasks',
  documents: 'documents', equipment: 'equipment', vehicles: 'vehicles', goals: 'goals', activities: 'activities', children: 'children', pets: 'pets',
  holdings: 'holdings', subcategories: 'subcategories', 'custom-categories': 'customCategories', 'category-budgets': 'categoryBudgets' };
const delayedPaths = new Set(['/equipment', '/vehicles', '/goals', '/activities', '/children', '/pets', '/documents', '/meals/dishes', '/meals/plan', '/market/prices', '/holdings']);

function marketPrices(data) {
  const item = (symbol, name, price, unit, change = 1.2) => ({ symbol, name, price, unit, change_value: price * change / 100,
    change_percent: change, date: data.today, time: '۱۲:۰۰' });
  return { updated_at: data.timestamp, stale: false,
    gold: [item('IR_GOLD_18K', 'طلای ۱۸ عیار', 5_000_000, 'تومان'), item('IR_COIN_EMAMI', 'سکهٔ امامی', 52_000_000, 'تومان', -0.6)],
    currency: [item('USD', 'دلار آمریکا', 110_000, 'تومان'), item('EUR', 'یورو', 119_000, 'تومان', -0.3)],
    crypto: [item('BTC', 'بیت‌کوین', 91_000, 'دلار'), item('ETH', 'اتریوم', 3_200, 'دلار', -2)],
    bourse: { date: data.today, time: '۱۲:۰۰', state: 'بسته', index: 2_400_000, index_change: 12_000, index_change_percent: 0.5,
      index_equalweight: 740_000, index_equalweight_change: -800, market_value: 8e12, trades_count: 140_000, trades_volume: 5e9, trades_value: 2e12 } };
}

function collectionResponse(session, key) {
  const data = session.data;
  if (key === 'events') data.events = [
    ...data.events.filter(item => item.kind !== 'activity'),
    ...data.activities.map(item => ({ id: item.id, family_id: familyId, member_id: item.created_by, for_member_id: null, title: item.title,
      date: item.date, note: item.note, kind: 'activity', activity_status: item.status, reminder_enabled: item.reminder_enabled,
      revision: item.revision, created_at: item.created_at })),
  ];
  const rows = data[key];
  if (key === 'vehicles') return response({ vehicles: rows, can_create: !['minor', 'missing-birth'].includes(session.scenario.mode) });
  if (key === 'goals') return response({ goals: rows.filter(item => item.owner_id === data.actor.id), can_create: true });
  if (key === 'activities') return response({ activities: rows, can_create: true });
  if (key === 'children') return response({ children: rows, can_create: managersOnly(session) });
  if (key === 'pets') return response({ pets: rows, can_create: managersOnly(session) });
  if (key === 'holdings') return response({ items: rows, total: rows.reduce((sum, item) => sum + item.value, 0), unpriced: rows.filter(item => !item.priced).length, stale: false });
  return response(rows);
}

function newRow(session, values) {
  return { id: randomUUID(), family_id: familyId, created_by: session.data.actor.id, created_at: session.data.timestamp,
    updated_at: session.data.timestamp, revision: 1, can_edit: true, can_delete: true, ...values };
}
function normalizeCreate(session, key, body) {
  const data = session.data;
  const defaults = {
    transactions: { member_id: data.actor.id, source_kind: null, type: 'expense', amount: 0, category: 'other', date: data.today, time: null,
      note: null, account_id: null, to_account_id: null, subcategory_id: null, repeat: 'none', repeat_end: null,
      recurring_plan: null, recurring_source_id: null, recurring_due_date: null, handled_occurrences: [], photos: [] },
    accounts: { member_id: data.actor.id, title: 'نمونه: حساب جدید', kind: 'bank', bank: null, card_number: null, initial_balance: 0, sms_enabled: false },
    tasks: { title: 'نمونه: کار جدید', description: null, assignee_id: null, due_date: null, completed: false, completed_at: null, completed_by: null, completion_photo_url: null },
    bills: { kind: 'other', title: 'نمونه: قبض جدید', amount: 0, due_date: data.today, state: 'unpaid', bill_no: null, payment_no: null, note: null, paid_at: null, paid_by_member_id: null, transaction_id: null },
    events: { member_id: data.actor.id, for_member_id: null, title: 'نمونه: مناسبت جدید', date: data.today, note: null, kind: 'event', reminder_enabled: true },
    inventory: { title: 'نمونه: قلم جدید', unit: null, quantity: 0, threshold: 0, note: null },
    documents: { title: 'نمونه: سند جدید', category: null, visibility: 'private', expiry_date: null, reminder_enabled: true, owner_id: data.actor.id,
      mime_type: 'application/pdf', file_name: 'sample-document.pdf', file_size: samplePdf.length, can_change_visibility: true },
    equipment: { title: 'نمونه: وسیلهٔ جدید', brand: null, model: null, purchase_date: null, warranty_until: null, warranty_document_id: null,
      service_task_id: null, service_due_date: null, service_reminder_enabled: false },
    vehicles: { title: 'نمونه: خودروی جدید', brand: null, model: null, plate: null, purchase_date: null, odometer: 0, insurance_until: null,
      inspection_until: null, document_id: null, service_task_id: null, service_due_date: null, service_due_odometer: null, service_reminder_enabled: false, can_view_history: true },
    goals: { owner_id: data.actor.id, kind: 'goal', title: 'نمونه: هدف جدید', note: null, target_date: null, status: 'active', reminder_enabled: true },
    activities: { title: 'نمونه: برنامهٔ جدید', note: null, date: data.today, location: null, status: 'planned', participant_ids: [], reminder_enabled: true },
    children: { name: 'نمونه: فرزند جدید', birth_date: null, age_years: null, status: 'pending', can_edit: managersOnly(session) },
    pets: { name: 'نمونه: حیوان جدید', species: 'گربه', breed: null, birth_date: null, can_edit: managersOnly(session), can_delete: managersOnly(session) },
    holdings: { member_id: data.actor.id, kind: 'currency', symbol: 'USD', name: 'نمونه: دارایی جدید', unit: 'دلار', quantity: 1, price: 0, value: 0, priced: false },
  };
  const values = clone(body || {}); delete values.base_revision; delete values.operation_id;
  return newRow(session, { ...defaults[key], ...values });
}

function offlineMutation(session, operation) {
  const data = session.data, saved = data.receipts.get(operation.operation_id);
  if (saved) return response({ ...saved, replayed: true, snapshot: offlineSnapshot(data) });
  const [entity, action] = String(operation.kind).split('.');
  const payload = operation.payload || {}, entityId = operation.entity_id;
  let list = entity === 'list' ? data.lists : entity === 'item' ? data.lists.flatMap(row => row.items) : entity === 'inventory' ? data.inventory : entity === 'task' ? data.tasks : null;
  if (!list) return error('INVALID_OPERATION', 'عملیات نمونه شناخته نشد.');
  let current = list.find(row => row.id === entityId);
  if (action !== 'create' && !current) return error('NOT_FOUND', 'مورد نمونه یافت نشد.', 404);
  if (current && operation.base_revision !== null && operation.base_revision !== undefined && current.revision !== operation.base_revision) return error('SYNC_CONFLICT', 'این مورد تغییر کرده است؛ نسخهٔ ذخیره‌شده را بررسی کنید.', 409);
  if (action === 'create') {
    const key = entity === 'list' ? 'lists' : entity === 'inventory' ? 'inventory' : 'tasks';
    current = entity === 'item' ? newRow(session, { list_id: payload.list_id, title: payload.title, qty: payload.qty ?? 1,
      unit: payload.unit ?? null, note: payload.note ?? null, checked: false, inventory_item_id: payload.inventory_item_id ?? null,
      price: null, bought_at: null, bought_by_member_id: null, transaction_id: null })
      : entity === 'list' ? newRow(session, { title: payload.title, items: [] }) : normalizeCreate(session, key, payload);
    current.id = entityId;
    if (entity === 'item') {
      const parent = data.lists.find(row => row.id === payload.list_id);
      if (!parent) return error('NOT_FOUND', 'فهرست نمونه یافت نشد.', 404);
      parent.items.push(current);
    } else list.push(current);
  } else if (action === 'delete') {
    if (entity === 'item') for (const parent of data.lists) parent.items = parent.items.filter(row => row.id !== entityId);
    else list.splice(list.indexOf(current), 1);
    current = null;
  } else {
    if (action === 'adjust') current.quantity = Math.max(0, current.quantity + Number(payload.delta || 0));
    else if (action === 'complete') Object.assign(current, { completed: Boolean(payload.completed), completed_at: payload.completed ? data.timestamp : null,
      completed_by: payload.completed ? data.actor.id : null, completion_photo_url: payload.completion_photo ?? null });
    else Object.assign(current, clone(payload));
    current.revision += 1; current.updated_at = data.timestamp;
  }
  const result = { operation_id: operation.operation_id, replayed: false, entity_type: entity, entity_id: entityId,
    revision: current?.revision ?? null, snapshot: offlineSnapshot(data) };
  data.receipts.set(operation.operation_id, clone(result)); return response(result);
}

/** Every unknown endpoint fails locally. Caller must never fall back to a real API. */
export function handlePreviewRequest(session, request) {
  const url = new URL(request.path || '/', 'http://copy-preview.invalid');
  const path = url.pathname.replace(/^\/api\/v1(?=\/|$)/, '') || '/';
  const query = request.query instanceof URLSearchParams ? request.query : new URLSearchParams(request.query || url.search);
  const method = String(request.method || 'GET').toUpperCase(), body = request.body && typeof request.body === 'object' ? request.body : {};
  const data = session.data, mode = session.scenario.mode;
  data.requests.push({ method, path }); if (data.requests.length > 200) data.requests.shift();
  if (method === 'OPTIONS') return response(null, 204);
  if (!['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'].includes(method)) return error('METHOD_NOT_ALLOWED', 'این عملیات در پیش‌نمایش پشتیبانی نمی‌شود.', 405);
  if (['minor', 'missing-birth'].includes(mode)) {
    if (/^\/documents(?:\/|$)/.test(path)) return error('DOCUMENT_FORBIDDEN', 'دسترسی به مدارک برای این حساب مجاز نیست.', 403);
    if (/^\/vehicles(?:\/|$)/.test(path) && (!['GET', 'HEAD'].includes(method) || path.endsWith('/services'))) {
      return error('VEHICLE_FORBIDDEN', 'مدیریت خودرو و سابقهٔ سرویس برای این حساب مجاز نیست.', 403);
    }
  }
  if (path === '/auth/config') return response({ otp_enabled: mode === 'otp', password_reset_enabled: true });
  if (path === '/auth/pre-registered') return response({ pre_registered: mode === 'pre-registered', family_name: mode === 'pre-registered' ? data.family.name : null });
  if (path === '/auth/check-password') return response({ ok: mode !== 'invalid-login' });
  if (path === '/auth/otp/request') return response({ code: '123456' });
  if (path === '/auth/login' || path === '/auth/register') {
    if (mode === 'invalid-login') return error('INVALID_CREDENTIALS', 'شماره موبایل یا رمز عبور اشتباه است.', 401);
    if (mode === 'suspended') return error('MEMBERSHIP_INACTIVE', 'عضویت شما در خانواده فعال نیست.', 403);
    const submittedOtp = path === '/auth/register' ? body.otp_code : body.code;
    if (mode === 'otp' && submittedOtp !== '123456') return error('INVALID_OTP', 'کد واردشده معتبر نیست.', 400);
    if (path === '/auth/register') {
      if (body.member_name) data.actor.name = String(body.member_name);
      if (body.family_name) data.family.name = String(body.family_name);
    }
    return actorAuth(session);
  }
  if (path === '/auth/session') return response({ member: data.actor, family: data.family, members: data.members });
  if (path === '/auth/family') return response(data.family);
  if (path === '/auth/members' && method === 'GET') return response(data.members);
  if (path === '/auth/join-requests' && method === 'GET') return managersOnly(session) ? response(data.joinRequests) : error('FORBIDDEN', 'فقط مدیر خانواده مجاز است.', 403);
  if (/^\/auth\/join-requests\/[^/]+\/(approve|reject)$/.test(path)) {
    if (!managersOnly(session)) return error('FORBIDDEN', 'فقط مدیر خانواده مجاز است.', 403);
    const requestId = path.split('/')[3], join = data.joinRequests.find(item => item.id === requestId), member = data.members.find(item => item.id === join?.member_id);
    if (!join) return error('NOT_FOUND', 'درخواست نمونه یافت نشد.', 404);
    data.joinRequests = data.joinRequests.filter(item => item.id !== requestId);
    if (member) member.membership_state = path.endsWith('/approve') ? 'active' : 'rejected';
    return path.endsWith('/approve') ? response(member) : response({ ok: true });
  }
  if (/^\/auth\/invite\//.test(path)) return mode === 'invite-expired' ? error('INVALID_INVITE', 'لینک دعوت نامعتبر یا منقضی شده است.', 404) : response({ family_name: data.family.name });
  if (path === '/auth/invite') return response({ token: 'copy-preview-invite' });
  if (path === '/auth/accept-invite' || path === '/auth/join') {
    if (mode === 'invite-expired') return error('INVALID_INVITE', 'لینک دعوت نامعتبر یا منقضی شده است.', 404);
    return response({ family_name: data.family.name, state: 'pending' });
  }
  if (['/auth/logout', '/auth/logout-all', '/auth/change-password', '/auth/password-reset/request', '/auth/password-reset/confirm'].includes(path)) return response({ ok: true });
  if (path === '/members/me/home-preferences') {
    if (method === 'GET') return response(data.home);
    if (method === 'PATCH') {
      if (body.revision !== data.home.revision) return error('SYNC_CONFLICT', 'چیدمان شما تغییر کرده است؛ نسخهٔ ذخیره‌شده را بررسی کنید.', 409);
      data.home = { revision: data.home.revision + 1, preferences: clone(body.preferences) }; return response(data.home);
    }
  }
  if (path === '/members/me' && method === 'PATCH') { Object.assign(data.actor, clone(body)); return response(data.actor); }
  if (path === '/members/me/theme') { data.actor.theme = body.theme; return response(null, 204); }
  if (path === '/members/me/currency') { data.actor.currency = body.currency; return response(data.actor); }
  if (path === '/family/settings') { data.family.budget = Number(body.budget || 0); return response(null, 204); }
  if (/^\/members\/[^/]+\/relation$/.test(path)) {
    const member = data.members.find(item => item.id === path.split('/')[2]);
    if (!member) return error('NOT_FOUND', 'عضو نمونه یافت نشد.', 404);
    member.relation = String(body.relation); return response(member);
  }
  if (path === '/notifications/prefs') {
    if (method === 'PATCH') Object.assign(data.prefs, clone(body));
    return response(data.prefs);
  }
  if (path === '/notifications/dismissals' && method === 'POST') { data.prefs.dismissed.push(body.key); return response(null, 204); }
  if (path.startsWith('/notifications/dismissals/') && method === 'DELETE') { data.prefs.dismissed = data.prefs.dismissed.filter(key => key !== decodeURIComponent(path.slice('/notifications/dismissals/'.length))); return response(null, 204); }
  if (path === '/events/sync-birthdays') return response(0);
  if (path === '/shopping/offline') return response(offlineSnapshot(data));
  if (path === '/shopping/offline/mutations') {
    if (mode === 'conflict') return error('SYNC_CONFLICT', 'این مورد تغییر کرده است؛ نسخهٔ ذخیره‌شده را بررسی کنید.', 409);
    if (mode === 'save-errors') return error('SERVER', session.errorMessage || 'ذخیرهٔ اطلاعات انجام نشد؛ دوباره تلاش کنید.', 503);
    return offlineMutation(session, body);
  }
  if (delayedPaths.has(path)) {
    if (mode === 'errors') return error('SERVER', session.errorMessage || 'دریافت اطلاعات ممکن نیست؛ دوباره تلاش کنید.', 503);
  }
  if (method !== 'GET' && method !== 'HEAD' && !path.startsWith('/auth/')) {
    if (mode === 'save-errors') return error('SERVER', session.errorMessage || 'ذخیرهٔ اطلاعات انجام نشد؛ دوباره تلاش کنید.', 503);
    if (mode === 'conflict') return error('SYNC_CONFLICT', session.errorMessage || 'این مورد تغییر کرده است؛ نسخهٔ ذخیره‌شده را بررسی کنید.', 409);
  }
  const delayMs = mode === 'loading' && delayedPaths.has(path) ? 20_000 : 0;
  if (path === '/market/prices') return response(marketPrices(data), 200, { delayMs });
  if (path === '/market/stocks') return response({ query: query.get('q') || '', fetched_at: data.timestamp, stale: false, total: 1, results: [{ symbol: 'نمونه', name: 'نمونه: شرکت بورسی', price: 12_000, change_percent: 1.2, close_price: 11_900, close_change_percent: 0.4, volume: 800_000, value: 9e9, trades_count: 800, low: 11_500, high: 12_100, yesterday: 11_860, event_time: '۱۲:۰۰', market: 'نمونه' }] });
  if (path === '/sms/bridge') return method === 'GET' ? response({ token: 'copy-preview-bridge-key', member_id: data.actor.id }) : response('copy-preview-bridge-key');
  if (path === '/sms/senders' && method === 'GET') return response(data.senders);
  if (path === '/sms/numbers') {
    if (method === 'POST') { const number = { id: randomUUID(), member_id: data.actor.id, phone: body.phone, label: body.label || '', verified: false, active: true }; data.numbers.push(number); return response(number, 201); }
    return response(data.numbers);
  }
  if (/^\/sms\/numbers\/[^/]+$/.test(path)) return mutateRow(session, 'numbers', path.split('/')[3], method, body);
  if (/^\/sms\/senders\/[^/]+$/.test(path)) return mutateRow(session, 'senders', path.split('/')[3], method, body);
  if (/^\/sms\/accounts\/[^/]+\/senders$/.test(path) && method === 'POST') {
    const sender = { id: randomUUID(), account_id: path.split('/')[3], sender: body.sender }; data.senders.push(sender); return response(sender, 201);
  }
  if (/^\/sms\/accounts\/[^/]+$/.test(path) && method === 'DELETE') {
    const accountId = path.split('/')[3]; data.senders = data.senders.filter(item => item.account_id !== accountId);
    const account = data.accounts.find(item => item.id === accountId); if (account) account.sms_enabled = false; return response(null, 204);
  }
  if (path === '/sms' && method === 'GET') return response(data.sms.filter(item => !query.get('status') || item.status === query.get('status')));
  if (path === '/sms/ingest') return response([normalizeCreate(session, 'transactions', body)]);
  if (path === '/sms' && method === 'POST') return response(Array.isArray(body.items) ? body.items.length : 0);
  if (/^\/sms\/[^/]+$/.test(path) && method === 'PATCH') {
    const item = data.sms.find(item => item.id === path.split('/')[2]); if (item) item.status = body.status; return response(null, 204);
  }
  if (/^\/sms\/accounts\/[^/]+\/enabled$/.test(path)) {
    const account = data.accounts.find(item => item.id === path.split('/')[3]); if (!account) return error('NOT_FOUND', 'حساب نمونه یافت نشد.', 404);
    account.sms_enabled = Boolean(body.enabled); return response(account);
  }
  if (path === '/meals/dishes' && method === 'GET') return response(data.dishes, 200, { delayMs });
  if (path === '/meals/plan' && method === 'GET') {
    const weekStart = query.get('week_start') || data.today;
    return response({ week_start: weekStart, entries: data.mealEntries.filter(item => item.date >= weekStart && item.date <= dayOffset(weekStart, 6)) }, 200, { delayMs });
  }
  if (path === '/meals/dishes' && method === 'POST') { const dish = newRow(session, { title: body.title, ingredients: clone(body.ingredients || []) }); data.dishes.push(dish); return response(dish, 201); }
  if (/^\/meals\/dishes\/[^/]+$/.test(path)) return mutateRow(session, 'dishes', path.split('/')[3], method, body);
  if (path === '/meals/plan' && method === 'POST') { const entry = newRow(session, { date: body.date, meal_type: body.meal_type, dish_id: body.dish_id }); data.mealEntries.push(entry); return response(entry, 201); }
  if (/^\/meals\/plan\/[^/]+$/.test(path)) return mutateRow(session, 'mealEntries', path.split('/')[3], method, body);
  if (path === '/shopping/lists' && method === 'GET') return response(data.lists);
  if (path === '/shopping/lists' && method === 'POST') { const list = newRow(session, { title: body.title, items: [] }); data.lists.push(list); return response(list, 201); }
  if (/^\/shopping\/lists\/[^/]+$/.test(path)) return mutateRow(session, 'lists', path.split('/')[3], method, body);
  if (/^\/shopping\/lists\/[^/]+\/items$/.test(path) && method === 'POST') {
    const parent = data.lists.find(item => item.id === path.split('/')[3]); if (!parent) return error('NOT_FOUND', 'فهرست نمونه یافت نشد.', 404);
    const item = newRow(session, { list_id: parent.id, qty: 1, unit: null, checked: false, price: null, bought_at: null, bought_by_member_id: null, transaction_id: null, inventory_item_id: null, note: null, ...clone(body) }); parent.items.push(item); return response(item, 201);
  }
  if (/^\/shopping\/items\/[^/]+(?:\/check)?$/.test(path)) {
    const itemId = path.split('/')[3], parent = data.lists.find(list => list.items.some(item => item.id === itemId)), item = parent?.items.find(row => row.id === itemId);
    if (!item) return error('NOT_FOUND', 'قلم نمونه یافت نشد.', 404);
    if (method === 'DELETE') { parent.items = parent.items.filter(row => row.id !== itemId); return response(null, 204); }
    Object.assign(item, clone(body)); item.revision += 1; return response(item);
  }
  if (/^\/shopping\/lists\/[^/]+\/complete$/.test(path)) {
    const list = data.lists.find(item => item.id === path.split('/')[3]); if (!list) return error('NOT_FOUND', 'فهرست نمونه یافت نشد.', 404);
    const items = list.items.filter(item => !item.checked), total = items.reduce((sum, item) => sum + (item.price || 0) * item.qty, 0);
    for (const item of items) Object.assign(item, { checked: true, bought_at: data.timestamp, bought_by_member_id: data.actor.id });
    return response({ list, total, item_count: items.length, transaction_id: null });
  }
  if (/^\/shopping\/lists\/[^/]+\/ensure-missing$/.test(path)) {
    const list = data.lists.find(item => item.id === path.split('/')[3]); if (!list) return error('NOT_FOUND', 'فهرست نمونه یافت نشد.', 404);
    const added = [], skipped = [];
    for (const ingredient of body.items || []) {
      const found = list.items.find(item => item.title === ingredient.title);
      if (found) skipped.push({ id: found.id, title: found.title });
      else { const item = newRow(session, { list_id: list.id, qty: 1, unit: null, checked: false, price: null, bought_at: null, bought_by_member_id: null, transaction_id: null, inventory_item_id: null, note: null, ...clone(ingredient) }); list.items.push(item); added.push(item); }
    }
    return response({ operation_id: body.operation_id, list_id: list.id, replayed: false, added, skipped, added_count: added.length, skipped_count: skipped.length });
  }
  if (/^\/equipment\/[^/]+\/services$/.test(path)) {
    const equipmentId = path.split('/')[2], equipment = data.equipment.find(item => item.id === equipmentId);
    if (!equipment) return error('NOT_FOUND', 'وسیلهٔ نمونه یافت نشد.', 404);
    if (method === 'GET') return response(data.equipmentServices.filter(item => item.equipment_id === equipmentId));
    const record = newRow(session, { equipment_id: equipmentId, performed_on: body.performed_on, description: body.description, next_due_date: body.next_due_date ?? null });
    data.equipmentServices.push(record); equipment.service_due_date = record.next_due_date; equipment.revision += 1; return response({ equipment, record, replayed: false });
  }
  if (/^\/vehicles\/[^/]+\/services$/.test(path)) {
    const vehicleId = path.split('/')[2], vehicle = data.vehicles.find(item => item.id === vehicleId);
    if (!vehicle) return error('NOT_FOUND', 'خودروی نمونه یافت نشد.', 404);
    if (method === 'GET') return response(data.vehicleServices.filter(item => item.vehicle_id === vehicleId));
    const record = newRow(session, { vehicle_id: vehicleId, performed_on: body.performed_on, description: body.description, performed_odometer: body.performed_odometer,
      next_due_date: body.next_due_date ?? null, next_due_odometer: body.next_due_odometer ?? null, cost_amount: body.cost_amount ?? null, cost_status: body.cost_amount ? 'recorded' : 'none', transaction_id: null });
    data.vehicleServices.push(record); Object.assign(vehicle, { service_due_date: record.next_due_date, service_due_odometer: record.next_due_odometer, odometer: record.performed_odometer, revision: vehicle.revision + 1 });
    return response({ vehicle, record, replayed: false });
  }
  if (/^\/pets\/[^/]+\/care-tasks$/.test(path) && method === 'POST') {
    if (!managersOnly(session)) return error('FORBIDDEN', 'فقط مدیر خانواده مجاز است.', 403);
    const task = normalizeCreate(session, 'tasks', { title: body.title, assignee_id: body.assignee_id, due_date: body.due_date }); data.tasks.push(task);
    const petId = path.split('/')[2]; data.petCare.set(petId, [...(data.petCare.get(petId) || []), task.id]);
    return response({ id: task.id, title: task.title, assignee_id: task.assignee_id, due_date: task.due_date, completed: false, revision: task.revision, can_complete: true }, 201);
  }
  if (/^\/children\/[^/]+$/.test(path) && method === 'GET') {
    const child = data.children.find(item => item.id === path.split('/')[2]); if (!child) return error('NOT_FOUND', 'فرزند نمونه یافت نشد.', 404);
    return response({ child, tasks: data.tasks.filter(item => item.assignee_id === child.id).map(({ id, title, due_date, completed }) => ({ id, title, due_date, completed })),
      activities: data.activities.filter(item => item.participant_ids.includes(child.id)).map(({ id, title, date, location, status }) => ({ id, title, date, location, status })),
      birthday: data.events.find(item => item.for_member_id === child.id) || null });
  }
  if (/^\/pets\/[^/]+$/.test(path) && method === 'GET') {
    const pet = data.pets.find(item => item.id === path.split('/')[2]); if (!pet) return error('NOT_FOUND', 'حیوان نمونه یافت نشد.', 404);
    return response({ pet, care_tasks: data.tasks.filter(item => (data.petCare.get(pet.id) || []).includes(item.id)).map(item => ({ id: item.id, title: item.title, assignee_id: item.assignee_id, due_date: item.due_date, completed: item.completed,
      revision: item.revision, can_complete: managersOnly(session) || item.assignee_id === data.actor.id })), can_create_care: managersOnly(session) });
  }
  if (/^\/tasks\/[^/]+\/complete$/.test(path)) {
    const task = data.tasks.find(item => item.id === path.split('/')[2]); if (!task) return error('NOT_FOUND', 'کار نمونه یافت نشد.', 404);
    Object.assign(task, { completed: Boolean(body.completed), completed_at: body.completed ? data.timestamp : null, completed_by: body.completed ? data.actor.id : null, revision: task.revision + 1 }); return response(task);
  }
  if (/^\/bills\/[^/]+\/(pay|unpay|cancel)$/.test(path) && method === 'POST') {
    const bill = data.bills.find(item => item.id === path.split('/')[2]); if (!bill) return error('NOT_FOUND', 'قبض نمونه یافت نشد.', 404);
    if (path.endsWith('/unpay')) {
      if (bill.state !== 'paid') return error('BILL_NOT_PAID', 'این قبض پرداخت نشده است.', 409);
      if (!managersOnly(session) && bill.paid_by_member_id !== data.actor.id) return error('FORBIDDEN', 'فقط پرداخت‌کننده یا مدیر خانواده می‌تواند پرداخت را برگرداند.', 403);
      data.transactions = data.transactions.filter(transaction => transaction.id !== bill.transaction_id);
      Object.assign(bill, { state: 'unpaid', paid_at: null, paid_by_member_id: null, transaction_id: null });
      return response(bill);
    }
    if (bill.state === 'paid') return error('BILL_ALREADY_PAID', 'این قبض قبلاً پرداخت شده است.', 409);
    if (path.endsWith('/cancel')) { bill.state = 'cancelled'; return response(bill); }
    if (bill.state === 'cancelled') return error('BILL_CANCELLED', 'قبض لغوشده پرداخت نمی‌شود.', 409);
    if (body.account_id && !data.accounts.some(account => account.id === body.account_id)) return error('NOT_FOUND', 'حساب یافت نشد.', 404);
    const transaction = normalizeCreate(session, 'transactions', { member_id: data.actor.id, type: 'expense', amount: bill.amount,
      category: 'bills', date: body.date || data.today, account_id: body.account_id || null, note: bill.title });
    data.transactions.push(transaction);
    Object.assign(bill, { state: 'paid', paid_at: data.timestamp, paid_by_member_id: data.actor.id, transaction_id: transaction.id });
    return response(bill);
  }
  if (/^\/inventory\/[^/]+\/adjust$/.test(path)) {
    const item = data.inventory.find(item => item.id === path.split('/')[2]); if (!item) return error('NOT_FOUND', 'قلم نمونه یافت نشد.', 404);
    item.quantity = Math.max(0, item.quantity + Number(body.delta || 0)); item.revision += 1; return response(item);
  }
  if (/^\/transactions\/[^/]+\/occurrences$/.test(path)) {
    if (method !== 'POST') return error('METHOD_NOT_ALLOWED', 'این عملیات پشتیبانی نمی‌شود.', 405);
    const transaction = data.transactions.find(item => item.id === path.split('/')[2]);
    if (!transaction || transaction.repeat === 'none' || (!managersOnly(session) && transaction.member_id !== data.actor.id)) return error('NOT_FOUND', 'تراکنش تکرارشونده یافت نشد.', 404);
    const date = new Date(body.due_date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.due_date) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== body.due_date) return error('INVALID_DATE', 'تاریخ سررسید نامعتبر است.', 422);
    if (!transaction.handled_occurrences.includes(body.due_date)) transaction.handled_occurrences.push(body.due_date);
    return response(null, 204);
  }
  if (/^\/transactions\/[^/]+\/(recurring|settle)$/.test(path)) {
    const row = data.transactions.find(item => item.id === path.split('/')[2]);
    if (!row || (!managersOnly(session) && row.member_id !== data.actor.id)) return error('NOT_FOUND', 'تراکنش یافت نشد.', 404);
    const action = path.split('/')[3];
    if (action === 'settle' && method === 'POST') {
      const existing = data.transactions.find(item => item.recurring_source_id === row.id && item.recurring_due_date === body.due_date);
      if (existing) return response(existing);
    }
    if (body.revision !== (row.recurring_plan?.revision ?? 0)) return error('RECURRING_CONFLICT', 'برنامهٔ تکرار تغییر کرده؛ اطلاعات را تازه کنید.', 409);
    if (action === 'recurring' && method === 'PATCH') {
      if (row.repeat === 'none' || row.source_kind) return error('NOT_FOUND', 'تراکنش تکرارشونده یافت نشد.', 404);
      if (!Number.isFinite(Number(body.amount)) || Number(body.amount) <= 0) return error('INVALID_AMOUNT', 'مبلغ باید بزرگ‌تر از صفر باشد.', 422);
      if (!['none', 'weekly', 'monthly', 'yearly'].includes(body.repeat)) return error('INVALID_REPEAT', 'دورهٔ تکرار نامعتبر است.', 422);
      if (body.repeat !== 'none' && (!validIso(body.start_date) || body.start_date < data.today)) return error('INVALID_DATE', 'موعد بعدی را از امروز به بعد انتخاب کنید.', 422);
      if (body.repeat !== 'none' && (!validIso(body.repeat_end) || body.repeat_end < body.start_date)) return error('INVALID_REPEAT_END', 'تاریخ پایان تکرار پیش از تاریخ تراکنش است.', 422);
      row.recurring_plan = { amount: Number(body.amount), category: body.category, note: String(body.note ?? '').trim(), start_date: body.start_date, revision: body.revision + 1 };
      row.repeat = body.repeat; row.repeat_end = body.repeat === 'none' ? null : body.repeat_end;
      return response(row);
    }
    if (action === 'settle' && method === 'POST') {
      const pending = previewSchedule(row).filter(due => !row.handled_occurrences.includes(due));
      if (!pending.includes(body.due_date) || (!body.transaction && pending[0] !== body.due_date)) return error('OCCURRENCE_UNAVAILABLE', 'این نوبت دیگر قابل تسویه نیست؛ برنامه را تازه کنید.', 409);
      const source = body.transaction;
      if (source && (source.type !== row.type || source.repeat !== 'none' || !validIso(source.date) || source.date > data.today)) return error('INVALID_OCCURRENCE', 'نوع نوبت و تاریخ پرداخت را بررسی کنید.', 422);
      const plan = row.recurring_plan;
      const values = { member_id: row.member_id, type: row.type, repeat: 'none',
        amount: source?.amount ?? plan?.amount ?? row.amount, category: source?.category ?? plan?.category ?? row.category,
        note: source ? source.note : plan ? plan.note : row.note, date: source?.date ?? data.today, time: source?.time ?? null,
        account_id: source ? source.account_id : body.account_id, to_account_id: source ? source.to_account_id : body.to_account_id,
        subcategory_id: source ? source.subcategory_id : plan && plan.category !== row.category ? null : row.subcategory_id,
        require_available_balance: true };
      const invalid = checkPreviewPayment(session, values);
      if (invalid) return invalid;
      const payment = normalizeCreate(session, 'transactions', { ...values, recurring_source_id: row.id, recurring_due_date: body.due_date });
      data.transactions.push(payment); row.handled_occurrences.push(body.due_date);
      return response(payment);
    }
    return error('METHOD_NOT_ALLOWED', 'این عملیات پشتیبانی نمی‌شود.', 405);
  }
  if (/^\/transactions\/[^/]+\/photos$/.test(path) && method === 'POST') {
    const transaction = data.transactions.find(item => item.id === path.split('/')[2]);
    if (!transaction) return error('NOT_FOUND', 'تراکنش نمونه یافت نشد.', 404);
    const photo = newRow(session, { transaction_id: transaction.id, member_id: data.actor.id, url: body.url, caption: body.caption ?? null });
    transaction.photos.push({ id: photo.id, url: photo.url, caption: photo.caption });
    return response(photo, 201);
  }
  if (/^\/photos\//.test(path)) {
    const photoId = path.split('/')[2];
    const transaction = data.transactions.find(item => item.photos.some(photo => photo.id === photoId));
    const photo = transaction?.photos.find(item => item.id === photoId);
    if (!photo) return error('NOT_FOUND', 'تصویر نمونه یافت نشد.', 404);
    if (method === 'PATCH') photo.caption = body.caption ?? null;
    if (method === 'DELETE') transaction.photos = transaction.photos.filter(item => item.id !== photoId);
    return response(null, 204);
  }
  if (path === '/uploads/avatar' || path === '/uploads/photo') return response({ ok: true, url: '/__copy/sample-image.svg' });
  if (/^\/documents\/[^/]+\/file$/.test(path)) {
    const document = data.documents.find(item => item.id === path.split('/')[2]);
    if (!document) return error('NOT_FOUND', 'سند نمونه یافت نشد.', 404);
    return { status: 200, body: Buffer.from(document.mime_type === 'image/png' ? samplePng : samplePdf),
      headers: { 'Content-Type': document.mime_type, 'Cache-Control': 'no-store' }, raw: true };
  }
  const segments = path.split('/').filter(Boolean), collection = collectionKeys[segments[0]];
  if (path === '/category-budgets' && method === 'POST') {
    const existing = data.categoryBudgets.find(item => item.category === body.category);
    if (existing) { existing.amount = Number(body.amount); return response(existing); }
  }
  if (segments[0] === 'category-budgets' && segments.length === 2 && method === 'DELETE') {
    data.categoryBudgets = data.categoryBudgets.filter(item => item.category !== segments[1]); return response(null, 204);
  }
  if (collection && segments.length === 1) {
    if (method === 'GET' || method === 'HEAD') return { ...collectionResponse(session, collection), delayMs };
    if (method === 'POST') {
      let createBody = body;
      if (collection === 'accounts') {
        const target = data.members.find(member => member.id === body.member_id && member.membership_state === 'active');
        if (!target) return error('INVALID_MEMBER', 'عضو نامعتبر است.', 422);
        if (target.id !== data.actor.id && !(managersOnly(session) && target.relation === 'فرزند' && body.kind === 'bank')) return error('FORBIDDEN', 'فقط برای خودتان حساب بسازید؛ مدیر می‌تواند برای فرزند حساب اضافه کند.', 403);
      }
      if (collection === 'transactions') {
        const invalid = checkPreviewPayment(session, body);
        if (invalid) return invalid;
      }
      if (collection === 'bills') {
        const prepared = prepareBill(body);
        if (prepared.status) return prepared;
        createBody = prepared;
      }
      // These endpoints return the existing row on a repeated name, just like ON CONFLICT.
      if (collection === 'customCategories' || collection === 'subcategories') {
        const name = String(body.name ?? '').trim();
        if (!name || name.length > 30) return error('INVALID_CATEGORY', 'نام دسته باید ۱ تا ۳۰ کاراکتر باشد.', 422);
        if (collection === 'customCategories' && !['expense', 'income'].includes(body.type)) return error('INVALID_TYPE', 'نوع دسته نامعتبر است.', 422);
        const parent = String(body.category ?? '').trim();
        if (collection === 'subcategories' && (!parent || parent.length > 60)) return error('INVALID_CATEGORY', 'دستهٔ والد نامعتبر است.', 422);
        const existing = data[collection].find(item => item.name === name
          && (collection === 'customCategories' ? item.type === body.type : item.category === parent));
        if (existing) return response(existing, 201);
        createBody = { ...body, name, ...(collection === 'subcategories' ? { category: parent } : {}) };
      }
      if (['children', 'pets'].includes(collection) && !managersOnly(session)) return error('FORBIDDEN', 'فقط مدیر خانواده مجاز است.', 403);
      const item = normalizeCreate(session, collection, createBody); data[collection].push(item); return response(item, 201);
    }
  }
  if (collection && segments.length === 2) return mutateRow(session, collection, segments[1], method, body);
  if (path === '/auth/members' && method === 'POST') {
    const member = { ...clone(data.actor), id: randomUUID(), name: body.name, phone: body.phone, role: 'member', status: 'pending', membership_state: 'active', relation: body.relation ?? 'سایر', gender: null, birth_date: null };
    data.members.push(member); return response(member, 201);
  }
  if (/^\/auth\/members\/[^/]+$/.test(path) && method === 'DELETE') { data.members = data.members.filter(item => item.id !== path.split('/')[3]); return response(null, 204); }
  return error('PREVIEW_ENDPOINT_NOT_FOUND', 'این مسیر نمونه در پیش‌نمایش موجود نیست.', 404);
}

function mutateRow(session, key, itemId, method, body) {
  const list = session.data[key], item = list.find(row => row.id === itemId);
  if (!item) return error('NOT_FOUND', 'مورد نمونه یافت نشد.', 404);
  if (method === 'GET' || method === 'HEAD') return response(item);
  if (key === 'accounts' && item.member_id !== session.data.actor.id) return error('NOT_FOUND', 'حساب یافت نشد.', 404);
  if (body.base_revision !== undefined && item.revision !== body.base_revision) return error('SYNC_CONFLICT', 'این مورد تغییر کرده است؛ نسخهٔ ذخیره‌شده را بررسی کنید.', 409);
  if (['children', 'pets'].includes(key) && !managersOnly(session)) return error('FORBIDDEN', 'فقط مدیر خانواده مجاز است.', 403);
  if (key === 'bills' && item.state === 'paid' && ['DELETE', 'PATCH'].includes(method)) return error('BILL_ALREADY_PAID', 'قبض پرداخت‌شده قابل تغییر نیست؛ ابتدا پرداخت را برگردانید.', 409);
  if (method === 'DELETE') {
    if (key === 'accounts') {
      if (body.confirmation !== item.title) return error('ACCOUNT_CONFIRMATION_REQUIRED', 'برای تأیید حذف، نام حساب را دقیق وارد کنید.', 422);
      if (session.data.transactions.some(row => row.account_id === itemId || row.to_account_id === itemId)) return error('ACCOUNT_IN_USE', 'این حساب سابقهٔ تراکنش دارد و حذف نمی‌شود؛ سابقهٔ مالی حفظ می‌شود.', 409);
    }
    if (key === 'transactions' && session.data.transactions.some(row => row.recurring_source_id === itemId)) return error('RECURRING_HISTORY_EXISTS', 'این تراکنش نوبت تسویه‌شده دارد؛ تکرار را متوقف کنید تا سابقه حفظ شود.', 409);
    if (key === 'customCategories' && session.data.transactions.some(transaction => transaction.category === itemId)) {
      return error('CATEGORY_IN_USE', 'این دسته در تراکنش‌ها به‌کار رفته و حذف نمی‌شود.', 409);
    }
    if (key === 'customCategories') {
      const subcategoryIds = new Set(session.data.subcategories.filter(subcategory => subcategory.category === itemId).map(subcategory => subcategory.id));
      session.data.subcategories = session.data.subcategories.filter(subcategory => subcategory.category !== itemId);
      session.data.categoryBudgets = session.data.categoryBudgets.filter(budget => budget.category !== itemId);
      for (const transaction of session.data.transactions) if (subcategoryIds.has(transaction.subcategory_id)) transaction.subcategory_id = null;
    }
    if (key === 'subcategories') for (const transaction of session.data.transactions) {
      if (transaction.subcategory_id === itemId) transaction.subcategory_id = null;
    }
    session.data[key] = list.filter(row => row.id !== itemId);
    if (key === 'transactions') for (const bill of session.data.bills) {
      if (bill.transaction_id === itemId) bill.transaction_id = null;
    }
    return response(null, 204);
  }
  if (method === 'PATCH' || method === 'POST') {
    const values = clone(body); delete values.base_revision; delete values.operation_id;
    if (key === 'accounts') {
      if ((values.card_number ?? null) !== item.card_number && !values.confirm_card_change) return error('ACCOUNT_CONFIRMATION_REQUIRED', 'تغییر شماره کارت را تأیید کنید.', 422);
      delete values.confirm_card_change; delete values.member_id; delete values.kind;
    }
    if (key === 'transactions') {
      const invalid = checkPreviewPayment(session, values, item);
      if (invalid) return invalid;
    }
    if (key === 'bills') {
      const prepared = prepareBill(values);
      if (prepared.status) return prepared;
      Object.assign(item, prepared); return response(item);
    }
    // AccountUpdate uses null to preserve the stored opening balance.
    if (key === 'accounts' && values.initial_balance == null) delete values.initial_balance;
    Object.assign(item, values, { revision: (item.revision || 0) + 1 }); return response(item);
  }
  return error('METHOD_NOT_ALLOWED', 'این عملیات در پیش‌نمایش پشتیبانی نمی‌شود.', 405);
}

function validIso(value) {
  const date = new Date(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
const persianCalendar = new Intl.DateTimeFormat('en-u-ca-persian', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' });
function persianParts(date) {
  const parts = Object.fromEntries(persianCalendar.formatToParts(date).map(part => [part.type, Number(part.value)]));
  return [parts.year, parts.month, parts.day];
}
function persianIso(year, month, day) {
  const target = year * 10000 + month * 100 + day;
  let lo = Math.floor(Date.UTC(year + 621, 0, 1) / 86400000), hi = Math.floor(Date.UTC(year + 622, 11, 31) / 86400000);
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2), [y, m, d] = persianParts(new Date(mid * 86400000));
    if (y * 10000 + m * 100 + d <= target) lo = mid; else hi = mid - 1;
  }
  return new Date(lo * 86400000).toISOString().slice(0, 10);
}
function previewSchedule(row) {
  if (row.repeat === 'none') return [];
  const start = row.recurring_plan?.start_date ?? row.date, [year, month, day] = persianParts(new Date(start));
  const dates = [];
  for (let n = row.recurring_plan?.start_date ? 0 : 1; n <= 1200; n++) {
    const index = year * 12 + month - 1 + n;
    const due = row.repeat === 'weekly' ? new Date(Date.parse(start) + n * 7 * 86400000).toISOString().slice(0, 10)
      : row.repeat === 'monthly' ? persianIso(Math.floor(index / 12), index % 12 + 1, day) : persianIso(year + n, month, day);
    if (row.repeat_end && due > row.repeat_end) break;
    dates.push(due);
  }
  return dates;
}
function checkPreviewPayment(session, values, replacing) {
  const { data } = session;
  if (!managersOnly(session) && values.member_id !== data.actor.id) return error('FORBIDDEN', 'نمی‌توانید تراکنش را به عضو دیگری نسبت دهید.', 403);
  if (!Number.isFinite(Number(values.amount)) || Number(values.amount) <= 0) return error('INVALID_AMOUNT', 'مبلغ باید بزرگ‌تر از صفر باشد.', 422);
  const account = data.accounts.find(item => item.id === values.account_id);
  if (!values.account_id && values.require_available_balance && data.accounts.some(item => item.member_id === data.actor.id)) return error('ACCOUNT_REQUIRED', 'حساب پرداخت یا دریافت را انتخاب کنید.', 422);
  if (values.account_id && (!account || account.member_id !== (replacing && managersOnly(session) ? replacing.member_id : data.actor.id))) return error('ACCOUNT_FORBIDDEN', 'فقط حساب‌های خودتان قابل انتخاب‌اند.', 403);
  if (values.type === 'transfer' && (!account || values.to_account_id === account.id || !data.accounts.some(item => item.id === values.to_account_id))) return error('INVALID_TRANSFER', 'انتقال به حساب مبدأ و مقصد متفاوت نیاز دارد.', 422);
  if (account && values.require_available_balance && values.type !== 'income') {
    const balance = data.transactions.filter(item => item.id !== replacing?.id).reduce((sum, item) => sum
      + (item.account_id === account.id ? Number(item.amount) * (item.type === 'income' ? 1 : -1) : 0)
      + (item.type === 'transfer' && item.to_account_id === account.id ? Number(item.amount) : 0), Number(account.initial_balance));
    if (balance < Number(values.amount)) return error('INSUFFICIENT_BALANCE', 'موجودی حساب برای این پرداخت کافی نیست.', 409);
  }
  return null;
}

function prepareBill(body) {
  const title = String(body.title ?? '').trim();
  if (!['electricity', 'water', 'gas', 'internet', 'phone', 'charge', 'other'].includes(body.kind)) return error('INVALID_INPUT', 'نوع قبض نامعتبر است.', 422);
  if (!title || title.length > 120) return error('INVALID_INPUT', 'عنوان قبض باید ۱ تا ۱۲۰ کاراکتر باشد.', 422);
  if (!Number.isFinite(Number(body.amount)) || Number(body.amount) <= 0 || Number(body.amount) > 9_999_999_999_999.99) return error('INVALID_AMOUNT', 'مبلغ قبض نامعتبر است.', 422);
  const date = new Date(body.due_date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.due_date) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== body.due_date) return error('INVALID_DATE', 'تاریخ سررسید نامعتبر است.', 422);
  const values = { kind: body.kind, title, amount: Number(body.amount), due_date: body.due_date, note: String(body.note ?? '').trim() || null };
  for (const key of ['bill_no', 'payment_no']) {
    const value = String(body[key] ?? '').replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 1776)).replace(/\s/g, '');
    if (value && (!/^\d+$/.test(value) || value.length > 40)) return error('INVALID_INPUT', 'شناسهٔ قبض باید فقط رقم و حداکثر ۴۰ کاراکتر باشد.', 422);
    values[key] = value || null;
  }
  return values;
}
