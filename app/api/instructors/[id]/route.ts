import { requireTeamSession } from "@/lib/auth/guard";
import { recordFromProfile, sanitizeProfile } from "@/lib/instructors";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COLUMNS =
  "id,name,affiliation,job_title,email,phone,expertise,career,education,teaching_history,certifications,preferred_style,notes,reuse_aggregate,reuse_share_original,status,created_at,updated_at";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) return Response.json({ error: "강사 정보를 확인하지 못했습니다." }, { status: 400 });

    const supabase = createSupabaseAdmin();
    const { data: instructor, error } = await supabase.from("instructors").select(COLUMNS).eq("id", id).single();
    if (error || !instructor) throw error || new Error("강사를 찾지 못했습니다.");

    // 강의 이력은 회사 이름과 함께여야 의미가 있다. 강사 페이지의 "어떤 회사에 어떤 수업을 언제".
    const { data: sessions, error: sessionsError } = await supabase
      .from("course_sessions")
      .select("id,title,held_on,start_time,location,headcount,duration_hours,status,outline,materials,company_id,company_research(id,name)")
      .eq("instructor_id", id)
      .order("held_on", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (sessionsError) throw sessionsError;

    const { data: contracts, error: contractsError } = await supabase
      .from("contracts")
      .select("id,course_session_id,contract_no,status,terms,pdf_path,sent_to,sent_at,viewed_at,signed_at,closed_reason,created_at,updated_at")
      .eq("instructor_id", id)
      .order("created_at", { ascending: false });
    if (contractsError) throw contractsError;

    const { data: documents, error: documentsError } = await supabase
      .from("instructor_documents")
      .select("id,course_session_id,kind,file_name,mime_type,file_size,parse_status,parse_error,created_at")
      .eq("instructor_id", id)
      .order("created_at", { ascending: false });
    if (documentsError) throw documentsError;

    return Response.json({
      instructor,
      sessions: sessions || [],
      contracts: contracts || [],
      documents: documents || [],
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "강사 정보를 불러오지 못했습니다." },
      { status: 404 },
    );
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) return Response.json({ error: "강사 정보를 확인하지 못했습니다." }, { status: 400 });

    const body = await request.json() as { profile?: unknown; status?: unknown };
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.profile !== undefined) {
      const profile = sanitizeProfile(body.profile);
      if (!profile.name) return Response.json({ error: "강사 이름은 반드시 필요합니다." }, { status: 400 });
      Object.assign(patch, recordFromProfile(profile));
    }
    if (body.status === "active" || body.status === "inactive") patch.status = body.status;

    const { data, error } = await createSupabaseAdmin()
      .from("instructors")
      .update(patch)
      .eq("id", id)
      .select(COLUMNS)
      .single();
    if (error) throw error;
    return Response.json({ instructor: data });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "강사 정보를 저장하지 못했습니다." },
      { status: 422 },
    );
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) return Response.json({ error: "강사 정보를 확인하지 못했습니다." }, { status: 400 });

    const supabase = createSupabaseAdmin();
    // 강의 이력이 있으면 DB 가 on delete restrict 로 막지만, 그 전에 이유를 설명한다.
    // 자산이 강사에 매달려 있어 지우면 자산도 사라진다 — 비활성 처리가 옳은 답이다.
    const { count, error: countError } = await supabase
      .from("course_sessions")
      .select("id", { count: "exact", head: true })
      .eq("instructor_id", id);
    if (countError) throw countError;
    if (count && count > 0) {
      return Response.json(
        { error: `강의 이력 ${count}건이 있어 삭제할 수 없습니다. 비활성으로 바꿔 주세요.` },
        { status: 409 },
      );
    }

    const { data: documents } = await supabase
      .from("instructor_documents")
      .select("storage_path")
      .eq("instructor_id", id);

    const { error } = await supabase.from("instructors").delete().eq("id", id);
    if (error) throw error;

    const paths = (documents || []).map((document) => document.storage_path as string).filter(Boolean);
    if (paths.length) {
      // 행은 이미 지워졌다. 저장소 정리는 실패해도 되돌리지 않는다.
      await supabase.storage.from("instructor-documents").remove(paths).catch(() => undefined);
    }
    return Response.json({ deleted: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "강사를 삭제하지 못했습니다." },
      { status: 422 },
    );
  }
}
