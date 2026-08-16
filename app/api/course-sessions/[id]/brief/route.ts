import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";
import { requireTeamSession } from "@/lib/auth/guard";
import { ConsultationBriefing } from "@/lib/consultations";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 56;
const INK = rgb(0.09, 0.13, 0.11);
const MUTED = rgb(0.47, 0.5, 0.48);
const LINE = rgb(0.9, 0.92, 0.9);

type Writer = { pdf: PDFDocument; page: PDFPage; y: number; regular: PDFFont; bold: PDFFont };

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

function ensureRoom(writer: Writer, needed: number) {
  if (writer.y - needed > MARGIN) return;
  writer.page = writer.pdf.addPage([PAGE.width, PAGE.height]);
  writer.y = PAGE.height - MARGIN;
}

function body(writer: Writer, text: string, indent = 0, size = 11) {
  for (const line of wrap(text, writer.regular, size, PAGE.width - MARGIN * 2 - indent)) {
    ensureRoom(writer, size + 6);
    writer.page.drawText(line, { x: MARGIN + indent, y: writer.y, size, font: writer.regular, color: INK });
    writer.y -= size + 6;
  }
}

function heading(writer: Writer, text: string) {
  ensureRoom(writer, 42);
  writer.y -= 12;
  writer.page.drawText(text, { x: MARGIN, y: writer.y, size: 13, font: writer.bold, color: INK });
  writer.y -= 8;
  writer.page.drawLine({
    start: { x: MARGIN, y: writer.y }, end: { x: PAGE.width - MARGIN, y: writer.y },
    thickness: 1, color: LINE,
  });
  writer.y -= 16;
}

function bullets(writer: Writer, items: string[], empty = "확인되지 않음") {
  if (!items.length) return body(writer, empty, 12);
  items.forEach((item) => {
    ensureRoom(writer, 20);
    writer.page.drawText("·", { x: MARGIN + 3, y: writer.y, size: 11, font: writer.bold, color: MUTED });
    body(writer, item, 14);
  });
}

type ResearchReport = {
  headline?: string; summary?: string;
  business?: { whatTheyDo?: string; offerings?: string[]; customers?: string; workFlow?: string };
  glossary?: Array<{ term?: string; meaning?: string }>;
  educationContext?: { likelyLearners?: string[]; currentWork?: string; startingPoint?: string; caution?: string };
};

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) return Response.json({ error: "강의를 확인하지 못했습니다." }, { status: 400 });

    const supabase = createSupabaseAdmin();
    const { data: session, error } = await supabase
      .from("course_sessions")
      .select("id,title,held_on,location,headcount,duration_hours,instructors(name),company_research(name,industry,research,consultation_briefing)")
      .eq("id", id)
      .single();
    if (error || !session) throw error || new Error("강의를 찾지 못했습니다.");

    const instructor = session.instructors as { name?: string } | null;
    const company = session.company_research as {
      name?: string; industry?: string; research?: ResearchReport; consultation_briefing?: ConsultationBriefing;
    } | null;
    const report = company?.research || {};
    const briefing = company?.consultation_briefing;

    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const [regularBytes, boldBytes] = await Promise.all([
      readFile(path.join(process.cwd(), "public/fonts/Pretendard-Regular.ttf")),
      readFile(path.join(process.cwd(), "public/fonts/Pretendard-Bold.ttf")),
    ]);
    const writer: Writer = {
      pdf,
      page: pdf.addPage([PAGE.width, PAGE.height]),
      y: PAGE.height - MARGIN,
      regular: await pdf.embedFont(regularBytes),
      bold: await pdf.embedFont(boldBytes),
    };

    writer.page.drawText("강의 준비 브리프", { x: MARGIN, y: writer.y, size: 22, font: writer.bold, color: INK });
    writer.y -= 28;
    writer.page.drawText(`${company?.name || "고객사"} · ${session.title}`, {
      x: MARGIN, y: writer.y, size: 12, font: writer.regular, color: MUTED,
    });
    writer.y -= 16;
    writer.page.drawText("강원대학교 산학협력단 교육사업팀", { x: MARGIN, y: writer.y, size: 10, font: writer.regular, color: MUTED });
    writer.y -= 10;

    heading(writer, "교육 개요");
    const held = session.held_on
      ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "long", timeZone: "Asia/Seoul" }).format(new Date(session.held_on as string))
      : "협의 후 확정";
    [
      ["담당 강사", instructor?.name || "미배정"],
      ["교육 일자", held],
      ["교육 시간", `${session.duration_hours}시간`],
      ["교육 장소", (session.location as string) || "협의 후 확정"],
      ["참석 인원", session.headcount ? `${session.headcount}명` : "협의 후 확정"],
      ["업종", company?.industry || "확인되지 않음"],
    ].forEach(([label, value]) => {
      ensureRoom(writer, 20);
      writer.page.drawText(label, { x: MARGIN, y: writer.y, size: 11, font: writer.bold, color: MUTED });
      writer.page.drawText(value, { x: MARGIN + 100, y: writer.y, size: 11, font: writer.regular, color: INK });
      writer.y -= 18;
    });

    heading(writer, "이 회사는 어떤 곳인가");
    if (report.headline) body(writer, report.headline);
    if (report.business?.whatTheyDo) body(writer, report.business.whatTheyDo);
    if (report.business?.customers) body(writer, `주요 고객: ${report.business.customers}`);
    if (report.business?.workFlow) body(writer, `업무 흐름: ${report.business.workFlow}`);
    if (report.business?.offerings?.length) body(writer, `제품·서비스: ${report.business.offerings.join(", ")}`);
    if (!report.headline && !report.business?.whatTheyDo) body(writer, "기업 조사 자료가 없습니다.");

    if (report.glossary?.length) {
      heading(writer, "회사에서 쓰는 말");
      report.glossary.forEach((item) => {
        if (item.term) body(writer, `${item.term} — ${item.meaning || ""}`.trim());
      });
    }

    if (report.educationContext) {
      heading(writer, "교육 대상과 출발점");
      const context = report.educationContext;
      if (context.likelyLearners?.length) body(writer, `예상 대상: ${context.likelyLearners.join(", ")}`);
      if (context.currentWork) body(writer, `현재 업무 방식: ${context.currentWork}`);
      if (context.startingPoint) body(writer, `시작점: ${context.startingPoint}`);
      if (context.caution) body(writer, `주의: ${context.caution}`);
    }

    // 상담에서 나온 것과 조사에서 나온 것을 섞지 않는다. 강사가 근거의 무게를 구분해야 한다.
    if (briefing?.overview) {
      heading(writer, "상담에서 확인된 내용");
      body(writer, briefing.overview);

      if (briefing.keyNeeds?.length) {
        writer.y -= 6;
        ensureRoom(writer, 24);
        writer.page.drawText("핵심 요구", { x: MARGIN, y: writer.y, size: 11, font: writer.bold, color: INK });
        writer.y -= 18;
        briefing.keyNeeds.forEach((need) => body(writer, `· ${need.title} — ${need.detail}`, 8));
      }
      if (briefing.audience?.headline) {
        writer.y -= 6;
        body(writer, `참석자: ${briefing.audience.headline} — ${briefing.audience.detail}`);
      }
      if (briefing.constraints?.length) {
        writer.y -= 6;
        ensureRoom(writer, 24);
        writer.page.drawText("제약 조건", { x: MARGIN, y: writer.y, size: 11, font: writer.bold, color: INK });
        writer.y -= 18;
        bullets(writer, briefing.constraints);
      }
      if (briefing.decisions?.length) {
        writer.y -= 6;
        ensureRoom(writer, 24);
        writer.page.drawText("합의된 사항", { x: MARGIN, y: writer.y, size: 11, font: writer.bold, color: INK });
        writer.y -= 18;
        bullets(writer, briefing.decisions);
      }
      if (briefing.openQuestions?.length) {
        writer.y -= 6;
        ensureRoom(writer, 24);
        writer.page.drawText("아직 확인되지 않은 것", { x: MARGIN, y: writer.y, size: 11, font: writer.bold, color: INK });
        writer.y -= 18;
        bullets(writer, briefing.openQuestions);
      }
    } else {
      heading(writer, "상담에서 확인된 내용");
      body(writer, "상담 통합 브리핑이 아직 없습니다. 상담 기록이 2건 이상일 때 만들어집니다.");
    }

    heading(writer, "강사께 요청드리는 것");
    body(writer, "· 고객사 제출용 강의 구성 아웃라인 (학습목표, 모듈별 시간과 형태, 참석자 준비물, 산출물)", 0);
    body(writer, "· 실제 강의에 사용하실 강의 자료", 0);
    writer.y -= 4;
    body(writer, "위 두 가지를 교육사업팀으로 보내 주시면 시스템에 등록해 관리합니다. 이 브리프의 내용은 기업 조사와 상담 기록에서 나온 것이며, 상담에서 확인되지 않은 항목은 그대로 비워 두었습니다.", 0, 10);

    const bytes = await pdf.save();
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="brief-${session.id}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "브리프를 만들지 못했습니다." },
      { status: 422 },
    );
  }
}
