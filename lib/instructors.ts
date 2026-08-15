export const INSTRUCTOR_DOCUMENTS_BUCKET = "instructor-documents";

/** Supabase 요금제의 전역 상한. 버킷 값을 이보다 올리면 413 으로 거부된다. */
export const MAX_INSTRUCTOR_DOCUMENT_SIZE = 50 * 1024 * 1024;

/**
 * 원본은 보관하고 파싱은 PDF 로만 한다. Gemini 는 PDF 를 그대로 읽지만 한글·워드·파워포인트는
 * 읽지 못하고, 서버에서 변환하는 것은 지금 규모에 맞지 않는 복잡도다. PDF 만 남기면 편집이
 * 불가능해 교육 콘텐츠 자산이 되지 못하므로 원본도 함께 받는다 — docs/instructor-asset-loop.md 6절.
 */
const PARSABLE_EXTENSIONS = new Set(["pdf"]);

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  hwp: "application/x-hwp",
  hwpx: "application/vnd.hancom.hwpx",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export const INSTRUCTOR_DOCUMENT_ACCEPT = Object.keys(MIME_BY_EXTENSION)
  .map((extension) => `.${extension}`)
  .join(",");

export const INSTRUCTOR_FORMAT_LABEL = "PDF, HWP, HWPX, DOC, DOCX, PPT, PPTX";

export type InstructorDocumentKind = "profile" | "outline" | "materials" | "signed_contract";

export const DOCUMENT_KIND_LABEL: Record<InstructorDocumentKind, string> = {
  profile: "강사 프로필",
  outline: "강의 구성 아웃라인",
  materials: "강의 자료",
  signed_contract: "서명 계약서",
};

/**
 * 브라우저가 한글·파워포인트 파일을 application/octet-stream 으로 올리는 경우가 흔해
 * MIME 은 신뢰하지 않고 확장자로 판정한다. 버킷도 같은 이유로 octet-stream 을 허용한다.
 */
export function resolveInstructorDocument(fileName: string) {
  const extension = fileName.toLowerCase().split(".").pop() || "";
  const mimeType = MIME_BY_EXTENSION[extension];
  if (!mimeType) return null;
  return { extension, mimeType, parsable: PARSABLE_EXTENSIONS.has(extension) };
}

/** 파싱은 못 하지만 보관은 하는 형식에 띄울 안내. 형식 오류로 끝내지 않는다. */
export const NON_PARSABLE_NOTICE =
  "원본은 보관되지만 자동 추출은 PDF 만 가능합니다. 한글·파워포인트에서 'PDF로 저장' 후 다시 올려 주세요.";

// ─── 프로필 ──────────────────────────────────────────────────────────────────

/**
 * 추출 화이트리스트. 강사 제출 프로필은 사실상 이력서라 주민등록번호·계좌번호·상세주소·
 * 가족관계·사진이 함께 들어 있는 경우가 흔하다. 모델이 뽑아내더라도 이 형태로 좁히면서
 * 버려진다 — docs/instructor-asset-loop.md 5절.
 */
export type InstructorExpertise = {
  industries: string[];
  topics: string[];
  tools: string[];
  audienceLevels: string[];
};

export type InstructorProfile = {
  name: string;
  affiliation: string;
  jobTitle: string;
  email: string;
  phone: string;
  expertise: InstructorExpertise;
  career: Array<{ period: string; organization: string; role: string }>;
  education: Array<{ period: string; school: string; major: string; degree: string }>;
  teachingHistory: Array<{ year: string; client: string; subject: string }>;
  certifications: string[];
  preferredStyle: string;
  notes: string;
};

export const EMPTY_PROFILE: InstructorProfile = {
  name: "",
  affiliation: "",
  jobTitle: "",
  email: "",
  phone: "",
  expertise: { industries: [], topics: [], tools: [], audienceLevels: [] },
  career: [],
  education: [],
  teachingHistory: [],
  certifications: [],
  preferredStyle: "",
  notes: "",
};

function text(value: unknown, limit = 400) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
}

function strings(value: unknown, limit = 40) {
  return Array.isArray(value)
    ? value.map((item) => text(item, 200)).filter(Boolean).slice(0, limit)
    : [];
}

function rows<T extends Record<string, string>>(value: unknown, keys: Array<keyof T>, limit = 30) {
  if (!Array.isArray(value)) return [] as T[];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => Object.fromEntries(keys.map((key) => [key, text(item[key as string], 300)])) as T)
    .filter((item) => Object.values(item).some(Boolean))
    .slice(0, limit);
}

/** 모델 응답과 사용자 편집 양쪽에서 쓰는 단일 관문. 스키마 밖 필드는 여기서 사라진다. */
export function sanitizeProfile(input: unknown): InstructorProfile {
  const value = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const expertise = (value.expertise && typeof value.expertise === "object" ? value.expertise : {}) as Record<string, unknown>;
  return {
    name: text(value.name, 80),
    affiliation: text(value.affiliation, 120),
    jobTitle: text(value.jobTitle, 80),
    email: text(value.email, 160),
    phone: text(value.phone, 40),
    expertise: {
      industries: strings(expertise.industries),
      topics: strings(expertise.topics),
      tools: strings(expertise.tools),
      audienceLevels: strings(expertise.audienceLevels),
    },
    career: rows(value.career, ["period", "organization", "role"]),
    education: rows(value.education, ["period", "school", "major", "degree"]),
    teachingHistory: rows(value.teachingHistory, ["year", "client", "subject"]),
    certifications: strings(value.certifications),
    preferredStyle: text(value.preferredStyle, 300),
    notes: text(value.notes, 1000),
  };
}

// ─── 강의 실적 ────────────────────────────────────────────────────────────────

export type CourseOutline = {
  objective: string;
  modules: Array<{ title: string; minutes: number; mode: string; tools: string[]; outcome: string }>;
  prerequisites: string[];
  deliverables: string[];
};

/**
 * caseExamples 의 tailored 여부가 이 구조의 핵심이다. 기업 맞춤 교육의 불만은 대부분
 * "결국 우리 얘기가 아니었다"로 오는데, 일반 사례만으로 채워진 자료는 만족도가 나오기 전에
 * 이미 위험 신호다 — 강의 전에 잡을 수 있는 몇 안 되는 지표.
 */
export type CourseMaterials = {
  toolsUsed: string[];
  practiceTasks: string[];
  caseExamples: Array<{ title: string; tailored: boolean }>;
  practiceRatio: number;
  slideCount: number;
};

export const COURSE_MODES = ["강의", "실습", "토의", "데모"] as const;

export function sanitizeOutline(input: unknown): CourseOutline {
  const value = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const modules = Array.isArray(value.modules) ? value.modules : [];
  return {
    objective: text(value.objective, 600),
    modules: modules
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => ({
        title: text(item.title, 200),
        minutes: Math.max(0, Math.min(600, Math.round(Number(item.minutes) || 0))),
        mode: (COURSE_MODES as readonly string[]).includes(text(item.mode, 10)) ? text(item.mode, 10) : "강의",
        tools: strings(item.tools, 12),
        outcome: text(item.outcome, 300),
      }))
      .filter((item) => item.title)
      .slice(0, 40),
    prerequisites: strings(value.prerequisites, 20),
    deliverables: strings(value.deliverables, 20),
  };
}

export function sanitizeMaterials(input: unknown): CourseMaterials {
  const value = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const cases = Array.isArray(value.caseExamples) ? value.caseExamples : [];
  return {
    toolsUsed: strings(value.toolsUsed, 30),
    practiceTasks: strings(value.practiceTasks, 30),
    caseExamples: cases
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => ({ title: text(item.title, 200), tailored: Boolean(item.tailored) }))
      .filter((item) => item.title)
      .slice(0, 30),
    practiceRatio: Math.max(0, Math.min(100, Math.round(Number(value.practiceRatio) || 0))),
    slideCount: Math.max(0, Math.min(2000, Math.round(Number(value.slideCount) || 0))),
  };
}

/** 맞춤 사례 비율. 0건이면 null 이라 "0%"와 "자료 없음"이 구분된다. */
export function tailoredCaseRatio(materials: CourseMaterials | null | undefined) {
  const cases = materials?.caseExamples || [];
  if (!cases.length) return null;
  return Math.round((cases.filter((item) => item.tailored).length / cases.length) * 100);
}

// ─── 계약 ────────────────────────────────────────────────────────────────────

export type ContractStatus =
  | "draft" | "ready" | "sent" | "viewed" | "signed" | "rejected" | "expired" | "withdrawn";

export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  draft: "작성 중",
  ready: "검토 완료",
  sent: "발송됨",
  viewed: "열람",
  signed: "서명 완료",
  rejected: "반려",
  expired: "만료",
  withdrawn: "철회",
};

export type ContractTerms = {
  fee: number;
  feeNote: string;
  paymentTerms: string;
  specialTerms: string[];
  /** 계약서 저작권 조항에서 합의한 결과. instructors 의 같은 이름 필드로 옮겨 적는다. */
  reuseAggregate: boolean;
  reuseShareOriginal: boolean;
};

export const DEFAULT_CONTRACT_TERMS: ContractTerms = {
  fee: 0,
  feeNote: "",
  paymentTerms: "강의 종료 후 산학협력단 지급 절차에 따라 지급",
  specialTerms: [],
  reuseAggregate: true,
  reuseShareOriginal: false,
};

export function sanitizeTerms(input: unknown): ContractTerms {
  const value = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    fee: Math.max(0, Math.min(100_000_000, Math.round(Number(value.fee) || 0))),
    feeNote: text(value.feeNote, 200),
    paymentTerms: text(value.paymentTerms, 400) || DEFAULT_CONTRACT_TERMS.paymentTerms,
    specialTerms: strings(value.specialTerms, 20),
    reuseAggregate: value.reuseAggregate !== false,
    reuseShareOriginal: Boolean(value.reuseShareOriginal),
  };
}

export type InstructorRecord = {
  id: string;
  name: string;
  affiliation: string;
  job_title: string;
  email: string;
  phone: string;
  expertise: InstructorExpertise;
  career: InstructorProfile["career"];
  education: InstructorProfile["education"];
  teaching_history: InstructorProfile["teachingHistory"];
  certifications: string[];
  preferred_style: string;
  notes: string;
  reuse_aggregate: boolean;
  reuse_share_original: boolean;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
};

/** DB 행 ↔ 화면 양식. 스네이크·카멜 변환을 한 곳에 모은다. */
export function profileFromRecord(record: InstructorRecord): InstructorProfile {
  return sanitizeProfile({
    name: record.name,
    affiliation: record.affiliation,
    jobTitle: record.job_title,
    email: record.email,
    phone: record.phone,
    expertise: record.expertise,
    career: record.career,
    education: record.education,
    teachingHistory: record.teaching_history,
    certifications: record.certifications,
    preferredStyle: record.preferred_style,
    notes: record.notes,
  });
}

export function recordFromProfile(profile: InstructorProfile) {
  return {
    name: profile.name,
    affiliation: profile.affiliation,
    job_title: profile.jobTitle,
    email: profile.email,
    phone: profile.phone,
    expertise: profile.expertise,
    career: profile.career,
    education: profile.education,
    teaching_history: profile.teachingHistory,
    certifications: profile.certifications,
    preferred_style: profile.preferredStyle,
    notes: profile.notes,
  };
}
