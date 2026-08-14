import { requireTeamSession } from "@/lib/auth/guard";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET() {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { data, error } = await createSupabaseAdmin()
      .from("company_research")
      .select("id,name,website_url,industry,stage,research,intelligence,crawl,questions,created_at,updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return Response.json({ companies: data });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "기업 목록을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const body = await request.json() as { name?: string; websiteUrl?: string; industry?: string; research?: unknown; intelligence?: unknown; crawl?: unknown; questions?: string[] };
    if (!body.name || !body.websiteUrl) return Response.json({ error: "기업명과 홈페이지 주소가 필요합니다." }, { status: 400 });
    const { data, error } = await createSupabaseAdmin().from("company_research").upsert({
      name: body.name,
      website_url: body.websiteUrl,
      industry: body.industry || "",
      research: body.research || {},
      intelligence: body.intelligence || {},
      crawl: body.crawl || {},
      questions: body.questions || [],
      updated_at: new Date().toISOString(),
    }, { onConflict: "website_url" }).select().single();
    if (error) throw error;
    return Response.json({ company: data }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "기업 조사 결과를 저장하지 못했습니다." }, { status: 500 });
  }
}
