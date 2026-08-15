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
  storage_path: string;
  mime_type: string;
  file_size: number;
  status: "uploaded" | "processing" | "completed" | "failed";
  transcript: ConsultationTranscript;
  summary: ConsultationSummary;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
  audio_url?: string;
};
