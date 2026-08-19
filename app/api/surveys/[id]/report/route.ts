import { requireTeamSession } from "@/lib/auth/guard";
import { pdfResponse } from "@/lib/pdf-writer";
import { renderSurveyReport, ReportSession } from "@/lib/survey-report";
import { sanitizeQuestions, summarizeSurvey, SurveyAnswers } from "@/lib/surveys";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * 결과 보고서. 고객사에 그대로 넘기는 인쇄물이라 화면과 같은 숫자여야 한다 — 그래서 평균도
 * 화면과 같은 summarizeSurvey 를 쓴다(무응답을 0으로 세지 않는 그 규칙).
 * 빈 설문지(종이로 돌리는 것)는 옆의 pdf 라우트다.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) return Response.json({ error: "만족도 조사를 확인하지 못했습니다." }, { status: 400 });

    const supabase = createSupabaseAdmin();
    const { data: survey, error } = await supabase
      .from("surveys")
      .select("id,title,questions,course_sessions(title,held_on,start_time,duration_hours,company_research(name),instructors(name))")
      .eq("id", id)
      .single();
    if (error || !survey) throw error || new Error("만족도 조사를 찾지 못했습니다.");

    const [{ data: responses }, { data: invites }] = await Promise.all([
      // 누가 낸 답인지 붙이려면 초대를 거쳐야 한다 — 응답은 사람이 아니라 초대에 매달려 있다.
      supabase.from("survey_responses")
        .select("answers,submitted_at,invite_id,survey_invites(learners(name,department))")
        .eq("survey_id", id)
        .order("submitted_at", { ascending: true }),
      supabase.from("survey_invites").select("sent_at").eq("survey_id", id),
    ]);

    const questions = sanitizeQuestions(survey.questions);
    const summary = summarizeSurvey(
      questions,
      (responses || []).map((response) => ({ answers: (response.answers || {}) as SurveyAnswers })),
      (invites || []).filter((invite) => invite.sent_at).length,
    );

    const detail = (responses || []).map((response) => {
      const learner = (response.survey_invites as { learners?: { name?: string; department?: string } | null } | null)?.learners;
      return {
        name: learner?.name || "이름 미상",
        department: learner?.department || "",
        answers: (response.answers || {}) as SurveyAnswers,
      };
    });

    const bytes = await renderSurveyReport({
      session: survey.course_sessions as ReportSession, summary, questions, responses: detail,
    });
    return pdfResponse(bytes, `survey-report-${id}.pdf`);
  } catch (error) {
    const detail = error instanceof Error ? error.message
      : (error && typeof error === "object" && "message" in error) ? String((error as { message: unknown }).message) : "";
    return Response.json({ error: detail || "결과를 내보내지 못했습니다." }, { status: 500 });
  }
}
