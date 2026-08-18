import { requireTeamSession } from "@/lib/auth/guard";
import { DEFAULT_QUESTIONS, sanitizeQuestions } from "@/lib/surveys";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const COLUMNS = "id,name,intro,questions,is_default,archived,created_at,updated_at";

function detail(error: unknown) {
  return error instanceof Error ? error.message
    : (error && typeof error === "object" && "message" in error) ? String((error as { message: unknown }).message)
    : "";
}

/**
 * 표준 질문지. 만족도 설문은 과정마다 새로 쓰는 것이 아니라 몇 장을 계속 돌려 쓴다 —
 * 같은 문항 id 로 물어야 과정끼리 견줄 수 있기 때문이다. 여기서 관리하고, 과정에서는
 * 골라 쓰기만 한다.
 */
export async function GET() {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase
      .from("survey_templates")
      .select(COLUMNS)
      .eq("archived", false)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true });
    // 표가 아직 없는 DB(마이그레이션 전)는 고장이 아니라 '준비 안 됨'이다. 화면이 붉은
    // 오류로 놀라게 하는 대신 빈 목록과 안내로 내려간다 — 설문지 만들기는 그동안에도 된다.
    // PostgREST 는 없는 표를 42P01 이 아니라 PGRST205 로 돌려준다(실측).
    if (error && (error.code === "42P01" || error.code === "PGRST205")) {
      return Response.json({ templates: [], ready: false });
    }
    if (error) throw error;

    // 어느 질문지를 몇 번 썼는지. 고를 때 판단 근거가 되고, 지우기 전 경고의 근거도 된다.
    const { data: used } = await supabase.from("surveys").select("template_id");
    const counts = new Map<string, number>();
    (used || []).forEach((row) => {
      const key = row.template_id as string | null;
      if (!key) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });

    return Response.json({
      ready: true,
      templates: (data || []).map((template) => ({
        ...template,
        questions: sanitizeQuestions(template.questions),
        usedCount: counts.get(template.id as string) || 0,
      })),
    });
  } catch (error) {
    return Response.json({ error: detail(error) || "질문지를 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const body = await request.json() as { name?: string; intro?: string; questions?: unknown };
    const name = (body.name || "").trim().slice(0, 120);
    if (!name) return Response.json({ error: "질문지 이름을 입력해 주세요." }, { status: 400 });

    // 새 질문지의 문항은 전부 표준이다 — 이 질문지를 쓰는 모든 과정이 같은 축으로 묶인다.
    const given = sanitizeQuestions(body.questions);
    const questions = (given.length ? given : DEFAULT_QUESTIONS)
      .map((question) => ({ ...question, source: "standard" as const }));

    const supabase = createSupabaseAdmin();
    const { count } = await supabase.from("survey_templates").select("id", { count: "exact", head: true });
    const { data, error } = await supabase
      .from("survey_templates")
      .insert({
        name,
        intro: (body.intro || "").trim().slice(0, 500),
        questions,
        // 첫 장은 자동으로 기본이 된다. 기본이 없으면 과정에서 고를 것이 없다.
        is_default: !count,
      })
      .select(COLUMNS)
      .single();
    if (error) throw error;
    return Response.json({ template: data }, { status: 201 });
  } catch (error) {
    return Response.json({ error: detail(error) || "질문지를 만들지 못했습니다." }, { status: 422 });
  }
}
