import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";
import { requireTeamSession } from "@/lib/auth/guard";
import { SCALE_LABELS, sanitizeQuestions } from "@/lib/surveys";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 56;
const INK = rgb(0.09, 0.13, 0.11);
const MUTED = rgb(0.47, 0.5, 0.48);
const LINE = rgb(0.86, 0.89, 0.92);

/** pdf-lib 은 줄바꿈을 해주지 않는다. 폭에 맞춰 직접 자른다 — 계약서 PDF 와 같은 방식이다. */
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

type Writer = { pdf: PDFDocument; page: PDFPage; y: number };

function ensureRoom(writer: Writer, needed: number) {
  if (writer.y - needed > MARGIN) return;
  writer.page = writer.pdf.addPage([PAGE.width, PAGE.height]);
  writer.y = PAGE.height - MARGIN;
}

function line(writer: Writer, text: string, font: PDFFont, size: number, gap = 6, color = INK, indent = 0) {
  for (const row of wrap(text, font, size, PAGE.width - MARGIN * 2 - indent)) {
    ensureRoom(writer, size + gap);
    writer.page.drawText(row, { x: MARGIN + indent, y: writer.y, size, font, color });
    writer.y -= size + gap;
  }
}

/**
 * 종이로 돌리는 설문지. 화면에서 답하지 못하는 현장(공장 라인, 메일을 안 쓰는 수강생)이 있어
 * 인쇄본이 필요하고, 고객사에 "이런 걸 묻습니다"를 먼저 보여 줄 때도 쓴다.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) return Response.json({ error: "설문지를 확인하지 못했습니다." }, { status: 400 });

    const { data: survey, error } = await createSupabaseAdmin()
      .from("surveys")
      .select("id,title,intro,questions,course_sessions(title,held_on,company_research(name),instructors(name))")
      .eq("id", id)
      .single();
    if (error || !survey) throw error || new Error("설문지를 찾지 못했습니다.");

    const session = survey.course_sessions as {
      title?: string; held_on?: string | null;
      company_research?: { name?: string } | null; instructors?: { name?: string } | null;
    } | null;
    const questions = sanitizeQuestions(survey.questions);

    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const [regularBytes, boldBytes] = await Promise.all([
      readFile(path.join(process.cwd(), "public/fonts/Pretendard-Regular.ttf")),
      readFile(path.join(process.cwd(), "public/fonts/Pretendard-Bold.ttf")),
    ]);
    const regular = await pdf.embedFont(regularBytes);
    const bold = await pdf.embedFont(boldBytes);

    const writer: Writer = { pdf, page: pdf.addPage([PAGE.width, PAGE.height]), y: PAGE.height - MARGIN };

    line(writer, String(survey.title || "교육 만족도 조사"), bold, 21, 12);
    const heldOn = session?.held_on
      ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "long", timeZone: "Asia/Seoul" }).format(new Date(session.held_on))
      : "";
    line(writer, [session?.company_research?.name, session?.title, heldOn].filter(Boolean).join("  ·  "), regular, 10, 6, MUTED);
    if (session?.instructors?.name) line(writer, `강사 ${session.instructors.name}`, regular, 10, 6, MUTED);

    writer.y -= 6;
    writer.page.drawLine({
      start: { x: MARGIN, y: writer.y }, end: { x: PAGE.width - MARGIN, y: writer.y },
      thickness: 1, color: LINE,
    });
    writer.y -= 18;

    if (survey.intro) { line(writer, String(survey.intro), regular, 10.5, 7, MUTED); writer.y -= 8; }

    questions.forEach((question, index) => {
      ensureRoom(writer, 64);
      line(writer, `${String(index + 1).padStart(2, "0")}. ${question.text}${question.required ? "" : " (선택)"}`, bold, 11.5, 8);
      if (question.type === "scale") {
        // 종이에서는 동그라미를 칠 자리가 있어야 답이 된다.
        const labels = SCALE_LABELS.map((label, score) => `(${score + 1}) ${label}`).join("    ");
        line(writer, labels, regular, 9.5, 10, MUTED, 12);
      } else if (question.type === "choice") {
        question.options.forEach((option) => line(writer, `☐  ${option}`, regular, 10, 6, INK, 12));
        writer.y -= 4;
      } else {
        for (let row = 0; row < 3; row += 1) {
          ensureRoom(writer, 22);
          writer.y -= 16;
          writer.page.drawLine({
            start: { x: MARGIN + 12, y: writer.y }, end: { x: PAGE.width - MARGIN, y: writer.y },
            thickness: 0.6, color: LINE,
          });
        }
        writer.y -= 12;
      }
    });

    ensureRoom(writer, 40);
    writer.y -= 6;
    line(writer, "응답해 주셔서 감사합니다. 강원대학교 산학협력단 교육사업팀", regular, 9.5, 6, MUTED);

    const bytes = await pdf.save();
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="survey-${id}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message
      : (error && typeof error === "object" && "message" in error) ? String((error as { message: unknown }).message) : "";
    return Response.json({ error: detail || "설문지를 내보내지 못했습니다." }, { status: 500 });
  }
}
