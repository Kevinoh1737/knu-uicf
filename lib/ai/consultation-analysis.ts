/**
 * 상담 내용을 교육 설계에 쓸 수 있는 모양으로 정리한다.
 *
 * 상담이 들어오는 길은 셋이다 — 녹취 전사, 화면에서 직접 입력, 적어 둔 메모 읽기. 그러나
 * 정리하는 일은 하나다. 세 길이 각자 프롬프트를 들고 있으면 같은 상담을 어떻게 넣었느냐에
 * 따라 다른 요약이 나오고, 그러면 통합 브리핑도 비교도 흔들린다. 그래서 여기 하나만 둔다.
 *
 * 들어오는 것은 언제나 평문이다. 녹취는 `[시각] 화자: 말` 로 이어 붙인 것이고, 나머지 둘은
 * 적힌 그대로다.
 */
import { generateWithGemini } from "@/lib/ai/gemini";
import type { ConsultationSource, ConsultationSummary } from "@/lib/consultations";

export const consultationSummarySchema = {
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

export function cleanConsultationSummary(value: ConsultationSummary): ConsultationSummary {
  const strings = (items: unknown) => Array.isArray(items)
    ? items.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim())
    : [];
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

/**
 * 무엇을 읽고 있는지 모델에게 알린다. 녹취 전문과 손으로 적은 메모는 밀도가 다르다 —
 * 메모는 원래 빈 곳이 많은 글이라, 같은 잣대로 읽으면 '확인되지 않음' 을 채우려고 지어낸다.
 */
const SOURCE_NOTE: Record<ConsultationSource, string> = {
  audio: "아래는 상담 녹취를 전사한 전문입니다.",
  text: "아래는 담당자가 상담 직후 기억을 되살려 직접 적은 상담 내용입니다. 녹취가 아니라서 오간 말이 그대로 담겨 있지 않고, 담당자가 중요하다고 본 것만 남아 있습니다.",
  memo: "아래는 담당자가 상담 중에 손으로 적은 메모를 읽어 옮긴 글입니다. 문장이 아니라 토막말과 단어로 적혀 있을 수 있고, 적히지 않은 것이 많습니다.",
};

const SPARSE_SOURCE_RULE = `
이 기록은 녹취가 아니므로 빈 곳이 많습니다. 적히지 않은 것을 문맥으로 메우지 마세요 —
적힌 것만 쓰고, 비어 있는 항목은 비워 두거나 followUpQuestions 로 옮기세요. 메모 한 줄에서
회사의 사정을 미루어 짐작한 문장을 만들어 내면, 담당자는 그것을 상담에서 들은 말로 읽습니다.`;

export type ConsultationAnalysisInput = {
  companyName: string;
  industry?: string | null;
  source: ConsultationSource;
  /** 정리할 상담 내용 평문. */
  text: string;
  timeoutMs: number;
  budgetMs: number;
  maxRetryWaitMs: number;
};

export async function analyzeConsultation({
  companyName, industry, source, text, timeoutMs, budgetMs, maxRetryWaitMs,
}: ConsultationAnalysisInput): Promise<ConsultationSummary> {
  const prompt = `${SOURCE_NOTE[source]} ${companyName}의 AI·AX 교육 상담입니다. 교육사업팀 관리자가 바로 후속 교육을 설계하고 강사에게 전달할 수 있도록 중요한 내용만 구조화하세요.

반드시 확인할 항목:
- 회사 조직과 핵심 부서, 가장 반복적인 업무
- 교육 목표와 개선하려는 현장 문제
- 참석 인원, 부서, 직급, 연령대, 성비, AI 활용 수준
- 필요한 실습 사례와 사용 가능한 업무 자료
- 보안, 데이터, 장소, 장비, 일정 등 제약
- 적합한 강사의 경험과 강의 준비에 필요한 정보
- 4시간 특강 기준의 합의사항과 아직 확인하지 못한 질문

오직 아래 상담 내용에 나온 사실만 요약하세요. 기업 정보나 기존 질문지의 내용을 상담에서 말한 것처럼 섞지 마세요. 기록에 없는 내용은 추정하지 말고 '확인되지 않음' 또는 후속 질문으로 남기세요. 짧고 쉬운 표현을 사용하세요.${source === "audio" ? "" : SPARSE_SOURCE_RULE}

기업 업종 참고: ${industry || "확인되지 않음"}

상담 내용:
${text}`;

  const result = await generateWithGemini({
    role: "consultationAnalysis",
    prompt,
    responseSchema: consultationSummarySchema,
    temperature: 0.1,
    maxOutputTokens: 16_384,
    timeoutMs,
    budgetMs,
    maxRetryWaitMs,
  });
  return cleanConsultationSummary(JSON.parse(result.text) as ConsultationSummary);
}
