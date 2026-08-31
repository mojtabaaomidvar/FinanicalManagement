-- ═══════════════════════════════════════════════════════════
-- مالی من — اسکیمای Supabase (PostgreSQL) — نسخه ۳.۴
-- ورود با شماره موبایل + رمز (کد پیامکی اختیاری) + کارت‌ها/حساب‌ها + پل پیامک
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
  dark        boolean not null default true,     -- تم تیره
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
drop function if exists public.accept_invite(text, text, text, text);
drop function if exists public.create_invite(uuid);
drop function if exists public.auth_check_otp(text, text);

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
create or replace function public.auth_register(
  p_family_name text, p_member_name text,
  p_phone text, p_password_hash text, p_otp_code text
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_family public.families;
  v_member public.members;
  v_token  text;
begin
  perform public._consume_otp(p_phone, p_otp_code);

  if exists (select 1 from public.members where phone = p_phone) then
    raise exception 'PHONE_EXISTS';
  end if;

  insert into public.families (name, code)
  values (p_family_name, public.generate_family_code())
  returning * into v_family;

  insert into public.members (family_id, name, role, phone, password_hash)
  values (v_family.id, p_member_name, 'owner', p_phone, p_password_hash)
  returning * into v_member;

  v_token := public._create_session(v_member.id);

  return json_build_object(
    'member', to_jsonb(v_member),
    'family', to_jsonb(v_family),
    'session_token', v_token
  );
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

-- همه تراکنش‌های خانواده
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
      select * from public.transactions
      where family_id = v_family_id
      order by created_at desc
    ) t
  ), '[]'::json);
end $$;

-- افزودن تراکنش (اعتبارسنجی کامل سمت سرور)
create or replace function public.add_transaction(
  p_token text, p_member_id uuid, p_type text, p_amount numeric,
  p_category text, p_date date, p_note text
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
  if not exists (select 1 from public.members
                 where id = p_member_id and family_id = v_family_id) then
    raise exception 'INVALID_MEMBER';
  end if;

  insert into public.transactions (family_id, member_id, type, amount, category, date, note)
  values (v_family_id, p_member_id, p_type, p_amount, p_category, p_date, nullif(btrim(coalesce(p_note, '')), ''))
  returning * into v_row;

  return to_jsonb(v_row);
end $$;

-- ویرایش تراکنش (فقط تراکنش‌های خانواده خود کاربر)
create or replace function public.update_transaction(
  p_token text, p_tx_id uuid, p_member_id uuid, p_type text, p_amount numeric,
  p_category text, p_date date, p_note text
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
  if not exists (select 1 from public.members
                 where id = p_member_id and family_id = v_family_id) then
    raise exception 'INVALID_MEMBER';
  end if;

  update public.transactions
  set member_id = p_member_id,
      type      = p_type,
      amount    = p_amount,
      category  = p_category,
      date      = p_date,
      note      = nullif(btrim(coalesce(p_note, '')), '')
  where id = p_tx_id and family_id = v_family_id;

  if not found then
    raise exception 'NOT_FOUND';
  end if;
end $$;

-- حذف تراکنش (فقط تراکنش‌های خانواده خود کاربر)
create or replace function public.delete_transaction(
  p_token text, p_tx_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.transactions
  where id = p_tx_id and family_id = public._family_id(p_token);

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

-- ذخیره تنظیمات خانواده (بودجه، واحد، تم)
create or replace function public.update_family_settings(
  p_token text, p_budget numeric, p_currency text, p_dark boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.families
  set budget   = greatest(coalesce(p_budget, 0), 0),
      currency = coalesce(nullif(btrim(coalesce(p_currency, '')), ''), 'تومان'),
      dark     = coalesce(p_dark, true)
  where id = public._family_id(p_token);

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

-- افزودن کارت/حساب (اعتبارسنجی کامل سمت سرور)
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
  v_sheba     := upper(regexp_replace(coalesce(p_sheba, ''), '[^0-9a-zA-Z]', '', 'g'));

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

  insert into public.accounts
    (family_id, member_id, title, bank, card_number, account_number, sheba)
  values
    (v_family_id, p_member_id, btrim(p_title),
     nullif(btrim(coalesce(p_bank, '')), ''),
     v_card, v_account_no, v_sheba)
  returning * into v_row;

  return to_jsonb(v_row);
end $$;

-- حذف کارت/حساب (فقط کارت‌های خانواده خود کاربر)
create or replace function public.delete_account(
  p_token text, p_account_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.accounts
  where id = p_account_id and family_id = public._family_id(p_token);

  if not found then
    raise exception 'NOT_FOUND';
  end if;
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
