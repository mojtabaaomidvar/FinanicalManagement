import { bankEntryFor, bankOfCard, cardMatchesBank } from "@/shared/lib/banks";

// Presentation only. Pinned IranianBanks colors; bank names and stored values
// remain in the existing catalog. Logos are bundled, never fetched from a bank.
const BANK_COLORS: Record<string, string> = {
  wepod: "#0E7490", blubank: "#004B87", bankino: "#4F46E5", banket: "#231F20",
  tobank: "#0284C7", omidbank: "#1E3A8A", abank: "#7C3AED", cbi: "#15803D",
  melli: "#0284C7", sepah: "#D97706", mellat: "#DC2626", saderat: "#1E3A8A",
  tejarat: "#2563EB", keshavarzi: "#15803D", maskan: "#EA580C", refah: "#4338CA",
  pasargad: "#CA8A04", saman: "#0284C7", parsian: "#B91C1C", "eghtesad-novin": "#7E22CE",
  karafarin: "#16A34A", sina: "#2563EB", sarmayeh: "#4338CA", shahr: "#DC2626",
  dey: "#0284C7", ayandeh: "#854D0E", gardeshgari: "#7F1D1D", "iran-zamin": "#7C2D12",
  khavarmianeh: "#1E293B", "mehr-iran": "#047857", resalat: "#1D4ED8", post: "#065F46",
  "tosee-taavon": "#1E3A8A", "tosee-saderat": "#0284C7", "sanat-madan": "#064E3B",
  melal: "#991B1B", noor: "#1E293B",
};

export function bankCardAppearance(bank: string | null | undefined, card: string | null | undefined) {
  const value = bank || (card ? bankOfCard(card) : null);
  const entry = value ? bankEntryFor(value) : undefined;
  if (!entry || !BANK_COLORS[entry.id] || (card && !cardMatchesBank(card, entry.value))) return null;
  return { id: entry.id, label: entry.label, color: BANK_COLORS[entry.id], logo: `/bank-logos/${entry.id}.png` };
}
