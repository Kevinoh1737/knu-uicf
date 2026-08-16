import { requireTeamSession } from "@/lib/auth/guard";
import { isStoredStage } from "@/lib/company-stage";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * 교육 완료·교육 취소는 사람이 판단한다. 예정 일시가 지났다고 자동으로 넘기지 않는다 —
 * 미룬 교육, 당일 취소, 다음 달로 밀린 일정이 전부 '완료'로 보이게 되기 때문이다.
 * 자동 전환 조건은 나중에 정해지면 이 라우트를 호출하는 쪽에 붙인다.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) return Response.json({ error: "기업 정보를 확인하지 못했습니다." }, { status: 400 });

    const body = await request.json() as { stage?: unknown };
    if (!isStoredStage(body.stage)) {
      return Response.json({ error: "바꿀 수 있는 상태가 아닙니다." }, { status: 400 });
    }

    const { data, error } = await createSupabaseAdmin()
      .from("company_research")
      .update({ stage: body.stage, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id,stage")
      .single();
    if (error) throw error;
    return Response.json({ company: data });
  } catch (error) {
    const detail = error instanceof Error ? error.message
      : (error && typeof error === "object" && "message" in error) ? String((error as { message: unknown }).message)
      : "";
    return Response.json({ error: detail || "상태를 바꾸지 못했습니다." }, { status: 422 });
  }
}
