import { requireTeamSession } from "@/lib/auth/guard";
import { LearnerStatus } from "@/lib/learners";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set<LearnerStatus>(["registered", "attended", "absent", "cancelled"]);

function detail(error: unknown) {
  return error instanceof Error ? error.message
    : (error && typeof error === "object" && "message" in error) ? String((error as { message: unknown }).message)
    : "";
}

/** 이 교육과정의 수강생과, 아직 넣지 않은 같은 기업 수강생을 함께 준다. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) return Response.json({ error: "교육과정을 확인하지 못했습니다." }, { status: 400 });

    const supabase = createSupabaseAdmin();
    const { data: session, error: sessionError } = await supabase
      .from("course_sessions").select("id,company_id").eq("id", id).single();
    if (sessionError || !session) throw sessionError || new Error("교육과정을 찾지 못했습니다.");

    const { data: enrolled, error: enrolledError } = await supabase
      .from("session_learners")
      .select("id,status,learner_id,learners(id,name,department,job_title,email)")
      .eq("course_session_id", id);
    if (enrolledError) throw enrolledError;

    const { data: pool, error: poolError } = await supabase
      .from("learners")
      .select("id,name,department,job_title,email")
      .eq("company_id", session.company_id)
      .order("name");
    if (poolError) throw poolError;

    const taken = new Set((enrolled || []).map((row) => row.learner_id as string));
    return Response.json({
      enrolled: (enrolled || []).sort((a, b) => {
        const left = (a.learners as { name?: string } | null)?.name || "";
        const right = (b.learners as { name?: string } | null)?.name || "";
        return left.localeCompare(right, "ko");
      }),
      available: (pool || []).filter((learner) => !taken.has(learner.id as string)),
    });
  } catch (error) {
    return Response.json({ error: detail(error) || "수강생을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) return Response.json({ error: "교육과정을 확인하지 못했습니다." }, { status: 400 });

    const body = await request.json() as { learnerIds?: unknown };
    const learnerIds = Array.isArray(body.learnerIds)
      ? body.learnerIds.filter((value): value is string => typeof value === "string" && UUID.test(value)).slice(0, 500)
      : [];
    if (!learnerIds.length) return Response.json({ error: "추가할 수강생을 선택해 주세요." }, { status: 400 });

    const supabase = createSupabaseAdmin();
    const { data: session, error: sessionError } = await supabase
      .from("course_sessions").select("id,company_id").eq("id", id).single();
    if (sessionError || !session) throw sessionError || new Error("교육과정을 찾지 못했습니다.");

    // 다른 기업 수강생이 섞여 들어가면 명단이 조용히 오염된다.
    const { data: valid, error: validError } = await supabase
      .from("learners").select("id").eq("company_id", session.company_id).in("id", learnerIds);
    if (validError) throw validError;
    const allowed = (valid || []).map((row) => row.id as string);
    if (!allowed.length) return Response.json({ error: "이 기업의 수강생이 아닙니다." }, { status: 400 });

    const { data, error } = await supabase
      .from("session_learners")
      .upsert(allowed.map((learnerId) => ({ course_session_id: id, learner_id: learnerId })),
        { onConflict: "course_session_id,learner_id", ignoreDuplicates: true })
      .select("id");
    if (error) throw error;
    return Response.json({ added: (data || []).length, skipped: learnerIds.length - allowed.length });
  } catch (error) {
    return Response.json({ error: detail(error) || "수강생을 추가하지 못했습니다." }, { status: 422 });
  }
}

/** 출결 변경과 명단에서 빼기. 사람 자체는 지우지 않는다 — 다른 과정 이력이 남아 있다. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) return Response.json({ error: "교육과정을 확인하지 못했습니다." }, { status: 400 });

    const body = await request.json() as { learnerId?: string; learnerIds?: unknown; status?: string; remove?: boolean };

    // 여럿을 한 번에 빼기. 서른 명짜리 명단에서 스무 명을 손으로 빼면 스무 번의 왕복이
    // 되고, 중간에 하나가 실패하면 어디까지 지워졌는지 알 수 없다.
    const supabase = createSupabaseAdmin();
    if (body.remove && Array.isArray(body.learnerIds)) {
      const learnerIds = body.learnerIds
        .filter((value): value is string => typeof value === "string" && UUID.test(value)).slice(0, 500);
      if (!learnerIds.length) return Response.json({ error: "뺄 수강생을 선택해 주세요." }, { status: 400 });
      const { data, error } = await supabase.from("session_learners").delete()
        .eq("course_session_id", id).in("learner_id", learnerIds).select("id");
      if (error) throw error;
      return Response.json({ removed: (data || []).length });
    }

    if (!UUID.test(body.learnerId || "")) return Response.json({ error: "수강생을 확인하지 못했습니다." }, { status: 400 });

    if (body.remove) {
      const { error } = await supabase.from("session_learners").delete()
        .eq("course_session_id", id).eq("learner_id", body.learnerId);
      if (error) throw error;
      return Response.json({ removed: true });
    }

    if (!STATUSES.has(body.status as LearnerStatus)) {
      return Response.json({ error: "알 수 없는 출결 상태입니다." }, { status: 400 });
    }
    const { data, error } = await supabase.from("session_learners")
      .update({ status: body.status, updated_at: new Date().toISOString() })
      .eq("course_session_id", id).eq("learner_id", body.learnerId)
      .select("id,status").single();
    if (error) throw error;
    return Response.json({ enrollment: data });
  } catch (error) {
    return Response.json({ error: detail(error) || "수강생 정보를 바꾸지 못했습니다." }, { status: 422 });
  }
}
