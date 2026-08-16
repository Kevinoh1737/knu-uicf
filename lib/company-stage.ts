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

/**
 * 담당자가 직접 고르는 상태의 이름. 저장값은 조사 완료지만, 고르는 자리에서는 '아직 교육이
 * 남아 있다'는 뜻이라 교육 예정으로 부른다 — 4시간 특강이라 '진행 중'인 기간이 사실상 없다.
 */
export function stageChoiceLabel(value: StoredStage) {
  return value === "research_complete" ? "교육 예정" : STAGE_LABEL[value];
}

export function isStoredStage(value: unknown): value is StoredStage {
  return typeof value === "string" && (STORED_STAGES as string[]).includes(value);
}

/**
 * 저장된 값이 사람의 판단이면 그것을 따르고, 아니면 진행 상황에서 읽는다.
 *
 * 교육과정을 만든 것과 강사를 배정한 것은 다른 단계다. 과정 수만 세면 강사가 없는데도
 * '강사 배정 완료'로 보인다 — 실제 순서가 과정 생성 → 강사 배정이므로 둘을 가른다.
 */
export function resolveStage(
  stored: unknown,
  sessionCount: number,
  assignedCount = sessionCount,
  deliveredCount = 0,
  cancelledCount = 0,
): CompanyStage {
  // 완료·취소는 교육과정마다 매겨진다. 회사 단계는 그 과정들에서 읽는다 — 과정이 둘인데
  // 하나만 끝났을 때 회사 전체가 끝난 것으로 보이면 남은 하나가 목록에서 사라진다.
  //
  // sessionCount 는 '취소를 뺀 살아 있는 과정 수'다. 그래서 취소 판정은 취소 수를 sessionCount
  // 와 견주는 게 아니라 '살아 있는 과정이 하나도 없는가'로 한다 — 하나 끝내고 하나 취소한
  // 회사를 취소로 적으면 끝낸 교육이 없던 일이 된다.
  if (cancelledCount > 0 && sessionCount === 0) return "cancelled";
  if (sessionCount > 0 && deliveredCount >= sessionCount) return "training_complete";
  // 과정이 생기기 전에 사람이 손으로 매겨 둔 값은 그대로 존중한다(예전 방식으로 남은 데이터).
  if (sessionCount === 0 && (stored === "training_complete" || stored === "cancelled")) return stored;
  // '배정 완료'는 남김없이 배정됐을 때만이다. 하나라도 배정되면 완료로 보던 때에는, 과정
  // 2개 중 1개만 강사가 있어도 '강사 배정 완료'가 떠서 남은 하나가 목록에서 사라졌다.
  if (sessionCount > 0 && assignedCount >= sessionCount) return "instructor_assigned";
  return sessionCount > 0 ? "course_created" : "research_complete";
}

export function stageLabel(
  stored: unknown,
  sessionCount: number,
  assignedCount = sessionCount,
  deliveredCount = 0,
  cancelledCount = 0,
) {
  return STAGE_LABEL[resolveStage(stored, sessionCount, assignedCount, deliveredCount, cancelledCount)];
}

/** 교육과정 하나의 상태. 담당자가 직접 고르는 것은 이 셋뿐이다. */
export type SessionStatus = "planned" | "delivered" | "cancelled";

export const SESSION_STATUS_CHOICES: SessionStatus[] = ["planned", "delivered", "cancelled"];

export const SESSION_STATUS_LABEL: Record<string, string> = {
  planned: "교육 예정",
  contracted: "계약 완료",
  delivered: "교육 완료",
  cancelled: "교육 취소",
};

/** 배지 색은 회사 단계와 같은 계열을 쓴다 — 같은 뜻이 자리마다 다른 색이면 다시 배워야 한다. */
export const SESSION_STATUS_TONE: Record<string, string> = {
  planned: "neutral",
  contracted: "progress",
  delivered: "done",
  cancelled: "stopped",
};

/**
 * '로' / '으로' 를 가른다. 받침이 없거나 ㄹ 받침이면 '로'다 — '교육 완료로', '교육 취소로',
 * '교육 예정으로'. 문구에 (으)로 를 박아 넣지 않으려면 이 계산이 필요하다.
 */
export function withRo(word: string) {
  const last = word.trim().slice(-1);
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return `${word}로`;
  const jong = (code - 0xac00) % 28;
  return jong === 0 || jong === 8 ? `${word}로` : `${word}으로`;
}

// ─── 카드에 쓰는 계산 ────────────────────────────────────────────────────────

export type CompanyProgress = {
  questionCount: number;
  consultationCount: number;
  sessionCount: number;
  assignedCount: number;
  /** 이미 날짜가 지난 교육. 교육 완료는 사람이 눌러야 바뀌므로 알려 줄 데가 필요하다. */
  pastSessionCount?: number;
};

/**
 * 목록 카드에 쓸 '다음에 할 일'. 상태가 아니라 남은 일을 보여 주려는 것이다 — 세 회사가
 * 모두 '조사 완료'면 배지는 아무것도 구분해 주지 못하는 반면, '상담 기록 필요'와
 * '강사 배정 필요'는 오늘 무엇을 열어야 하는지를 바로 답한다.
 *
 * 문구는 화면 탭 이름(니즈 질문지·상담 기록·교육 진행)을 그대로 쓴다. 카드에서 읽은 말과
 * 눌러서 들어간 화면의 말이 다르면 같은 일인지 알 수 없다.
 */
export function nextAction(stored: unknown, progress: CompanyProgress): string {
  const stage = resolveStage(stored, progress.sessionCount, progress.assignedCount);
  if (stage === "cancelled") return "교육 취소됨";
  if (stage === "training_complete") return "교육 완료";
  if (progress.sessionCount === 0) {
    if (progress.questionCount === 0) return "니즈 질문지 필요";
    if (progress.consultationCount === 0) return "상담 기록 필요";
    return "교육과정 등록 필요";
  }
  if (progress.assignedCount < progress.sessionCount) return "강사 배정 필요";
  // 여기까지 왔는데 다가오는 교육이 없다는 뜻이다 — 카드는 예정일이 있으면 날짜를 대신 쓴다.
  if (progress.pastSessionCount) return "교육 완료 처리 필요";
  return "교육일 미정";
}

/**
 * 마지막 손댄 뒤로 며칠이 지났는지. 24시간 단위로 내림한다 — 달력 경계로 세는 것보다
 * 하루 적게 나올 수 있지만, 경고는 넘치는 것보다 모자란 편이 낫다.
 */
export function daysSince(value: unknown, now = new Date()): number | null {
  if (typeof value !== "string" || !value) return null;
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return null;
  const day = 24 * 60 * 60 * 1000;
  const diff = Math.floor((now.getTime() - then.getTime()) / day);
  return diff < 0 ? 0 : diff;
}

/** 이만큼 조용하면 잊힌 것으로 본다. 2주는 상담 한 번 잡고도 남는 기간이다. */
export const STALE_AFTER_DAYS = 14;

/**
 * 예정된 교육일을 'M/D (D-n)' 로. 날짜만 있는 컬럼(date)이라 시간대에 흔들리지 않도록
 * 문자열을 직접 가른다 — `new Date("2026-08-28")` 는 UTC 자정으로 읽혀 한국에서는 하루가
 * 밀린다.
 */
export function heldOnLabel(value: unknown, now = new Date()): string {
  if (typeof value !== "string") return "";
  const parts = value.slice(0, 10).split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return "";
  const [year, month, day] = parts;
  const target = Date.UTC(year, month - 1, day);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((target - today) / (24 * 60 * 60 * 1000));
  const date = `${month}/${day}`;
  if (diff === 0) return `${date} (오늘)`;
  if (diff > 0) return `${date} (D-${diff})`;
  return `${date} (${-diff}일 지남)`;
}
