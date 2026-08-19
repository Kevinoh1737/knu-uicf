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
      /**
       * 한 번이라도 교육에 쓰인 질문지의 문항은 잠근다.
       *
       * 지난 응답이 깨지지는 않는다 — 조사를 만들 때 문항을 복사해 두므로 그때 물은 문장은
       * 그대로 남는다. 깨지는 것은 비교표다: 축은 이 질문지의 현재 문항이고 교육별 점수는
       * 문항 id 로 맞추므로, 문항을 더하면 지난 교육 줄이 비고 빼면 실제로 답한 문항이
       * 사라지며, 문구만 고치면 다른 문장을 보고 답한 점수에 새 문장이 붙는다.
       * 화면도 같은 판단으로 버튼을 감추지만, 막는 것은 여기여야 한다.
       */
      const { count: usedCount } = await supabase
        .from("surveys").select("id", { count: "exact", head: true }).eq("template_id", id);
      if (usedCount) {
        return Response.json(
          { error: `이미 ${usedCount}개 교육이 이 질문지로 물었습니다. 문항은 고칠 수 없습니다 — 새 질문지를 만들어 주세요.` },
          { status: 409 },
        );
      }
      const questions = sanitizeQuestions(body.questions);
      if (!questions.length) return Response.json({ error: "문항이 하나도 없습니다." }, { status: 400 });
      // 질문지 안의 문항은 전부 표준이다. 과정 전용 문항은 이제 없다.
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

    // 치우면서 기본 표시도 함께 뗀다. '기본은 한 장뿐'이 유일 인덱스로 걸려 있어, 표시를
    // 단 채로 두면 다음 장을 기본으로 세울 수 없다.
    const { error } = await supabase
      .from("survey_templates")
      .update({ archived: true, is_default: false, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;

    /**
     * 기본 질문지를 치웠으면 남은 것 중 하나가 그 자리를 잇는다.
     *
     * 예전에는 '다른 것을 기본으로 세운 뒤에 치우라'며 거절했는데, 기본을 바꾸는 버튼을
     * 없앤 지금 그 말은 막다른 길이다. 어차피 사람이 고를 일이 아니다 — 과정에서 어느
     * 질문지를 쓸지는 그때 고르고, 기본은 '아무것도 고르지 않았을 때 뭘 쓸까'일 뿐이다.
     * 가장 최근에 만든 것을 세운다(새로 만들고 옛것을 치우는 흐름에서 그게 맞다).
     */
    if (template.is_default) {
      const { data: next } = await supabase
        .from("survey_templates").select("id").eq("archived", false)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (next) {
        await supabase.from("survey_templates")
          .update({ is_default: true, updated_at: new Date().toISOString() }).eq("id", next.id);
      }
    }
    return Response.json({ archived: true });
  } catch (error) {
    return Response.json({ error: detail(error) || "질문지를 치우지 못했습니다." }, { status: 422 });
  }
}
