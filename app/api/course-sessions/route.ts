import { requireTeamSession } from "@/lib/auth/guard";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(["planned", "contracted", "delivered", "cancelled"]);

export async function POST(request: Request) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const body = await request.json() as {
      companyId?: string; instructorId?: string; title?: string; heldOn?: string;
      location?: string; headcount?: number; durationHours?: number; status?: string;
    };
    if (!UUID.test(body.companyId || "")) {
      return Response.json({ error: "기업을 확인하지 못했습니다." }, { status: 400 });
    }
    // 강사는 생성 시점에 없어도 된다. 교육과정을 먼저 만들고 나중에 배정하는 것이 실제 순서다.
    if (body.instructorId && !UUID.test(body.instructorId)) {
      return Response.json({ error: "강사를 확인하지 못했습니다." }, { status: 400 });
    }
    const title = (body.title || "").trim().slice(0, 200);
    if (!title) return Response.json({ error: "과정명을 입력해 주세요." }, { status: 400 });

    // held_on 은 date 컬럼이라 형식이 어긋나면 INSERT 가 통째로 깨진다. 빈 값은 null 로 넘긴다.
    const heldOn = /^\d{4}-\d{2}-\d{2}$/.test(body.heldOn || "") ? body.heldOn : null;

    const { data, error } = await createSupabaseAdmin()
      .from("course_sessions")
      .insert({
        company_id: body.companyId,
        instructor_id: body.instructorId || null,
        title,
        held_on: heldOn,
        location: (body.location || "").trim().slice(0, 200),
        headcount: Number.isFinite(Number(body.headcount)) && Number(body.headcount) > 0
          ? Math.min(10_000, Math.round(Number(body.headcount))) : null,
        duration_hours: Math.max(0.5, Math.min(99, Number(body.durationHours) || 4)),
        status: STATUSES.has(body.status || "") ? body.status : "planned",
      })
      .select("id,title,held_on,location,headcount,duration_hours,status,outline,materials,company_id,instructor_id,instructors(id,name,affiliation,job_title),company_research(id,name)")
      .single();
    if (error) throw error;
    return Response.json({ session: data });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "강의를 등록하지 못했습니다." },
      { status: 422 },
    );
  }
}
