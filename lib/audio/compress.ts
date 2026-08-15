/**
 * Shrinks a consultation recording in the browser before it is uploaded.
 *
 * Two facts drive the design. Supabase caps uploads at 50MB for this project, and Gemini downsamples
 * every audio input to 16 Kbps mono regardless of what it receives. So a high-bitrate stereo recording
 * costs storage and upload time while buying no transcription accuracy at all. Converting to 16 kHz
 * mono MP3 turns roughly an hour of conversation into about 14MB with nothing lost that Gemini would
 * have used.
 *
 * The browser's own decoder does the format handling and the resampling: `decodeAudioData` resamples
 * to the sample rate of the context it is called on (verified in-browser: 44.1 kHz stereo WAV decodes
 * to 16 kHz preserving duration), so no wasm codec bundle is needed. Encoding runs in a worker
 * because hidden tabs clamp timers hard enough to stall a cooperative loop for minutes.
 */
import type { EncodeRequest, EncodeResponse } from "./mp3-encoder.worker";

export const COMPRESSED_MIME_TYPE = "audio/mpeg";
export const COMPRESSED_EXTENSION = "mp3";

const TARGET_SAMPLE_RATE = 16_000;
const TARGET_BITRATE_KBPS = 32;

export class AudioCompressionError extends Error {}

/**
 * Reading duration from a media element costs nothing and tells the operator up front whether a
 * recording is usable, instead of failing minutes into processing. Returns 0 when the browser cannot
 * read the file's metadata.
 */
export function readAudioDuration(file: File) {
  return new Promise<number>((resolve) => {
    const element = document.createElement("audio");
    const url = URL.createObjectURL(file);
    const finish = (value: number) => { URL.revokeObjectURL(url); resolve(value); };
    element.preload = "metadata";
    element.onloadedmetadata = () => finish(Number.isFinite(element.duration) ? element.duration : 0);
    element.onerror = () => finish(0);
    element.src = url;
  });
}

export type CompressionResult = {
  blob: Blob;
  fileName: string;
  durationSeconds: number;
  originalSize: number;
};

/**
 * Always convert these, whatever their size. Lossless sources are the ones that blow past the cap,
 * and a video container handed to Gemini as video is billed at 258 tokens per second instead of the
 * 32 it charges for audio — an eight-fold cost for a picture nobody looks at.
 */
const ALWAYS_CONVERT_EXTENSIONS = new Set(["wav", "flac", "mp4"]);

export function needsCompression(file: File, uploadLimitBytes: number) {
  const extension = file.name.toLowerCase().split(".").pop() || "";
  return ALWAYS_CONVERT_EXTENSIONS.has(extension) || file.size > uploadLimitBytes * 0.8;
}

export function compressedFileName(originalName: string) {
  return `${originalName.replace(/\.[^.]+$/, "") || "consultation"}.${COMPRESSED_EXTENSION}`;
}

/** Gemini folds multi-channel audio into one channel anyway, so the downmix costs nothing in accuracy. */
function toMonoSamples(decoded: AudioBuffer) {
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index));
  const samples = new Int16Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    let sum = 0;
    for (const channel of channels) sum += channel[index];
    const sample = Math.max(-1, Math.min(1, sum / channels.length));
    samples[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return samples;
}

function encodeInWorker(samples: Int16Array, sampleRate: number, onProgress?: (ratio: number) => void) {
  return new Promise<Uint8Array>((resolve, reject) => {
    const worker = new Worker(new URL("./mp3-encoder.worker.ts", import.meta.url));
    worker.onmessage = (event: MessageEvent<EncodeResponse>) => {
      const message = event.data;
      if (message.type === "progress") { onProgress?.(message.ratio); return; }
      worker.terminate();
      if (message.type === "done") resolve(message.bytes);
      else reject(new AudioCompressionError("녹취파일을 변환하지 못했습니다."));
    };
    worker.onerror = () => { worker.terminate(); reject(new AudioCompressionError("녹취파일을 변환하지 못했습니다.")); };
    worker.postMessage({ samples, sampleRate, bitrateKbps: TARGET_BITRATE_KBPS } satisfies EncodeRequest, [samples.buffer]);
  });
}

export async function compressConsultationAudio(
  file: File,
  onProgress?: (ratio: number) => void,
): Promise<CompressionResult> {
  if (typeof window === "undefined" || !window.OfflineAudioContext) {
    throw new AudioCompressionError("이 브라우저에서는 녹취파일을 변환할 수 없습니다.");
  }

  let decoded: AudioBuffer;
  try {
    const context = new OfflineAudioContext(1, 1, TARGET_SAMPLE_RATE);
    decoded = await context.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new AudioCompressionError("녹취파일을 읽지 못했습니다. 다른 형식으로 저장한 뒤 다시 올려 주세요.");
  }

  const sampleRate = decoded.sampleRate;
  const seconds = decoded.duration;
  const samples = toMonoSamples(decoded);
  const bytes = await encodeInWorker(samples, sampleRate, onProgress);
  onProgress?.(1);

  return {
    blob: new Blob([bytes as BlobPart], { type: COMPRESSED_MIME_TYPE }),
    fileName: compressedFileName(file.name),
    durationSeconds: seconds,
    originalSize: file.size,
  };
}
