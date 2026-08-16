import { requireTeamSession } from "@/lib/auth/guard";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * 교육과정에 강사를 배정하거나 배정을 해제한다. 생성과 분리한 이유는 실제 순서가
 * 과정 생성 → 강사 배정이기 때문이다.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) return Response.json({ error: "교육과정을 확인하지 못했습니다." }, { status: 400 });

    const body = await request.json() as { instructorId?: string | null };
    const instructorId = body.instructorId ?? null;
    if (instructorId !== null && !UUID.test(instructorId)) {
      return Response.json({ error: "강사를 확인하지 못했습니다." }, { status: 400 });
    }

    const supabase = createSupabaseAdmin();

    // 계약이 나간 뒤에 강사를 바꾸면 계약서에 적힌 사람과 실제 강사가 어긋난다.
    const { data: contracts, error: contractsError } = await supabase
      .from("contracts")
      .select("id,status")
      .eq("course_session_id", id)
      .not("status", "in", "(withdrawn,rejected,expired)");
    if (contractsError) throw contractsError;

    const live = (contracts || []).filter((contract) => contract.status !== "draft");
    if (live.length > 0) {
      return Response.json(
        { error: "계약이 진행 중이라 강사를 바꿀 수 없습니다. 계약을 철회한 뒤 배정해 주세요." },
        { status: 409 },
      );
    }

    // 작성 중인 계약서는 아직 밖으로 나가지 않았으므로 막지 않는다. 다만 계약서는 강사와
    // 맺는 것이라 상대가 없어질 수는 없고, 강사가 바뀌면 초안도 같이 따라가야 한다.
    const drafts = contracts || [];
    if (drafts.length > 0 && instructorId === null) {
      return Response.json(
        { error: "작성 중인 계약서가 있어 배정을 해제할 수 없습니다. 계약서를 철회한 뒤 해제해 주세요." },
        { status: 409 },
      );
    }
    if (drafts.length > 0 && instructorId) {
      const { error: syncError } = await supabase
        .from("contracts")
        .update({ instructor_id: instructorId, updated_at: new Date().toISOString() })
        .in("id", drafts.map((contract) => contract.id));
      if (syncError) throw syncError;
    }

    const { data, error } = await supabase
      .from("course_sessions")
      .update({ instructor_id: instructorId, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id,instructor_id,instructors(id,name,affiliation,job_title,email)")
      .single();
    if (error) throw error;
    return Response.json({ session: data });
  } catch (error) {
    const detail = error instanceof Error ? error.message
      : (error && typeof error === "object" && "message" in error) ? String((error as { message: unknown }).message)
      : "";
    return Response.json({ error: detail || "강사를 배정하지 못했습니다." }, { status: 422 });
  }
}
