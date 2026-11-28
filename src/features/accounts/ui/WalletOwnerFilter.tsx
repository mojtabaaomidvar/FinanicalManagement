import type { AccountsModel } from "../model/useAccountsModel";

export function WalletOwnerFilter({ m }: { m: AccountsModel }) {
  if (!m.canViewFamilyWallets) return null;
  const options = [
    { id: null, label: "همه" },
    { id: m.member!.id, label: "خودم" },
    ...m.filterMembers.map(person => ({ id: person.id, label: person.name })),
  ];
  const selected = options.find(option => option.id === m.selectedOwnerId) ?? options[0];
  return <div className="wallet-owner-context">
    <p className="wallet-owner-current" role="status"><span>کیف‌پول‌های</span><b>{selected.label}</b></p>
    <div className="wallet-owner-filter" role="group" aria-label="نمایش کیف پول بر اساس عضو">
    {options.map(option => <button key={option.id ?? "all"} type="button"
      className="wallet-owner-option" aria-pressed={m.selectedOwnerId === option.id}
      onClick={event => {
        m.selectOwner(option.id);
        event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
      }}>{option.label}</button>)}
    </div>
  </div>;
}
