import { requireTeamSession } from "@/lib/auth/guard";
import { sanitizeQuestions } from "@/lib/surveys";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COLUMNS = "id,name,intro,questions,is_default,archived,created_at,updated_at";

function detail(error: unknown) {
  return error instanceof Error ? error.message
    : (error && typeof error === "object" && "message" in error) ? String((error as { message: unknown }).message)
    : "";
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) return Response.json({ error: "질문지를 확인하지 못했습니다." }, { status: 400 });

    const body = await request.json() as { name?: string; intro?: string; questions?: unknown; isDefault?: boolean };
    const supabase = createSupabaseAdmin();
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.name !== undefined) {
      const name = String(body.name).trim().slice(0, 120);
      if (!name) return Response.json({ error: "질문지 이름을 입력해 주세요." }, { status: 400 });
      update.name = name;
    }
    if (body.intro !== undefined) update.intro = String(body.intro).trim().slice(0, 500);
    if (body.questions !== undefined) {
      const questions = sanitizeQuestions(body.questions);
      if (!questions.length) return Response.json({ error: "문항이 하나도 없습니다." }, { status: 400 });
      // 질문지 안의 문항은 전부 표준이다. 과정 전용 문항은 그 과정 설문지에만 산다.
      update.questions = questions.map((question) => ({ ...question, source: "standard" as const }));
    }

    // 기본은 한 장뿐이다(부분 유일 인덱스). 새로 세우기 전에 쓰던 것을 내린다.
    if (body.isDefault === true) {
      const { error: clearError } = await supabase
        .from("survey_templates").update({ is_default: false }).eq("is_default", true).neq("id", id);
      if (clearError) throw clearError;
      update.is_default = true;
    }

    const { data, error } = await supabase
      .from("survey_templates").update(update).eq("id", id).select(COLUMNS).single();
    if (error) throw error;
    return Response.json({ template: data });
  } catch (error) {
    return Response.json({ error: detail(error) || "질문지를 저장하지 못했습니다." }, { status: 422 });
  }
}

/**
 * 지우지 않고 접는다(archived). 이미 이 질문지로 만든 설문지와 응답이 남아 있고,
 * 나중에 '어떤 질문지로 물었나'를 되짚을 수 있어야 한다.
 */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) return Response.json({ error: "질문지를 확인하지 못했습니다." }, { status: 400 });

    const supabase = createSupabaseAdmin();
    const { data: template, error: readError } = await supabase
      .from("survey_templates").select("id,is_default").eq("id", id).single();
    if (readError || !template) throw readError || new Error("질문지를 찾지 못했습니다.");

    // 기본 질문지를 치우면 과정에서 고를 기본값이 사라진다. 다른 것을 기본으로 세운 뒤에.
    if (template.is_default) {
      return Response.json(
        { error: "기본 질문지는 치울 수 없습니다. 다른 질문지를 기본으로 지정한 뒤에 다시 시도해 주세요." },
        { status: 409 },
      );
    }

    const { error } = await supabase
      .from("survey_templates").update({ archived: true, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
    return Response.json({ archived: true });
  } catch (error) {
    return Response.json({ error: detail(error) || "질문지를 치우지 못했습니다." }, { status: 422 });
  }
}
