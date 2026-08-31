/* پیاده‌سازی مخازن — مپ کردن ردیف‌های snake_case به انواع دامنه */

import type { BankSms, NewBankSms, SmsStatus } from "@/domain/sms/sms.types";
import type { Family, FamilySettings, Member } from "@/domain/family/family.types";
import type { Transaction } from "@/domain/transaction/transaction.types";

/* ── ردیف‌های خام PostgREST ── */

export interface MemberRow {
  id: string;
  family_id: string;
  name: string;
  role: string;
  phone: string | null;
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
  id: string;
  family_id: string;
  member_id: string;
  type: "expense" | "income";
  amount: string | number;
  category: string;
  date: string;
  note: string | null;
  account_id: string | null;
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
  status: SmsStatus;
  created_at: string;
}

/* ── مپ‌ها ── */

export function mapMember(r: MemberRow): Member {
  return {
    id: r.id,
    familyId: r.family_id,
    name: r.name,
    role: r.role === "owner" ? "owner" : "member",
    phone: r.phone,
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

export function mapTransaction(r: TransactionRow): Transaction {
  return {
    id: r.id,
    familyId: r.family_id,
    memberId: r.member_id,
    type: r.type,
    amount: +r.amount,
    category: r.category,
    date: r.date,
    note: r.note,
    accountId: r.account_id,
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
    status: r.status,
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
  }));
}

export function familySettingsOf(f: Family): FamilySettings {
  return { budget: f.budget, currency: f.currency, dark: f.dark };
}

/* ── کارت‌ها/حساب‌ها ── */

export interface AccountRow {
  id: string;
  family_id: string;
  member_id: string;
  title: string;
  bank: string | null;
  card_number: string | null;
  account_number: string | null;
  sheba: string | null;
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
    bank: r.bank,
    cardNumber: r.card_number,
    accountNumber: r.account_number,
    sheba: r.sheba,
    createdAt: r.created_at,
  };
}
