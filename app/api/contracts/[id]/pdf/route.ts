import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";
import { requireTeamSession } from "@/lib/auth/guard";
import { formatHeldOn } from "@/lib/course-time";
import { ContractTerms, sanitizeTerms } from "@/lib/instructors";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 56;
const INK = rgb(0.09, 0.13, 0.11);
const MUTED = rgb(0.47, 0.5, 0.48);
const LINE = rgb(0.9, 0.92, 0.9);

function won(value: number) {
  return `${value.toLocaleString("ko-KR")}원`;
}

function heldOnLabel(value: string | null, startTime?: string | null, durationHours?: number | null) {
  return formatHeldOn(value, startTime, durationHours, "long") || "협의 후 확정";
}

/** pdf-lib 은 줄바꿈을 해주지 않는다. 폭에 맞춰 직접 자른다. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number) {
  const lines: string[] = [];
  let current = "";
  for (const character of text) {
    if (character === "\n") { lines.push(current); current = ""; continue; }
    const next = current + character;
    if (font.widthOfTextAtSize(next, size) > maxWidth && current) { lines.push(current); current = character; }
    else current = next;
  }
  if (current) lines.push(current);
  return lines;
}

type Writer = {
  page: PDFPage;
  y: number;
  pdf: PDFDocument;
};

function ensureRoom(writer: Writer, needed: number) {
  if (writer.y - needed > MARGIN) return;
  writer.page = writer.pdf.addPage([PAGE.width, PAGE.height]);
  writer.y = PAGE.height - MARGIN;
}

function paragraph(writer: Writer, text: string, font: PDFFont, size: number, gap = 6) {
  for (const line of wrap(text, font, size, PAGE.width - MARGIN * 2)) {
    ensureRoom(writer, size + gap);
    writer.page.drawText(line, { x: MARGIN, y: writer.y, size, font, color: INK });
    writer.y -= size + gap;
  }
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) return Response.json({ error: "계약서를 확인하지 못했습니다." }, { status: 400 });

    const supabase = createSupabaseAdmin();
    const { data: contract, error } = await supabase
      .from("contracts")
      .select("id,contract_no,status,terms,created_at,instructors(name,affiliation,job_title),course_sessions(title,held_on,start_time,location,headcount,duration_hours,company_research(name))")
      .eq("id", id)
      .single();
    if (error || !contract) throw error || new Error("계약서를 찾지 못했습니다.");

    const instructor = contract.instructors as { name?: string; affiliation?: string; job_title?: string } | null;
    const session = contract.course_sessions as {
      title?: string; held_on?: string | null; start_time?: string | null; location?: string; headcount?: number | null;
      duration_hours?: number; company_research?: { name?: string } | null;
    } | null;
    const terms: ContractTerms = sanitizeTerms(contract.terms);

    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const [regularBytes, boldBytes] = await Promise.all([
      readFile(path.join(process.cwd(), "public/fonts/Pretendard-Regular.ttf")),
      readFile(path.join(process.cwd(), "public/fonts/Pretendard-Bold.ttf")),
    ]);
    const regular = await pdf.embedFont(regularBytes);
    const bold = await pdf.embedFont(boldBytes);

    const writer: Writer = { pdf, page: pdf.addPage([PAGE.width, PAGE.height]), y: PAGE.height - MARGIN };

    writer.page.drawText("강의 용역 계약서", { x: MARGIN, y: writer.y, size: 22, font: bold, color: INK });
    writer.y -= 30;
    writer.page.drawText(`계약번호 ${contract.contract_no}`, { x: MARGIN, y: writer.y, size: 10, font: regular, color: MUTED });
    writer.y -= 22;
    writer.page.drawLine({
      start: { x: MARGIN, y: writer.y }, end: { x: PAGE.width - MARGIN, y: writer.y },
      thickness: 1, color: LINE,
    });
    writer.y -= 26;

    const rows: Array<[string, string]> = [
      ["발주기관", "강원대학교 산학협력단 교육사업팀"],
      ["강사", [instructor?.name, instructor?.affiliation, instructor?.job_title].filter(Boolean).join(" · ") || "확인 필요"],
      ["교육 대상", session?.company_research?.name || "확인 필요"],
      ["과정명", session?.title || "확인 필요"],
      ["교육 일자", heldOnLabel(session?.held_on ?? null, session?.start_time, session?.duration_hours)],
      ["교육 시간", `${session?.duration_hours ?? 4}시간`],
      ["교육 장소", session?.location || "협의 후 확정"],
      ["참석 인원", session?.headcount ? `${session.headcount}명` : "협의 후 확정"],
      ["강사료", terms.fee > 0 ? `${won(terms.fee)}${terms.feeNote ? ` (${terms.feeNote})` : ""}` : "협의 후 확정"],
      ["지급 조건", terms.paymentTerms],
    ];

    for (const [label, value] of rows) {
      const lines = wrap(value, regular, 11, PAGE.width - MARGIN * 2 - 110);
      ensureRoom(writer, lines.length * 17 + 8);
      writer.page.drawText(label, { x: MARGIN, y: writer.y, size: 11, font: bold, color: MUTED });
      lines.forEach((line, index) => {
        writer.page.drawText(line, { x: MARGIN + 110, y: writer.y - index * 16, size: 11, font: regular, color: INK });
      });
      writer.y -= Math.max(1, lines.length) * 16 + 8;
    }

    writer.y -= 10;
    ensureRoom(writer, 40);
    writer.page.drawText("자료 제출 및 저작권", { x: MARGIN, y: writer.y, size: 13, font: bold, color: INK });
    writer.y -= 20;

    paragraph(writer, "1. 강사는 강의 전까지 고객사 제출용 강의 구성 아웃라인과 실제 강의에 사용하는 강의 자료를 발주기관에 제출한다.", regular, 11);
    paragraph(writer, "2. 제출한 자료의 저작권은 강사에게 있으며, 발주기관은 아래에서 합의한 범위에서만 이를 이용한다.", regular, 11);
    paragraph(writer, `3. 집계·패턴 활용: ${terms.reuseAggregate ? "동의함" : "동의하지 않음"} — 개별 강사와 자료를 식별할 수 없는 형태로, 교육 설계 개선을 위한 통계에 한하여 이용한다.`, regular, 11);
    paragraph(writer, `4. 원본 제공: ${terms.reuseShareOriginal ? "동의함" : "동의하지 않음"} — 제출한 자료 원본을 다른 강사에게 제공하는 것에 대한 합의이다.`, regular, 11);

    if (terms.specialTerms.length) {
      writer.y -= 10;
      ensureRoom(writer, 30);
      writer.page.drawText("특약 사항", { x: MARGIN, y: writer.y, size: 13, font: bold, color: INK });
      writer.y -= 20;
      terms.specialTerms.forEach((term, index) => paragraph(writer, `${index + 1}. ${term}`, regular, 11));
    }

    writer.y -= 24;
    ensureRoom(writer, 90);
    writer.page.drawText("본 계약의 성립을 증명하기 위하여 계약서 2부를 작성하고 각 1부씩 보관한다.", {
      x: MARGIN, y: writer.y, size: 11, font: regular, color: INK,
    });
    writer.y -= 46;

    // 주민등록번호·계좌번호는 이 시스템에 저장하지 않는다. 지급에 필요한 정보는 서명 시
    // 강사가 직접 기재하도록 빈칸으로 둔다 — docs/instructor-asset-loop.md 11.1.
    writer.page.drawText("강사", { x: MARGIN, y: writer.y, size: 11, font: bold, color: MUTED });
    writer.page.drawText(`${instructor?.name || ""}  (서명 또는 인)`, { x: MARGIN + 110, y: writer.y, size: 11, font: regular, color: INK });
    writer.y -= 26;
    writer.page.drawText("작성일", { x: MARGIN, y: writer.y, size: 11, font: bold, color: MUTED });
    writer.page.drawText("년      월      일", { x: MARGIN + 110, y: writer.y, size: 11, font: regular, color: INK });
    writer.y -= 26;
    writer.page.drawText("강원대학교 산학협력단장", { x: MARGIN, y: writer.y, size: 11, font: bold, color: MUTED });
    writer.page.drawText("(직인)", { x: MARGIN + 160, y: writer.y, size: 11, font: regular, color: INK });
    writer.y -= 34;
    paragraph(writer, "지급에 필요한 생년월일·주민등록번호·계좌 정보는 산학협력단 회계 절차에 따라 별도 서식으로 제출한다.", regular, 9);

    const bytes = await pdf.save();
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${contract.contract_no}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "계약서를 만들지 못했습니다." },
      { status: 422 },
    );
  }
}
