import { requireTeamSession } from "@/lib/auth/guard";
import { ContractStatus, sanitizeTerms } from "@/lib/instructors";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COLUMNS = "id,course_session_id,contract_no,status,terms,sent_to,sent_at,viewed_at,signed_at,closed_reason,created_at,updated_at";

/**
 * 어떤 상태에서 어디로 갈 수 있는지를 한 곳에 둔다. 계약은 상태 기계이고, 임의 전이를 허용하면
 * 감사 로그가 설명할 수 없는 이력이 남는다. 발송(sent)은 이메일 배선이 붙기 전까지 막혀 있다.
 */
const ALLOWED: Record<ContractStatus, ContractStatus[]> = {
  draft: ["ready", "withdrawn"],
  ready: ["draft", "sent", "withdrawn"],
  sent: ["viewed", "signed", "rejected", "expired", "withdrawn"],
  viewed: ["signed", "rejected", "expired", "withdrawn"],
  signed: [],
  rejected: [],
  expired: [],
  withdrawn: [],
};

const STAMP: Partial<Record<ContractStatus, string>> = { sent: "sent_at", viewed: "viewed_at", signed: "signed_at" };

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) return Response.json({ error: "계약서를 확인하지 못했습니다." }, { status: 400 });

    const body = await request.json() as { status?: string; terms?: unknown; reason?: string };
    const supabase = createSupabaseAdmin();
    const { data: current, error: currentError } = await supabase
      .from("contracts").select("id,status").eq("id", id).single();
    if (currentError || !current) throw currentError || new Error("계약서를 찾지 못했습니다.");

    const from = current.status as ContractStatus;
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.terms !== undefined) {
      if (from !== "draft" && from !== "ready") {
        return Response.json({ error: "발송한 계약서는 조건을 바꿀 수 없습니다." }, { status: 409 });
      }
      patch.terms = sanitizeTerms(body.terms);
    }

    let to: ContractStatus | null = null;
    if (body.status) {
      to = body.status as ContractStatus;
      if (!ALLOWED[from] || !ALLOWED[from].includes(to)) {
        return Response.json({ error: `${from} 상태에서는 ${to} 로 바꿀 수 없습니다.` }, { status: 409 });
      }
      // 발송은 되돌릴 수 없는 외부 행동이다. 메일 배선이 붙기 전에는 상태만 바꿀 수 없게 막는다.
      if (to === "sent") {
        return Response.json(
          { error: "발송은 아직 준비되지 않았습니다. 발신 도메인 설정이 필요합니다." },
          { status: 501 },
        );
      }
      patch.status = to;
      const stamp = STAMP[to];
      if (stamp) patch[stamp] = new Date().toISOString();
      if (body.reason) patch.closed_reason = String(body.reason).slice(0, 300);
    }

    const { data, error } = await supabase.from("contracts").update(patch).eq("id", id).select(COLUMNS).single();
    if (error) throw error;

    if (to) {
      await supabase.from("contract_events").insert({
        contract_id: id, from_status: from, to_status: to, actor: "교육사업팀",
        detail: body.reason ? String(body.reason).slice(0, 300) : "",
      });
    }
    return Response.json({ contract: data });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "계약서를 수정하지 못했습니다." },
      { status: 422 },
    );
  }
}
