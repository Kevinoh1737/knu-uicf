import { requireTeamSession } from "@/lib/auth/guard";
import { DEFAULT_CONTRACT_TERMS, sanitizeTerms } from "@/lib/instructors";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** KNU-2026-0001 형태. 앱에서 번호를 세면 동시 생성 시 겹치므로 시퀀스에서 받는다. */
async function nextContractNo(supabase: ReturnType<typeof createSupabaseAdmin>) {
  const { data, error } = await supabase.rpc("next_contract_no");
  if (error || !data) throw error || new Error("계약번호를 만들지 못했습니다.");
  return String(data);
}

export async function POST(request: Request) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const body = await request.json() as { courseSessionId?: string; terms?: unknown };
    if (!UUID.test(body.courseSessionId || "")) {
      return Response.json({ error: "강의를 확인하지 못했습니다." }, { status: 400 });
    }

    const supabase = createSupabaseAdmin();
    const { data: session, error: sessionError } = await supabase
      .from("course_sessions")
      .select("id,instructor_id")
      .eq("id", body.courseSessionId)
      .single();
    if (sessionError || !session) throw sessionError || new Error("강의를 찾지 못했습니다.");

    // 한 강의에 살아 있는 계약은 하나다. 철회·반려된 것만 남아 있으면 새로 만들 수 있다.
    const { data: existing } = await supabase
      .from("contracts")
      .select("id,status")
      .eq("course_session_id", body.courseSessionId)
      .not("status", "in", "(withdrawn,rejected,expired)")
      .maybeSingle();
    if (existing) {
      return Response.json({ error: "이 강의에는 이미 계약서가 있습니다." }, { status: 409 });
    }

    const terms = body.terms === undefined ? DEFAULT_CONTRACT_TERMS : sanitizeTerms(body.terms);
    const contractNo = await nextContractNo(supabase);

    const { data, error } = await supabase
      .from("contracts")
      .insert({
        course_session_id: body.courseSessionId,
        instructor_id: session.instructor_id,
        contract_no: contractNo,
        status: "draft",
        terms,
      })
      .select("id,course_session_id,contract_no,status,terms,sent_to,sent_at,viewed_at,signed_at,created_at")
      .single();
    if (error) throw error;

    await supabase.from("contract_events").insert({
      contract_id: data.id, from_status: "", to_status: "draft", actor: "교육사업팀", detail: "계약서 생성",
    });

    return Response.json({ contract: data });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "계약서를 만들지 못했습니다." },
      { status: 422 },
    );
  }
}
