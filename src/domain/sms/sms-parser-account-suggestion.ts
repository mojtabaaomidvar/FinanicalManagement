import type { Account } from "@/domain/account/account.types";
import type { Member } from "@/domain/family/family.types";
import { BANK_CATALOG } from "@/shared/lib/bankCatalog";
import { toEn } from "@/shared/lib/digits";

/** Parser vocabulary uses stored bank names and never editable display copy. */
function normalize(value: string) {
  return toEn(value).replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/[\u064B-\u065F]/g, "")
    .replace(/[^\p{L}\p{N}*]+/gu, " ").trim().replace(/\s+/g, " ");
}
function contains(text: string, phrase: string) {
  return !!phrase && ` ${text} `.includes(` ${phrase} `);
}
const ACCOUNT_TYPES = ["جاری", "سپرده", "پس انداز", "قرض الحسنه", "کیف پول", "نقدی"];
const GENERIC_TITLES = new Set(["حساب", "بانک", "کارت", "کیف پول", "نقدی"]);
const BANK_PARSER_ALIASES: Record<string, string[]> = {
  melli: ["ملی"], saderat: ["صادرات"], refah: ["رفاه"], "tosee-saderat": ["توسعه صادرات"],
  "iran-zamin": ["ایران زمین"], "mehr-iran": ["مهر ایران", "قرض الحسنه مهر ایران"],
};
const BANK_TERMS = BANK_CATALOG.map(bank => ({ id: bank.id,
  terms: [...new Set([normalize(bank.value.replace(/\([^)]*\)/g, "")).replace(/^بانک\s+/, ""), ...(BANK_PARSER_ALIASES[bank.id] ?? [])])],
}));

/** Suggestions never cross ownership and never choose a winner between equal evidence. */
export function suggestSmsAccount(raw: string, accounts: Account[], members: Member[], ownerId: string) {
  const text = normalize(raw);
  const named = members.filter(member => contains(text, normalize(member.name)));
  const member = named.length === 1 ? named[0] : null;
  const mentionedType = ACCOUNT_TYPES.find(type => contains(text, type)) ?? null;
  const hits = BANK_TERMS.flatMap(bank => bank.terms.filter(term => contains(text, term)).map(term => ({ id: bank.id, term })));
  const mentionedBanks = hits.filter(hit => !hits.some(other => other.term !== hit.term && contains(other.term, hit.term))).map(hit => hit.id);
  if (named.length > 1 || (member && member.id !== ownerId)) return { member, account: null, mentionedType };
  const suffixMatch = text.match(/(?:کارت|شماره کارت)(?:\s+(?:شماره|بانکی))?\s+([\d* ]{4,24})/);
  const suffix = suffixMatch?.[1].replace(/\s/g, "").match(/\d{4}$/)?.[0];
  const scored = accounts.filter(account => account.memberId === ownerId).map(account => {
    const title = normalize(account.title);
    const bank = normalize(account.bank ?? "").replace(/^بانک\s+/, "");
    const catalogBank = BANK_CATALOG.find(entry => entry.value === account.bank || entry.id === account.bank)
      ?? BANK_TERMS.find(entry => entry.terms.some(term => term === bank));
    const titleMatch = title.length > 2 && !GENERIC_TITLES.has(title) && contains(text, title);
    const suffixFound = !!suffix && !!account.cardNumber && toEn(account.cardNumber).replace(/\D/g, "").endsWith(suffix);
    const bankMatch = catalogBank ? mentionedBanks.includes(catalogBank.id) : bank.length > 1 && contains(text, bank);
    const typeMatch = !!mentionedType && (contains(title, mentionedType)
      || (account.kind === "wallet" && ["کیف پول", "نقدی"].includes(mentionedType)));
    const incompatible = (mentionedBanks.length > 0 && !bankMatch)
      || (mentionedType && (["کیف پول", "نقدی"].includes(mentionedType) ? account.kind !== "wallet"
      : account.kind !== "bank" || (ACCOUNT_TYPES.some(type => contains(title, type)) && !typeMatch)));
    const score = incompatible ? 0 : (suffixFound ? 12 : 0) + (titleMatch ? 8 : 0) + (bankMatch ? 3 : 0) + (typeMatch ? 2 : 0);
    return { account, score };
  }).filter(item => item.score >= 2).sort((a, b) => b.score - a.score);
  const best = scored[0];
  const account = best && best.score !== scored[1]?.score ? best.account : null;
  return { member, account, mentionedType };
}
