import { AIRole, getModelForRole } from "./models";

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
  timeoutMs?: number;
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

export async function generateWithGemini({
  role,
  prompt,
  media = [],
  responseSchema,
  temperature = 0.2,
  maxOutputTokens,
  timeoutMs = 60_000,
}: GenerateOptions): Promise<GeminiResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

  const model = getModelForRole(role);
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
  const retryDelays = [2_000, 5_000, 10_000];

  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: requestBody,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (response.ok) {
      const data = await response.json();
      const text = (data.candidates?.[0]?.content?.parts || [])
        .map((part: { text?: string }) => part.text || "")
        .join("");
      if (!text) throw new Error("분석 결과가 비어 있습니다. 다시 시도해 주세요.");
      return { model, text, usage: data.usageMetadata };
    }

    const retryable = response.status === 429 || response.status === 503;
    if (retryable && attempt < retryDelays.length) {
      await response.body?.cancel().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt]));
      continue;
    }

    const error = await response.text();
    if (retryable) throw new Error("현재 녹취 처리 요청이 많습니다. 잠시 후 다시 시도해 주세요.");
    throw new Error(`분석 요청 실패 (${response.status}): ${error.slice(0, 180)}`);
  }

  throw new Error("분석 요청을 완료하지 못했습니다.");
}
