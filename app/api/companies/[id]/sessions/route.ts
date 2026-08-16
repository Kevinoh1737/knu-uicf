import { requireTeamSession } from "@/lib/auth/guard";
import { SurveyAnswers, sanitizeQuestions, summarizeSurvey } from "@/lib/surveys";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** 기업 화면에서 보는 같은 데이터. 강사 페이지와 같은 행을 반대 방향에서 읽는다. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) return Response.json({ error: "기업 정보를 확인하지 못했습니다." }, { status: 400 });

    const supabase = createSupabaseAdmin();
    const { data: sessions, error } = await supabase
      .from("course_sessions")
      .select("id,title,held_on,location,headcount,duration_hours,status,outline,materials,instructor_id,instructors(id,name,affiliation,job_title,email)")
      .eq("company_id", id)
      .order("held_on", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (error) throw error;

    const sessionIds = (sessions || []).map((session) => session.id as string);
    // 계약은 강의별로 하나만 살아 있지만 이력이 쌓이므로 최신 것만 화면에 붙인다.
    const { data: contracts } = sessionIds.length
      ? await supabase
          .from("contracts")
          .select("id,course_session_id,contract_no,status,sent_to,created_at")
          .in("course_session_id", sessionIds)
          .order("created_at", { ascending: false })
      : { data: [] };

    const latest = new Map<string, unknown>();
    (contracts || []).forEach((contract) => {
      const key = contract.course_session_id as string;
      if (!latest.has(key)) latest.set(key, contract);
    });

    // 교육과정별 수강생 수. 단계 표시와 카드 진행에 같은 숫자를 쓴다.
    const { data: enrollments } = sessionIds.length
      ? await supabase.from("session_learners").select("course_session_id,status").in("course_session_id", sessionIds)
      : { data: [] };
    const learnerCounts = new Map<string, { total: number; attended: number }>();
    (enrollments || []).forEach((row) => {
      const key = row.course_session_id as string;
      const current = learnerCounts.get(key) || { total: 0, attended: 0 };
      if (row.status !== "cancelled") current.total += 1;
      if (row.status === "attended") current.attended += 1;
      learnerCounts.set(key, current);
    });

    // 단계 표시는 기업 전체의 진행이라 상담·질문지도 함께 읽는다.
    const { data: company } = await supabase
      .from("company_research").select("questions,research,stage").eq("id", id).single();
    const { count: consultationCount } = await supabase
      .from("company_consultations").select("id", { count: "exact", head: true })
      .eq("company_id", id).eq("status", "completed");

    // 강사를 배정할 때 고르는 목록. 화면마다 따로 부르지 않도록 함께 내려보낸다.
    const { data: instructors } = await supabase
      .from("instructors")
      .select("id,name,affiliation,job_title")
      .eq("status", "active")
      .order("name");

    // 만족도. 발송은 이 화면에서 하고 결과도 여기서 본다 — 설문지 문항 편집만 만족도 메뉴다.
    const { data: surveys } = sessionIds.length
      ? await supabase.from("surveys").select("id,course_session_id,title,status,questions").in("course_session_id", sessionIds)
      : { data: [] };
    const surveyIds = (surveys || []).map((survey) => survey.id as string);
    const [{ data: surveyInvites }, { data: surveyResponses }] = await Promise.all([
      surveyIds.length
        ? supabase.from("survey_invites").select("survey_id,sent_at").in("survey_id", surveyIds)
        : Promise.resolve({ data: [] as Array<{ survey_id: string; sent_at: string | null }> }),
      surveyIds.length
        ? supabase.from("survey_responses").select("survey_id,answers").in("survey_id", surveyIds)
        : Promise.resolve({ data: [] as Array<{ survey_id: string; answers: unknown }> }),
    ]);

    const surveyBySession = new Map<string, {
      id: string; title: string; status: string; questionCount: number;
      sent: number; responded: number; responseRate: number; overall: number | null;
    }>();
    (surveys || []).forEach((survey) => {
      const surveyId = survey.id as string;
      const questions = sanitizeQuestions(survey.questions);
      const sent = (surveyInvites || []).filter((invite) => invite.survey_id === surveyId && invite.sent_at).length;
      const responses = (surveyResponses || [])
        .filter((response) => response.survey_id === surveyId)
        .map((response) => ({ answers: (response.answers || {}) as SurveyAnswers }));
      const summary = summarizeSurvey(questions, responses, sent);
      surveyBySession.set(survey.course_session_id as string, {
        id: surveyId,
        title: String(survey.title || ""),
        status: String(survey.status || "draft"),
        questionCount: questions.length,
        sent: summary.invited,
        responded: summary.responded,
        responseRate: summary.responseRate,
        overall: summary.overall,
      });
    });

    return Response.json({
      sessions: (sessions || []).map((session) => ({
        ...session,
        contract: latest.get(session.id as string) || null,
        learners: learnerCounts.get(session.id as string) || { total: 0, attended: 0 },
        survey: surveyBySession.get(session.id as string) || null,
      })),
      instructors: instructors || [],
      progress: {
        hasResearch: Boolean(company?.research && Object.keys(company.research as object).length),
        questionCount: Array.isArray(company?.questions) ? company.questions.length : 0,
        consultationCount: consultationCount || 0,
        storedStage: (company?.stage as string) || "research_complete",
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "교육 진행 정보를 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}
