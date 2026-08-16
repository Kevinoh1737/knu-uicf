import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";

/**
 * xlsx 읽기. 이 프로젝트는 이미 adm-zip 으로 엑셀을 만들고 있으므로 읽는 쪽도 같은 도구를 쓴다
 * (app/api/exports/questionnaire). 새 의존성을 들이지 않으려는 것이고, 필요한 것은 첫 시트의
 * 문자열 표 하나뿐이라 서식·수식은 읽지 않는다.
 */
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** A1 → 0, B1 → 1, AA1 → 26. 빈 셀은 XML 에 아예 없으므로 열 위치를 참조에서 읽어야 한다. */
function columnIndex(reference: string) {
  const letters = reference.replace(/\d+/g, "");
  let index = 0;
  for (const character of letters) index = index * 26 + (character.charCodeAt(0) - 64);
  return index - 1;
}

/**
 * 속성이 붙은 요소는 파서가 객체로 준다 — <t xml:space="preserve">이름</t> 은
 * { "#text": "이름", "@_xml:space": "preserve" } 가 된다. 문자열로 단정하면
 * "[object Object]" 가 되어 머리글을 못 찾는다 (실제로 왕복 시험에서 걸렸다).
 */
function nodeText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") {
    const text = (value as Record<string, unknown>)["#text"];
    return text === undefined || text === null ? "" : String(text);
  }
  return String(value);
}

function cellText(cell: Record<string, unknown>, shared: string[]) {
  const type = cell["@_t"];
  if (type === "s") {
    const index = Number(nodeText(cell.v));
    return Number.isInteger(index) ? shared[index] ?? "" : "";
  }
  if (type === "inlineStr") {
    const is = cell.is as { t?: unknown } | undefined;
    return nodeText(is?.t);
  }
  return nodeText(cell.v);
}

/** 첫 시트를 행 배열로 읽는다. 각 행은 열 순서대로 정렬된 문자열 배열이다. */
export function readSheetRows(buffer: Buffer, maxRows = 1000): string[][] {
  const zip = new AdmZip(buffer);

  const sharedEntry = zip.getEntry("xl/sharedStrings.xml");
  const shared: string[] = [];
  if (sharedEntry) {
    const parsed = parser.parse(sharedEntry.getData().toString("utf8")) as { sst?: { si?: unknown } };
    for (const item of asArray(parsed.sst?.si as Record<string, unknown>[])) {
      // 서식이 섞인 셀은 <r> 조각으로 쪼개져 들어온다. 조각을 이어 붙여야 원문이 된다.
      if (item.t !== undefined) { shared.push(nodeText(item.t)); continue; }
      const runs = asArray(item.r as Record<string, unknown>[]);
      shared.push(runs.map((run) => nodeText(run.t)).join(""));
    }
  }

  const sheetEntry = zip.getEntries().find((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.entryName));
  if (!sheetEntry) throw new Error("엑셀에서 시트를 찾지 못했습니다.");

  const sheet = parser.parse(sheetEntry.getData().toString("utf8")) as {
    worksheet?: { sheetData?: { row?: unknown } };
  };

  const rows: string[][] = [];
  for (const row of asArray(sheet.worksheet?.sheetData?.row as Record<string, unknown>[])) {
    if (rows.length >= maxRows) break;
    const cells = asArray(row.c as Record<string, unknown>[]);
    const values: string[] = [];
    for (const cell of cells) {
      const reference = String(cell["@_r"] ?? "");
      const index = reference ? columnIndex(reference) : values.length;
      while (values.length < index) values.push("");
      values[index] = cellText(cell, shared).trim();
    }
    rows.push(values);
  }
  return rows;
}

/**
 * 머리글 줄을 찾아 열 위치를 짚는다. 고객사가 보내는 명단은 제목·안내 줄이 위에 붙어 있는
 * 일이 흔해서, 첫 줄을 머리글로 단정하지 않고 이름 열이 있는 줄을 찾는다.
 */
const HEADER_PATTERNS: Record<string, RegExp> = {
  name: /^(이름|성명|성\s*명|참석자|수강생|성함)$/,
  department: /^(부서|소속|팀|부서명|소속부서)$/,
  jobTitle: /^(직급|직책|직위|직함)$/,
  email: /^(이메일|메일|email|e-?mail|이메일주소)$/i,
};

export type SheetColumns = { header: number; name: number; department: number; jobTitle: number; email: number };

export function findColumns(rows: string[][]): SheetColumns | null {
  for (let index = 0; index < Math.min(rows.length, 20); index += 1) {
    const row = rows[index];
    const found: Record<string, number> = {};
    row.forEach((cell, position) => {
      const value = cell.replace(/\s+/g, "");
      for (const [key, pattern] of Object.entries(HEADER_PATTERNS)) {
        if (found[key] === undefined && pattern.test(value)) found[key] = position;
      }
    });
    // 이름 열이 없으면 명단으로 볼 수 없다. 나머지는 없어도 된다.
    if (found.name !== undefined) {
      return {
        header: index,
        name: found.name,
        department: found.department ?? -1,
        jobTitle: found.jobTitle ?? -1,
        email: found.email ?? -1,
      };
    }
  }
  return null;
}
