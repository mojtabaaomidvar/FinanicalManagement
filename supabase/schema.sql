-- ═══════════════════════════════════════════════════════════
-- مالی من — اسکیمای Supabase (PostgreSQL) — نسخه ۳
-- ورود با شماره موبایل + رمز + تأیید دو مرحله‌ای پیامکی
-- اجرا در: Supabase Dashboard → SQL Editor → New query → Run
-- (روی پروژه جدید یا قبلی قابل اجراست — idempotent)
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
-- dev_mode = true  → درخواست OTP مستقیم از کلاینت مجاز است (کد به کلاینت برمی‌گردد)
-- dev_mode = false → فقط تابع سرورless ارسال پیامک کار می‌کند (حالت تولید)
create table if not exists public.app_settings (
  id       integer primary key default 1 check (id = 1),
  dev_mode boolean not null default true
);

insert into public.app_settings (id, dev_mode) values (1, true)
on conflict (id) do nothing;

-- ═══════════════════════════════════════════════════════════
-- Row Level Security
-- ═══════════════════════════════════════════════════════════

alter table public.families       enable row level security;
alter table public.members        enable row level security;
alter table public.transactions   enable row level security;
alter table public.sms_messages   enable row level security;
alter table public.otp_codes      enable row level security;
alter table public.family_invites enable row level security;
alter table public.app_settings   enable row level security;

-- خواندن
drop policy if exists "families_select"     on public.families;
drop policy if exists "members_select"      on public.members;
drop policy if exists "transactions_select" on public.transactions;
drop policy if exists "sms_select"          on public.sms_messages;
drop policy if exists "settings_select"     on public.app_settings;
create policy "families_select"     on public.families       for select using (true);
create policy "members_select"      on public.members        for select using (true);
create policy "transactions_select" on public.transactions   for select using (true);
create policy "sms_select"          on public.sms_messages   for select using (true);
create policy "settings_select"     on public.app_settings   for select using (true);

-- نوشتن
drop policy if exists "families_insert"     on public.families;
drop policy if exists "members_insert"      on public.members;
drop policy if exists "transactions_insert" on public.transactions;
drop policy if exists "sms_insert"          on public.sms_messages;
create policy "families_insert"     on public.families       for insert with check (true);
create policy "members_insert"      on public.members        for insert with check (true);
create policy "transactions_insert" on public.transactions   for insert with check (true);
create policy "sms_insert"          on public.sms_messages   for insert with check (true);

-- ویرایش
drop policy if exists "families_update"     on public.families;
drop policy if exists "transactions_update" on public.transactions;
drop policy if exists "sms_update"          on public.sms_messages;
drop policy if exists "members_update"      on public.members;
create policy "families_update"     on public.families       for update using (true) with check (true);
create policy "transactions_update" on public.transactions   for update using (true) with check (true);
create policy "sms_update"          on public.sms_messages   for update using (true) with check (true);
create policy "members_update"      on public.members        for update using (true) with check (true);

-- حذف
drop policy if exists "transactions_delete" on public.transactions;
drop policy if exists "sms_delete"          on public.sms_messages;
drop policy if exists "members_delete"      on public.members;
create policy "transactions_delete" on public.transactions   for delete using (true);
create policy "sms_delete"          on public.sms_messages   for delete using (true);
create policy "members_delete"      on public.members        for delete using (true);

-- otp_codes و family_invites فقط از طریق توابع RPC (security definer) دسترسی دارند

-- ═══════════════════════════════════════════════════════════
-- توابع کمکی
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

-- ═══════════════════════════════════════════════════════════
-- توابع احراز هویت (RPC — security definer)
-- ═══════════════════════════════════════════════════════════

-- بررسی رمز عبور (مرحله ۱ ورود)
create or replace function public.auth_check_password(
  p_phone text, p_password_hash text
) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  return exists (
    select 1 from public.members
    where phone = p_phone and password_hash = p_password_hash
  );
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

-- بررسی صحت کد OTP (بدون استفاده کردن — برای ثبت‌نام)
create or replace function public.auth_check_otp(
  p_phone text, p_code text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_otp record;
begin
  select * into v_otp from public.otp_codes
  where phone = p_phone and code = p_code and used = false
    and expires_at > now()
  order by created_at desc limit 1;

  if not found then
    return false;
  end if;

  update public.otp_codes set used = true where id = v_otp.id;
  return true;
end $$;

-- ثبت‌نام: ساخت خانواده + عضو مدیر (بعد از تأیید OTP صدا زده می‌شود)
create or replace function public.auth_register(
  p_family_name text, p_member_name text,
  p_phone text, p_password_hash text
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_family public.families;
  v_member public.members;
begin
  if exists (select 1 from public.members where phone = p_phone) then
    raise exception 'PHONE_EXISTS';
  end if;

  insert into public.families (name, code)
  values (p_family_name, public.generate_family_code())
  returning * into v_family;

  insert into public.members (family_id, name, role, phone, password_hash)
  values (v_family.id, p_member_name, 'owner', p_phone, p_password_hash)
  returning * into v_member;

  return json_build_object('member', to_jsonb(v_member), 'family', to_jsonb(v_family));
end $$;

-- ورود نهایی: تأیید OTP + بازگرداندن عضو و خانواده
create or replace function public.auth_login(
  p_phone text, p_code text
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_otp record;
  v_member public.members;
  v_family public.families;
begin
  select * into v_otp from public.otp_codes
  where phone = p_phone and code = p_code and used = false
    and expires_at > now()
  order by created_at desc limit 1;

  if not found then
    raise exception 'INVALID_OTP';
  end if;

  update public.otp_codes set used = true where id = v_otp.id;

  select * into v_member from public.members where phone = p_phone;
  if not found then
    raise exception 'NO_MEMBER';
  end if;

  select * into v_family from public.families where id = v_member.family_id;

  return json_build_object('member', to_jsonb(v_member), 'family', to_jsonb(v_family));
end $$;

-- ─────────── دعوت اعضا ───────────

-- ساخت لینک دعوت جدید (لینک‌های قبلی خانواده غیرفعال می‌شوند)
create or replace function public.create_invite(
  p_family_id uuid
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_token text;
begin
  update public.family_invites
  set active = false
  where family_id = p_family_id and active = true;

  v_token := encode(gen_random_bytes(20), 'hex');
  insert into public.family_invites (family_id, token, expires_at)
  values (p_family_id, v_token, now() + interval '30 days');

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

  return json_build_object(
    'family_name', v_family.name,
    'family_id',   v_family.id
  );
end $$;

-- پذیرش دعوت: ثبت‌نام عضو جدید در خانواده (بعد از تأیید OTP)
create or replace function public.accept_invite(
  p_token text, p_member_name text,
  p_phone text, p_password_hash text
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_inv record;
  v_member public.members;
begin
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

  return json_build_object('member', to_jsonb(v_member));
end $$;
