import AdmZip from "adm-zip";
import { requireTeamSession } from "@/lib/auth/guard";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function xml(value: string) {
  const cleaned = Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || code >= 32;
    })
    .join("");
  return cleaned
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function cell(reference: string, value: string, style: number) {
  return `<c r="${reference}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

const COLUMNS = ["A", "B", "C", "D"];

/**
 * 현재 명단을 엑셀로 내보낸다. 고객사가 처음 보내 준 파일과 인원이 달라졌을 때
 * 최신 명단을 다시 넘기기 위한 것이라, 받은 것과 같은 열 구성으로 낸다.
 */
function buildWorkbook(companyName: string, rows: Array<[string, string, string, string]>) {
  const zip = new AdmZip();
  const now = new Date();
  const dateLabel = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const lastRow = Math.max(5, rows.length + 4);

  const sheetRows = [
    `<row r="1" ht="34" customHeight="1">${cell("A1", `${companyName} 수강생 명단`, 1)}</row>`,
    `<row r="2" ht="24" customHeight="1">${cell("A2", `강원대학교 산학협력단 교육사업팀  ·  ${dateLabel}  ·  ${rows.length}명`, 2)}</row>`,
    `<row r="3" ht="12" customHeight="1"></row>`,
    `<row r="4" ht="27" customHeight="1">${["이름", "부서", "직급", "이메일"].map((label, index) => cell(`${COLUMNS[index]}4`, label, 3)).join("")}</row>`,
    ...rows.map((row, index) =>
      `<row r="${index + 5}" ht="22" customHeight="1">${row.map((value, position) => cell(`${COLUMNS[position]}${index + 5}`, value, 4)).join("")}</row>`),
  ].join("");

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:D${lastRow}"/>
  <sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="20"/>
  <cols><col min="1" max="1" width="14" customWidth="1"/><col min="2" max="2" width="24" customWidth="1"/><col min="3" max="3" width="16" customWidth="1"/><col min="4" max="4" width="32" customWidth="1"/></cols>
  <sheetData>${sheetRows}</sheetData>
  <mergeCells count="2"><mergeCell ref="A1:D1"/><mergeCell ref="A2:D2"/></mergeCells>
  <autoFilter ref="A4:D${lastRow}"/>
  <pageMargins left="0.35" right="0.35" top="0.55" bottom="0.55" header="0.2" footer="0.2"/>
  <pageSetup orientation="portrait" fitToWidth="1" fitToHeight="0" paperSize="9"/>
</worksheet>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="4">
    <font><sz val="11"/><name val="Pretendard"/><family val="2"/></font>
    <font><b/><sz val="18"/><color rgb="FFFFFFFF"/><name val="Pretendard"/><family val="2"/></font>
    <font><sz val="10"/><color rgb="FF607080"/><name val="Pretendard"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Pretendard"/><family val="2"/></font>
  </fonts>
  <fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF173452"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF315F50"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="2"><border/><border><bottom style="thin"><color rgb="FFDCE3EC"/></bottom></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="5">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center" indent="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center" indent="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" indent="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="수강생 명단" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": sheet,
    "xl/styles.xml": styles,
  };
  Object.entries(files).forEach(([path, content]) => zip.addFile(path, Buffer.from(content, "utf8")));
  return zip.toBuffer();
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) return Response.json({ error: "기업 정보를 확인하지 못했습니다." }, { status: 400 });

    const supabase = createSupabaseAdmin();
    const { data: company } = await supabase.from("company_research").select("name").eq("id", id).single();
    const { data: learners, error } = await supabase
      .from("learners").select("name,department,job_title,email").eq("company_id", id).order("name");
    if (error) throw error;

    const rows = (learners || []).map((learner) => [
      String(learner.name || ""), String(learner.department || ""),
      String(learner.job_title || ""), String(learner.email || ""),
    ] as [string, string, string, string]);

    const workbook = buildWorkbook(company?.name || "수강생", rows);
    return new Response(new Uint8Array(workbook), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="learners-${id}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    return Response.json({ error: detail || "명단을 내보내지 못했습니다." }, { status: 500 });
  }
}
