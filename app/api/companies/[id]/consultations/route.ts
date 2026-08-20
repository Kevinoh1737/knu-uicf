import { requireTeamSession } from "@/lib/auth/guard";
import { analyzeConsultation } from "@/lib/ai/consultation-analysis";
import { generateWithGemini } from "@/lib/ai/gemini";
import { deleteGeminiFile, uploadGeminiFile } from "@/lib/ai/gemini-files";
import {
  CONSULTATION_AUDIO_BUCKET,
  CONSULTATION_COLUMNS,
  ConsultationTranscript,
  MAX_CONSULTATION_AUDIO_SIZE,
  resolveConsultationAudio,
} from "@/lib/consultations";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
/** 800s is the Vercel Pro ceiling. Transcribing an hour of audio genuinely needs minutes, not seconds. */
export const maxDuration = 800;

/**
 * Upload, transcription, and analysis each retry, and together they can outrun `maxDuration`.
 * A platform kill skips the catch block that marks the row failed, which would leave the record
 * stuck on "처리 중" forever, so every phase draws from one budget that ends before the kill.
 *
 * The per-attempt transcription cap was 150s and that was simply too small: a measured 58-minute
 * recording takes about 221s of API time (plus up to 50s of 503 backoff) and returns a complete
 * 33,000-character transcript. The old cap aborted it mid-flight and recorded a timeout.
 */
const ROUTE_BUDGET_MS = 780_000;
const UPLOAD_BUDGET_MS = 90_000;
const ANALYSIS_RESERVE_MS = 90_000;
const TRANSCRIPTION_CALL_MS = 420_000;
const ANALYSIS_CALL_MS = 90_000;
/** 503 spikes on this model have lasted through four straight attempts; the budget can absorb waiting them out. */
const TRANSCRIPTION_RETRY_WAIT_MS = 240_000;
const ANALYSIS_RETRY_WAIT_MS = 60_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const transcriptSchema = {
  type: "OBJECT",
  properties: {
    language: { type: "STRING" },
    segments: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          speaker: { type: "STRING" },
          timestamp: { type: "STRING" },
          text: { type: "STRING" },
        },
        required: ["speaker", "timestamp", "text"],
      },
    },
  },
  required: ["language", "segments"],
};

function cleanTranscript(value: ConsultationTranscript): ConsultationTranscript {
  return {
    language: String(value.language || "ko"),
    segments: Array.isArray(value.segments) ? value.segments
      .filter((segment) => segment && typeof segment.text === "string" && segment.text.trim())
      .map((segment, index) => ({
        speaker: String(segment.speaker || `화자 ${index % 2 + 1}`).trim(),
        timestamp: String(segment.timestamp || "").trim(),
        text: segment.text.trim(),
      })) : [],
  };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) return Response.json({ error: "기업 정보를 확인하지 못했습니다." }, { status: 400 });
    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase
      .from("company_consultations")
      .select(CONSULTATION_COLUMNS)
      .eq("company_id", id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    // 직접 입력한 기록에는 파일이 없다. 없는 경로로 서명 URL 을 만들려 하면 건건이 실패한다.
    const consultations = await Promise.all((data || []).map(async (item) => {
      if (!item.storage_path || item.source !== "audio") return item;
      const { data: signed } = await supabase.storage.from(CONSULTATION_AUDIO_BUCKET).createSignedUrl(item.storage_path, 60 * 60);
      return { ...item, audio_url: signed?.signedUrl || undefined };
    }));

    // Tolerated rather than required: the column arrives with a migration, and the per-consultation
    // view has to keep working on a database that has not had it applied yet.
    let briefing = null;
    const { data: companyRow, error: briefingError } = await supabase
      .from("company_research")
      .select("consultation_briefing")
      .eq("id", id)
      .maybeSingle();
    if (briefingError) console.error(`[consultations] 통합 브리핑 조회 실패: ${briefingError.message}`);
    else if (companyRow?.consultation_briefing && Object.keys(companyRow.consultation_briefing).length) {
      briefing = companyRow.consultation_briefing;
    }

    return Response.json({ consultations, briefing });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "상담 기록을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  const startedAt = Date.now();
  const remainingMs = () => ROUTE_BUDGET_MS - (Date.now() - startedAt);
  let consultationId = "";
  let geminiFileName = "";
  try {
    const { id } = await context.params;
    const body = await request.json() as { storagePath?: string; fileName?: string; mimeType?: string; fileSize?: number };
    const fileName = String(body.fileName || "").trim();
    const storagePath = String(body.storagePath || "").trim();
    const audio = resolveConsultationAudio(fileName, body.mimeType);
    if (!UUID.test(id)) return Response.json({ error: "기업 정보를 확인하지 못했습니다." }, { status: 400 });
    if (!audio || !storagePath.startsWith(`${id}/`) || storagePath.includes("..") || storagePath.split("/").length !== 2) {
      return Response.json({ error: "올바르지 않은 녹취파일입니다." }, { status: 400 });
    }
    if (!body.fileSize || body.fileSize > MAX_CONSULTATION_AUDIO_SIZE) {
      return Response.json({ error: "녹취파일은 최대 50MB까지 업로드할 수 있습니다." }, { status: 400 });
    }

    const supabase = createSupabaseAdmin();
    const { data: company, error: companyError } = await supabase
      .from("company_research")
      .select("id,name,industry")
      .eq("id", id)
      .single();
    if (companyError || !company) throw companyError || new Error("기업 정보를 찾지 못했습니다.");

    const { data: consultation, error: insertError } = await supabase
      .from("company_consultations")
      .insert({
        company_id: id,
        file_name: fileName,
        storage_path: storagePath,
        mime_type: audio.mimeType,
        file_size: body.fileSize,
        source: "audio",
        status: "processing",
      })
      .select("id")
      .single();
    if (insertError || !consultation) throw insertError || new Error("상담 기록을 만들지 못했습니다.");
    consultationId = consultation.id;

    const { data: storedFile, error: downloadError } = await supabase.storage.from(CONSULTATION_AUDIO_BUCKET).download(storagePath);
    if (downloadError || !storedFile) throw downloadError || new Error("녹취파일을 불러오지 못했습니다.");
    const uploadedFile = await uploadGeminiFile(Buffer.from(await storedFile.arrayBuffer()), fileName, audio.mimeType, Math.min(UPLOAD_BUDGET_MS, remainingMs()));
    geminiFileName = uploadedFile.name;

    const transcriptionResult = await generateWithGemini({
      role: "consultationTranscription",
      prompt: "이 기업 교육 상담 녹취를 처음부터 끝까지 빠짐없이 한국어 텍스트로 전사하세요. 발화 순서를 보존하고 문장을 요약하거나 생략하지 마세요. 화자를 구분할 수 있으면 실제 이름 또는 역할을 사용하고, 확인할 수 없으면 화자 1, 화자 2처럼 표시하세요. 각 발화 시작 시각은 MM:SS 또는 HH:MM:SS 형식으로 기록하세요. 알아듣기 어려운 말은 추측하지 말고 [불명확]으로 표시하세요.",
      media: [{ fileData: { mimeType: uploadedFile.mimeType || audio.mimeType, fileUri: uploadedFile.uri } }],
      responseSchema: transcriptSchema,
      temperature: 0,
      maxOutputTokens: 65_536,
      timeoutMs: TRANSCRIPTION_CALL_MS,
      budgetMs: remainingMs() - ANALYSIS_RESERVE_MS,
      maxRetryWaitMs: TRANSCRIPTION_RETRY_WAIT_MS,
    });
    const transcript = cleanTranscript(JSON.parse(transcriptionResult.text) as ConsultationTranscript);
    if (!transcript.segments.length) throw new Error("녹취에서 대화 내용을 확인하지 못했습니다.");

    const transcriptText = transcript.segments
      .map((segment) => `[${segment.timestamp}] ${segment.speaker}: ${segment.text}`)
      .join("\n");
    const summary = await analyzeConsultation({
      companyName: company.name,
      industry: company.industry,
      source: "audio",
      text: transcriptText,
      timeoutMs: ANALYSIS_CALL_MS,
      budgetMs: remainingMs(),
      maxRetryWaitMs: ANALYSIS_RETRY_WAIT_MS,
    });

    const { data: saved, error: updateError } = await supabase
      .from("company_consultations")
      .update({ transcript, summary, status: "completed", error_message: null, updated_at: new Date().toISOString() })
      .eq("id", consultationId)
      .select(CONSULTATION_COLUMNS)
      .single();
    if (updateError || !saved) throw updateError || new Error("분석 결과를 저장하지 못했습니다.");
    const { data: signed } = await supabase.storage.from(CONSULTATION_AUDIO_BUCKET).createSignedUrl(storagePath, 60 * 60);
    return Response.json({ consultation: { ...saved, audio_url: signed?.signedUrl || undefined } });
  } catch (error) {
    if (consultationId) {
      await createSupabaseAdmin().from("company_consultations").update({
        status: "failed",
        error_message: error instanceof Error ? error.message.slice(0, 500) : "녹취 처리 실패",
        updated_at: new Date().toISOString(),
      }).eq("id", consultationId);
    }
    return Response.json({ error: error instanceof Error ? error.message : "녹취를 처리하지 못했습니다." }, { status: 422 });
  } finally {
    if (geminiFileName) await deleteGeminiFile(geminiFileName);
  }
}
