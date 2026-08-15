import { requireTeamSession } from "@/lib/auth/guard";
import { INSTRUCTOR_DOCUMENTS_BUCKET } from "@/lib/instructors";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
