import { requireTeamSession } from "@/lib/auth/guard";
import { sanitizeQuestions, summarizeSurvey, SurveyAnswers } from "@/lib/surveys";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * 질문지 하나를 쓴 교육들을 나란히 놓는다. 표준 질문지를 돌려 쓰기로 한 이유가 이 화면이다 —
 * 과정마다 문항을 새로 쓰면 숫자는 남아도 견줄 수가 없다.
 *
 * 축은 '질문지의 척도 문항'이다. 과정에서 더한 문항(source=custom)은 그 과정에만 있어
 * 다른 열을 채울 수 없으므로 여기서 뺀다 — 빈칸이 섞인 표는 비교가 아니라 착시다.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) return Response.json({ error: "질문지를 확인하지 못했습니다." }, { status: 400 });

    const supabase = createSupabaseAdmin();
    const { data: template, error: templateError } = await supabase
      .from("survey_templates").select("id,name,questions").eq("id", id).maybeSingle();
    if (templateError) throw templateError;
    if (!template) return Response.json({ error: "질문지를 찾지 못했습니다." }, { status: 404 });

    const axis = sanitizeQuestions(template.questions).filter((question) => question.type === "scale");

    const { data: surveys, error } = await supabase
      .from("surveys")
      .select("id,status,course_session_id,course_sessions(id,title,held_on,company_id,instructor_id,company_research(name),instructors(name))")
      .eq("template_id", id);
    if (error) throw error;

    const surveyIds = (surveys || []).map((survey) => survey.id as string);
    const [{ data: responses }, { data: invites }] = await Promise.all([
      surveyIds.length
        ? supabase.from("survey_responses").select("survey_id,answers").in("survey_id", surveyIds)
        : Promise.resolve({ data: [] as Array<{ survey_id: string; answers: unknown }> }),
      surveyIds.length
        ? supabase.from("survey_invites").select("survey_id,sent_at").in("survey_id", surveyIds)
        : Promise.resolve({ data: [] as Array<{ survey_id: string; sent_at: string | null }> }),
    ]);

    const answersBySurvey = new Map<string, Array<{ answers: SurveyAnswers }>>();
    (responses || []).forEach((row) => {
      const key = row.survey_id as string;
      const list = answersBySurvey.get(key) || [];
      list.push({ answers: (row.answers || {}) as SurveyAnswers });
      answersBySurvey.set(key, list);
    });
    const sentBySurvey = new Map<string, number>();
    (invites || []).forEach((invite) => {
      if (!invite.sent_at) return;
      const key = invite.survey_id as string;
      sentBySurvey.set(key, (sentBySurvey.get(key) || 0) + 1);
    });

    const courses = (surveys || []).map((survey) => {
      const surveyId = survey.id as string;
      const session = survey.course_sessions as {
        id?: string; title?: string; held_on?: string | null; company_id?: string; instructor_id?: string;
        company_research?: { name?: string } | null; instructors?: { name?: string } | null;
      } | null;
      // 같은 요약기를 쓴다. 비교 화면만 다르게 세면 한 화면의 평균과 다른 화면의 평균이 갈린다.
      const summary = summarizeSurvey(axis, answersBySurvey.get(surveyId) || [], sentBySurvey.get(surveyId) || 0);
      const scores: Record<string, { average: number; count: number }> = {};
      summary.scales.forEach((scale) => { scores[scale.id] = { average: scale.average, count: scale.count }; });
      return {
        surveyId,
        sessionId: session?.id || survey.course_session_id,
        title: session?.title || "",
        // 강사·회사는 '무엇끼리 견줄 것인가'를 고르는 손잡이다. 한 강사의 지난 수업들,
        // 한 회사의 지난 과정들 — 뜻이 있는 묶음은 지금까지 이 둘뿐이다.
        companyId: session?.company_id || "",
        companyName: session?.company_research?.name || "",
        instructorId: session?.instructor_id || "",
        instructorName: session?.instructors?.name || "",
        heldOn: session?.held_on || null,
        status: survey.status,
        invited: summary.invited,
        responded: summary.responded,
        responseRate: summary.responseRate,
        overall: summary.overall,
        scores,
      };
    })
      // 최근에 한 교육이 왼쪽이다. 날짜 없는 과정은 뒤로 — 견주는 기준이 시간이기 때문이다.
      .sort((left, right) => (right.heldOn || "").localeCompare(left.heldOn || ""));

    // 기준선(문항별 평균)은 여기서 내지 않는다. 화면이 강사별·회사별로 걸러 보기 때문에,
    // '무엇의 평균인가'는 지금 무엇을 보고 있느냐에 달려 있다 — 보이는 것에서 화면이 낸다.
    return Response.json({
      template: { id: template.id, name: template.name },
      axis: axis.map((question) => ({ id: question.id, text: question.text })),
      courses,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message
      : (error && typeof error === "object" && "message" in error) ? String((error as { message: unknown }).message) : "";
    return Response.json({ error: detail || "비교를 불러오지 못했습니다." }, { status: 500 });
  }
}
