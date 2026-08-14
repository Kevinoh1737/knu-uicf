import { NextRequest, NextResponse } from "next/server";
import { generateWithGemini } from "@/lib/ai/gemini";
import { AI_ROLE_CONFIG, GEMINI_MODELS } from "@/lib/ai/models";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    configured: Boolean(process.env.GEMINI_API_KEY),
    models: GEMINI_MODELS,
    roles: AI_ROLE_CONFIG,
  });
}

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const checks = [
    ["documentExtraction", "fast"],
    ["companyResearch", "balanced"],
    ["courseDesign", "deep"],
  ] as const;

  const results = [];
  for (const [role, tier] of checks) {
    const startedAt = Date.now();
    try {
      const result = await generateWithGemini({
        role,
        prompt: "연결 확인입니다. 반드시 KNU_UICF_OK 라고만 답하세요.",
        temperature: 0,
      });
      results.push({
        tier,
        role,
        model: result.model,
        ok: result.text.trim().includes("KNU_UICF_OK"),
        latencyMs: Date.now() - startedAt,
      });
    } catch (error) {
      results.push({
        tier,
        role,
        model: AI_ROLE_CONFIG[role].model,
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message.replace(process.env.GEMINI_API_KEY || "", "[REDACTED]") : "Unknown error",
      });
    }
  }

  return NextResponse.json({
    ok: results.every((result) => result.ok),
    checkedAt: new Date().toISOString(),
    results,
  });
}

