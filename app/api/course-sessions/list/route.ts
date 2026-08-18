import { requireTeamSession } from "@/lib/auth/guard";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const COLUMNS =
  "id,title,held_on,start_time,duration_hours,location,headcount,status,company_id,instructor_id,company_research(id,name),instructors(id,name)";

/**
 * 사업 전체의 교육 일정. 기업 화면은 한 회사 안만 보여 주는데, 사업 대시보드는 '이번 달에
 * 무엇이 돌아가는가'를 물으므로 회사를 가로질러 한 벌로 읽어야 한다.
 */
export async function GET() {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const supabase = createSupabaseAdmin();
    const { data: sessions, error } = await supabase
      .from("course_sessions")
      .select(COLUMNS)
      .order("held_on", { ascending: true, nullsFirst: false });
    if (error) throw error;

    const ids = (sessions || []).map((session) => session.id as string);
    const { data: enrollments } = ids.length
      ? await supabase.from("session_learners").select("course_session_id,status").in("course_session_id", ids)
      : { data: [] as Array<{ course_session_id: string; status: string }> };

    const learners = new Map<string, { total: number; attended: number }>();
    (enrollments || []).forEach((row) => {
      const key = row.course_session_id as string;
      const current = learners.get(key) || { total: 0, attended: 0 };
      if (row.status !== "cancelled") current.total += 1;
      if (row.status === "attended") current.attended += 1;
      learners.set(key, current);
    });

    // 조인 결과는 단일 관계라도 배열로 올 수 있다.
    const first = <T,>(value: T | T[] | null) => (Array.isArray(value) ? value[0] : value) || null;

    return Response.json({
      sessions: (sessions || []).map((session) => {
        const company = first(session.company_research as { id?: string; name?: string } | { id?: string; name?: string }[] | null);
        const instructor = first(session.instructors as { id?: string; name?: string } | { id?: string; name?: string }[] | null);
        return {
          id: session.id,
          title: session.title,
          heldOn: session.held_on,
          startTime: session.start_time,
          durationHours: session.duration_hours,
          location: session.location,
          headcount: session.headcount,
          status: session.status,
          companyId: company?.id || session.company_id,
          companyName: company?.name || "",
          instructorName: instructor?.name || "",
          learnerCount: learners.get(session.id as string)?.total || 0,
          attendedCount: learners.get(session.id as string)?.attended || 0,
        };
      }),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message
      : (error && typeof error === "object" && "message" in error) ? String((error as { message: unknown }).message) : "";
    return Response.json({ error: detail || "교육 일정을 불러오지 못했습니다." }, { status: 500 });
  }
}
