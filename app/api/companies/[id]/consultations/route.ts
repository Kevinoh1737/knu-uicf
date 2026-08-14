import { requireTeamSession } from "@/lib/auth/guard";
import { generateWithGemini } from "@/lib/ai/gemini";
import { deleteGeminiFile, uploadGeminiFile } from "@/lib/ai/gemini-files";
import {
  CONSULTATION_AUDIO_BUCKET,
  ConsultationSummary,
  ConsultationTranscript,
  MAX_CONSULTATION_AUDIO_SIZE,
  resolveConsultationAudio,
} from "@/lib/consultations";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

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

const summarySchema = {
  type: "OBJECT",
  properties: {
    overview: { type: "STRING" },
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
    instructorNotes: { type: "ARRAY", items: { type: "STRING" } },
    followUpQuestions: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["overview", "keyNeeds", "audience", "constraints", "decisions", "instructorNotes", "followUpQuestions"],
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

function cleanSummary(value: ConsultationSummary): ConsultationSummary {
  const strings = (items: unknown) => Array.isArray(items) ? items.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : [];
  return {
    overview: String(value.overview || "").trim(),
    keyNeeds: Array.isArray(value.keyNeeds) ? value.keyNeeds
      .filter((item) => item && typeof item.title === "string")
      .map((item) => ({ title: item.title.trim(), detail: String(item.detail || "").trim() })) : [],
    audience: {
      headline: String(value.audience?.headline || "확인 필요").trim(),
      detail: String(value.audience?.detail || "상담 내용에서 확인되지 않음").trim(),
    },
    constraints: strings(value.constraints),
    decisions: strings(value.decisions),
    instructorNotes: strings(value.instructorNotes),
    followUpQuestions: strings(value.followUpQuestions),
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
      .select("id,company_id,file_name,storage_path,mime_type,file_size,status,transcript,summary,error_message,created_at,updated_at")
      .eq("company_id", id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    const consultations = await Promise.all((data || []).map(async (item) => {
      const { data: signed } = await supabase.storage.from(CONSULTATION_AUDIO_BUCKET).createSignedUrl(item.storage_path, 60 * 60);
      return { ...item, audio_url: signed?.signedUrl || undefined };
    }));
    return Response.json({ consultations });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "상담 기록을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
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
        status: "processing",
      })
      .select("id")
      .single();
    if (insertError || !consultation) throw insertError || new Error("상담 기록을 만들지 못했습니다.");
    consultationId = consultation.id;

    const { data: storedFile, error: downloadError } = await supabase.storage.from(CONSULTATION_AUDIO_BUCKET).download(storagePath);
    if (downloadError || !storedFile) throw downloadError || new Error("녹취파일을 불러오지 못했습니다.");
    const uploadedFile = await uploadGeminiFile(Buffer.from(await storedFile.arrayBuffer()), fileName, audio.mimeType);
    geminiFileName = uploadedFile.name;

    const transcriptionResult = await generateWithGemini({
      role: "consultationTranscription",
      prompt: "이 기업 교육 상담 녹취를 처음부터 끝까지 빠짐없이 한국어 텍스트로 전사하세요. 발화 순서를 보존하고 문장을 요약하거나 생략하지 마세요. 화자를 구분할 수 있으면 실제 이름 또는 역할을 사용하고, 확인할 수 없으면 화자 1, 화자 2처럼 표시하세요. 각 발화 시작 시각은 MM:SS 또는 HH:MM:SS 형식으로 기록하세요. 알아듣기 어려운 말은 추측하지 말고 [불명확]으로 표시하세요.",
      media: [{ fileData: { mimeType: uploadedFile.mimeType || audio.mimeType, fileUri: uploadedFile.uri } }],
      responseSchema: transcriptSchema,
      temperature: 0,
      maxOutputTokens: 65_536,
      timeoutMs: 240_000,
    });
    const transcript = cleanTranscript(JSON.parse(transcriptionResult.text) as ConsultationTranscript);
    if (!transcript.segments.length) throw new Error("녹취에서 대화 내용을 확인하지 못했습니다.");

    const transcriptText = transcript.segments
      .map((segment) => `[${segment.timestamp}] ${segment.speaker}: ${segment.text}`)
      .join("\n");
    const analysisResult = await generateWithGemini({
      role: "consultationAnalysis",
      prompt: `아래는 ${company.name}의 AI·AX 교육 상담 전문입니다. 교육사업팀 관리자가 바로 후속 교육을 설계하고 강사에게 전달할 수 있도록 중요한 내용만 구조화하세요.\n\n반드시 확인할 항목:\n- 회사 조직과 핵심 부서, 가장 반복적인 업무\n- 교육 목표와 개선하려는 현장 문제\n- 참석 인원, 부서, 직급, 연령대, 성비, AI 활용 수준\n- 필요한 실습 사례와 사용 가능한 업무 자료\n- 보안, 데이터, 장소, 장비, 일정 등 제약\n- 적합한 강사의 경험과 강의 준비에 필요한 정보\n- 4시간 특강 기준의 합의사항과 아직 확인하지 못한 질문\n\n오직 아래 상담 전문에 나온 사실만 요약하세요. 기업 정보나 기존 질문지의 내용을 상담에서 말한 것처럼 섞지 마세요. 녹취에 없는 내용은 추정하지 말고 '확인되지 않음' 또는 후속 질문으로 남기세요. 짧고 쉬운 표현을 사용하세요.\n\n기업 업종 참고: ${company.industry || "확인되지 않음"}\n\n상담 전문:\n${transcriptText}`,
      responseSchema: summarySchema,
      temperature: 0.1,
      maxOutputTokens: 16_384,
      timeoutMs: 180_000,
    });
    const summary = cleanSummary(JSON.parse(analysisResult.text) as ConsultationSummary);

    const { data: saved, error: updateError } = await supabase
      .from("company_consultations")
      .update({ transcript, summary, status: "completed", error_message: null, updated_at: new Date().toISOString() })
      .eq("id", consultationId)
      .select("id,company_id,file_name,storage_path,mime_type,file_size,status,transcript,summary,error_message,created_at,updated_at")
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
