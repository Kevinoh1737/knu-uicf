import { requireTeamSession } from "@/lib/auth/guard";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return Response.json({ error: "올바르지 않은 기업 ID입니다." }, { status: 400 });

    const { data, error } = await createSupabaseAdmin()
      .from("company_research")
      .delete()
      .eq("id", id)
      .select("id");

    if (error) throw error;
    if (!data?.length) return Response.json({ error: "삭제할 기업을 찾지 못했습니다." }, { status: 404 });
    return Response.json({ deletedId: id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "기업을 삭제하지 못했습니다." }, { status: 500 });
  }
}
