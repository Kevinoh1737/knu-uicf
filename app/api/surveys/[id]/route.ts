import { requireTeamSession } from "@/lib/auth/guard";
import { sanitizeQuestions, summarizeSurvey, SurveyAnswers } from "@/lib/surveys";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COLUMNS = "id,course_session_id,title,intro,questions,status,template_id,created_at,updated_at";

/** 설문지 한 장과 지금까지의 응답 지표. 편집 화면과 교육과정 화면이 같은 것을 읽는다. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) return Response.json({ error: "설문지를 확인하지 못했습니다." }, { status: 400 });

    const supabase = createSupabaseAdmin();
    const { data: survey, error } = await supabase
      .from("surveys")
      .select(`${COLUMNS},survey_templates(id,name),course_sessions(id,title,held_on,start_time,duration_hours,location,headcount,company_research(id,name),instructors(name))`)
      .eq("id", id)
      .single();
    if (error || !survey) throw error || new Error("설문지를 찾지 못했습니다.");

    const [{ data: invites }, { data: responses }] = await Promise.all([
      supabase.from("survey_invites")
        .select("id,sent_at,send_error,responded_at,learners(id,name,department,email)")
        .eq("survey_id", id),
      supabase.from("survey_responses").select("answers,submitted_at").eq("survey_id", id),
    ]);

    const questions = sanitizeQuestions(survey.questions);
    const sentCount = (invites || []).filter((invite) => invite.sent_at).length;
    const summary = summarizeSurvey(
      questions,
      (responses || []).map((response) => ({ answers: (response.answers || {}) as SurveyAnswers })),
      sentCount,
    );

    // 편집 화면은 '무슨 교육의, 어느 질문지로 만든' 설문지인지 알아야 한다 — 그것 없이는
    // 제목만 보고 고치게 되고, 과정끼리 견주는 축(질문지)이 화면에서 사라진다.
    const session = survey.course_sessions as {
      id?: string; title?: string; held_on?: string | null; start_time?: string | null; duration_hours?: number | null;
      company_research?: { id?: string; name?: string } | null; instructors?: { name?: string } | null;
    } | null;
    const template = survey.survey_templates as { id?: string; name?: string } | null;

    return Response.json({
      survey: { ...survey, questions },
      course: {
        id: session?.id || survey.course_session_id,
        title: session?.title || "",
        heldOn: session?.held_on || null,
        startTime: session?.start_time || null,
        durationHours: session?.duration_hours ?? null,
        companyName: session?.company_research?.name || "",
        instructorName: session?.instructors?.name || "",
      },
      template: template?.id ? { id: template.id, name: template.name || "" } : null,
      invites: (invites || []).map((invite) => {
        const learner = invite.learners as { id?: string; name?: string; department?: string; email?: string } | null;
        return {
          id: invite.id,
          sentAt: invite.sent_at,
          sendError: invite.send_error,
          respondedAt: invite.responded_at,
          learnerName: learner?.name || "",
          learnerEmail: learner?.email || "",
        };
      }),
      summary,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message
      : (error && typeof error === "object" && "message" in error) ? String((error as { message: unknown }).message) : "";
    return Response.json({ error: detail || "설문지를 불러오지 못했습니다." }, { status: 404 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) return Response.json({ error: "설문지를 확인하지 못했습니다." }, { status: 400 });

    const body = await request.json() as { title?: string; intro?: string; questions?: unknown; status?: string };
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.title === "string") update.title = body.title.trim().slice(0, 120) || "교육 만족도 조사";
    if (typeof body.intro === "string") update.intro = body.intro.trim().slice(0, 600);
    if (body.status === "draft" || body.status === "open" || body.status === "closed") update.status = body.status;

    if (body.questions !== undefined) {
      const questions = sanitizeQuestions(body.questions);
      if (!questions.length) return Response.json({ error: "문항을 하나 이상 남겨 주세요." }, { status: 400 });

      // 이미 답을 받은 뒤에 문항을 갈아엎으면 지난 응답이 어느 질문에 대한 답인지 알 수 없게
      // 된다. 남아 있는 문항의 답만 뜻을 유지하므로, 응답이 있으면 문항 삭제·id 변경을 막는다.
      const supabase = createSupabaseAdmin();
      const { count } = await supabase
        .from("survey_responses").select("id", { count: "exact", head: true }).eq("survey_id", id);
      if (count) {
        const { data: current } = await supabase.from("surveys").select("questions").eq("id", id).single();
        const before = sanitizeQuestions(current?.questions);
        const after = new Set(questions.map((question) => question.id));
        const dropped = before.filter((question) => !after.has(question.id));
        if (dropped.length) {
          return Response.json(
            { error: `이미 ${count}건의 응답이 있어 문항을 지울 수 없습니다. 문구 수정과 문항 추가만 가능합니다.` },
            { status: 409 },
          );
        }
      }
      update.questions = questions;
    }

    const { data, error } = await createSupabaseAdmin()
      .from("surveys").update(update).eq("id", id).select(COLUMNS).single();
    if (error) throw error;
    return Response.json({ survey: { ...data, questions: sanitizeQuestions(data.questions) } });
  } catch (error) {
    const detail = error instanceof Error ? error.message
      : (error && typeof error === "object" && "message" in error) ? String((error as { message: unknown }).message) : "";
    return Response.json({ error: detail || "설문지를 저장하지 못했습니다." }, { status: 422 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) return Response.json({ error: "설문지를 확인하지 못했습니다." }, { status: 400 });

    const supabase = createSupabaseAdmin();
    // 받은 응답은 되살릴 수 없다. 설문지째 지우는 일은 응답이 없을 때만 허용한다.
    const { count } = await supabase
      .from("survey_responses").select("id", { count: "exact", head: true }).eq("survey_id", id);
    if (count) {
      return Response.json({ error: `응답 ${count}건이 있어 삭제할 수 없습니다. 마감으로 바꿔 주세요.` }, { status: 409 });
    }
    const { error } = await supabase.from("surveys").delete().eq("id", id);
    if (error) throw error;
    return Response.json({ deleted: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message
      : (error && typeof error === "object" && "message" in error) ? String((error as { message: unknown }).message) : "";
    return Response.json({ error: detail || "설문지를 삭제하지 못했습니다." }, { status: 422 });
  }
}
