import { displayCompanyName } from "@/lib/company-name";
import { formatHeldOn } from "@/lib/course-time";
import { BAR, BAR_BG, createDocument, drawRun, ensureRoom, line, MARGIN, MUTED, PAGE, rule } from "@/lib/pdf-writer";
import { SCALE_MAX, SurveySummary } from "@/lib/surveys";

export type ReportSession = {
  title?: string; held_on?: string | null; start_time?: string | null; duration_hours?: number | null;
  company_research?: { name?: string } | null; instructors?: { name?: string } | null;
} | null;

/**
 * 결과 보고서를 그린다. 라우트가 아니라 여기 있는 이유는 그려지는 것을 라우트 밖에서도
 * 확인할 수 있어야 하기 때문이다 — 인쇄물은 눈으로 봐야 맞는지 알 수 있다.
 *
 * 응답자 이름은 넣지 않는다. 수강생에게 익명으로 묻는다고 알리고 받은 답이고, 고객사로
 * 나가는 문서에 이름이 붙으면 그 약속이 깨진다. 발송·응답 '수'까지만 적는다.
 */
export async function renderSurveyReport({ session, summary }: { session: ReportSession; summary: SurveySummary }) {
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

  // 서술형 — 점수가 말해 주지 않는 이유가 여기 있다. 답이 없는 문항은 지면만 차지한다.
  summary.texts.filter((text) => text.answers.length > 0).forEach((text) => {
    ensureRoom(writer, 50);
    writer.y -= 4;
    line(writer, `${text.text}  (${text.answers.length}건)`, bold, 11, 9);
    text.answers.forEach((answer) => line(writer, `· ${answer}`, regular, 10, 6, MUTED, 12));
  });

  ensureRoom(writer, 40);
  writer.y -= 8;
  line(writer, "강원대학교 산학협력단 교육사업팀", regular, 9.5, 6, MUTED);

  return pdf.save();
}
