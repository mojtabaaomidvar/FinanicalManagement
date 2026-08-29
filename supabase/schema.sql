-- ═══════════════════════════════════════════════════════════
-- مالی من — اسکیمای Supabase (PostgreSQL)
-- اجرا در: Supabase Dashboard → SQL Editor → New query → Run
-- ═══════════════════════════════════════════════════════════

-- ─────────── جدول خانواده‌ها ───────────
create table if not exists public.families (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  code        text not null unique,              -- کد دعوت ۶ رقمی
  budget      numeric(15,2) not null default 0,  -- بودجه ماهانه (۰ = غیرفعال)
  currency    text not null default 'تومان',     -- واحد نمایش
  dark        boolean not null default true,     -- تم تیره
  created_at  timestamptz not null default now()
);

-- ─────────── جدول اعضا ───────────
create table if not exists public.members (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  name        text not null,
  role        text not null default 'member',    -- 'owner' | 'member'
  created_at  timestamptz not null default now()
);

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
  member_id   uuid references public.members(id) on delete set null, -- ثبت‌کننده
  raw_text    text not null,                     -- متن کامل پیامک
  bank        text,                              -- نام بانک (پارس‌شده)
  type        text check (type in ('expense','income')),
  amount      numeric(15,2),
  balance     numeric(15,2),                     -- موجودی اعلام‌شده
  date        date,                              -- تاریخ پیامک
  status      text not null default 'pending'    -- 'pending' | 'recorded' | 'ignored'
              check (status in ('pending','recorded','ignored')),
  created_at  timestamptz not null default now()
);

create index if not exists idx_sms_family on public.sms_messages(family_id);
create index if not exists idx_sms_status on public.sms_messages(status);

-- ═══════════════════════════════════════════════════════════
-- Row Level Security
-- این اپ بدون Auth کار می‌کند؛ دسترسی با کد خانواده از کلاینت
-- ارسال می‌شود. برای سادگی، سیاست‌های باز روی هر دو جدول:
-- ═══════════════════════════════════════════════════════════

alter table public.families      enable row level security;
alter table public.members       enable row level security;
alter table public.transactions  enable row level security;
alter table public.sms_messages  enable row level security;

-- خواندن همه (اپ عمومی خانوادگی)
create policy "families_select"     on public.families      for select using (true);
create policy "members_select"      on public.members       for select using (true);
create policy "transactions_select" on public.transactions  for select using (true);
create policy "sms_select"          on public.sms_messages  for select using (true);

-- نوشتن
create policy "families_insert"     on public.families      for insert with check (true);
create policy "members_insert"      on public.members       for insert with check (true);
create policy "transactions_insert" on public.transactions  for insert with check (true);
create policy "sms_insert"          on public.sms_messages  for insert with check (true);

-- ویرایش
create policy "families_update"     on public.families      for update using (true) with check (true);
create policy "transactions_update" on public.transactions  for update using (true) with check (true);
create policy "sms_update"          on public.sms_messages  for update using (true) with check (true);

-- حذف
create policy "transactions_delete" on public.transactions  for delete using (true);
create policy "sms_delete"          on public.sms_messages  for delete using (true);
create policy "members_delete"      on public.members       for delete using (true);

-- ═══════════════════════════════════════════════════════════
-- توابع کمکی
-- ═══════════════════════════════════════════════════════════

-- تولید کد دعوت ۶ رقمی یکتا
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
-- داده اولیه (اختیاری — برای تست)
-- ═══════════════════════════════════════════════════════════
-- insert into public.families (name, code) values ('خانواده ما', '123456');
-- insert into public.members (family_id, name, role)
--   select id, 'پدر', 'owner' from public.families where code = '123456';
