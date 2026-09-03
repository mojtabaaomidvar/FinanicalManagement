-- ═══════════════════════════════════════════════════════════
-- مالی من — اسکیمای Supabase (PostgreSQL) — نسخه ۳.۵
-- ورود با شماره موبایل + رمز (کد پیامکی اختیاری) + کارت‌ها/حساب‌ها + پل پیامک + حساب منشا/مقصد تراکنش
-- بدون نیاز به هیچ افزونه‌ای (pgcrypto لازم نیست — توکن‌ها از gen_random_uuid ساخته می‌شوند)
--
-- اجرا در: Supabase Dashboard → SQL Editor → New query → Run
-- (روی پروژه جدید یا قبلی قابل اجراست — idempotent)
--
-- امنیت نسخه ۳.۲:
--   • هیچ جدولی مستقیماً از کلاینت قابل خواندن/نوشتن نیست (RLS بسته)
--   • همه دسترسی‌ها از طریق توابع RPC با security definer
--   • نشست با توکن ۶۴ کاراکتری — ۷ روز پس از آخرین استفاده منقضی می‌شود
--     (هر بار باز کردن اپ، اعتبار نشست تمدید می‌گردد)
--   • کد OTP با کلید app_settings.otp_enabled قابل روشن/خاموش است
--     (پیش‌فرض: خاموش) — در حالت روشن برای ورود/ثبت‌نام/دعوت اجباری است
--   • قفل ۱۵ دقیقه‌ای پس از ۱۰ تلاش ناموفق (رمز یا کد)
-- ═══════════════════════════════════════════════════════════

-- ─────────── جدول خانواده‌ها ───────────
create table if not exists public.families (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  code        text not null unique,              -- کد نمایشی خانواده
  budget      numeric(15,2) not null default 0,  -- بودجه ماهانه (۰ = غیرفعال)
  currency    text not null default 'تومان',     -- واحد نمایش
  dark        boolean not null default false,    -- تم تیره (پیش‌فرض برند: روشن)
  created_at  timestamptz not null default now()
);

-- ─────────── جدول اعضا (با شماره موبایل و رمز) ───────────
create table if not exists public.members (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references public.families(id) on delete cascade,
  name          text not null,
  role          text not null default 'member',  -- 'owner' | 'member'
  phone         text unique,                     -- 09xxxxxxxxx
  password_hash text,                            -- SHA-256(phone:password) هگز
  created_at    timestamptz not null default now()
);

-- مهاجرت از نسخه ۲ (اگر جدول قدیمی باشد)
alter table public.members add column if not exists phone text;
alter table public.members add column if not exists password_hash text;
create unique index if not exists idx_members_phone on public.members(phone) where phone is not null;

-- پروفایل و وضعیت عضو (v5.1)
alter table public.members add column if not exists gender text
  check (gender is null or gender in ('male','female'));
alter table public.members add column if not exists birth_date date;
alter table public.members add column if not exists national_id text;
alter table public.members add column if not exists avatar_url text;
alter table public.members add column if not exists status text not null default 'active'
  check (status in ('pending','active'));
-- تنظیمات شخصی عضو (v5.5): تم = light | dark | auto
alter table public.members add column if not exists theme text not null default 'auto'
  check (theme in ('light','dark','auto'));
-- نسبت عضو با مدیر خانواده (v5.7): خودم | همسر | فرزند | پدر/مادر | خواهر/برادر | سایر
alter table public.members add column if not exists relation text not null default 'خودم';

-- ─────────── جدول تراکنش‌ها ───────────
create table if not exists public.transactions (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  member_id   uuid not null references public.members(id) on delete cascade,
  type        text not null check (type in ('expense','income')),
  amount      numeric(15,2) not null check (amount > 0),
  category    text not null default 'other-e',
  date        date not null,                     -- تاریخ میلادی؛ جلالی در کلاینت
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_tx_family on public.transactions(family_id);
create index if not exists idx_tx_member on public.transactions(member_id);
create index if not exists idx_tx_date   on public.transactions(date);

-- مهاجرت نسخه ۳.۵: حساب منشا/مقصد تراکنش (اختیاری)
alter table public.transactions add column if not exists account_id uuid
  references public.accounts(id) on delete set null;
create index if not exists idx_tx_account on public.transactions(account_id);

-- مهاجرت: ساعت ثبت تراکنش (اختیاری — "HH:MM")
alter table public.transactions add column if not exists time text;

-- ─────────── جدول پیامک‌های بانکی ───────────
create table if not exists public.sms_messages (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  member_id   uuid references public.members(id) on delete set null,
  raw_text    text not null,
  bank        text,
  type        text check (type in ('expense','income')),
  amount      numeric(15,2),
  balance     numeric(15,2),
  date        date,
  status      text not null default 'pending'
              check (status in ('pending','recorded','ignored')),
  created_at  timestamptz not null default now()
);

create index if not exists idx_sms_family on public.sms_messages(family_id);
create index if not exists idx_sms_status on public.sms_messages(status);

-- ─────────── جدول کدهای یک‌بار مصرف (OTP) ───────────
create table if not exists public.otp_codes (
  id         uuid primary key default gen_random_uuid(),
  phone      text not null,
  code       text not null,
  expires_at timestamptz not null,
  used       boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_otp_phone on public.otp_codes(phone);

-- ─────────── جدول نشست‌ها (توکن لاگین) ───────────
create table if not exists public.sessions (
  id         uuid primary key default gen_random_uuid(),
  token      text not null unique,
  member_id  uuid not null references public.members(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists idx_sessions_member on public.sessions(member_id);

-- ─────────── جدول تلاش‌های ورود (ضد brute-force) ───────────
create table if not exists public.auth_attempts (
  id         uuid primary key default gen_random_uuid(),
  phone      text not null,
  ok         boolean not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_attempts_phone on public.auth_attempts(phone, created_at);

-- ─────────── جدول دعوت‌نامه‌های خانواده ───────────
create table if not exists public.family_invites (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references public.families(id) on delete cascade,
  token      text not null unique,
  created_by uuid references public.members(id) on delete set null,
  active     boolean not null default true,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_invites_family on public.family_invites(family_id);

-- ─────────── تنظیمات سراسری اپ ───────────
-- dev_mode    = true  → درخواست OTP مستقیم از کلاینت مجاز است (کد به کلاینت برمی‌گردد)
-- dev_mode    = false → فقط تابع سرورless ارسال پیامک کار می‌کند (حالت تولید)
-- otp_enabled = false → ورود/ثبت‌نام/دعوت فقط با شماره + رمز (بدون کد پیامکی)
-- otp_enabled = true  → کد پیامکی برای هر سه مسیر اجباری است
create table if not exists public.app_settings (
  id          integer primary key default 1 check (id = 1),
  dev_mode    boolean not null default true,
  otp_enabled boolean not null default false
);

-- مهاجرت از نسخه‌های قبلی (افزودن ستون otp_enabled)
alter table public.app_settings add column if not exists otp_enabled boolean not null default false;

insert into public.app_settings (id, dev_mode) values (1, true)
on conflict (id) do nothing;

-- مهاجرت برند خانه یار: تم روشن پیش‌فرض برای خانواده‌های موجود
update public.families set dark = false where dark = true;

-- ═══════════════════════════════════════════════════════════
-- Row Level Security — همه جداول بسته؛ فقط RPC دسترسی دارد
-- ═══════════════════════════════════════════════════════════

alter table public.families       enable row level security;
alter table public.members        enable row level security;
alter table public.transactions   enable row level security;
alter table public.sms_messages   enable row level security;
alter table public.otp_codes      enable row level security;
alter table public.family_invites enable row level security;
alter table public.app_settings   enable row level security;
alter table public.sessions       enable row level security;
alter table public.auth_attempts  enable row level security;

-- حذف پالیسی‌های باز نسخه‌های قبلی (اگر وجود داشته باشند)
drop policy if exists "families_select"     on public.families;
drop policy if exists "members_select"      on public.members;
drop policy if exists "transactions_select" on public.transactions;
drop policy if exists "sms_select"          on public.sms_messages;
drop policy if exists "settings_select"     on public.app_settings;
drop policy if exists "families_insert"     on public.families;
drop policy if exists "members_insert"      on public.members;
drop policy if exists "transactions_insert" on public.transactions;
drop policy if exists "sms_insert"          on public.sms_messages;
drop policy if exists "families_update"     on public.families;
drop policy if exists "transactions_update" on public.transactions;
drop policy if exists "sms_update"          on public.sms_messages;
drop policy if exists "members_update"      on public.members;
drop policy if exists "transactions_delete" on public.transactions;
drop policy if exists "sms_delete"          on public.sms_messages;
drop policy if exists "members_delete"      on public.members;

-- هیچ پالیسی‌ای ساخته نمی‌شود → دسترسی مستقیم PostgREST به همه جداول منع می‌شود.
-- فقط توابع security definer (زیر) و کلید service_role (تابع سرورless) اجازه دارند.

-- ═══════════════════════════════════════════════════════════
-- حذف توابع نسخه قبلی که امضایشان تغییر کرده است
-- (CREATE OR REPLACE با امضای متفاوت، اورلود می‌سازد — باید DROP شوند)
-- ═══════════════════════════════════════════════════════════

drop function if exists public.auth_register(text, text, text, text);
drop function if exists public.auth_register(text, text, text, text, text);
drop function if exists public.auth_register(text, text, text, text, text, text);
drop function if exists public.accept_invite(text, text, text, text);
drop function if exists public.create_invite(uuid);
drop function if exists public.auth_check_otp(text, text);
drop function if exists public.add_member_by_manager(text, text, text);
drop function if exists public.add_member_by_manager(text, text, text, text);
drop function if exists public.add_event(text, text, date, text);
drop function if exists public.add_event(text, text, date, text, uuid);
drop function if exists public.delete_event(text, uuid);
drop function if exists public.delete_transaction(text, uuid, uuid);
drop function if exists public.delete_account(text, uuid, text);
drop function if exists public.add_account(text, uuid, text, text, text, text, text);
drop function if exists public.add_transaction(text, uuid, text, numeric, text, date, text);
drop function if exists public.update_transaction(text, uuid, uuid, text, numeric, text, date, text);
drop function if exists public.add_transaction(text, uuid, text, numeric, text, date, text, uuid);
drop function if exists public.update_transaction(text, uuid, uuid, text, numeric, text, date, text, uuid);
drop function if exists public.add_transaction(text, uuid, text, numeric, text, date, text, uuid, uuid);
drop function if exists public.update_transaction(text, uuid, uuid, text, numeric, text, date, text, uuid, uuid);

-- ═══════════════════════════════════════════════════════════
-- توابع کمکی داخلی
-- ═══════════════════════════════════════════════════════════

-- تولید کد نمایشی ۶ رقمی یکتا
create or replace function public.generate_family_code()
returns text language plpgsql as $$
declare
  new_code text;
begin
  loop
    new_code := lpad((floor(random() * 1000000))::text, 6, '0');
    exit when not exists (select 1 from public.families where code = new_code);
  end loop;
  return new_code;
end $$;

-- یافتن شناسه عضو از توکن نشست (یا خطا)
-- نشست لغزان: هر استفاده، ۷ روز دیگر اعتبار می‌دهد — ۷ روز عدم فعالیت = خروج خودکار
create or replace function public._session_member_id(p_token text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_member_id uuid;
begin
  delete from public.sessions where expires_at < now();

  select member_id into v_member_id from public.sessions
  where token = p_token and expires_at > now();

  if v_member_id is null then
    raise exception 'SESSION_EXPIRED';
  end if;

  update public.sessions
  set expires_at = now() + interval '7 days'
  where token = p_token;

  return v_member_id;
end $$;

-- یافتن شناسه خانواده از توکن نشست
create or replace function public._family_id(p_token text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_family_id uuid;
begin
  select m.family_id into v_family_id
  from public.members m
  where m.id = public._session_member_id(p_token);

  if v_family_id is null then
    raise exception 'SESSION_EXPIRED';
  end if;
  return v_family_id;
end $$;

-- ساخت نشست جدید برای عضو → توکن (اعتبار اولیه ۷ روز، با هر استفاده تمدید می‌شود)
-- توکن از دو UUID تصادفی ساخته می‌شود (۶۴ رقم هگز) — بدون نیاز به افزونه pgcrypto
create or replace function public._create_session(p_member_id uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_token text;
begin
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.sessions (token, member_id, expires_at)
  values (v_token, p_member_id, now() + interval '7 days');
  return v_token;
end $$;

-- مصرف کد OTP (بررسی + used کردن) — با قفل ضد brute-force
-- اگر OTP در app_settings خاموش باشد، بدون بررسی رد می‌شود
create or replace function public._consume_otp(p_phone text, p_code text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_otp record;
  v_fails int;
  v_otp_on boolean;
begin
  select otp_enabled into v_otp_on from public.app_settings where id = 1;
  if v_otp_on is null or not v_otp_on then
    return;  -- OTP غیرفعال است
  end if;

  select count(*) into v_fails from public.auth_attempts
  where phone = p_phone and ok = false and created_at > now() - interval '15 minutes';
  if v_fails >= 10 then
    raise exception 'TOO_MANY_ATTEMPTS';
  end if;

  select * into v_otp from public.otp_codes
  where phone = p_phone and code = p_code and used = false
    and expires_at > now()
  order by created_at desc limit 1;

  if not found then
    insert into public.auth_attempts (phone, ok) values (p_phone, false);
    raise exception 'INVALID_OTP';
  end if;

  update public.otp_codes set used = true where id = v_otp.id;
  delete from public.auth_attempts where phone = p_phone and ok = false;
end $$;

-- تنظیمات عمومی اپ (بدون نیاز به احراز هویت) — کلاینت از این می‌فهمد OTP فعال است یا نه
create or replace function public.get_public_config()
returns json
language sql security definer set search_path = public as $$
  select json_build_object(
    'otp_enabled', coalesce(
      (select otp_enabled from public.app_settings where id = 1), false
    )
  )
$$;

-- ═══════════════════════════════════════════════════════════
-- توابع احراز هویت (RPC — security definer)
-- ═══════════════════════════════════════════════════════════

-- بررسی رمز عبور (مرحله ۱ ورود) — با قفل ضد brute-force
create or replace function public.auth_check_password(
  p_phone text, p_password_hash text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_ok boolean;
  v_fails int;
begin
  select count(*) into v_fails from public.auth_attempts
  where phone = p_phone and ok = false and created_at > now() - interval '15 minutes';
  if v_fails >= 10 then
    raise exception 'TOO_MANY_ATTEMPTS';
  end if;

  select exists (
    select 1 from public.members
    where phone = p_phone and password_hash = p_password_hash
  ) into v_ok;

  insert into public.auth_attempts (phone, ok) values (p_phone, v_ok);
  delete from public.auth_attempts where created_at < now() - interval '1 day';

  return v_ok;
end $$;

-- درج کد OTP (برای تابع سرورless و حالت توسعه)
create or replace function public.insert_otp(
  p_phone text, p_code text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  -- حذف کدهای قدیمی
  delete from public.otp_codes
  where phone = p_phone or created_at < now() - interval '1 hour';

  insert into public.otp_codes (phone, code, expires_at)
  values (p_phone, p_code, now() + interval '5 minutes');
end $$;

-- درخواست OTP در حالت توسعه (dev_mode) — کد به کلاینت برمی‌گردد
-- در حالت تولید (dev_mode=false) خطا می‌دهد؛ فقط /api/send-otp مجاز است
create or replace function public.request_otp_dev(
  p_phone text
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_dev boolean;
begin
  select dev_mode into v_dev from public.app_settings where id = 1;
  if v_dev is null or not v_dev then
    raise exception 'OTP_API_ONLY';
  end if;

  -- حداقل ۶۰ ثانیه بین هر درخواست
  if exists (
    select 1 from public.otp_codes
    where phone = p_phone and created_at > now() - interval '60 seconds'
  ) then
    raise exception 'TOO_SOON';
  end if;

  v_code := lpad((floor(random() * 1000000))::text, 6, '0');
  perform public.insert_otp(p_phone, v_code);
  return v_code;
end $$;

-- ورود نهایی: تأیید OTP + ساخت نشست + بازگرداندن عضو و خانواده
create or replace function public.auth_login(
  p_phone text, p_code text
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_member public.members;
  v_family public.families;
  v_token  text;
begin
  perform public._consume_otp(p_phone, p_code);

  select * into v_member from public.members where phone = p_phone;
  if not found then
    raise exception 'NO_MEMBER';
  end if;

  select * into v_family from public.families where id = v_member.family_id;
  v_token := public._create_session(v_member.id);

  return json_build_object(
    'member', to_jsonb(v_member),
    'family', to_jsonb(v_family),
    'session_token', v_token
  );
end $$;

-- ثبت‌نام: تأیید OTP + ساخت خانواده + عضو مدیر + نشست
-- اگر شماره قبلاً توسط مدیر به‌عنوان عضو (pending) ثبت شده باشد،
-- ثبت‌نام همان عضو را کامل می‌کند (خانواده موجود، نقش member)
create or replace function public.auth_register(
  p_family_name text, p_member_name text,
  p_phone text, p_password_hash text, p_otp_code text,
  p_relation text default 'خودم'
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_family public.families;
  v_member public.members;
  v_token  text;
begin
  perform public._consume_otp(p_phone, p_otp_code);

  if p_relation is null or btrim(p_relation) = '' then
    raise exception 'INVALID_RELATION';
  end if;

  select * into v_member from public.members where phone = p_phone;
  if found then
    if v_member.status = 'pending' then
      -- تکمیل ثبت‌نام عضو معرفی‌شده توسط مدیر
      update public.members
      set name         = coalesce(nullif(btrim(p_member_name), ''), name),
          password_hash = p_password_hash,
          status       = 'active',
          relation     = btrim(p_relation)
      where id = v_member.id
      returning * into v_member;

      select * into v_family from public.families where id = v_member.family_id;
      v_token := public._create_session(v_member.id);
      return json_build_object(
        'member', to_jsonb(v_member),
        'family', to_jsonb(v_family),
        'session_token', v_token
      );
    else
      raise exception 'PHONE_EXISTS';
    end if;
  end if;

  insert into public.families (name, code)
  values (p_family_name, public.generate_family_code())
  returning * into v_family;

  -- عضو اول = مدیر (نسبت همیشه «خودم»)
  insert into public.members (family_id, name, role, phone, password_hash, relation)
  values (v_family.id, p_member_name, 'owner', p_phone, p_password_hash, 'خودم')
  returning * into v_member;

  v_token := public._create_session(v_member.id);

  return json_build_object(
    'member', to_jsonb(v_member),
    'family', to_jsonb(v_family),
    'session_token', v_token
  );
end $$;

-- ─────────── عضو پیش‌ثبت‌شده توسط مدیر ───────────

-- بررسی عمومی: آیا این شماره توسط مدیری به‌عنوان عضو معرفی شده؟
-- (بدون نیاز به احراز هویت — فقط نام خانواده و نام عضو برمی‌گرداند)
create or replace function public.check_pre_registered(p_phone text)
returns json
language sql security definer set search_path = public as $$
  select coalesce(
    (
      select json_build_object(
        'pre_registered', true,
        'family_name', f.name,
        'member_name', m.name
      )
      from public.members m
      join public.families f on f.id = m.family_id
      where m.phone = p_phone and m.status = 'pending'
      limit 1
    ),
    json_build_object('pre_registered', false)
  )::json
$$;

-- افزودن عضو توسط مدیر (اسم، شماره و نسبت با مدیر — عضو pending تا خودش ثبت‌نام کند)
create or replace function public.add_member_by_manager(
  p_token text, p_name text, p_phone text, p_relation text default 'سایر'
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_family_id uuid;
  v_actor_role text;
  v_row public.members;
begin
  v_family_id := public._family_id(p_token);

  select role into v_actor_role from public.members
  where id = public._session_member_id(p_token);

  if v_actor_role <> 'owner' then
    raise exception 'FORBIDDEN';
  end if;

  if p_name is null or length(btrim(p_name)) < 1 or length(btrim(p_name)) > 40 then
    raise exception 'INVALID_NAME';
  end if;
  if p_phone is null or p_phone !~ '^09\d{9}$' then
    raise exception 'INVALID_PHONE';
  end if;
  if p_relation is null or btrim(p_relation) = '' then
    raise exception 'INVALID_RELATION';
  end if;
  if exists (select 1 from public.members where phone = p_phone) then
    raise exception 'PHONE_EXISTS';
  end if;

  insert into public.members (family_id, name, role, phone, status, relation)
  values (v_family_id, btrim(p_name), 'member', p_phone, 'pending', btrim(p_relation))
  returning * into v_row;

  return to_jsonb(v_row);
end $$;

-- ─────────── دعوت اعضا ───────────

-- ساخت لینک دعوت جدید (خانواده از نشست کاربر مشخص می‌شود)
create or replace function public.create_invite(
  p_token text
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_token    text;
  v_family_id uuid;
begin
  v_family_id := public._family_id(p_token);

  update public.family_invites
  set active = false
  where family_id = v_family_id and active = true;

  v_token := left(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 40);
  insert into public.family_invites (family_id, token, expires_at)
  values (v_family_id, v_token, now() + interval '30 days');

  return v_token;
end $$;

-- اطلاعات دعوت‌نامه (نام خانواده) برای کسی که لینک را باز می‌کند
create or replace function public.get_invite(
  p_token text
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_inv record;
  v_family public.families;
begin
  select * into v_inv from public.family_invites
  where token = p_token and active = true and expires_at > now();

  if not found then
    raise exception 'INVALID_INVITE';
  end if;

  select * into v_family from public.families where id = v_inv.family_id;

  return json_build_object('family_name', v_family.name);
end $$;

-- پذیرش دعوت: تأیید OTP + ثبت‌نام عضو جدید در خانواده + نشست
create or replace function public.accept_invite(
  p_token text, p_member_name text,
  p_phone text, p_password_hash text, p_otp_code text
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_inv     record;
  v_member  public.members;
  v_family  public.families;
  v_session text;
begin
  perform public._consume_otp(p_phone, p_otp_code);

  select * into v_inv from public.family_invites
  where token = p_token and active = true and expires_at > now();

  if not found then
    raise exception 'INVALID_INVITE';
  end if;

  if exists (select 1 from public.members where phone = p_phone) then
    raise exception 'PHONE_EXISTS';
  end if;

  insert into public.members (family_id, name, role, phone, password_hash)
  values (v_inv.family_id, p_member_name, 'member', p_phone, p_password_hash)
  returning * into v_member;

  select * into v_family from public.families where id = v_inv.family_id;
  v_session := public._create_session(v_member.id);

  return json_build_object(
    'member', to_jsonb(v_member),
    'family', to_jsonb(v_family),
    'session_token', v_session
  );
end $$;

-- ═══════════════════════════════════════════════════════════
-- نشست
-- ═══════════════════════════════════════════════════════════

-- اعتبارسنجی نشست: عضو + خانواده + اعضا (یک درخواست برای ورود به اپ)
create or replace function public.validate_session(
  p_token text
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_member public.members;
  v_family public.families;
begin
  select * into v_member from public.members
  where id = public._session_member_id(p_token);

  select * into v_family from public.families where id = v_member.family_id;

  return json_build_object(
    'member', to_jsonb(v_member),
    'family', to_jsonb(v_family),
    'members', coalesce((
      select json_agg(row_to_json(m))
      from (
        select id, name, role, phone, created_at
        from public.members
        where family_id = v_member.family_id
        order by created_at asc
      ) m
    ), '[]'::json)
  );
end $$;

-- خروج: حذف نشست
create or replace function public.logout_session(
  p_token text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.sessions where token = p_token;
end $$;

-- ═══════════════════════════════════════════════════════════
-- دسترسی داده — همه با توکن نشست
-- ═══════════════════════════════════════════════════════════

-- اطلاعات خانواده خود کاربر
create or replace function public.get_family(p_token text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_family public.families;
begin
  select * into v_family from public.families
  where id = public._family_id(p_token);
  return to_jsonb(v_family);
end $$;

-- اعضای خانواده خود کاربر
create or replace function public.get_members(p_token text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_family_id uuid;
begin
  v_family_id := public._family_id(p_token);
  return coalesce((
    select json_agg(row_to_json(m))
    from (
      select id, name, role, phone, created_at
      from public.members
      where family_id = v_family_id
      order by created_at asc
    ) m
  ), '[]'::json);
end $$;

-- حذف عضو (فقط مدیر؛ مدیر قابل حذف نیست)
create or replace function public.remove_member(
  p_token text, p_member_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actor public.members;
  v_target public.members;
begin
  select * into v_actor from public.members
  where id = public._session_member_id(p_token);

  select * into v_target from public.members where id = p_member_id;
  if not found or v_target.family_id <> v_actor.family_id then
    raise exception 'NOT_FOUND';
  end if;
  if v_actor.role <> 'owner' then
    raise exception 'FORBIDDEN';
  end if;
  if v_target.role = 'owner' then
    raise exception 'CANNOT_REMOVE_OWNER';
  end if;

  delete from public.sessions where member_id = v_target.id;
  delete from public.members where id = v_target.id;
end $$;

-- همه تراکنش‌های خانواده (با تصاویر پیوست)
create or replace function public.list_transactions(p_token text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_family_id uuid;
begin
  v_family_id := public._family_id(p_token);
  return coalesce((
    select json_agg(row_to_json(t))
    from (
      select tx.*,
             coalesce(ph.photos, '[]'::json) as photos
      from public.transactions tx
      left join lateral (
        select json_agg(json_build_object(
                 'id', p.id, 'url', p.url, 'caption', p.caption
               ) order by p.created_at) as photos
        from public.transaction_photos p
        where p.transaction_id = tx.id
      ) ph on true
      where tx.family_id = v_family_id
      order by tx.created_at desc
    ) t
  ), '[]'::json);
end $$;

-- افزودن تراکنش (حساب الزامی؛ زیردسته و ساعت اختیاری)
create or replace function public.add_transaction(
  p_token text, p_member_id uuid, p_type text, p_amount numeric,
  p_category text, p_date date, p_note text,
  p_account_id uuid, p_subcategory_id uuid default null,
  p_time text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_family_id uuid;
  v_row public.transactions;
begin
  v_family_id := public._family_id(p_token);

  if p_type not in ('expense','income') then
    raise exception 'INVALID_TYPE';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if p_category is null or btrim(p_category) = '' then
    raise exception 'INVALID_CATEGORY';
  end if;
  if p_date is null then
    raise exception 'INVALID_DATE';
  end if;
  if p_time is not null and p_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'INVALID_TIME';
  end if;
  if not exists (select 1 from public.members
                 where id = p_member_id and family_id = v_family_id) then
    raise exception 'INVALID_MEMBER';
  end if;

  -- دسته: از لیست ثابت یا دسته سفارشی همین خانواده با همین نوع
  if not exists (
    select 1 from public.custom_categories
    where family_id = v_family_id and type = p_type
      and id::text = btrim(p_category)
  ) and btrim(p_category) not in (
    'food','home','bills','transport','health','clothing','edu','fun','shopping',
    'comm','finance','insurance','gifte','family','beauty','sport','pet','other-e',
    'salary','business','invest','sale','gift','other-i'
  ) then
    raise exception 'INVALID_CATEGORY';
  end if;

  -- حساب منشا/مقصد الزامی است
  if p_account_id is null then
    raise exception 'ACCOUNT_REQUIRED';
  end if;
  if not exists (select 1 from public.accounts
                 where id = p_account_id and family_id = v_family_id) then
    raise exception 'INVALID_ACCOUNT_ID';
  end if;

  -- زیردسته باید متعلق به همین خانواده و همین دسته باشد
  if p_subcategory_id is not null and not exists (
    select 1 from public.subcategories
    where id = p_subcategory_id and family_id = v_family_id
      and category = btrim(p_category)) then
    raise exception 'INVALID_SUBCATEGORY';
  end if;

  insert into public.transactions
    (family_id, member_id, type, amount, category, date, time, note, account_id, subcategory_id)
  values
    (v_family_id, p_member_id, p_type, p_amount, btrim(p_category), p_date, p_time,
     nullif(btrim(coalesce(p_note, '')), ''), p_account_id, p_subcategory_id)
  returning * into v_row;

  return to_jsonb(v_row);
end $$;

-- ویرایش تراکنش (حساب الزامی؛ زیردسته و ساعت اختیاری)
create or replace function public.update_transaction(
  p_token text, p_tx_id uuid, p_member_id uuid, p_type text, p_amount numeric,
  p_category text, p_date date, p_note text,
  p_account_id uuid, p_subcategory_id uuid default null,
  p_time text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_family_id uuid;
begin
  v_family_id := public._family_id(p_token);

  if p_type not in ('expense','income') then
    raise exception 'INVALID_TYPE';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if p_category is null or btrim(p_category) = '' then
    raise exception 'INVALID_CATEGORY';
  end if;
  if p_date is null then
    raise exception 'INVALID_DATE';
  end if;
  if p_time is not null and p_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'INVALID_TIME';
  end if;
  if not exists (select 1 from public.members
                 where id = p_member_id and family_id = v_family_id) then
    raise exception 'INVALID_MEMBER';
  end if;

  if not exists (
    select 1 from public.custom_categories
    where family_id = v_family_id and type = p_type
      and id::text = btrim(p_category)
  ) and btrim(p_category) not in (
    'food','home','bills','transport','health','clothing','edu','fun','shopping',
    'comm','finance','insurance','gifte','family','beauty','sport','pet','other-e',
    'salary','business','invest','sale','gift','other-i'
  ) then
    raise exception 'INVALID_CATEGORY';
  end if;

  if p_account_id is null then
    raise exception 'ACCOUNT_REQUIRED';
  end if;
  if not exists (select 1 from public.accounts
                 where id = p_account_id and family_id = v_family_id) then
    raise exception 'INVALID_ACCOUNT_ID';
  end if;

  if p_subcategory_id is not null and not exists (
    select 1 from public.subcategories
    where id = p_subcategory_id and family_id = v_family_id
      and category = btrim(p_category)) then
    raise exception 'INVALID_SUBCATEGORY';
  end if;

  update public.transactions
  set member_id = p_member_id,
      type      = p_type,
      amount    = p_amount,
      category  = btrim(p_category),
      date      = p_date,
      time      = p_time,
      note      = nullif(btrim(coalesce(p_note, '')), ''),
      account_id = p_account_id,
      subcategory_id = p_subcategory_id
  where id = p_tx_id and family_id = v_family_id;

  if not found then
    raise exception 'NOT_FOUND';
  end if;
end $$;

-- حذف تراکنش: مدیر = هر تراکنش خانواده؛ عضو = فقط تراکنش خودش
create or replace function public.delete_transaction(
  p_token text, p_tx_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_member uuid;
  v_role text;
begin
  v_member := public._session_member_id(p_token);
  select role into v_role from public.members where id = v_member;

  if v_role = 'owner' then
    delete from public.transactions
    where id = p_tx_id and family_id = public._family_id(p_token);
  else
    delete from public.transactions
    where id = p_tx_id
      and family_id = public._family_id(p_token)
      and member_id = v_member;
  end if;

  if not found then
    raise exception 'NOT_FOUND';
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════
-- تصاویر پیوست تراکنش (رسید خرید، عکس محصول و…)
-- ═══════════════════════════════════════════════════════════

create table if not exists public.transaction_photos (
  id             uuid primary key default gen_random_uuid(),
  family_id      uuid not null references public.families(id) on delete cascade,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  member_id      uuid not null references public.members(id) on delete cascade,
  url            text not null,
  caption        text,
  created_at     timestamptz not null default now()
);

create index if not exists idx_tx_photos_tx on public.transaction_photos(transaction_id);

alter table public.transaction_photos enable row level security;
-- بدون پالیسی → دسترسی فقط از طریق RPC

-- افزودن تصویر به تراکنش (هر عضو خانواده؛ آپلودر ثبت می‌شود)
create or replace function public.add_tx_photo(
  p_token text, p_tx_id uuid, p_url text, p_caption text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_family_id uuid;
  v_actor uuid;
  v_row public.transaction_photos;
begin
  v_family_id := public._family_id(p_token);
  v_actor := public._session_member_id(p_token);

  if not exists (select 1 from public.transactions
                 where id = p_tx_id and family_id = v_family_id) then
    raise exception 'NOT_FOUND';
  end if;
  if p_url is null or length(btrim(p_url)) < 10 or length(p_url) > 500 then
    raise exception 'INVALID_URL';
  end if;
  if p_caption is not null and length(btrim(p_caption)) > 100 then
    raise exception 'INVALID_CAPTION';
  end if;

  insert into public.transaction_photos
    (family_id, transaction_id, member_id, url, caption)
  values
    (v_family_id, p_tx_id, v_actor, btrim(p_url),
     nullif(btrim(coalesce(p_caption, '')), ''))
  returning * into v_row;

  return to_jsonb(v_row);
end $$;

-- ویرایش توضیح تصویر: مدیر، آپلودر یا سازنده تراکنش
create or replace function public.update_tx_photo_caption(
  p_token text, p_photo_id uuid, p_caption text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_member uuid;
  v_role text;
begin
  v_member := public._session_member_id(p_token);
  select role into v_role from public.members where id = v_member;

  if p_caption is not null and length(btrim(p_caption)) > 100 then
    raise exception 'INVALID_CAPTION';
  end if;

  update public.transaction_photos p
  set caption = nullif(btrim(coalesce(p_caption, '')), '')
  where p.id = p_photo_id
    and p.family_id = public._family_id(p_token)
    and (
      v_role = 'owner'
      or p.member_id = v_member
      or exists (select 1 from public.transactions t
                 where t.id = p.transaction_id and t.member_id = v_member)
    );

  if not found then
    raise exception 'NOT_FOUND';
  end if;
end $$;

-- حذف تصویر: مدیر، آپلودر یا سازنده تراکنش
create or replace function public.delete_tx_photo(
  p_token text, p_photo_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_member uuid;
  v_role text;
begin
  v_member := public._session_member_id(p_token);
  select role into v_role from public.members where id = v_member;

  delete from public.transaction_photos p
  where p.id = p_photo_id
    and p.family_id = public._family_id(p_token)
    and (
      v_role = 'owner'
      or p.member_id = v_member
      or exists (select 1 from public.transactions t
                 where t.id = p.transaction_id and t.member_id = v_member)
    );

  if not found then
    raise exception 'NOT_FOUND';
  end if;
end $$;

-- پیامک‌های خانواده (با فیلتر اختیاری وضعیت)
create or replace function public.list_sms(p_token text, p_status text default null)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_family_id uuid;
begin
  v_family_id := public._family_id(p_token);
  return coalesce((
    select json_agg(row_to_json(s))
    from (
      select * from public.sms_messages
      where family_id = v_family_id
        and (p_status is null or status = p_status)
      order by created_at desc
    ) s
  ), '[]'::json);
end $$;

-- افزودن دسته‌ای پیامک بانکی (وضعیت pending)
-- p_items: آرایه‌ای از {raw_text, bank, type, amount, balance, date}
create or replace function public.add_sms_messages(
  p_token text, p_items jsonb
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_family_id  uuid;
  v_member_id  uuid;
  v_count      integer;
begin
  v_family_id := public._family_id(p_token);
  v_member_id := public._session_member_id(p_token);

  with ins as (
    insert into public.sms_messages
      (family_id, member_id, raw_text, bank, type, amount, balance, date, status)
    select
      v_family_id,
      v_member_id,
      (i->>'raw_text')::text,
      nullif(i->>'bank', ''),
      case when i->>'type' in ('expense','income') then i->>'type' end,
      nullif(i->>'amount', '')::numeric,
      nullif(i->>'balance', '')::numeric,
      nullif(i->>'date', '')::date,
      'pending'
    from jsonb_array_elements(p_items) as i
    where i->>'raw_text' is not null and btrim(i->>'raw_text') <> ''
    returning 1
  )
  select count(*) into v_count from ins;

  return v_count;
end $$;

-- تغییر وضعیت پیامک (recorded / ignored)
create or replace function public.set_sms_status(
  p_token text, p_sms_id uuid, p_status text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('pending','recorded','ignored') then
    raise exception 'INVALID_STATUS';
  end if;

  update public.sms_messages
  set status = p_status
  where id = p_sms_id and family_id = public._family_id(p_token);

  if not found then
    raise exception 'NOT_FOUND';
  end if;
end $$;

-- ذخیره تنظیمات خانواده (بودجه فقط مدیر؛ واحد/تم برای همه اعضا)
create or replace function public.update_family_settings(
  p_token text, p_budget numeric, p_currency text, p_dark boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_member uuid;
  v_role text;
begin
  v_member := public._session_member_id(p_token);
  select role into v_role from public.members where id = v_member;

  if v_role = 'owner' then
    update public.families
    set budget   = greatest(coalesce(p_budget, 0), 0),
        currency = coalesce(nullif(btrim(coalesce(p_currency, '')), ''), 'تومان'),
        dark     = coalesce(p_dark, true)
    where id = public._family_id(p_token);
  else
    update public.families
    set currency = coalesce(nullif(btrim(coalesce(p_currency, '')), ''), 'تومان'),
        dark     = coalesce(p_dark, true)
    where id = public._family_id(p_token);
  end if;

  if not found then
    raise exception 'NOT_FOUND';
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════
-- کارت‌ها و حساب‌های بانکی
-- ═══════════════════════════════════════════════════════════

create table if not exists public.accounts (
  id             uuid primary key default gen_random_uuid(),
  family_id      uuid not null references public.families(id) on delete cascade,
  member_id      uuid not null references public.members(id) on delete cascade,
  title          text not null,                    -- نام دلخواه (مثل «کارت اصلی من»)
  bank           text,                             -- نام بانک
  card_number    text,                             -- ۱۶ رقم (اختیاری)
  account_number text,                             -- شماره حساب (اختیاری)
  sheba          text,                             -- شبا IR + ۲۴ رقم (اختیاری)
  created_at     timestamptz not null default now()
);

create index if not exists idx_accounts_family on public.accounts(family_id);

alter table public.accounts enable row level security;
-- بدون پالیسی → دسترسی فقط از طریق RPC

-- پیش‌شماره‌های کارت (BIN) برای هم‌خوانی کارت با بانک انتخاب‌شده
create table if not exists public.card_bins (
  bin  text primary key check (bin ~ '^\d{6}$'),
  bank text not null
);

insert into public.card_bins (bin, bank) values
  ('610433','بانک ملت'),('991975','بانک ملت'),('628023','بانک ملت'),
  ('617353','بانک ملی'),('627483','بانک ملی'),('603799','بانک ملی'),('639607','بانک ملی'),
  ('603769','بانک صادرات'),('639347','بانک صادرات'),
  ('585983','بانک تجارت'),('627354','بانک تجارت'),('207177','بانک تجارت'),('636214','بانک تجارت'),
  ('589210','بانک سپه'),
  ('603770','بانک کشاورزی'),('627418','بانک کشاورزی'),('502908','بانک کشاورزی'),
  ('622106','بانک پارسیان'),('627889','بانک پارسیان'),('639194','بانک پارسیان'),
  ('502229','بانک پاسارگاد'),('502910','بانک پاسارگاد'),('628157','بانک پاسارگاد'),
  ('621986','بانک سامان'),('639346','بانک سامان'),
  ('589463','بانک رفاه'),
  ('505801','بانک گردشگری'),('505809','بانک گردشگری'),
  ('502806','بانک شهر'),('504706','بانک شهر'),
  ('502938','بانک دی'),
  ('627488','بانک کارآفرین'),('639607','بانک کارآفرین'),
  ('627648','بانک توسعه صادرات'),
  ('606373','بانک قرض‌الحسنه مهر ایران'),
  ('585949','بانک خاورمیانه'),
  ('627381','بانک انصاری'),
  ('627412','بانک سرمایه'),
  ('636949','بانک حکمت')
on conflict (bin) do nothing;

-- حذف نسخه‌های قدیمی در صورت تغییر امضا
drop function if exists public.list_accounts(text);
drop function if exists public.add_account(text, uuid, text, text, text, text, text);
drop function if exists public.delete_account(text, uuid);

-- همه کارت‌های خانواده
create or replace function public.list_accounts(p_token text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_family_id uuid;
begin
  v_family_id := public._family_id(p_token);
  return coalesce((
    select json_agg(row_to_json(a))
    from (
      select * from public.accounts
      where family_id = v_family_id
      order by created_at asc
    ) a
  ), '[]'::json);
end $$;

-- افزودن کارت/حساب (اعتبارسنجی کامل سمت سرور + هم‌خوانی BIN کارت با بانک)
-- هر یک از فیلدهای کارت/حساب/شبا به‌تنهایی کافی است؛ همه اختیاری‌اند
create or replace function public.add_account(
  p_token text, p_member_id uuid, p_title text, p_bank text,
  p_card_number text, p_account_number text, p_sheba text
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_family_id uuid;
  v_row public.accounts;
  v_card text;
  v_sheba text;
  v_account_no text;
begin
  v_family_id := public._family_id(p_token);

  if p_title is null or btrim(p_title) = '' then
    raise exception 'INVALID_TITLE';
  end if;
  if length(btrim(p_title)) > 40 then
    raise exception 'INVALID_TITLE';
  end if;
  if not exists (select 1 from public.members
                 where id = p_member_id and family_id = v_family_id) then
    raise exception 'INVALID_MEMBER';
  end if;

  v_card      := nullif(regexp_replace(coalesce(p_card_number, ''), '[^0-9]', '', 'g'), '');
  v_account_no := nullif(regexp_replace(coalesce(p_account_number, ''), '[^0-9]', '', 'g'), '');
  v_sheba     := nullif(upper(regexp_replace(coalesce(p_sheba, ''), '[^0-9a-zA-Z]', '', 'g')), '');

  if v_card is not null and v_card !~ '^\d{16}$' then
    raise exception 'INVALID_CARD';
  end if;
  if v_sheba is not null and v_sheba !~ '^IR\d{24}$' then
    raise exception 'INVALID_SHEBA';
  end if;
  if v_account_no is not null and v_account_no !~ '^\d{5,20}$' then
    raise exception 'INVALID_ACCOUNT_NO';
  end if;
  if v_card is null and v_account_no is null and v_sheba is null then
    raise exception 'EMPTY_ACCOUNT';
  end if;

  -- هم‌خوانی ۶ رقم اول کارت با بانک انتخاب‌شده (اگر بانک شناخته‌شده باشد)
  if v_card is not null and nullif(btrim(coalesce(p_bank, '')), '') is not null then
    if exists (
      select 1 from public.card_bins
      where bin = left(v_card, 6) and bank <> btrim(p_bank)
    ) then
      raise exception 'BANK_MISMATCH';
    end if;
    -- اگر بانک انتخابی اصلاً BIN ندارد و BIN این کارت متعلق به بانک دیگری است
    if not exists (select 1 from public.card_bins where bank = btrim(p_bank))
      and exists (select 1 from public.card_bins where bin = left(v_card, 6)) then
      raise exception 'BANK_MISMATCH';
    end if;
  end if;

  insert into public.accounts
    (family_id, member_id, title, bank, card_number, account_number, sheba)
  values
    (v_family_id, p_member_id, btrim(p_title),
     nullif(btrim(coalesce(p_bank, '')), ''),
     v_card, v_account_no, v_sheba)
  returning * into v_row;

  return to_jsonb(v_row);
end $$;

-- حذف کارت/حساب: مدیر = هر کارت خانواده؛ عضو = فقط کارت خودش
create or replace function public.delete_account(
  p_token text, p_account_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_member uuid;
  v_role text;
begin
  v_member := public._session_member_id(p_token);
  select role into v_role from public.members where id = v_member;

  if v_role = 'owner' then
    delete from public.accounts
    where id = p_account_id and family_id = public._family_id(p_token);
  else
    delete from public.accounts
    where id = p_account_id
      and family_id = public._family_id(p_token)
      and member_id = v_member;
  end if;

  if not found then
    raise exception 'NOT_FOUND';
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════
-- زیردسته‌ها — دائمی برای هر خانواده (مثل: خورد و خوراک ← رستوران)
-- ═══════════════════════════════════════════════════════════

create table if not exists public.subcategories (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references public.families(id) on delete cascade,
  category   text not null,                       -- id دسته (مثل food)
  name       text not null,
  created_at timestamptz not null default now(),
  unique (family_id, category, name)
);

alter table public.subcategories enable row level security;
-- بدون پالیسی → دسترسی فقط از طریق RPC

-- مهاجرت: ستون زیردسته در تراکنش‌ها (باید بعد از ساخت جدول باشد)
alter table public.transactions add column if not exists subcategory_id uuid
  references public.subcategories(id) on delete set null;

-- همه زیردسته‌های خانواده
create or replace function public.list_subcategories(p_token text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_family_id uuid;
begin
  v_family_id := public._family_id(p_token);
  return coalesce((
    select json_agg(row_to_json(s))
    from (
      select * from public.subcategories
      where family_id = v_family_id
      order by category asc, created_at asc
    ) s
  ), '[]'::json);
end $$;

-- افزودن زیردسته برای یک دسته (تکراری رد می‌شود)
create or replace function public.add_subcategory(
  p_token text, p_category text, p_name text
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_family_id uuid;
  v_row public.subcategories;
begin
  v_family_id := public._family_id(p_token);

  if p_category is null or btrim(p_category) = '' then
    raise exception 'INVALID_CATEGORY';
  end if;
  if p_name is null or length(btrim(p_name)) < 1 or length(btrim(p_name)) > 30 then
    raise exception 'INVALID_NAME';
  end if;

  insert into public.subcategories (family_id, category, name)
  values (v_family_id, btrim(p_category), btrim(p_name))
  on conflict (family_id, category, name) do nothing
  returning * into v_row;

  if v_row.id is null then
    select * into v_row from public.subcategories
    where family_id = v_family_id and category = btrim(p_category) and name = btrim(p_name);
  end if;

  return to_jsonb(v_row);
end $$;

-- حذف زیردسته (تراکنش‌های قبلی مقدار را از دست می‌دهند — set null)
create or replace function public.delete_subcategory(
  p_token text, p_subcategory_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.subcategories
  where id = p_subcategory_id and family_id = public._family_id(p_token);

  if not found then
    raise exception 'NOT_FOUND';
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════
-- دسته‌های سفارشی — ساخته‌شده توسط خانواده (دائمی)
-- id دسته سفارشی (uuid) در transactions.category ذخیره می‌شود
-- ═══════════════════════════════════════════════════════════

create table if not exists public.custom_categories (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references public.families(id) on delete cascade,
  type       text not null check (type in ('expense','income')),
  name       text not null,
  created_at timestamptz not null default now(),
  unique (family_id, type, name)
);

alter table public.custom_categories enable row level security;
-- بدون پالیسی → دسترسی فقط از طریق RPC

-- همه دسته‌های سفارشی خانواده
create or replace function public.list_custom_categories(p_token text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_family_id uuid;
begin
  v_family_id := public._family_id(p_token);
  return coalesce((
    select json_agg(row_to_json(c))
    from (
      select * from public.custom_categories
      where family_id = v_family_id
      order by created_at asc
    ) c
  ), '[]'::json);
end $$;

-- افزودن دسته سفارشی (تکراری → همان موجود)
create or replace function public.add_custom_category(
  p_token text, p_type text, p_name text
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_family_id uuid;
  v_row public.custom_categories;
begin
  v_family_id := public._family_id(p_token);

  if p_type not in ('expense','income') then
    raise exception 'INVALID_TYPE';
  end if;
  if p_name is null or length(btrim(p_name)) < 1 or length(btrim(p_name)) > 30 then
    raise exception 'INVALID_NAME';
  end if;

  insert into public.custom_categories (family_id, type, name)
  values (v_family_id, p_type, btrim(p_name))
  on conflict (family_id, type, name) do nothing
  returning * into v_row;

  if v_row.id is null then
    select * into v_row from public.custom_categories
    where family_id = v_family_id and type = p_type and name = btrim(p_name);
  end if;

  return to_jsonb(v_row);
end $$;

-- درج زیردسته‌های پیش‌فرض برای خانواده (idempotent — فقط موارد ناموجود)
create or replace function public.ensure_default_subcategories(p_token text)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_family_id uuid;
  v_count integer;
begin
  v_family_id := public._family_id(p_token);

  with ins as (
    insert into public.subcategories (family_id, category, name)
    select v_family_id, d.cat, d.name
    from (values
      ('food','خرید خواربار'),
      ('food','رستوران و فست‌فود'),
      ('food','کافه'),
      ('food','نانوایی'),
      ('food','میوه و سبزیجات'),
      ('food','گوشت و پروتئین'),
      ('food','لبنیات'),
      ('food','تنقلات'),
      ('food','نوشیدنی'),
      ('food','غذا بیرون و سفارش آنلاین'),
      ('food','متفرقه'),
      ('home','اجاره خانه'),
      ('home','شارژ ساختمان'),
      ('home','تعمیرات خانه'),
      ('home','لوازم خانه'),
      ('home','دکوراسیون'),
      ('home','نظافت'),
      ('home','امور منزل و خدمات'),
      ('home','متفرقه'),
      ('bills','برق'),
      ('bills','آب و فاضلاب'),
      ('bills','گاز'),
      ('bills','تلفن و اینترنت'),
      ('bills','سایر قبض‌ها'),
      ('bills','متفرقه'),
      ('transport','سوخت و بنزین'),
      ('transport','تاکسی و اسنپ'),
      ('transport','عوارض و جرائم'),
      ('transport','سرویس دوره‌ای'),
      ('transport','تعمیر خودرو'),
      ('transport','بلیط اتوبوس و مترو'),
      ('transport','پارکینگ'),
      ('transport','کارواش'),
      ('transport','متفرقه'),
      ('health','دارو'),
      ('health','ویزیت پزشک'),
      ('health','دندانپزشکی'),
      ('health','آزمایش و تصویربرداری'),
      ('health','عینک'),
      ('health','بستری و جراحی'),
      ('health','متفرقه'),
      ('clothing','لباس'),
      ('clothing','کفش'),
      ('clothing','کیف و اکسسوری'),
      ('clothing','خیاطی و تعمیر'),
      ('clothing','متفرقه'),
      ('edu','شهریه'),
      ('edu','کتاب و لوازم تحریر'),
      ('edu','دوره آنلاین'),
      ('edu','کلاس خاص'),
      ('edu','آموزشگاه زبان'),
      ('edu','متفرقه'),
      ('fun','سینما و تئاتر'),
      ('fun','گردش و سفر'),
      ('fun','بازی'),
      ('fun','اسباب‌بازی'),
      ('fun','کنسرت'),
      ('fun','متفرقه'),
      ('shopping','خرید آنلاین'),
      ('shopping','لوازم جانبی'),
      ('shopping','لوازم برقی'),
      ('shopping','متفرقه'),
      ('comm','شارژ موبایل'),
      ('comm','بسته اینترنت'),
      ('comm','سیم‌کارت و خدمات'),
      ('comm','متفرقه'),
      ('finance','کارمزد بانکی'),
      ('finance','اقساط وام'),
      ('finance','جریمه و دیرکرد'),
      ('finance','مالیات و عوارض'),
      ('finance','انتقال و کارت به کارت'),
      ('finance','متفرقه'),
      ('insurance','بیمه شخص ثالث'),
      ('insurance','بیمه بدنه'),
      ('insurance','بیمه عمر'),
      ('insurance','بیمه درمان تکمیلی'),
      ('insurance','متفرقه'),
      ('gifte','هدیه تولد'),
      ('gifte','عیدی'),
      ('gifte','صدقه و خیریه'),
      ('gifte','مراسم و مهمانی'),
      ('gifte','متفرقه'),
      ('family','لوازم کودک'),
      ('family','شیرخشک و پوشک'),
      ('family','مهدکودک'),
      ('family','سالمندان'),
      ('family','متفرقه'),
      ('beauty','آرایشی'),
      ('beauty','مراقبت پوست و مو'),
      ('beauty','سلم و اسپا'),
      ('beauty','اصلاح و آرایشگاه'),
      ('beauty','متفرقه'),
      ('sport','باشگاه'),
      ('sport','تجهیزات ورزشی'),
      ('sport','استخر'),
      ('sport','متفرقه'),
      ('pet','غذای حیوانات'),
      ('pet','دامپزشکی'),
      ('pet','لوازم حیوانات'),
      ('pet','متفرقه'),
      ('salary','حقوق پایه'),
      ('salary','اضافه‌کاری'),
      ('salary','پاداش'),
      ('salary','عیدی و سنوات'),
      ('salary','متفرقه'),
      ('business','فروش محصول'),
      ('business','ارائه خدمات'),
      ('business','سود مشارکت'),
      ('business','متفرقه'),
      ('invest','سود سپرده بانکی'),
      ('invest','سود صندوق'),
      ('invest','سود بورس'),
      ('invest','اجاره املاک'),
      ('invest','متفرقه'),
      ('sale','فروش وسایل'),
      ('sale','فروش طلا و ارز'),
      ('sale','متفرقه'),
      ('gift','عیدی دریافتی'),
      ('gift','هدیه دریافتی'),
      ('gift','متفرقه'),
      ('other-e','متفرقه'),
      ('other-i','متفرقه')
    ) as d(cat, name)
    on conflict (family_id, category, name) do nothing
    returning 1
  )
  select count(*) into v_count from ins;

  return v_count;
end $$;

-- ═══════════════════════════════════════════════════════════
-- پل پیامک — اتصال خودکار از گوشی اندروید (اپ فوروادر)
-- ═══════════════════════════════════════════════════════════

create table if not exists public.sms_bridges (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references public.families(id) on delete cascade,
  member_id  uuid not null references public.members(id) on delete cascade,
  token      text not null unique,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_bridges_family on public.sms_bridges(family_id);

alter table public.sms_bridges enable row level security;
-- بدون پالیسی → دسترسی فقط از طریق RPC (کاربر) و service_role (وب‌هوک)

-- پل فعال عضو فعلی (برای نمایش در تنظیمات) — null اگر نباشد
create or replace function public.get_bridge(p_token text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_member uuid;
begin
  v_member := public._session_member_id(p_token);
  return (
    select json_build_object('token', b.token, 'member_id', b.member_id)
    from public.sms_bridges b
    where b.member_id = v_member and b.active
    order by b.created_at desc
    limit 1
  );
end $$;

-- ساخت/چرخش پل برای عضو فعلی (کلید قبلی بی‌درنگ باطل می‌شود)
create or replace function public.create_bridge(p_token text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_member uuid;
  v_family uuid;
  v_token  text;
begin
  v_member := public._session_member_id(p_token);
  select family_id into v_family from public.members where id = v_member;

  update public.sms_bridges
  set active = false
  where member_id = v_member and active;

  v_token := left(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 40);
  insert into public.sms_bridges (family_id, member_id, token)
  values (v_family, v_member, v_token);

  return v_token;
end $$;

-- ═══════════════════════════════════════════════════════════
-- پروفایل کاربر (v5.1)
-- ═══════════════════════════════════════════════════════════

create or replace function public.update_member_profile(
  p_token text, p_name text, p_gender text, p_birth_date date,
  p_national_id text, p_avatar_url text, p_theme text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_member_id uuid;
  v_national_id text;
  v_row public.members;
begin
  v_member_id := public._session_member_id(p_token);

  if p_name is null or length(btrim(p_name)) < 1 or length(btrim(p_name)) > 40 then
    raise exception 'INVALID_NAME';
  end if;
  if p_gender is not null and p_gender not in ('male','female') then
    raise exception 'INVALID_GENDER';
  end if;
  if p_birth_date is not null and (p_birth_date < '1900-01-01' or p_birth_date > current_date) then
    raise exception 'INVALID_DATE';
  end if;
  if p_theme is not null and p_theme not in ('light','dark','auto') then
    raise exception 'INVALID_THEME';
  end if;

  v_national_id := nullif(regexp_replace(coalesce(p_national_id, ''), '[^0-9]', '', 'g'), '');
  if v_national_id is not null and v_national_id !~ '^\d{10}$' then
    raise exception 'INVALID_NATIONAL_ID';
  end if;

  if p_avatar_url is not null and length(p_avatar_url) > 500 then
    raise exception 'INVALID_AVATAR';
  end if;

  update public.members
  set name        = btrim(p_name),
      gender      = p_gender,
      birth_date  = p_birth_date,
      national_id = v_national_id,
      avatar_url  = p_avatar_url,
      theme       = coalesce(p_theme, theme)
  where id = v_member_id
  returning * into v_row;

  return to_jsonb(v_row);
end $$;

-- تغییر سریع تم شخصی (بدون لمس بقیه پروفایل)
create or replace function public.set_member_theme(
  p_token text, p_theme text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_theme not in ('light','dark','auto') then
    raise exception 'INVALID_THEME';
  end if;

  update public.members
  set theme = p_theme
  where id = public._session_member_id(p_token);
end $$;

-- ═══════════════════════════════════════════════════════════
-- رویدادهای مهم خانواده (v5.1)
-- ═══════════════════════════════════════════════════════════

create table if not exists public.family_events (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references public.families(id) on delete cascade,
  member_id  uuid references public.members(id) on delete set null,
  for_member_id uuid references public.members(id) on delete set null,
  title      text not null,
  date       date not null,
  note       text,
  created_at timestamptz not null default now()
);

create index if not exists idx_events_family on public.family_events(family_id);

-- مهاجرت دیتابیس‌های موجود: عضوِ مربوط به رویداد (اختیاری)
alter table public.family_events
  add column if not exists for_member_id uuid references public.members(id) on delete set null;

-- رویدادهای تولدِ ساخته‌شده با sync قبلی → عضو مربوطه را پر کن
update public.family_events e
set for_member_id = e.member_id
from public.members m
where e.for_member_id is null
  and e.member_id = m.id
  and e.family_id = m.family_id
  and e.title = 'تولد ' || m.name;

alter table public.family_events enable row level security;
-- بدون پالیسی → دسترسی فقط از طریق RPC

create or replace function public.list_events(p_token text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_family_id uuid;
begin
  v_family_id := public._family_id(p_token);
  return coalesce((
    select json_agg(row_to_json(e))
    from (
      select * from public.family_events
      where family_id = v_family_id
      order by date desc, created_at desc
    ) e
  ), '[]'::json);
end $$;

create or replace function public.add_event(
  p_token text, p_title text, p_date date, p_note text,
  p_member_id uuid default null,
  p_for_member_id uuid default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_family_id uuid;
  v_actor uuid;
  v_role text;
  v_row public.family_events;
begin
  v_family_id := public._family_id(p_token);
  v_actor := public._session_member_id(p_token);
  select role into v_role from public.members where id = v_actor;

  if p_title is null or length(btrim(p_title)) < 1 or length(btrim(p_title)) > 60 then
    raise exception 'INVALID_TITLE';
  end if;
  if p_date is null then
    raise exception 'INVALID_DATE';
  end if;

  -- عضو فقط برای خودش رویداد می‌سازد؛ مدیر برای هر عضو
  if v_role <> 'owner' and p_member_id is not null and p_member_id <> v_actor then
    raise exception 'FORBIDDEN';
  end if;

  -- عضو مربوطه باید عضو فعال همین خانواده باشد (مثلاً تولدِ کدام عضو)
  if p_for_member_id is not null and not exists (
    select 1 from public.members
    where id = p_for_member_id and family_id = v_family_id and status = 'active'
  ) then
    raise exception 'INVALID_MEMBER';
  end if;

  -- دی‌دوبل: رویداد هم‌عنوان هم‌تاریخ برای همان عضو مربوطه قبلا هست
  if exists (
    select 1 from public.family_events
    where family_id = v_family_id
      and title = btrim(p_title)
      and date = p_date
      and ((p_for_member_id is null and for_member_id is null) or for_member_id = p_for_member_id)
  ) then
    raise exception 'EVENT_DUPLICATE';
  end if;

  insert into public.family_events (family_id, member_id, for_member_id, title, date, note)
  values (v_family_id, coalesce(p_member_id, v_actor), p_for_member_id, btrim(p_title), p_date,
          nullif(btrim(coalesce(p_note, '')), ''))
  returning * into v_row;

  return to_jsonb(v_row);
end $$;

-- حذف رویداد: مدیر = هر رویداد؛ عضو = فقط رویداد خودش
create or replace function public.delete_event(
  p_token text, p_event_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_member uuid;
  v_role text;
begin
  v_member := public._session_member_id(p_token);
  select role into v_role from public.members where id = v_member;

  if v_role = 'owner' then
    delete from public.family_events
    where id = p_event_id and family_id = public._family_id(p_token);
  else
    delete from public.family_events
    where id = p_event_id
      and family_id = public._family_id(p_token)
      and member_id = v_member;
  end if;

  if not found then
    raise exception 'NOT_FOUND';
  end if;
end $$;

-- همگام‌سازی تولد اعضا: از تاریخ تولد پروفایل، رویداد «تولد [نام]» می‌سازد
-- (اگر نباشد؛ اگر تاریخ عوض شده باشد آپدیت؛ اگر حذف شده باشد رویداد حذف)
create or replace function public.sync_birthday_events(p_token text)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_family_id uuid;
  v_count int := 0;
  v_member record;
  v_event record;
begin
  v_family_id := public._family_id(p_token);

  for v_member in
    select id, name, birth_date from public.members
    where family_id = v_family_id and status = 'active' and birth_date is not null
  loop
    select * into v_event from public.family_events
    where family_id = v_family_id
      and member_id = v_member.id
      and title = 'تولد ' || v_member.name
    limit 1;

    if not found then
      insert into public.family_events (family_id, member_id, for_member_id, title, date, note)
      values (v_family_id, v_member.id, v_member.id, 'تولد ' || v_member.name, v_member.birth_date, null);
      v_count := v_count + 1;
    elsif v_event.date <> v_member.birth_date then
      update public.family_events
      set date = v_member.birth_date
      where id = v_event.id;
      v_count := v_count + 1;
    end if;
  end loop;

  -- عضو بدون تاریخ تولد؟ رویداد تولد او حذف شود
  delete from public.family_events e
  where e.family_id = v_family_id
    and e.title like 'تولد %'
    and e.member_id in (
      select id from public.members
      where family_id = v_family_id and birth_date is null
    );

  return v_count;
end $$;

-- ═══════════════════════════════════════════════════════════
-- بودجه دسته‌های هزینه — سقف ماهانه هر دسته (مصرف هر ماه از صفر)
-- ═══════════════════════════════════════════════════════════

create table if not exists public.category_budgets (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references public.families(id) on delete cascade,
  category   text not null,
  amount     numeric(15,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (family_id, category)
);

create index if not exists idx_cat_budgets_family on public.category_budgets(family_id);

alter table public.category_budgets enable row level security;
-- بدون پالیسی → دسترسی فقط از طریق RPC

-- فهرست بودجه‌های خانواده (همه اعضا می‌بینند)
create or replace function public.list_category_budgets(p_token text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_family_id uuid;
begin
  v_family_id := public._family_id(p_token);
  return coalesce((
    select json_agg(row_to_json(b))
    from (
      select * from public.category_budgets
      where family_id = v_family_id
      order by created_at
    ) b
  ), '[]'::json);
end $$;

-- تعیین/به‌روزرسانی بودجه یک دسته (فقط مدیر خانواده)
create or replace function public.set_category_budget(
  p_token text, p_category text, p_amount numeric
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_family_id uuid;
  v_role text;
  v_row public.category_budgets;
begin
  v_family_id := public._family_id(p_token);
  select role into v_role from public.members where id = public._session_member_id(p_token);
  if v_role <> 'owner' then
    raise exception 'FORBIDDEN';
  end if;

  if p_category is null or length(btrim(p_category)) < 1 or length(p_category) > 60 then
    raise exception 'INVALID_CATEGORY';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 999999999999 then
    raise exception 'INVALID_AMOUNT';
  end if;

  insert into public.category_budgets (family_id, category, amount)
  values (v_family_id, btrim(p_category), p_amount)
  on conflict (family_id, category)
  do update set amount = excluded.amount
  returning * into v_row;

  return to_jsonb(v_row);
end $$;

-- حذف بودجه یک دسته (فقط مدیر خانواده)
create or replace function public.delete_category_budget(
  p_token text, p_category text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_family_id uuid;
  v_role text;
begin
  v_family_id := public._family_id(p_token);
  select role into v_role from public.members where id = public._session_member_id(p_token);
  if v_role <> 'owner' then
    raise exception 'FORBIDDEN';
  end if;

  delete from public.category_budgets
  where family_id = v_family_id and category = p_category;

  if not found then
    raise exception 'NOT_FOUND';
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════
-- باکت‌های Supabase Storage — خواندن عمومی، نوشتن فقط سرور
-- ═══════════════════════════════════════════════════════════

do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public)
    values ('avatars', 'avatars', true)
    on conflict (id) do nothing;

    execute 'drop policy if exists "avatars_public_read" on storage.objects';
    execute 'create policy "avatars_public_read" on storage.objects
             for select using (bucket_id = ''avatars'')';

    -- تصاویر پیوست تراکنش (رسید/عکس محصول)
    insert into storage.buckets (id, name, public)
    values ('tx-photos', 'tx-photos', true)
    on conflict (id) do nothing;

    execute 'drop policy if exists "tx_photos_public_read" on storage.objects';
    execute 'create policy "tx_photos_public_read" on storage.objects
             for select using (bucket_id = ''tx-photos'')';
  end if;
end $$;
