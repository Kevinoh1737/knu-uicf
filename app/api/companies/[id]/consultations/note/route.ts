/**
 * 녹취 없이 남기는 상담 기록.
 *
 * 두 가지를 받는다 — 화면에서 직접 입력한 글(`source: "text"`)과, 적어 둔 메모 파일에서
 * 읽어 낸 글(`source: "memo"`). 둘 다 마지막에는 같은 분석을 지난다(lib/ai/consultation-analysis).
 *
 * 녹취 라우트와 갈라 둔 이유는 시간이다. 전사는 90분짜리를 상대해야 해서 800초를 잡지만
 * 여기는 길어야 메모 몇 장을 읽는 정도라, 같은 자리에 두면 실패했을 때 사용자가 800초를
 * 기다리게 된다.
 */
import { requireTeamSession } from "@/lib/auth/guard";
import { analyzeConsultation } from "@/lib/ai/consultation-analysis";
import { generateWithGemini } from "@/lib/ai/gemini";
import {
  CONSULTATION_COLUMNS,
  CONSULTATION_NOTES_BUCKET,
  MAX_CONSULTATION_NOTE_LENGTH,
  MAX_CONSULTATION_NOTE_SIZE,
  MIN_CONSULTATION_NOTE_LENGTH,
  resolveConsultationNote,
} from "@/lib/consultations";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

const ROUTE_BUDGET_MS = 280_000;
const READ_CALL_MS = 90_000;
const ANALYSIS_CALL_MS = 90_000;
const ANALYSIS_RESERVE_MS = 100_000;
const RETRY_WAIT_MS = 45_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const noteSchema = {
  type: "OBJECT",
  properties: {
    text: { type: "STRING" },
    legible: { type: "BOOLEAN" },
  },
  required: ["text", "legible"],
};

const READ_PROMPT = `첨부한 것은 기업 교육 담당자가 고객사와 상담하면서 손으로 적은 메모입니다. 적힌 글을 그대로 한국어 텍스트로 옮기세요.

규칙:
1. 요약하지 말고 적힌 것을 그대로 옮기세요. 토막말과 단어 나열도 그대로 둡니다.
2. 줄바꿈, 들여쓰기, 화살표, 번호처럼 적은 사람이 만든 구조를 살리세요.
3. 알아볼 수 없는 글자는 추측하지 말고 [판독불가] 로 표시하세요.
4. 메모에 없는 말을 채워 넣어 문장을 매끄럽게 만들지 마세요.
5. legible 은 글자를 알아볼 수 있었으면 true, 사진이 흐리거나 글씨를 거의 읽지 못했으면 false 로 두세요.`;

type Body = {
  source?: string;
  note?: string;
  storagePath?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
};

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  const startedAt = Date.now();
  const remainingMs = () => ROUTE_BUDGET_MS - (Date.now() - startedAt);
  let consultationId = "";

  try {
    const { id } = await context.params;
    if (!UUID.test(id)) return Response.json({ error: "기업 정보를 확인하지 못했습니다." }, { status: 400 });

    const body = await request.json() as Body;
    const source = body.source === "memo" ? "memo" : "text";

    const supabase = createSupabaseAdmin();
    const { data: company, error: companyError } = await supabase
      .from("company_research")
      .select("id,name,industry")
      .eq("id", id)
      .single();
    if (companyError || !company) throw companyError || new Error("기업 정보를 찾지 못했습니다.");

    // ─── 직접 입력 ────────────────────────────────────────────────────────────
    if (source === "text") {
      const note = String(body.note || "").trim().slice(0, MAX_CONSULTATION_NOTE_LENGTH);
      if (note.length < MIN_CONSULTATION_NOTE_LENGTH) {
        return Response.json(
          { error: `상담 내용을 ${MIN_CONSULTATION_NOTE_LENGTH}자 이상 적어 주세요. 너무 짧으면 교육 설계에 쓸 것이 나오지 않습니다.` },
          { status: 400 },
        );
      }
      const title = String(body.fileName || "").trim() || defaultTitle("직접 입력");

      const { data: created, error: insertError } = await supabase
        .from("company_consultations")
        .insert({ company_id: id, file_name: title, source: "text", note, status: "processing" })
        .select("id")
        .single();
      if (insertError || !created) throw insertError || new Error("상담 기록을 만들지 못했습니다.");
      consultationId = created.id;

      const summary = await analyzeConsultation({
        companyName: company.name, industry: company.industry, source: "text", text: note,
        timeoutMs: ANALYSIS_CALL_MS, budgetMs: remainingMs(), maxRetryWaitMs: RETRY_WAIT_MS,
      });
      return await complete(supabase, consultationId, summary);
    }

    // ─── 메모 파일 ────────────────────────────────────────────────────────────
    const fileName = String(body.fileName || "").trim();
    const storagePath = String(body.storagePath || "").trim();
    const note = resolveConsultationNote(fileName, body.mimeType);
    if (!note || !storagePath.startsWith(`${id}/`) || storagePath.includes("..") || storagePath.split("/").length !== 2) {
      return Response.json({ error: "올바르지 않은 메모 파일입니다." }, { status: 400 });
    }
    if (!body.fileSize || body.fileSize > MAX_CONSULTATION_NOTE_SIZE) {
      return Response.json({ error: "메모 파일은 최대 20MB까지 올릴 수 있습니다." }, { status: 400 });
    }

    const { data: created, error: insertError } = await supabase
      .from("company_consultations")
      .insert({
        company_id: id, file_name: fileName, storage_path: storagePath,
        mime_type: note.mimeType, file_size: body.fileSize, source: "memo", status: "processing",
      })
      .select("id")
      .single();
    if (insertError || !created) throw insertError || new Error("상담 기록을 만들지 못했습니다.");
    consultationId = created.id;

    const { data: stored, error: downloadError } = await supabase.storage
      .from(CONSULTATION_NOTES_BUCKET).download(storagePath);
    if (downloadError || !stored) throw downloadError || new Error("메모 파일을 불러오지 못했습니다.");
    const bytes = Buffer.from(await stored.arrayBuffer());

    // txt 는 모델을 부를 이유가 없다. 이미 글이다.
    let text = "";
    let legible = true;
    if (note.mimeType === "text/plain") {
      text = bytes.toString("utf8").trim();
    } else {
      const read = await generateWithGemini({
        role: "documentExtraction",
        prompt: READ_PROMPT,
        media: [{ inlineData: { mimeType: note.mimeType, data: bytes.toString("base64") } }],
        responseSchema: noteSchema,
        temperature: 0,
        maxOutputTokens: 16_384,
        timeoutMs: READ_CALL_MS,
        budgetMs: Math.max(READ_CALL_MS, remainingMs() - ANALYSIS_RESERVE_MS),
        maxRetryWaitMs: RETRY_WAIT_MS,
      });
      const parsed = JSON.parse(read.text) as { text?: string; legible?: boolean };
      text = String(parsed.text || "").trim();
      legible = parsed.legible !== false;
    }
    text = text.slice(0, MAX_CONSULTATION_NOTE_LENGTH);

    // 못 읽은 메모를 그대로 분석에 넘기면 모델이 빈자리를 지어낸다. 여기서 끊고 사람에게 돌려준다.
    if (!legible || text.length < MIN_CONSULTATION_NOTE_LENGTH) {
      throw new Error("메모에서 글을 충분히 읽지 못했습니다. 사진이 흐리거나 글씨가 작으면 밝은 곳에서 다시 찍어 올려 주세요. 직접 입력으로 적으셔도 됩니다.");
    }

    const summary = await analyzeConsultation({
      companyName: company.name, industry: company.industry, source: "memo", text,
      timeoutMs: ANALYSIS_CALL_MS, budgetMs: remainingMs(), maxRetryWaitMs: RETRY_WAIT_MS,
    });
    return await complete(supabase, consultationId, summary, text);
  } catch (error) {
    const message = error instanceof Error ? error.message
      : (error && typeof error === "object" && "message" in error) ? String((error as { message: unknown }).message)
      : "상담 기록을 저장하지 못했습니다.";
    // 행을 이미 만들었으면 남긴다 — 원본과 '실패했다는 사실'이 사라지면 다시 올릴지 판단할 수 없다.
    if (consultationId) {
      await createSupabaseAdmin().from("company_consultations").update({
        status: "failed", error_message: message.slice(0, 500), updated_at: new Date().toISOString(),
      }).eq("id", consultationId);
    }
    console.error(`[consultations/note] 실패: ${message}`);
    return Response.json({ error: message }, { status: 422 });
  }
}

/** 이름을 안 주면 날짜로 짓는다. 목록에서 서로 구분되기만 하면 된다. */
function defaultTitle(kind: string) {
  const now = new Date();
  const date = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now).replace(/\.\s?/g, "").trim();
  return `${kind} ${date}`;
}

type Client = ReturnType<typeof createSupabaseAdmin>;

async function complete(supabase: Client, id: string, summary: unknown, note?: string) {
  const patch: Record<string, unknown> = {
    summary, status: "completed", error_message: null, updated_at: new Date().toISOString(),
  };
  if (note !== undefined) patch.note = note;
  const { data, error } = await supabase
    .from("company_consultations")
    .update(patch)
    .eq("id", id)
    .select(CONSULTATION_COLUMNS)
    .single();
  if (error || !data) throw error || new Error("분석 결과를 저장하지 못했습니다.");
  return Response.json({ consultation: data });
}
