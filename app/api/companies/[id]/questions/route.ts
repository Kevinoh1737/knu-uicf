import { requireTeamSession } from "@/lib/auth/guard";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    const { questions } = await request.json() as { questions?: unknown };
    if (!Array.isArray(questions) || questions.some(item => typeof item !== "string" || !item.trim())) {
      return Response.json({ error: "비어 있지 않은 질문 목록이 필요합니다." }, { status: 400 });
    }
    const { data, error } = await createSupabaseAdmin().from("company_research")
      .update({ questions, updated_at: new Date().toISOString() })
      .eq("id", id).select("id,questions,updated_at").single();
    if (error) throw error;
    return Response.json({ company: data });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "질문지를 저장하지 못했습니다." }, { status: 500 });
  }
}
