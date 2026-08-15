import { AIRole, getFallbackModelForRole, getModelForRole } from "./models";

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { mimeType: string; fileUri: string } };

type GenerateOptions = {
  role: AIRole;
  prompt: string;
  media?: GeminiPart[];
  responseSchema?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
  /** Cap for a single attempt. */
  timeoutMs?: number;
  /** Cap for all attempts and retry waits combined, so retries cannot outlive the caller's route budget. */
  budgetMs?: number;
  /**
   * Total time that may be spent waiting between retries. Raise it for calls with a generous route
   * budget: a 503 costs no tokens and fails in seconds, so giving up early wastes budget that could
   * have ridden out the spike.
   */
  maxRetryWaitMs?: number;
};

export type GeminiResult = {
  model: string;
  text: string;
  usage?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
};

/** Distinguishes "this model has no capacity right now" from a request we got wrong. */
class ModelOverloadedError extends Error {}

const RETRY_BASE_MS = 5_000;
const RETRY_MAX_DELAY_MS = 60_000;
const MAX_ATTEMPTS = 8;
const MIN_ATTEMPT_MS = 5_000;
/**
 * How much of the retry allowance the primary model gets before we try the fallback. Overload tends
 * to be sustained rather than momentary, so waiting the whole allowance on one model is worse than
 * switching: in the measured case the primary was still refusing after seven attempts across 268s
 * while another model accepted the same request immediately.
 */
const PRIMARY_RETRY_SHARE = 0.35;

/** Pulls the human-readable reason out of a Gemini error body, falling back to the raw text. */
function apiReason(body: string) {
  try {
    const parsed = JSON.parse(body) as { error?: { status?: string; message?: string } };
    if (parsed.error) return `${parsed.error.status || ""} ${parsed.error.message || ""}`.trim();
  } catch { /* Non-JSON bodies are returned as-is below. */ }
  return body.slice(0, 300) || "(본문 없음)";
}

async function callModel(options: {
  role: AIRole;
  model: string;
  apiKey: string;
  requestBody: string;
  timeoutMs: number;
  maxRetryWaitMs: number;
  remainingMs: () => number;
}): Promise<GeminiResult> {
  const { role, model, apiKey, requestBody, timeoutMs, maxRetryWaitMs, remainingMs } = options;
  let waitedMs = 0;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const attemptTimeout = Math.min(timeoutMs, remainingMs());
    if (attemptTimeout < MIN_ATTEMPT_MS) throw new Error("분석 시간이 부족합니다. 잠시 후 다시 시도해 주세요.");

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: requestBody,
      signal: AbortSignal.timeout(attemptTimeout),
    });

    if (response.ok) {
      const data = await response.json();
      const text = (data.candidates?.[0]?.content?.parts || [])
        .map((part: { text?: string }) => part.text || "")
        .join("");
      if (!text) throw new Error("분석 결과가 비어 있습니다. 다시 시도해 주세요.");
      return { model, text, usage: data.usageMetadata };
    }

    // Read the body on every failure, including ones we retry: 429 and 503 need different answers
    // from the operator, and throwing one message for both hides which it was.
    const detail = await response.text().catch(() => "");
    const reason = apiReason(detail);
    console.error(`[gemini] ${role} ${model} HTTP ${response.status} attempt ${attempt + 1}/${MAX_ATTEMPTS}: ${reason}`);

    const retryable = response.status === 429 || response.status === 503;
    const retryDelay = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_MS * 2 ** attempt);
    if (
      retryable
      && attempt < MAX_ATTEMPTS - 1
      && waitedMs + retryDelay <= maxRetryWaitMs
      && remainingMs() > retryDelay + MIN_ATTEMPT_MS
    ) {
      waitedMs += retryDelay;
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
      continue;
    }

    if (retryable) throw new ModelOverloadedError(String(response.status));
    throw new Error(`분석 요청 실패 (${response.status}): ${reason.slice(0, 180)}`);
  }

  throw new ModelOverloadedError("재시도 소진");
}

export async function generateWithGemini({
  role,
  prompt,
  media = [],
  responseSchema,
  temperature = 0.2,
  maxOutputTokens,
  timeoutMs = 60_000,
  budgetMs,
  maxRetryWaitMs = 50_000,
}: GenerateOptions): Promise<GeminiResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

  const requestBody = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }, ...media] }],
    generationConfig: {
      temperature,
      ...(maxOutputTokens ? { maxOutputTokens } : {}),
      ...(responseSchema
        ? { responseMimeType: "application/json", responseSchema }
        : {}),
    },
  });

  const startedAt = Date.now();
  const remainingMs = () => (budgetMs ? budgetMs - (Date.now() - startedAt) : Number.POSITIVE_INFINITY);

  const primary = getModelForRole(role);
  const fallback = getFallbackModelForRole(role);
  const primaryWait = fallback ? Math.round(maxRetryWaitMs * PRIMARY_RETRY_SHARE) : maxRetryWaitMs;

  try {
    return await callModel({ role, model: primary, apiKey, requestBody, timeoutMs, maxRetryWaitMs: primaryWait, remainingMs });
  } catch (error) {
    const overloaded = error instanceof ModelOverloadedError;
    if (!overloaded) throw error;
    if (!fallback || remainingMs() < MIN_ATTEMPT_MS) {
      throw new Error(
        error.message === "429"
          ? "AI 사용량 한도에 걸렸습니다 (429). 잠시 후 다시 시도해 주세요."
          : "AI 서버가 혼잡합니다 (503). 잠시 후 다시 시도해 주세요.",
      );
    }
    console.error(`[gemini] ${role} ${primary} 과부하 — ${fallback} 으로 전환`);
    try {
      return await callModel({
        role,
        model: fallback,
        apiKey,
        requestBody,
        timeoutMs,
        maxRetryWaitMs: maxRetryWaitMs - primaryWait,
        remainingMs,
      });
    } catch (fallbackError) {
      if (fallbackError instanceof ModelOverloadedError) {
        throw new Error("AI 서버가 혼잡합니다 (503). 잠시 후 다시 시도해 주세요.");
      }
      throw fallbackError;
    }
  }
}
