export type LearnerStatus = "registered" | "attended" | "absent" | "cancelled";

export const LEARNER_STATUS_LABEL: Record<LearnerStatus, string> = {
  registered: "신청",
  attended: "참석",
  absent: "불참",
  cancelled: "취소",
};

/**
 * 명단에서 받아들이는 항목. 강사 프로필과 같은 화이트리스트 방식이다 — 제출받은 명단에는
 * 생년월일·사번·연락처가 함께 실려 오는 일이 흔하고, 모델이 뽑아내도 여기서 사라진다.
 */
export type LearnerInput = {
  name: string;
  department: string;
  jobTitle: string;
  email: string;
  notes: string;
};

function text(value: unknown, limit = 200) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
}

/** 이메일 형태가 아니면 버린다. 중복 판정의 기준이라 쓰레기 값이 들어가면 사람이 갈라진다. */
function email(value: unknown) {
  const cleaned = text(value, 160).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned) ? cleaned : "";
}

export function sanitizeLearner(input: unknown): LearnerInput {
  const value = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    name: text(value.name, 80),
    department: text(value.department, 120),
    jobTitle: text(value.jobTitle, 80),
    email: email(value.email),
    notes: text(value.notes, 300),
  };
}

export function sanitizeLearners(input: unknown): LearnerInput[] {
  if (!Array.isArray(input)) return [];
  return input.map(sanitizeLearner).filter((learner) => learner.name).slice(0, 500);
}

export type LearnerRecord = {
  id: string;
  company_id: string;
  name: string;
  department: string;
  job_title: string;
  email: string;
  notes: string;
  created_at: string;
};

export function recordFromLearner(companyId: string, learner: LearnerInput) {
  return {
    company_id: companyId,
    name: learner.name,
    department: learner.department,
    job_title: learner.jobTitle,
    email: learner.email,
    notes: learner.notes,
  };
}
