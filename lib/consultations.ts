export const CONSULTATION_AUDIO_BUCKET = "consultation-audio";
/**
 * What may be stored. This is the Supabase project's global ceiling on the current plan, not a number
 * we chose: raising the bucket's own limit above it is rejected with 413, so the browser compresses
 * anything larger before upload (see lib/audio/compress.ts).
 */
export const MAX_CONSULTATION_AUDIO_SIZE = 50 * 1024 * 1024;
/**
 * What may be handed to the browser compressor. Decoding holds the whole recording in memory as
 * 16 kHz samples, so this keeps a tab from being killed instead of showing an error.
 */
export const MAX_CONSULTATION_SOURCE_SIZE = 300 * 1024 * 1024;

/**
 * How long a recording may run. The binding constraint is not storage but the transcription route
 * finishing inside `maxDuration` (800s on Vercel Pro, budgeted to 780s).
 *
 * Measured on a real 58-minute recording: 221s of transcription API time, 3.8s per minute of audio,
 * producing a complete 18,855-token transcript. At that rate 90 minutes needs roughly 340s, and with
 * upload, 503 backoff, and analysis it still lands near 470s — comfortably inside the budget, and far
 * enough below the 65,536 output-token cap. Past this, browser memory during conversion becomes the
 * next wall (about 440MB per hour of audio), so lifting it further means chunking (see TODO.md).
 */
export const MAX_CONSULTATION_MINUTES = 90;
export const MAX_CONSULTATION_SECONDS = MAX_CONSULTATION_MINUTES * 60;

/**
 * Every entry here must survive the whole chain: the file picker, the Supabase bucket's allowed MIME
 * list, and — for anything that gets converted — `decodeAudioData`. AIFF is deliberately absent: the
 * bucket does not allow `audio/aiff` and Chromium reports `canPlayType("audio/aiff") === "no"`, so it
 * could be picked but never uploaded.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  flac: "audio/flac",
  mp4: "video/mp4",
};

/** What the upload screen tells the operator, kept next to the list it describes. */
export const CONSULTATION_FORMAT_LABEL = "MP3, M4A, WAV, AAC, OGG, FLAC, MP4";

export const CONSULTATION_AUDIO_ACCEPT = Object.keys(MIME_BY_EXTENSION)
  .map((extension) => `.${extension}`)
  .join(",");

// ─── 녹취가 아닌 상담 기록 ────────────────────────────────────────────────────
//
// 현장에서 늘 녹음할 수 있는 것은 아니다 — 고객사가 꺼리기도 하고, 서서 나눈 짧은 이야기도
// 있다. 그때 담당자는 수첩에 적는다. 그래서 상담 기록에 길이 셋이다.
export type ConsultationSource = "audio" | "text" | "memo";

export const CONSULTATION_NOTES_BUCKET = "consultation-notes";
/** 손글씨 사진 몇 장이면 충분하다. 버킷 설정과 같은 값을 쓴다. */
export const MAX_CONSULTATION_NOTE_SIZE = 20 * 1024 * 1024;
/** 직접 입력 상한. 90분 녹취 전문이 3만 자 안팎이라 그보다 넉넉하다. */
export const MAX_CONSULTATION_NOTE_LENGTH = 50_000;
/**
 * 분석이 쓸 것이 있어야 한다. 한 줄짜리 메모로는 니즈도 제약도 나오지 않고, 모델은 그
 * 빈자리를 지어내서 채운다 — 그럴 바에는 받지 않는 편이 낫다.
 */
export const MIN_CONSULTATION_NOTE_LENGTH = 30;

/**
 * 메모로 받을 수 있는 것. 손으로 적은 사진과 PDF 가 대부분이다.
 * 한글(.hwp)과 워드(.docx)는 모델이 직접 읽지 못해 뺐다 — 고를 수는 있는데 올리면 실패하는
 * 것이 가장 나쁜 경우라, 애초에 고를 수 없게 한다.
 */
const NOTE_MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
  txt: "text/plain",
};

export const CONSULTATION_NOTE_FORMAT_LABEL = "사진(JPG, PNG, HEIC), PDF, TXT";

export const CONSULTATION_NOTE_ACCEPT = Object.keys(NOTE_MIME_BY_EXTENSION)
  .map((extension) => `.${extension}`)
  .join(",");

export function resolveConsultationNote(fileName: string, suppliedMimeType?: string) {
  const extension = fileName.toLowerCase().split(".").pop() || "";
  const mimeType = NOTE_MIME_BY_EXTENSION[extension];
  if (!mimeType) return null;
  // 브라우저가 붙인 형식이 확장자와 어긋나면 믿지 않는다. HEIC 는 형식을 비워 보내는 기기가 있어 통과시킨다.
  if (suppliedMimeType && suppliedMimeType !== mimeType
    && !(extension === "heic" || extension === "heif")
    && !(extension === "jpg" && suppliedMimeType === "image/jpeg")) return null;
  return { extension, mimeType };
}

/**
 * 상담 기록을 읽어 올 때 쓰는 칸 목록. 라우트마다 따로 적으면 칸을 하나 더할 때 한 곳을
 * 빠뜨리고, 그러면 화면에서만 값이 비어 보인다 — 원인을 찾기 어려운 종류의 버그다.
 */
export const CONSULTATION_COLUMNS =
  "id,company_id,file_name,storage_path,mime_type,file_size,source,note,status,transcript,summary,error_message,created_at,updated_at";

/** 화면에 무엇으로 들어온 기록인지 알린다. 녹취만 있던 시절의 기록은 source 가 audio 다. */
export const CONSULTATION_SOURCE_LABEL: Record<ConsultationSource, string> = {
  audio: "녹취",
  text: "직접 입력",
  memo: "메모",
};

export function resolveConsultationAudio(fileName: string, suppliedMimeType?: string) {
  const extension = fileName.toLowerCase().split(".").pop() || "";
  const mimeType = MIME_BY_EXTENSION[extension];
  if (!mimeType) return null;
  if (suppliedMimeType && !suppliedMimeType.startsWith("audio/") && suppliedMimeType !== "video/mp4") return null;
  return { extension, mimeType };
}

export type TranscriptSegment = {
  speaker: string;
  timestamp: string;
  text: string;
};

export type ConsultationTranscript = {
  language: string;
  segments: TranscriptSegment[];
};

export type ConsultationSummary = {
  overview: string;
  keyNeeds: Array<{ title: string; detail: string }>;
  audience: { headline: string; detail: string };
  constraints: string[];
  decisions: string[];
  instructorNotes: string[];
  followUpQuestions: string[];
};

/**
 * What a single consultation cannot answer: how the picture changed between sessions, and where two
 * sessions disagree. Those two fields are the reason a combined briefing beats reading each summary.
 */
export type ConsultationBriefing = {
  overview: string;
  sessions: Array<{ label: string; gist: string }>;
  keyNeeds: Array<{ title: string; detail: string }>;
  audience: { headline: string; detail: string };
  constraints: string[];
  decisions: string[];
  changes: string[];
  openQuestions: string[];
  sourceIds: string[];
  generatedAt: string;
};

export function isBriefingStale(briefing: ConsultationBriefing | null | undefined, completedIds: string[]) {
  if (!briefing?.sourceIds?.length) return completedIds.length > 0;
  const covered = new Set(briefing.sourceIds);
  return completedIds.length !== briefing.sourceIds.length || completedIds.some((id) => !covered.has(id));
}

export type ConsultationRecord = {
  id: string;
  company_id: string;
  file_name: string;
  /** 파일이 있을 때만 채워진다. 직접 입력한 기록에는 없다. */
  storage_path: string | null;
  mime_type: string | null;
  file_size: number | null;
  source: ConsultationSource;
  /** 직접 입력한 글, 또는 메모에서 읽어 낸 글. 녹취면 비어 있고 transcript 를 본다. */
  note: string;
  status: "uploaded" | "processing" | "completed" | "failed";
  transcript: ConsultationTranscript;
  summary: ConsultationSummary;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
  audio_url?: string;
};
