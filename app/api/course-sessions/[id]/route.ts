import { requireTeamSession } from "@/lib/auth/guard";
import { sanitizeStartTime } from "@/lib/course-time";
import { INSTRUCTOR_DOCUMENTS_BUCKET } from "@/lib/instructors";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(["planned", "contracted", "delivered", "cancelled"]);
const COLUMNS =
  "id,title,held_on,start_time,location,headcount,duration_hours,status,outline,materials,company_id,instructor_id,instructors(id,name,affiliation,job_title,email)";

/**
 * 교육과정 수정. 날짜가 밀리고 장소가 바뀌는 것은 흔한 일이라, 지우고 다시 만들게 하면
 * 붙어 있던 수강생 배정과 설문지·응답까지 함께 사라진다.
 *
 * 다만 서명이 끝난 계약이 걸린 과정은 막는다 — 계약서는 이 행을 읽어 그 자리에서 만들어지는
 * 문서라, 여기서 일시를 고치면 이미 서명된 문서의 내용이 조용히 바뀐다.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) return Response.json({ error: "교육과정을 확인하지 못했습니다." }, { status: 400 });

    const body = await request.json() as {
      title?: string; heldOn?: string | null; startTime?: string | null;
      location?: string; headcount?: number | string | null; durationHours?: number | string; status?: string;
    };

    const supabase = createSupabaseAdmin();
    const { data: contracts, error: contractsError } = await supabase
      .from("contracts").select("contract_no,status").eq("course_session_id", id).eq("status", "signed");
    if (contractsError) throw contractsError;
    if (contracts?.length) {
      return Response.json(
        { error: `서명이 끝난 계약(${contracts[0].contract_no})이 있어 수정할 수 없습니다. 계약 내용과 어긋나게 됩니다.` },
        { status: 409 },
      );
    }

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.title !== undefined) {
      const title = String(body.title).trim().slice(0, 200);
      if (!title) return Response.json({ error: "과정명을 입력해 주세요." }, { status: 400 });
      update.title = title;
    }
    // 빈 문자열은 '지웠다'는 뜻이라 null 로 넣는다. 날짜 미정으로 되돌릴 수 있어야 한다.
    if (body.heldOn !== undefined) {
      update.held_on = /^\d{4}-\d{2}-\d{2}$/.test(String(body.heldOn || "")) ? body.heldOn : null;
    }
    if (body.startTime !== undefined) update.start_time = sanitizeStartTime(body.startTime) || null;
    if (body.location !== undefined) update.location = String(body.location).trim().slice(0, 200);
    if (body.headcount !== undefined) {
      const headcount = Number(body.headcount);
      update.headcount = Number.isFinite(headcount) && headcount > 0 ? Math.min(10_000, Math.round(headcount)) : null;
    }
    if (body.durationHours !== undefined) {
      update.duration_hours = Math.max(0.5, Math.min(99, Number(body.durationHours) || 4));
    }
    if (body.status !== undefined && STATUSES.has(String(body.status))) update.status = body.status;

    const { data, error } = await supabase
      .from("course_sessions").update(update).eq("id", id).select(COLUMNS).single();
    if (error) throw error;
    return Response.json({ session: data });
  } catch (error) {
    const detail = error instanceof Error ? error.message
      : (error && typeof error === "object" && "message" in error) ? String((error as { message: unknown }).message) : "";
    return Response.json({ error: detail || "교육과정을 수정하지 못했습니다." }, { status: 422 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) return Response.json({ error: "강의를 확인하지 못했습니다." }, { status: 400 });

    const supabase = createSupabaseAdmin();

    // 서명까지 끝난 계약이 걸려 있으면 지우지 않는다. 계약 이력은 감사 대상이고,
    // 잘못 입력한 강의를 지우는 것과 체결된 계약을 없애는 것은 다른 일이다.
    const { data: contracts, error: contractsError } = await supabase
      .from("contracts").select("id,status").eq("course_session_id", id);
    if (contractsError) throw contractsError;
    const signed = (contracts || []).find((contract) => contract.status === "signed");
    if (signed) {
      return Response.json({ error: "서명이 끝난 계약이 있어 삭제할 수 없습니다." }, { status: 409 });
    }

    const { data: documents } = await supabase
      .from("instructor_documents").select("storage_path").eq("course_session_id", id);

    // contracts·instructor_documents 는 on delete cascade 로 함께 사라진다.
    const { error } = await supabase.from("course_sessions").delete().eq("id", id);
    if (error) throw error;

    const paths = (documents || []).map((document) => document.storage_path as string).filter(Boolean);
    if (paths.length) {
      // 행은 이미 사라졌다. 저장소 정리 실패로 삭제를 되돌리지는 않는다.
      await supabase.storage.from(INSTRUCTOR_DOCUMENTS_BUCKET).remove(paths).catch(() => undefined);
    }
    return Response.json({ deleted: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "강의를 삭제하지 못했습니다." },
      { status: 422 },
    );
  }
}
