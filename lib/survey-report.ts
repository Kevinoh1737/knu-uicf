import { displayCompanyName } from "@/lib/company-name";
import { formatHeldOn } from "@/lib/course-time";
import { BAR, BAR_BG, BAR_LOW, createDocument, drawRun, ensureRoom, INK, line, LINE, MARGIN, MUTED, PAGE, rule } from "@/lib/pdf-writer";
import { SCALE_MAX, SurveyAnswers, SurveyQuestion, SurveySummary } from "@/lib/surveys";

export type ReportSession = {
  title?: string; held_on?: string | null; start_time?: string | null; duration_hours?: number | null;
  company_research?: { name?: string } | null; instructors?: { name?: string } | null;
} | null;

/** 한 사람이 낸 답. 이름은 발송 기록(초대)에서 따라온다 — 누가 답했는지는 원래 알고 있다. */
export type ReportResponse = { name: string; department: string; answers: SurveyAnswers };

/**
 * 결과 보고서를 그린다. 라우트가 아니라 여기 있는 이유는 그려지는 것을 라우트 밖에서도
 * 확인할 수 있어야 하기 때문이다 — 인쇄물은 눈으로 봐야 맞는지 알 수 있다.
 *
 * 요약(문항별 평균)만으로는 "왜 그런가"가 안 보여서 뒤에 응답 상세를 붙인다. 사람마다
 * 한 줄로 점수를 늘어놓고, 적어 준 글은 그 아래에 이름과 함께 옮긴다.
 */
export async function renderSurveyReport({ session, summary, questions, responses }: {
  session: ReportSession;
  summary: SurveySummary;
  questions: SurveyQuestion[];
  responses: ReportResponse[];
}) {
  const { pdf, regular, bold, writer } = await createDocument();

  line(writer, `${session?.title || "교육"} 만족도 결과`, bold, 21, 12);
  const heldOn = formatHeldOn(session?.held_on, session?.start_time, session?.duration_hours, "long");
  // 고객사에 그대로 넘기는 문서라 화면과 같은 이름으로 적는다('주식회사'는 떼고).
  line(writer, [displayCompanyName(session?.company_research?.name || ""), heldOn].filter(Boolean).join("  ·  "), regular, 10, 6, MUTED);
  if (session?.instructors?.name) line(writer, `강사 ${session.instructors.name}`, regular, 10, 6, MUTED);
  rule(writer);

  line(writer, [
    `발송 ${summary.invited}명`,
    `응답 ${summary.responded}명 (${summary.responseRate}%)`,
    `전체 평균 ${summary.overall === null ? "—" : `${summary.overall} / ${SCALE_MAX}`}`,
  ].join("      "), bold, 12, 14);

  if (summary.responded === 0) {
    line(writer, "아직 들어온 응답이 없습니다.", regular, 10.5, 7, MUTED);
  }

  // 척도 문항 — 숫자 하나로는 '3.7이 좋은 건가'를 알 수 없어 막대와 분포를 같이 둔다.
  summary.scales.forEach((scale, index) => {
    ensureRoom(writer, 56);
    line(writer, `${String(index + 1).padStart(2, "0")}. ${scale.text}`, bold, 11, 7);
    if (!scale.count) {
      line(writer, "응답 없음", regular, 9.5, 10, MUTED, 12);
      return;
    }
    const barWidth = PAGE.width - MARGIN * 2 - 84;
    ensureRoom(writer, 24);
    writer.page.drawRectangle({ x: MARGIN + 12, y: writer.y - 2, width: barWidth, height: 7, color: BAR_BG });
    writer.page.drawRectangle({
      x: MARGIN + 12, y: writer.y - 2, width: (barWidth * scale.average) / SCALE_MAX, height: 7, color: BAR,
    });
    drawRun(writer.page, `${scale.average.toFixed(2)} / ${SCALE_MAX}`, {
      x: MARGIN + 12 + barWidth + 10, y: writer.y - 2, size: 9.5, font: bold,
    });
    writer.y -= 16;
    line(writer, `${scale.distribution.map((count, position) => `${position + 1}점 ${count}명`).join("   ")}   (응답 ${scale.count}명)`,
      regular, 9, 12, MUTED, 12);
  });

  // ─── 응답 상세 ────────────────────────────────────────────────────────────
  // 평균은 '어느 문항이 낮은가'까지만 답한다. 누가 어떻게 답했는지는 여기서만 보인다.
  const scaleQuestions = questions.filter((question) => question.type === "scale");
  const textQuestions = questions.filter((question) => question.type !== "scale");

  if (responses.length) {
    ensureRoom(writer, 70);
    writer.y -= 10;
    line(writer, "응답 상세", bold, 14, 8);
    line(writer, `문항 번호는 위 결과의 순서와 같습니다. 응답 ${responses.length}명.`, regular, 9.5, 12, MUTED);

    // 이름 한 칸 + 문항 수만큼 + 평균 한 칸. 좁은 종이라 칸 너비를 미리 나눈다.
    const nameWidth = 104;
    const tail = 42;
    const usable = PAGE.width - MARGIN * 2 - nameWidth - tail;
    const cell = scaleQuestions.length ? usable / scaleQuestions.length : usable;

    const header = () => {
      ensureRoom(writer, 26);
      drawRun(writer.page, "응답자", { x: MARGIN, y: writer.y, size: 9, font: bold, color: MUTED });
      scaleQuestions.forEach((question, index) => {
        drawRun(writer.page, String(index + 1).padStart(2, "0"), {
          x: MARGIN + nameWidth + cell * index, y: writer.y, size: 9, font: bold, color: MUTED,
        });
      });
      drawRun(writer.page, "평균", { x: PAGE.width - MARGIN - tail + 8, y: writer.y, size: 9, font: bold, color: MUTED });
      writer.y -= 6;
      writer.page.drawLine({
        start: { x: MARGIN, y: writer.y }, end: { x: PAGE.width - MARGIN, y: writer.y }, thickness: 0.8, color: LINE,
      });
      writer.y -= 13;
    };
    header();

    responses.forEach((response) => {
      // 페이지가 넘어가면 머리줄이 없어져 어느 칸이 몇 번 문항인지 알 수 없게 된다.
      if (writer.y - 18 <= MARGIN) { ensureRoom(writer, 18); header(); }
      const who = response.department ? `${response.name} (${response.department})` : response.name;
      drawRun(writer.page, who.slice(0, 12), { x: MARGIN, y: writer.y, size: 9.5, font: regular });
      const scores: number[] = [];
      scaleQuestions.forEach((question, index) => {
        const value = response.answers[question.id];
        const text = typeof value === "number" ? String(value) : "—";
        if (typeof value === "number") scores.push(value);
        drawRun(writer.page, text, {
          x: MARGIN + nameWidth + cell * index, y: writer.y, size: 9.5, font: regular,
          color: typeof value === "number" && value <= 2 ? BAR_LOW : INK,
        });
      });
      const mine = scores.length ? (scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(2) : "—";
      drawRun(writer.page, mine, { x: PAGE.width - MARGIN - tail + 4, y: writer.y, size: 9.5, font: bold });
      writer.y -= 16;
    });

    // 적어 준 글은 표에 넣을 수 없다. 사람별로 이름과 함께 아래에 옮긴다.
    const written = responses.filter((response) =>
      textQuestions.some((question) => typeof response.answers[question.id] === "string" && response.answers[question.id]));
    if (written.length) {
      // 제목만 페이지 끝에 남고 내용이 다음 장으로 넘어가면 읽는 사람이 한 번 헤맨다.
      // 첫 사람 몫까지 자리가 있어야 제목을 쓴다.
      ensureRoom(writer, 96);
      writer.y -= 12;
      line(writer, "적어 주신 의견", bold, 12, 10);
      written.forEach((response) => {
        ensureRoom(writer, 44);
        const who = response.department ? `${response.name} · ${response.department}` : response.name;
        line(writer, who, bold, 10, 6);
        textQuestions.forEach((question) => {
          const value = response.answers[question.id];
          if (typeof value !== "string" || !value.trim()) return;
          line(writer, `${question.text}`, regular, 9, 4, MUTED, 12);
          line(writer, value, regular, 10, 6, INK, 12);
        });
        writer.y -= 4;
      });
    }
  }

  ensureRoom(writer, 40);
  writer.y -= 8;
  line(writer, "강원대학교 산학협력단 교육사업팀", regular, 9.5, 6, MUTED);

  return pdf.save();
}
