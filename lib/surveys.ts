/**
 * 만족도 설문. 교육과정 하나에 설문지 하나이고, 문항은 관리자가 최종 결정한다 — AI 는 초안만
 * 만들고, 이미 쓰던 설문지가 있으면 그것을 읽어 초안에 반영한다.
 *
 * 문항 형태를 셋으로 묶은 이유: 지표로 쓸 수 있는 것은 숫자뿐이고(scale), 이유는 글에서만
 * 나오고(text), 그 사이를 메우는 것이 보기 선택(choice)이다. 형태를 더 늘리면 화면·PDF·집계가
 * 모두 같이 늘어난다.
 */
export type SurveyQuestionType = "scale" | "choice" | "text";

export type SurveyQuestion = {
  id: string;
  type: SurveyQuestionType;
  text: string;
  options: string[];
  required: boolean;
};

export type SurveyStatus = "draft" | "open" | "closed";

export const SURVEY_STATUS_LABEL: Record<SurveyStatus, string> = {
  draft: "작성 중",
  open: "응답 받는 중",
  closed: "마감",
};

/** 5점 척도. 화면·PDF·집계가 같은 문구를 써야 응답자와 담당자가 같은 것을 본다. */
export const SCALE_LABELS = ["전혀 아니다", "아니다", "보통이다", "그렇다", "매우 그렇다"];
export const SCALE_MAX = SCALE_LABELS.length;

const MAX_QUESTIONS = 30;
const MAX_OPTIONS = 8;
const MAX_TEXT = 300;
const MAX_ANSWER_TEXT = 2_000;

function trimTo(value: unknown, limit: number) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function questionType(value: unknown): SurveyQuestionType {
  return value === "choice" || value === "text" ? value : "scale";
}

/**
 * 저장 직전의 유일한 관문. AI 응답도, 관리자 입력도, PDF 에서 읽은 것도 전부 여기를 지난다 —
 * 형태를 한 곳에서만 좁혀야 화면과 집계가 같은 것을 가정할 수 있다.
 */
export function sanitizeQuestions(value: unknown): SurveyQuestion[] {
  if (!Array.isArray(value)) return [];
  const questions: SurveyQuestion[] = [];
  value.slice(0, MAX_QUESTIONS).forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const source = item as Record<string, unknown>;
    const text = trimTo(source.text, MAX_TEXT);
    if (!text) return;
    const type = questionType(source.type);
    const options = type === "choice" && Array.isArray(source.options)
      ? source.options.map((option) => trimTo(option, 80)).filter(Boolean).slice(0, MAX_OPTIONS)
      : [];
    // 보기가 없는 선택 문항은 답을 고를 수 없다. 서술형으로 내려 두는 편이 빈 화면보다 낫다.
    const resolved = type === "choice" && options.length < 2 ? "text" : type;
    questions.push({
      id: trimTo(source.id, 40) || `q${index + 1}`,
      type: resolved,
      text,
      options: resolved === "choice" ? options : [],
      required: source.required !== false,
    });
  });
  // id 가 겹치면 답이 서로를 덮어쓴다. 뒤에 온 것을 밀어낸다.
  const seen = new Set<string>();
  return questions.map((question, index) => {
    let id = question.id;
    while (seen.has(id)) id = `${id}_${index}`;
    seen.add(id);
    return { ...question, id };
  });
}

/** 초안이 실패해도 빈 화면을 주지 않기 위한 기본 문항. 교육 만족도의 표준 축이다. */
export const DEFAULT_QUESTIONS: SurveyQuestion[] = sanitizeQuestions([
  { id: "content_useful", type: "scale", text: "교육 내용이 실제 업무에 도움이 되었다" },
  { id: "level_fit", type: "scale", text: "교육의 난이도와 진행 속도가 적절했다" },
  { id: "delivery", type: "scale", text: "강사의 설명이 이해하기 쉬웠다" },
  { id: "relevance", type: "scale", text: "실습과 사례가 우리 회사 업무와 관련이 있었다" },
  { id: "duration", type: "scale", text: "교육 시간과 분량이 적절했다" },
  { id: "recommend", type: "scale", text: "이 교육을 동료에게 추천하고 싶다" },
  { id: "best_part", type: "text", text: "가장 도움이 된 내용은 무엇이었습니까?", required: false },
  { id: "improve", type: "text", text: "더 다뤘으면 하는 내용이나 개선점이 있다면 적어 주세요.", required: false },
]);

export type SurveyAnswers = Record<string, number | string>;

/** 응답 저장 전 정리. 설문지에 없는 문항은 버리고, 척도는 1~5 정수만 남긴다. */
export function sanitizeAnswers(questions: SurveyQuestion[], value: unknown): SurveyAnswers {
  if (!value || typeof value !== "object") return {};
  const source = value as Record<string, unknown>;
  const answers: SurveyAnswers = {};
  questions.forEach((question) => {
    const raw = source[question.id];
    if (raw === undefined || raw === null || raw === "") return;
    if (question.type === "scale") {
      const score = Math.round(Number(raw));
      if (Number.isFinite(score) && score >= 1 && score <= SCALE_MAX) answers[question.id] = score;
      return;
    }
    const text = trimTo(raw, MAX_ANSWER_TEXT);
    if (!text) return;
    // 보기에 없는 값이 올라오면 고른 것이 아니라 만들어 낸 것이다.
    if (question.type === "choice" && !question.options.includes(text)) return;
    answers[question.id] = text;
  });
  return answers;
}

/** 필수 문항이 비어 있으면 어떤 문항인지 돌려준다. 화면과 서버가 같은 판단을 쓴다. */
export function missingRequired(questions: SurveyQuestion[], answers: SurveyAnswers) {
  return questions.filter((question) => question.required && answers[question.id] === undefined);
}

export type ScaleSummary = {
  id: string;
  text: string;
  average: number;
  count: number;
  distribution: number[];
};

export type SurveySummary = {
  invited: number;
  responded: number;
  responseRate: number;
  overall: number | null;
  scales: ScaleSummary[];
  texts: Array<{ id: string; text: string; answers: string[] }>;
};

/**
 * 지표. 평균은 응답이 있는 문항만으로 낸다 — 무응답을 0으로 세면 사람이 적게 답할수록
 * 점수가 떨어져서, 만족도가 아니라 응답률을 재게 된다.
 */
export function summarizeSurvey(
  questions: SurveyQuestion[],
  responses: Array<{ answers: SurveyAnswers }>,
  invited: number,
): SurveySummary {
  const scales: ScaleSummary[] = [];
  const texts: SurveySummary["texts"] = [];

  questions.forEach((question) => {
    if (question.type === "scale") {
      const distribution = new Array(SCALE_MAX).fill(0);
      let total = 0;
      let count = 0;
      responses.forEach((response) => {
        const value = response.answers[question.id];
        if (typeof value !== "number" || value < 1 || value > SCALE_MAX) return;
        distribution[value - 1] += 1;
        total += value;
        count += 1;
      });
      scales.push({
        id: question.id,
        text: question.text,
        average: count ? Number((total / count).toFixed(2)) : 0,
        count,
        distribution,
      });
      return;
    }
    const answers = responses
      .map((response) => response.answers[question.id])
      .filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
    texts.push({ id: question.id, text: question.text, answers });
  });

  const answered = scales.filter((scale) => scale.count > 0);
  const overall = answered.length
    ? Number((answered.reduce((sum, scale) => sum + scale.average, 0) / answered.length).toFixed(2))
    : null;

  const responded = responses.length;
  // 분모는 '보낸 수'가 아니라 '보낸 수와 받은 수 중 큰 값'이다. 발송에 실패했거나 링크를
  // 직접 전달한 경우 보낸 수가 0인데 응답은 들어올 수 있고, 그때 0으로 나누면 '응답 2명 ·
  // 응답률 0%' 같은 말이 안 되는 표시가 나온다.
  const base = Math.max(invited, responded);
  return {
    invited,
    responded,
    responseRate: base ? Math.round((responded / base) * 100) : 0,
    overall,
    scales,
    texts,
  };
}

export const MAX_SURVEY_PDF_SIZE = 10 * 1024 * 1024;
