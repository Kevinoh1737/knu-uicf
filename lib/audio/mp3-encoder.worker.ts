/**
 * Encodes 16 kHz mono samples to MP3 off the main thread.
 *
 * This has to be a worker rather than a chunked loop on the page. Browsers clamp `setTimeout` in a
 * hidden tab (measured here: over 1.5s per yield), so a cooperative loop that yields to keep the UI
 * painting would stall for minutes the moment the operator switches tabs — exactly what they will do
 * while an hour of audio is converting. A worker runs at full speed regardless of tab visibility.
 */
import { Mp3Encoder } from "@breezystack/lamejs";

/** MP3 frames hold 1152 samples. */
const BLOCK_SAMPLES = 1152;
const BLOCKS_PER_PROGRESS = 256;

export type EncodeRequest = { samples: Int16Array; sampleRate: number; bitrateKbps: number };
export type EncodeResponse =
  | { type: "progress"; ratio: number }
  | { type: "done"; bytes: Uint8Array }
  | { type: "error"; message: string };

/** `self` is typed as Window under the DOM lib; a worker exposes the postMessage-with-transfer form. */
const scope = self as unknown as Worker;

scope.onmessage = (event: MessageEvent<EncodeRequest>) => {
  const { samples, sampleRate, bitrateKbps } = event.data;
  try {
    const encoder = new Mp3Encoder(1, sampleRate, bitrateKbps);
    const parts: Uint8Array[] = [];
    const totalBlocks = Math.ceil(samples.length / BLOCK_SAMPLES) || 1;

    for (let blockIndex = 0; blockIndex < totalBlocks; blockIndex += 1) {
      const start = blockIndex * BLOCK_SAMPLES;
      const encoded = encoder.encodeBuffer(samples.subarray(start, Math.min(start + BLOCK_SAMPLES, samples.length)));
      if (encoded.length) parts.push(encoded);
      if (blockIndex % BLOCKS_PER_PROGRESS === 0) {
        scope.postMessage({ type: "progress", ratio: blockIndex / totalBlocks } satisfies EncodeResponse);
      }
    }

    const tail = encoder.flush();
    if (tail.length) parts.push(tail);

    const size = parts.reduce((total, part) => total + part.length, 0);
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    scope.postMessage({ type: "done", bytes } satisfies EncodeResponse, [bytes.buffer]);
  } catch (error) {
    scope.postMessage({ type: "error", message: error instanceof Error ? error.message : "인코딩 실패" } satisfies EncodeResponse);
  }
};
