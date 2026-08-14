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
}: GenerateOptions): Promise<GeminiResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

  const model = getModelForRole(role);
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }, ...media] }],
        generationConfig: {
          temperature,
          ...(responseSchema
            ? { responseMimeType: "application/json", responseSchema }
            : {}),
        },
      }),
      signal: AbortSignal.timeout(60_000),
    },
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini ${model} request failed (${response.status}): ${error.slice(0, 240)}`);
  }

  const data = await response.json();
  const text = (data.candidates?.[0]?.content?.parts || [])
    .map((part: { text?: string }) => part.text || "")
    .join("");

  if (!text) throw new Error(`Gemini ${model} returned an empty response`);

  return { model, text, usage: data.usageMetadata };
}

