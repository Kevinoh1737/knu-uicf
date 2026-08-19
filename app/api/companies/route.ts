import { requireTeamSession } from "@/lib/auth/guard";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET() {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase
      .from("company_research")
      // crawl 은 화면이 읽지 않는다 — 홈페이지에서 긁어 온 원본이라 회사가 늘수록 목록
      // 응답만 무거워진다(조사할 때 쓰고 그 뒤로는 보지 않는 칸이다).
      .select("id,name,website_url,industry,stage,contact,research,intelligence,questions,created_at,updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw error;

    // 교육과정 생성과 강사 배정은 다른 단계라 따로 센다 — lib/company-stage.ts 참고.
    // 상담·수강생 수와 다음 교육일까지 함께 읽는 이유는 카드가 '어디를 먼저 열어야 하나'에
    // 답해야 하기 때문이다. 회사마다 상세를 열어 보게 하면 그 답이 목록에 없는 셈이 된다.
    const [sessionsResult, learnersResult, consultationsResult] = await Promise.all([
      supabase.from("course_sessions").select("company_id,status,instructor_id,held_on,instructors(name)"),
      supabase.from("learners").select("company_id"),
      supabase.from("company_consultations").select("company_id"),
    ]);
    if (sessionsResult.error) throw sessionsResult.error;
    if (learnersResult.error) throw learnersResult.error;
    if (consultationsResult.error) throw consultationsResult.error;

    const today = new Date().toISOString().slice(0, 10);
    type Next = { heldOn: string; instructorName: string };
    const counts = new Map<string, { total: number; assigned: number; past: number; delivered: number; cancelled: number; next: Next | null }>();
    (sessionsResult.data || []).forEach((session) => {
      const key = session.company_id as string;
      const current = counts.get(key) || { total: 0, assigned: 0, past: 0, delivered: 0, cancelled: 0, next: null };
      // 취소된 과정도 회사 단계 계산에는 필요하다 — 전부 취소면 회사도 취소다.
      if (session.status === "cancelled") { current.cancelled += 1; counts.set(key, current); return; }
      if (session.status === "delivered") current.delivered += 1;
      current.total += 1;
      if (session.instructor_id) current.assigned += 1;

      // 다가오는 교육 중 가장 이른 것 하나. 지난 교육은 '다음'이 아니라 이력이다.
      const heldOn = typeof session.held_on === "string" ? session.held_on.slice(0, 10) : "";
      if (heldOn && heldOn < today && session.status !== "delivered") current.past += 1;
      if (heldOn && heldOn >= today && (!current.next || heldOn < current.next.heldOn)) {
        // 조인 결과는 단일 관계라도 배열로 올 수 있다.
        const joined = session.instructors as { name?: string } | { name?: string }[] | null;
        const instructor = Array.isArray(joined) ? joined[0] : joined;
        current.next = { heldOn, instructorName: String(instructor?.name || "") };
      }
      counts.set(key, current);
    });

    const tally = (rows: Array<{ company_id: unknown }> | null) => {
      const map = new Map<string, number>();
      (rows || []).forEach((row) => {
        const key = String(row.company_id);
        map.set(key, (map.get(key) || 0) + 1);
      });
      return map;
    };
    const learnerCounts = tally(learnersResult.data);
    const consultationCounts = tally(consultationsResult.data);

    return Response.json({
      companies: (data || []).map((company) => {
        const id = company.id as string;
        const count = counts.get(id) || { total: 0, assigned: 0, past: 0, delivered: 0, cancelled: 0, next: null };
        return {
          ...company,
          sessionCount: count.total,
          assignedCount: count.assigned,
          pastSessionCount: count.past,
          deliveredCount: count.delivered,
          cancelledCount: count.cancelled,
          nextSession: count.next,
          learnerCount: learnerCounts.get(id) || 0,
          consultationCount: consultationCounts.get(id) || 0,
        };
      }),
    });
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
