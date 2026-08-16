import { requireTeamSession } from "@/lib/auth/guard";
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

    // 강사를 배정할 때 고르는 목록. 화면마다 따로 부르지 않도록 함께 내려보낸다.
    const { data: instructors } = await supabase
      .from("instructors")
      .select("id,name,affiliation,job_title")
      .eq("status", "active")
      .order("name");

    return Response.json({
      sessions: (sessions || []).map((session) => ({ ...session, contract: latest.get(session.id as string) || null })),
      instructors: instructors || [],
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "교육 진행 정보를 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}
