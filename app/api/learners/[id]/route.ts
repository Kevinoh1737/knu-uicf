import { requireTeamSession } from "@/lib/auth/guard";
import { sanitizeLearner } from "@/lib/learners";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COLUMNS = "id,company_id,name,department,job_title,email,notes,created_at";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) return Response.json({ error: "수강생을 확인하지 못했습니다." }, { status: 400 });

    const learner = sanitizeLearner(await request.json());
    if (!learner.name) return Response.json({ error: "이름은 반드시 필요합니다." }, { status: 400 });

    const { data, error } = await createSupabaseAdmin()
      .from("learners")
      .update({
        name: learner.name, department: learner.department, job_title: learner.jobTitle,
        email: learner.email, notes: learner.notes, updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select(COLUMNS)
      .single();
    if (error) throw error;
    return Response.json({ learner: data });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "수강생을 저장하지 못했습니다." },
      { status: 422 },
    );
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) return Response.json({ error: "수강생을 확인하지 못했습니다." }, { status: 400 });

    // 수강 연결은 cascade 로 함께 사라진다. 참석 이력까지 지우는 것이므로
    // 화면에서 확인을 받은 뒤에만 부른다.
    const { error } = await createSupabaseAdmin().from("learners").delete().eq("id", id);
    if (error) throw error;
    return Response.json({ deleted: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "수강생을 삭제하지 못했습니다." },
      { status: 422 },
    );
  }
}
