import { requireTeamSession } from "@/lib/auth/guard";
import { CONSULTATION_AUDIO_BUCKET } from "@/lib/consultations";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; consultationId: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { id, consultationId } = await context.params;
    if (!UUID.test(id) || !UUID.test(consultationId)) {
      return Response.json({ error: "상담 기록을 확인하지 못했습니다." }, { status: 400 });
    }

    const supabase = createSupabaseAdmin();
    // Scoped by company as well as id, so a record id alone cannot reach another company's data.
    const { data, error } = await supabase
      .from("company_consultations")
      .delete()
      .eq("id", consultationId)
      .eq("company_id", id)
      .select("id,storage_path");
    if (error) throw error;
    if (!data?.length) return Response.json({ error: "삭제할 상담 기록을 찾지 못했습니다." }, { status: 404 });

    // The row is the record of truth; a stranded audio file is worth less than a failed delete.
    const { error: storageError } = await supabase.storage.from(CONSULTATION_AUDIO_BUCKET).remove([data[0].storage_path]);
    if (storageError) console.error(`[consultations] 녹취파일 삭제 실패 ${data[0].storage_path}: ${storageError.message}`);

    return Response.json({ deletedId: consultationId });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "상담 기록을 삭제하지 못했습니다." }, { status: 500 });
  }
}
