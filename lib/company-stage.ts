/**
 * 기업의 진행 단계.
 *
 * 저장하는 값과 계산하는 값을 나눈다. '강사 배정 완료'는 강의가 있는지로 언제나 알 수 있어
 * 저장하지 않는다 — 저장하면 강의를 지웠을 때 상태만 남아 어긋난다. 반대로 '교육 완료'와
 * '교육 취소'는 사람이 판단하는 것이라 저장한다. 일정이 지났다고 자동으로 넘기지 않는다.
 */
export type StoredStage = "research_complete" | "training_complete" | "cancelled";
export type CompanyStage = StoredStage | "course_created" | "instructor_assigned";

export const STAGE_LABEL: Record<CompanyStage, string> = {
  research_complete: "조사 완료",
  course_created: "교육과정 생성",
  instructor_assigned: "강사 배정 완료",
  training_complete: "교육 완료",
  cancelled: "교육 취소",
};

/** 배지 색. 진행 중 · 끝남 · 멈춤을 구분한다. */
export const STAGE_TONE: Record<CompanyStage, string> = {
  research_complete: "neutral",
  course_created: "progress",
  instructor_assigned: "progress",
  training_complete: "done",
  cancelled: "stopped",
};

export const STORED_STAGES: StoredStage[] = ["research_complete", "training_complete", "cancelled"];

export function isStoredStage(value: unknown): value is StoredStage {
  return typeof value === "string" && (STORED_STAGES as string[]).includes(value);
}

/**
 * 저장된 값이 사람의 판단이면 그것을 따르고, 아니면 진행 상황에서 읽는다.
 *
 * 교육과정을 만든 것과 강사를 배정한 것은 다른 단계다. 과정 수만 세면 강사가 없는데도
 * '강사 배정 완료'로 보인다 — 실제 순서가 과정 생성 → 강사 배정이므로 둘을 가른다.
 */
export function resolveStage(stored: unknown, sessionCount: number, assignedCount = sessionCount): CompanyStage {
  if (stored === "training_complete" || stored === "cancelled") return stored;
  if (assignedCount > 0) return "instructor_assigned";
  return sessionCount > 0 ? "course_created" : "research_complete";
}

export function stageLabel(stored: unknown, sessionCount: number, assignedCount = sessionCount) {
  return STAGE_LABEL[resolveStage(stored, sessionCount, assignedCount)];
}

/**
 * '로' / '으로' 를 가른다. 받침이 없거나 ㄹ 받침이면 '로'다 — '교육 완료로', '교육 취소로',
 * '진행 중으로'. 문구에 (으)로 를 박아 넣지 않으려면 이 계산이 필요하다.
 */
export function withRo(word: string) {
  const last = word.trim().slice(-1);
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return `${word}로`;
  const jong = (code - 0xac00) % 28;
  return jong === 0 || jong === 8 ? `${word}로` : `${word}으로`;
}
