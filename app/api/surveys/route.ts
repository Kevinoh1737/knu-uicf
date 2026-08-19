import { requireTeamSession } from "@/lib/auth/guard";
import { DEFAULT_QUESTIONS, sanitizeQuestions } from "@/lib/surveys";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SESSION_COLUMNS =
  "id,title,held_on,start_time,duration_hours,location,headcount,status,company_id,instructor_id,company_research(id,name),instructors(name)";

/**
 * 만족도 화면의 목록. 설문지가 아니라 '교육과정'을 먼저 세운다 — 설문지는 과정에 매달린
 * 것이라, 아직 설문지가 없는 과정도 같은 목록에 보여야 만들 자리가 생긴다.
 */
export async function GET() {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const supabase = createSupabaseAdmin();
    const { data: sessions, error } = await supabase
      .from("course_sessions")
      .select(SESSION_COLUMNS)
      .neq("status", "cancelled")
      .order("held_on", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (error) throw error;

    const sessionIds = (sessions || []).map((session) => session.id as string);
    const { data: surveys } = sessionIds.length
      ? await supabase.from("surveys").select("id,course_session_id,title,status,questions,updated_at").in("course_session_id", sessionIds)
      : { data: [] };

    const surveyIds = (surveys || []).map((survey) => survey.id as string);
    const [{ data: invites }, { data: responses }] = await Promise.all([
      surveyIds.length
        ? supabase.from("survey_invites").select("survey_id,sent_at").in("survey_id", surveyIds)
        : Promise.resolve({ data: [] as Array<{ survey_id: string; sent_at: string | null }> }),
      surveyIds.length
        ? supabase.from("survey_responses").select("survey_id").in("survey_id", surveyIds)
        : Promise.resolve({ data: [] as Array<{ survey_id: string }> }),
    ]);

    const sent = new Map<string, number>();
    (invites || []).forEach((invite) => {
      if (!invite.sent_at) return;
      const key = invite.survey_id as string;
      sent.set(key, (sent.get(key) || 0) + 1);
    });
    const answered = new Map<string, number>();
    (responses || []).forEach((response) => {
      const key = response.survey_id as string;
      answered.set(key, (answered.get(key) || 0) + 1);
    });

    const bySession = new Map((surveys || []).map((survey) => [survey.course_session_id as string, survey]));

    // 수강생이 없으면 발송할 곳이 없다. 목록에서 미리 알려 주려고 함께 센다.
    const { data: enrollments } = sessionIds.length
      ? await supabase.from("session_learners").select("course_session_id,status").in("course_session_id", sessionIds)
      : { data: [] };
    const learnerCounts = new Map<string, number>();
    (enrollments || []).forEach((row) => {
      if (row.status === "cancelled") return;
      const key = row.course_session_id as string;
      learnerCounts.set(key, (learnerCounts.get(key) || 0) + 1);
    });

    const items = (sessions || []).map((session) => {
      const survey = bySession.get(session.id as string);
      const company = session.company_research as { id?: string; name?: string } | null;
      const instructor = session.instructors as { name?: string } | null;
      const surveyId = survey?.id as string | undefined;
      return {
        sessionId: session.id,
        title: session.title,
        heldOn: session.held_on,
        startTime: session.start_time,
        durationHours: session.duration_hours,
        location: session.location,
        headcount: session.headcount,
        companyId: company?.id || session.company_id,
        companyName: company?.name || "",
        instructorName: instructor?.name || "",
        learnerCount: learnerCounts.get(session.id as string) || 0,
        survey: survey
          ? {
              id: surveyId,
              title: survey.title,
              status: survey.status,
              questionCount: sanitizeQuestions(survey.questions).length,
              updatedAt: survey.updated_at,
              sentCount: surveyId ? sent.get(surveyId) || 0 : 0,
              responseCount: surveyId ? answered.get(surveyId) || 0 : 0,
            }
          : null,
      };
    });

    return Response.json({ items });
  } catch (error) {
    const detail = error instanceof Error ? error.message
      : (error && typeof error === "object" && "message" in error) ? String((error as { message: unknown }).message) : "";
    return Response.json({ error: detail || "만족도 목록을 불러오지 못했습니다." }, { status: 500 });
  }
}

/** 교육과정에 설문지를 만든다. 이미 있으면 그것을 돌려준다 — 한 과정에 한 장이다. */
export async function POST(request: Request) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const body = await request.json() as {
      courseSessionId?: string; questions?: unknown; title?: string; templateId?: string;
    };
    if (!UUID.test(body.courseSessionId || "")) {
      return Response.json({ error: "교육과정을 확인하지 못했습니다." }, { status: 400 });
    }

    const supabase = createSupabaseAdmin();
    const { data: existing } = await supabase
      .from("surveys").select("id").eq("course_session_id", body.courseSessionId).maybeSingle();
    if (existing) return Response.json({ survey: existing, created: false });

    // 표준 질문지를 베껴 온다. 고르지 않았으면 기본 질문지를 쓴다 — 아무것도 없을 때만
    // 코드 안의 기본 문항으로 내려간다(질문지 표가 아직 없는 DB 도 돌아가야 한다).
    const { data: template } = UUID.test(body.templateId || "")
      ? await supabase.from("survey_templates").select("id,name,intro,questions").eq("id", body.templateId).maybeSingle()
      : await supabase.from("survey_templates").select("id,name,intro,questions").eq("is_default", true).eq("archived", false).maybeSingle();

    const fromTemplate = template ? sanitizeQuestions(template.questions).map((question) => ({ ...question, source: "standard" as const })) : [];
    const given = sanitizeQuestions(body.questions);
    const questions = given.length ? given : fromTemplate;

    const { data, error } = await supabase
      .from("surveys")
      .insert({
        course_session_id: body.courseSessionId,
        title: (body.title || "").trim().slice(0, 120) || "교육 만족도 조사",
        intro: template?.intro || "",
        questions: questions.length ? questions : DEFAULT_QUESTIONS,
        ...(template ? { template_id: template.id } : {}),
      })
      .select("id,course_session_id,title,intro,questions,status,updated_at")
      .single();
    if (error) throw error;
    return Response.json({ survey: data, created: true }, { status: 201 });
  } catch (error) {
    const detail = error instanceof Error ? error.message
      : (error && typeof error === "object" && "message" in error) ? String((error as { message: unknown }).message) : "";
    return Response.json({ error: detail || "만족도 조사를 만들지 못했습니다." }, { status: 422 });
  }
}
