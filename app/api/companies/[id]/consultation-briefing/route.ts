import { requireTeamSession } from "@/lib/auth/guard";
import { generateWithGemini } from "@/lib/ai/gemini";
import { ConsultationBriefing, ConsultationTranscript } from "@/lib/consultations";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
/** One deep pass over every transcript for a company; long, but far shorter than transcription. */
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BRIEFING_CALL_MS = 180_000;
const BRIEFING_BUDGET_MS = 260_000;
const BRIEFING_RETRY_WAIT_MS = 60_000;
/** Keeps a company with many long sessions from overflowing one prompt. Oldest text is trimmed first. */
const TRANSCRIPT_CHAR_BUDGET = 400_000;

const briefingSchema = {
  type: "OBJECT",
  properties: {
    overview: { type: "STRING" },
    sessions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { label: { type: "STRING" }, gist: { type: "STRING" } },
        required: ["label", "gist"],
      },
    },
    keyNeeds: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { title: { type: "STRING" }, detail: { type: "STRING" } },
        required: ["title", "detail"],
      },
    },
    audience: {
      type: "OBJECT",
      properties: { headline: { type: "STRING" }, detail: { type: "STRING" } },
      required: ["headline", "detail"],
    },
    constraints: { type: "ARRAY", items: { type: "STRING" } },
    decisions: { type: "ARRAY", items: { type: "STRING" } },
    changes: { type: "ARRAY", items: { type: "STRING" } },
    openQuestions: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["overview", "sessions", "keyNeeds", "audience", "constraints", "decisions", "changes", "openQuestions"],
};

function strings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim())
    : [];
}

function transcriptText(transcript: ConsultationTranscript | null) {
  return (transcript?.segments || [])
    .map((segment) => `[${segment.timestamp}] ${segment.speaker}: ${segment.text}`)
    .join("\n");
}

function sessionDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "long", timeZone: "Asia/Seoul" }).format(new Date(value));
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) return Response.json({ error: "기업 정보를 확인하지 못했습니다." }, { status: 400 });

    const supabase = createSupabaseAdmin();
    const { data: company, error: companyError } = await supabase
      .from("company_research")
      .select("id,name,industry")
      .eq("id", id)
      .single();
    if (companyError || !company) throw companyError || new Error("기업 정보를 찾지 못했습니다.");

    const { data: rows, error: rowsError } = await supabase
      .from("company_consultations")
      .select("id,file_name,transcript,created_at")
      .eq("company_id", id)
      .eq("status", "completed")
      .order("created_at", { ascending: true });
    if (rowsError) throw rowsError;

    const sessions = (rows || [])
      .map((row) => ({ id: row.id as string, fileName: row.file_name as string, createdAt: row.created_at as string, text: transcriptText(row.transcript as ConsultationTranscript) }))
      .filter((session) => session.text.length > 0);

    // A single session already has its own summary; a briefing only earns its cost from two or more.
    // Clearing on the way down matters as much as building on the way up: a briefing left behind after
    // a deletion would keep describing consultations that no longer exist.
    if (sessions.length < 2) {
      const { error: clearError } = await supabase
        .from("company_research")
        .update({ consultation_briefing: {}, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (clearError) console.error(`[briefing] 초기화 실패: ${clearError.message}`);
      return Response.json({ briefing: null, reason: "상담 기록이 2건 이상일 때 통합 브리핑을 만듭니다." });
    }

    // Trim the oldest sessions first so the most recent picture always survives the budget.
    let used = 0;
    const included = [...sessions].reverse().filter((session) => {
      if (used + session.text.length > TRANSCRIPT_CHAR_BUDGET) return false;
      used += session.text.length;
      return true;
    }).reverse();
    const trimmed = sessions.length - included.length;

    const body = included
      .map((session, index) => `\n===== ${index + 1}차 상담 (${sessionDate(session.createdAt)} · ${session.fileName}) =====\n${session.text}`)
      .join("\n");

    const prompt = `당신은 강원대학교 산학협력단 교육사업팀의 교육기획 담당자입니다. 아래는 ${company.name}과(와) 진행한 상담 ${included.length}건의 전문이며, 오래된 순서대로 정렬되어 있습니다. 담당자가 이 회사의 4시간 AI·AX 교육을 설계할 수 있도록 여러 상담을 하나로 합쳐 정리하세요.

핵심 원칙:
1. 상담 사이에 내용이 달라졌다면 나중 상담을 우선하고, 무엇이 어떻게 바뀌었는지 changes에 반드시 남기세요. 참석 인원, 일정, 대상 부서, 교육 목표처럼 교육 설계를 바꾸는 변경이 특히 중요합니다.
2. 서로 어긋나는데 어느 쪽이 맞는지 판단할 수 없으면, 임의로 고르지 말고 changes와 openQuestions에 함께 남기세요.
3. 여러 상담에서 반복된 요구는 하나로 합치고, 중복해서 나열하지 마세요.
4. sessions에는 상담별로 한 줄씩, 그 회차에서 새로 확인된 것만 적으세요. label은 '1차 상담 (날짜)' 형식으로 쓰세요.
5. keyNeeds는 교육 주제를 결정할 수 있을 만큼 구체적으로, 중요한 순서대로 작성하세요.
6. decisions에는 확정된 것만, openQuestions에는 아직 확인하지 못해 다음 상담에서 물어야 할 것만 넣으세요.
7. 오직 아래 상담 전문에 나온 사실만 사용하세요. 기업 조사 자료나 일반적인 추측을 상담에서 말한 것처럼 섞지 마세요. 확인되지 않은 항목은 '확인되지 않음'으로 두세요.
8. 짧고 쉬운 한국어로 쓰세요. 담당자가 그대로 읽고 판단할 수 있어야 합니다.

기업 업종 참고: ${company.industry || "확인되지 않음"}
${trimmed > 0 ? `\n주의: 분량 때문에 가장 오래된 상담 ${trimmed}건은 제외했습니다.\n` : ""}
상담 전문:${body}`;

    const generated = await generateWithGemini({
      role: "consultationAnalysis",
      prompt,
      responseSchema: briefingSchema,
      temperature: 0.1,
      maxOutputTokens: 16_384,
      timeoutMs: BRIEFING_CALL_MS,
      budgetMs: BRIEFING_BUDGET_MS,
      maxRetryWaitMs: BRIEFING_RETRY_WAIT_MS,
    });
    const parsed = JSON.parse(generated.text) as Partial<ConsultationBriefing>;

    const briefing: ConsultationBriefing = {
      overview: String(parsed.overview || "").trim(),
      sessions: Array.isArray(parsed.sessions)
        ? parsed.sessions.filter((item) => item && typeof item.label === "string").map((item) => ({ label: item.label.trim(), gist: String(item.gist || "").trim() }))
        : [],
      keyNeeds: Array.isArray(parsed.keyNeeds)
        ? parsed.keyNeeds.filter((item) => item && typeof item.title === "string").map((item) => ({ title: item.title.trim(), detail: String(item.detail || "").trim() }))
        : [],
      audience: {
        headline: String(parsed.audience?.headline || "확인 필요").trim(),
        detail: String(parsed.audience?.detail || "상담 내용에서 확인되지 않음").trim(),
      },
      constraints: strings(parsed.constraints),
      decisions: strings(parsed.decisions),
      changes: strings(parsed.changes),
      openQuestions: strings(parsed.openQuestions),
      // Covers every completed session, including any trimmed from the prompt, so staleness is judged
      // against what exists rather than what happened to fit.
      sourceIds: sessions.map((session) => session.id),
      generatedAt: new Date().toISOString(),
    };

    const { error: saveError } = await supabase
      .from("company_research")
      .update({ consultation_briefing: briefing, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (saveError) {
      // The column arrives with a migration; until then the briefing is still worth returning.
      console.error(`[briefing] 저장 실패: ${saveError.message}`);
      return Response.json({ briefing, saved: false, error: "통합 브리핑을 저장하지 못했습니다. 데이터베이스 업데이트가 필요합니다." });
    }

    return Response.json({ briefing, saved: true, trimmed });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "통합 브리핑을 만들지 못했습니다." }, { status: 422 });
  }
}
