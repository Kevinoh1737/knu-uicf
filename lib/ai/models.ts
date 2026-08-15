export type AIRole =
  | "companyResearch"
  | "documentExtraction"
  | "questionnaireDesign"
  | "consultationTranscription"
  | "consultationAnalysis"
  | "courseDesign"
  | "surveyDesign"
  | "instructorMatching";

export type ModelTier = "fast" | "balanced" | "deep";

export const GEMINI_MODELS: Record<ModelTier, string> = {
  fast: process.env.GEMINI_MODEL_FAST || "gemini-3.5-flash-lite",
  balanced: process.env.GEMINI_MODEL_BALANCED || "gemini-3.6-flash",
  deep: process.env.GEMINI_MODEL_DEEP || "gemini-3.1-pro-preview",
};

export const AI_ROLE_CONFIG: Record<
  AIRole,
  { tier: ModelTier; model: string; purpose: string }
> = {
  companyResearch: {
    tier: "balanced",
    model: GEMINI_MODELS.balanced,
    purpose: "기업 홈페이지·브로슈어·경쟁사 조사와 근거 정리",
  },
  documentExtraction: {
    tier: "fast",
    model: GEMINI_MODELS.fast,
    purpose: "수강생 명단과 강사 프로필의 대량 구조화 추출",
  },
  questionnaireDesign: {
    tier: "balanced",
    model: GEMINI_MODELS.balanced,
    purpose: "제조·레거시 산업의 기업별 AI·AX 교육 니즈 질문지 설계",
  },
  consultationTranscription: {
    tier: "balanced",
    model: GEMINI_MODELS.balanced,
    purpose: "상담 녹취 전사, 타임스탬프와 화자 분리",
  },
  consultationAnalysis: {
    tier: "deep",
    model: GEMINI_MODELS.deep,
    purpose: "상담 전문의 니즈·제약조건·성과지표 심층 분석",
  },
  courseDesign: {
    tier: "deep",
    model: GEMINI_MODELS.deep,
    purpose: "4시간 단위 최종 교육과정과 학습목표 설계",
  },
  surveyDesign: {
    tier: "balanced",
    model: GEMINI_MODELS.balanced,
    purpose: "수업 내용 기반 맞춤 만족도 문항 설계",
  },
  instructorMatching: {
    tier: "balanced",
    model: GEMINI_MODELS.balanced,
    purpose: "전문분야·일정·평가 기반 강사 후보 추천",
  },
};

/**
 * Used when the primary model answers 503 for a whole retry window. Overload is per model, not per
 * key: measured 2026-08-15 on one 58-minute recording within the same minute, gemini-3.6-flash and
 * gemini-3.7-flash both returned 503 while gemini-3.5-flash accepted the identical request.
 */
export const FALLBACK_MODELS: Record<ModelTier, string> = {
  fast: process.env.GEMINI_MODEL_FAST_FALLBACK || "gemini-3.1-flash-lite",
  balanced: process.env.GEMINI_MODEL_BALANCED_FALLBACK || "gemini-3.5-flash",
  deep: process.env.GEMINI_MODEL_DEEP_FALLBACK || "gemini-3.6-flash",
};

export function getModelForRole(role: AIRole) {
  return AI_ROLE_CONFIG[role].model;
}

/** Null when the fallback would just be the primary again. */
export function getFallbackModelForRole(role: AIRole) {
  const fallback = FALLBACK_MODELS[AI_ROLE_CONFIG[role].tier];
  return fallback && fallback !== getModelForRole(role) ? fallback : null;
}
