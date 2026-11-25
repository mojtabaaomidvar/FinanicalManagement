/* پیاده‌سازی مخازن — مپ کردن ردیف‌های snake_case به انواع دامنه */

import type { BankSms, NewBankSms, SmsStatus } from "@/domain/sms/sms.types";
import type {
  Family,
  JoinRequest,
  Member,
  MembershipState,
} from "@/domain/family/family.types";
import type { Transaction } from "@/domain/transaction/transaction.types";
import { legacyIntegerMoney, normalizeMoney } from "@/shared/lib/money";

/* ── ردیف‌های خام PostgREST ── */

export interface MemberRow {
  id: string;
  family_id: string;
  name: string;
  role: string;
  phone: string | null;
  gender: "male" | "female" | null;
  birth_date: string | null;
  avatar_url: string | null;
  status: "pending" | "active";
  /** سرورِ قدیمی این را نمی‌فرستد → undefined، که «نامعلوم» است نه «تأییدشده» */
  membership_state?: string | null;
  theme: "light" | "dark" | "auto";
  relation: string;
  currency: string | null;
  created_at: string;
}

export interface FamilyRow {
  id: string;
  name: string;
  code: string;
  budget: string | number;
  currency: string;
  dark: boolean;
  created_at: string;
}

export interface TransactionRow {
  payment_method?: Transaction["paymentMethod"];
  transfer_fee_method?: Transaction["transferFeeMethod"];
  transfer_fee_rial?: number | null;
  transfer_fee_for_id?: string | null;
  recurring_plan?: { amount: string; category: string; note: string | null; start_date: string | null; revision: number } | null;
  recurring_source_id?: string | null;
  recurring_due_date?: string | null;
  id: string;
  source_kind?: string | null;
  family_id: string;
  member_id: string;
  type: "expense" | "income" | "transfer";
  amount: string;
  category: string;
  date: string;
  time: string | null;
  note: string | null;
  account_id: string | null;
  to_account_id?: string | null;
  subcategory_id: string | null;
  repeat?: "none" | "weekly" | "monthly" | "yearly" | null;
  repeat_end?: string | null;
  handled_occurrences?: string[] | null;
  photos?: { id: string; url: string; caption: string | null }[] | null;
  created_at: string;
}

export interface SmsRow {
  id: string;
  family_id: string;
  member_id: string | null;
  raw_text: string;
  bank: string | null;
  type: "expense" | "income" | null;
  amount: string | number | null;
  balance: string | number | null;
  date: string | null;
  time?: string | null;
  received_at?: string | null;
  transport_id?: string | null;
  parser_version?: string | null;
  transaction_id?: string | null;
  status: SmsStatus;
  sender?: string | null;
  account_id?: string | null;
  created_at: string;
}

/* ── مپ‌ها ── */

/** شش مقدارِ CHECKِ پایگاه داده پذیرفته می‌شوند؛ هر چیزِ دیگر (و نبودِ فیلد)
    `null` = «نامعلوم» است. عمداً به «active» نمی‌افتد: سرورِ قدیمی که این
    ستون را نمی‌فرستد نباید عضوِ در‌انتظار را تأییدشده نشان بدهد. */
const MEMBERSHIP_STATES: readonly string[] = [
  "pending",
  "active",
  "rejected",
  "expired",
  "suspended",
  "removed",
];

function membershipStateOf(
  v: string | null | undefined,
): MembershipState | null {
  return typeof v === "string" && MEMBERSHIP_STATES.includes(v)
    ? (v as MembershipState)
    : null;
}

export function mapMember(r: MemberRow): Member {
  return {
    id: r.id,
    familyId: r.family_id,
    name: r.name,
    role: r.role === "owner" || r.role === "admin" ? r.role : "member",
    phone: r.phone,
    gender: r.gender ?? null,
    birthDate: r.birth_date ?? null,
    avatarUrl: r.avatar_url ?? null,
    status: r.status === "pending" ? "pending" : "active",
    membershipState: membershipStateOf(r.membership_state),
    theme: r.theme === "light" || r.theme === "dark" ? r.theme : "auto",
    relation: r.relation ?? "خودم",
    /* اگر سرور قدیمی باشد و ستون را نفرستد، تومان پیش‌فرض است */
    currency: r.currency === "ریال" ? "ریال" : "تومان",
    createdAt: r.created_at,
  };
}

export function mapFamily(r: FamilyRow): Family {
  return {
    id: r.id,
    name: r.name,
    code: r.code,
    budget: +r.budget,
    currency: r.currency,
    dark: r.dark,
  };
}

/* ── §۲.۶ درخواست‌های پیوستن ── */

export interface JoinRequestRow {
  id: string;
  member_id: string | null;
  member_name: string | null;
  phone: string | null;
  relation: string | null;
  via: string;
  state: string;
  requested_at: string;
}

export function mapJoinRequest(r: JoinRequestRow): JoinRequest {
  return {
    id: r.id,
    memberId: r.member_id ?? null,
    memberName: r.member_name ?? null,
    phone: r.phone ?? null,
    relation: r.relation ?? null,
    /* «link» و «code» تنها مقادیرِ سرورند؛ هر چیزِ دیگر به «code» نمی‌افتد
       بلکه به «link» می‌افتد تا با پیش‌فرضِ invite_id سازگار باشد. */
    via: r.via === "code" ? "code" : "link",
    state: r.state,
    requestedAt: r.requested_at,
  };
}

export function mapTransaction(r: TransactionRow): Transaction {
  return {
    recurringPlan: r.recurring_plan ? { ...r.recurring_plan, amount: normalizeMoney(r.recurring_plan.amount), startDate: r.recurring_plan.start_date } : null,
    recurringSourceId: r.recurring_source_id ?? null,
    recurringDueDate: r.recurring_due_date ?? null,
    id: r.id,
    sourceKind: r.source_kind === "vehicle_service" || r.source_kind === "transfer_fee" || r.source_kind === "wallet_correction" ? r.source_kind : null,
    transferFeeMethod: r.transfer_fee_method ?? null,
    paymentMethod: r.payment_method ?? null,
    transferFeeRial: r.transfer_fee_rial == null ? null : legacyIntegerMoney(r.transfer_fee_rial),
    transferFeeForId: r.transfer_fee_for_id ?? null,
    familyId: r.family_id,
    memberId: r.member_id,
    type: r.type,
    amount: normalizeMoney(r.amount),
    category: r.category,
    date: r.date,
    time: r.time ?? null,
    note: r.note,
    accountId: r.account_id,
    toAccountId: r.to_account_id ?? null,
    subcategoryId: r.subcategory_id,
    repeat:
      r.repeat === "weekly" || r.repeat === "monthly" || r.repeat === "yearly"
        ? r.repeat
        : "none",
    repeatEnd: r.repeat_end ?? null,
    handledOccurrences: Array.isArray(r.handled_occurrences)
      ? r.handled_occurrences
      : [],
    photos: (r.photos ?? []).map((p) => ({
      id: p.id,
      url: p.url,
      caption: p.caption ?? null,
    })),
    createdAt: r.created_at,
  };
}

export function mapSms(r: SmsRow): BankSms {
  return {
    id: r.id,
    familyId: r.family_id,
    memberId: r.member_id,
    rawText: r.raw_text,
    bank: r.bank,
    type: r.type,
    amount: r.amount == null ? null : +r.amount,
    balance: r.balance == null ? null : +r.balance,
    date: r.date,
    time: r.time ?? null,
    receivedAt: r.received_at ?? null,
    transportId: r.transport_id ?? null,
    parserVersion: r.parser_version ?? null,
    transactionId: r.transaction_id ?? null,
    status: r.status,
    sender: r.sender ?? null,
    accountId: r.account_id ?? null,
    createdAt: r.created_at,
  };
}

export function toSmsItems(items: NewBankSms[]): Record<string, unknown>[] {
  return items.map((s) => ({
    raw_text: s.rawText,
    bank: s.bank,
    type: s.type,
    amount: s.amount,
    balance: s.balance,
    date: s.date,
    time: s.time ?? null,
  }));
}

/* familySettingsOf بازنشسته شد (v5.8) — واحد پول و تم شخصی شدند و
   تنها تنظیم خانوادگی باقی‌مانده سقف بودجه است که مستقیم فرستاده می‌شود. */

/* ── کارت‌ها/حساب‌ها ── */

export interface AccountRow {
  id: string;
  family_id: string;
  member_id: string;
  title: string;
  kind?: "bank" | "wallet" | null;
  bank: string | null;
  card_number: string | null;
  initial_balance?: string | null;
  /* رضایت تشخیص پیامک — سرور قدیمی نفرستد، false پیش‌فرض */
  sms_enabled?: boolean | null;
  created_at: string;
}

export function mapAccount(
  r: AccountRow,
): import("@/domain/account/account.types").Account {
  return {
    id: r.id,
    familyId: r.family_id,
    memberId: r.member_id,
    title: r.title,
    kind: r.kind === "wallet" ? "wallet" : "bank",
    bank: r.bank,
    cardNumber: r.card_number,
    initialBalance: normalizeMoney(r.initial_balance ?? "0"),
    smsEnabled: r.sms_enabled === true,
    createdAt: r.created_at,
  };
}

/* ── رویدادهای خانواده ── */

export interface EventRow {
  id: string;
  family_id: string;
  member_id: string | null;
  for_member_id: string | null;
  title: string;
  date: string;
  note: string | null;
  created_at: string;
  kind?: "event" | "activity";
  activity_status?: "planned" | "done" | "cancelled" | null;
  reminder_enabled?: boolean;
  revision?: number;
}

export function mapEvent(
  r: EventRow,
): import("@/domain/event/event.types").FamilyEvent {
  return {
    id: r.id,
    familyId: r.family_id,
    memberId: r.member_id,
    forMemberId: r.for_member_id ?? null,
    title: r.title,
    date: r.date,
    note: r.note,
    createdAt: r.created_at,
    kind: r.kind === "activity" ? "activity" : "event",
    activityStatus: r.kind === "activity" ? r.activity_status ?? null : null,
    reminderEnabled: r.reminder_enabled === true,
    revision: r.revision ?? 1,
  };
}

/* ── بودجه دسته‌های هزینه ── */

export interface CategoryBudgetRow {
  id: string;
  family_id: string;
  category: string;
  amount: number;
  created_at: string;
}

export function mapCategoryBudget(
  r: CategoryBudgetRow,
): import("@/domain/category/category-budget.types").CategoryBudget {
  return {
    id: r.id,
    familyId: r.family_id,
    category: r.category,
    amount: Number(r.amount),
    createdAt: r.created_at,
  };
}
