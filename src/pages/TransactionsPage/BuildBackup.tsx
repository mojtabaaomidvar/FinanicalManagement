/* دکمه خروجی JSON — دانلود پشتیبان */

import type { UseCases } from "@/application/useCases";
import type { Family, Member } from "@/domain/family/family.types";
import type { Transaction } from "@/domain/transaction/transaction.types";

export function BuildBackup({
  useCases,
  family,
  members,
  txs,
  notify,
}: {
  useCases: UseCases;
  family: Family | null;
  members: Member[];
  txs: Transaction[];
  notify: (m: string) => void;
}) {
  function exportJson() {
    if (!family) return;
    const data = useCases.buildBackupJson.execute({ family, members, transactions: txs });
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download =
      "mali-man-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
    notify("فایل پشتیبان دانلود شد");
  }

  return (
    <button className="icon-btn" aria-label="خروجی گرفتن" onClick={exportJson}>
      <svg>
        <use href="#i-share" />
      </svg>
    </button>
  );
}
