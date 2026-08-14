export const CONSULTATION_AUDIO_BUCKET = "consultation-audio";
export const MAX_CONSULTATION_AUDIO_SIZE = 50 * 1024 * 1024;

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
