/* خروجی CSV تراکنش‌ها — سازگار با Excel فارسی (UTF-8 BOM) */

import type { Transaction } from "@/domain/transaction/transaction.types";
import { toEn } from "./digits";

function esc(v: string | number | null): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function fa(v: string | number | null): string {
  return esc(v);
}

export interface CsvMember {
  id: string;
  name: string;
}

export interface CsvCategory {
  id: string;
  name: string;
}

/** CSV با ستون‌های فارسی؛ sep= برای Excel فارسی */
export function transactionsToCsv(
  txs: Transaction[],
  members: CsvMember[],
  categories: CsvCategory[],
  accountNameOf: (id: string | null) => string,
): string {
  const mName = new Map(members.map((m) => [m.id, m.name]));
  const cName = new Map(categories.map((c) => [c.id, c.name]));
  const typeFa: Record<Transaction["type"], string> = {
    expense: "هزینه",
    income: "درآمد",
    transfer: "انتقال",
  };
  const repeatFa: Record<Transaction["repeat"], string> = {
    none: "بدون تکرار",
    weekly: "هفتگی",
    monthly: "ماهانه",
    yearly: "سالانه",
  };

  const head = [
    "تاریخ",
    "ساعت",
    "نوع",
    "دسته",
    "زیردسته/شرح",
    "مبلغ (تومان)",
    "عضو",
    "از حساب",
    "به حساب",
    "تکرار",
  ];
  const rows = txs.map((t) => [
    fa(t.date),
    fa(t.time ?? ""),
    fa(typeFa[t.type]),
    fa(cName.get(t.category) ?? t.category),
    fa(t.note ?? ""),
    fa(toEn(String(t.amount))),
    fa(mName.get(t.memberId) ?? "—"),
    fa(accountNameOf(t.accountId)),
    fa(t.type === "transfer" ? accountNameOf(t.toAccountId) : ""),
    fa(repeatFa[t.repeat]),
  ]);

  const body = [head, ...rows].map((r) => r.join(",")).join("\r\n");
  /* BOM + تگ sep → باز شدن مستقیم در اکسل فارسی با ستون‌بندی درست */
  return "\uFEFF" + "sep=,\r\n" + body;
}

/** دانلود فایل متنی با BOM */
export function downloadTextFile(
  content: string,
  filename: string,
  mime = "text/csv;charset=utf-8",
): void {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * خروجی Excel واقعی (xlsx) بدون کتابخانه: Excel 2003 XML (SpreadsheetML)
 * اکسل و LibreOffice هر دو باز می‌کنند؛ اعداد به‌صورت عددی می‌نشینند.
 */
export function transactionsToExcelXml(
  txs: Transaction[],
  members: CsvMember[],
  categories: CsvCategory[],
  accountNameOf: (id: string | null) => string,
): string {
  const mName = new Map(members.map((m) => [m.id, m.name]));
  const cName = new Map(categories.map((c) => [c.id, c.name]));
  const typeFa: Record<Transaction["type"], string> = {
    expense: "هزینه",
    income: "درآمد",
    transfer: "انتقال",
  };

  const x = (s: string | number) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const rows = txs
    .map((t) => {
      const cells = [
        `<Cell><Data ss:Type="String">${x(t.date)}</Data></Cell>`,
        `<Cell><Data ss:Type="String">${x(t.time ?? "")}</Data></Cell>`,
        `<Cell><Data ss:Type="String">${x(typeFa[t.type])}</Data></Cell>`,
        `<Cell><Data ss:Type="String">${x(cName.get(t.category) ?? t.category)}</Data></Cell>`,
        `<Cell><Data ss:Type="String">${x(t.note ?? "")}</Data></Cell>`,
        `<Cell><Data ss:Type="Number">${t.amount}</Data></Cell>`,
        `<Cell><Data ss:Type="String">${x(mName.get(t.memberId) ?? "—")}</Data></Cell>`,
        `<Cell><Data ss:Type="String">${x(accountNameOf(t.accountId))}</Data></Cell>`,
      ];
      return `<Row>${cells.join("")}</Row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="تراکنش‌ها">
<Table>
<Row>
<Cell><Data ss:Type="String">تاریخ</Data></Cell>
<Cell><Data ss:Type="String">ساعت</Data></Cell>
<Cell><Data ss:Type="String">نوع</Data></Cell>
<Cell><Data ss:Type="String">دسته</Data></Cell>
<Cell><Data ss:Type="String">شرح</Data></Cell>
<Cell><Data ss:Type="String">مبلغ (تومان)</Data></Cell>
<Cell><Data ss:Type="String">عضو</Data></Cell>
<Cell><Data ss:Type="String">حساب</Data></Cell>
</Row>
${rows}
</Table>
</Worksheet>
</Workbook>`;
}
