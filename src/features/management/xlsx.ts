// Small, dependency-free SpreadsheetML package. Strings are inline strings, never formulas.
// Parts follow Microsoft's Open XML spreadsheet structure; no macros or external relationships.
export type ExcelValue = string | number | boolean | null | undefined;
export type ExcelSheet = { name: string; columns: string[]; rows: ExcelValue[][] };

const namespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const relationships = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const encoder = new TextEncoder();
const xml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const text = (value: string) => xml(value.replace(/_x(?=[0-9a-fA-F]{4}_)/g, "_x005F_x")
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,
    character => `_x${character.charCodeAt(0).toString(16).padStart(4, "0")}_`));

const column = (index: number): string => {
  let result = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    result = String.fromCharCode(65 + (value - 1) % 26) + result;
  }
  return result;
};

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
const crc32 = (bytes: Uint8Array) => {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};

const zip = (parts: { name: string; content: string }[]): ArrayBuffer => {
  const files = parts.map(part => {
    const name = encoder.encode(part.name), data = encoder.encode(part.content);
    return { name, data, crc: crc32(data) };
  });
  const localSize = files.reduce((sum, file) => sum + 30 + file.name.length + file.data.length, 0);
  const centralSize = files.reduce((sum, file) => sum + 46 + file.name.length, 0);
  const output = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(output.buffer);
  let offset = 0, directory = localSize;
  const word = (at: number, value: number) => view.setUint16(at, value, true);
  const dword = (at: number, value: number) => view.setUint32(at, value, true);
  for (const file of files) {
    dword(offset, 0x04034b50); word(offset + 4, 20); word(offset + 6, 0x800);
    word(offset + 12, 33); dword(offset + 14, file.crc);
    dword(offset + 18, file.data.length); dword(offset + 22, file.data.length);
    word(offset + 26, file.name.length);
    output.set(file.name, offset + 30); output.set(file.data, offset + 30 + file.name.length);
    dword(directory, 0x02014b50); word(directory + 4, 20); word(directory + 6, 20);
    word(directory + 8, 0x800); word(directory + 14, 33); dword(directory + 16, file.crc);
    dword(directory + 20, file.data.length); dword(directory + 24, file.data.length);
    word(directory + 28, file.name.length); dword(directory + 42, offset);
    output.set(file.name, directory + 46);
    offset += 30 + file.name.length + file.data.length;
    directory += 46 + file.name.length;
  }
  dword(directory, 0x06054b50); word(directory + 8, files.length); word(directory + 10, files.length);
  dword(directory + 12, centralSize); dword(directory + 16, localSize);
  return output.buffer;
};

const styles = `${declaration}<styleSheet xmlns="${namespace}">
<fonts count="2"><font><sz val="11"/><name val="Vazirmatn"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Vazirmatn"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF203E30"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="top" wrapText="1" readingOrder="2"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1" readingOrder="2"/></xf><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

const worksheet = (sheet: ExcelSheet): string => {
  if (!sheet.columns.length || sheet.columns.length > 16384 || sheet.rows.length > 1048575) {
    throw new Error("تعداد سطر یا ستون گزارش از ظرفیت فایل اکسل بیشتر است.");
  }
  const rows = [sheet.columns, ...sheet.rows];
  const cells = rows.map((row, rowIndex) => {
    if (row.length > sheet.columns.length) throw new Error("ساختار ستون‌های گزارش معتبر نیست.");
    return `<row r="${rowIndex + 1}"${rowIndex === 0 ? ' ht="30" customHeight="1"' : ""}>${row.map((value, index) => {
      const reference = `${column(index)}${rowIndex + 1}`;
      if (typeof value === "number" && Number.isFinite(value)) {
        return `<c r="${reference}" s="${Number.isInteger(value) ? 2 : 3}"><v>${value}</v></c>`;
      }
      if (typeof value === "boolean") return `<c r="${reference}" t="b"><v>${Number(value)}</v></c>`;
      const content = value == null ? "" : String(value);
      if (content.length > 32767) throw new Error("متن یکی از خانه‌های گزارش برای اکسل بیش از حد بلند است.");
      return `<c r="${reference}" s="${rowIndex === 0 ? 1 : 0}" t="inlineStr"><is><t xml:space="preserve">${text(content)}</t></is></c>`;
    }).join("")}</row>`;
  }).join("");
  const end = `${column(sheet.columns.length - 1)}${rows.length}`;
  const widths = sheet.columns.map((header, index) => {
    const longest = Math.max(header.length, ...sheet.rows.slice(0, 100).map(row => String(row[index] ?? "").length));
    return `<col min="${index + 1}" max="${index + 1}" width="${Math.max(16, Math.min(48, longest + 4))}" customWidth="1"/>`;
  }).join("");
  return `${declaration}<worksheet xmlns="${namespace}"><dimension ref="A1:${end}"/>
<sheetViews><sheetView workbookViewId="0" rightToLeft="1"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="22"/><cols>${widths}</cols><sheetData>${cells}</sheetData><autoFilter ref="A1:${end}"/></worksheet>`;
};

export const createExcel = (sheets: ExcelSheet[]): ArrayBuffer => {
  if (!sheets.length) throw new Error("گزارشی برای ساخت فایل اکسل انتخاب نشده است.");
  const names = new Set<string>();
  const normalized = sheets.map((sheet, index) => {
    const fallbackLabel = "برگه";
    const base = sheet.name.replace(/[\[\]:*?\/\\\u0000-\u001f]/g, " ").replace(/^'+|'+$/g, "").trim().slice(0, 31) || `${fallbackLabel} ${index + 1}`;
    let name = base, suffix = 1;
    while (names.has(name.toLocaleLowerCase())) {
      const tail = ` (${++suffix})`;
      name = base.slice(0, 31 - tail.length) + tail;
    }
    names.add(name.toLocaleLowerCase());
    return { ...sheet, name };
  });
  const parts = [
    { name: "[Content_Types].xml", content: `${declaration}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${normalized.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
    { name: "_rels/.rels", content: `${declaration}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relationships}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", content: `${declaration}<workbook xmlns="${namespace}" xmlns:r="${relationships}"><bookViews><workbookView/></bookViews><sheets>${normalized.map((sheet, index) => `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", content: `${declaration}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${normalized.map((_, index) => `<Relationship Id="rId${index + 1}" Type="${relationships}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}<Relationship Id="rId${normalized.length + 1}" Type="${relationships}/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", content: styles },
    ...normalized.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, content: worksheet(sheet) })),
  ];
  return zip(parts);
};

export const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename;
  try { document.body.append(link); link.click(); }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
};

export const downloadExcel = (sheets: ExcelSheet[], filename: string): void =>
  downloadBlob(new Blob([createExcel(sheets)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }), filename.endsWith(".xlsx") ? filename : filename + ".xlsx");
