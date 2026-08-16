import { requireTeamSession } from "@/lib/auth/guard";
import { generateWithGemini } from "@/lib/ai/gemini";
import { sanitizeContact } from "@/lib/contacts";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CARD_BYTES = 8 * 1024 * 1024;

function detail(error: unknown) {
  return error instanceof Error ? error.message
    : (error && typeof error === "object" && "message" in error) ? String((error as { message: unknown }).message)
    : "";
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) return Response.json({ error: "기업 정보를 확인하지 못했습니다." }, { status: 400 });

    const contact = sanitizeContact(await request.json());
    const { data, error } = await createSupabaseAdmin()
      .from("company_research")
      .update({ contact, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id,contact")
      .single();
    if (error) throw error;
    return Response.json({ contact: data.contact });
  } catch (error) {
    return Response.json({ error: detail(error) || "담당자 정보를 저장하지 못했습니다." }, { status: 422 });
  }
}

const cardSchema = {
  type: "OBJECT",
  properties: {
    name: { type: "STRING" }, position: { type: "STRING" }, department: { type: "STRING" },
    email: { type: "STRING" }, phone: { type: "STRING" },
  },
  required: ["name", "position", "department", "email", "phone"],
};

/**
 * 명함 이미지에서 담당자 정보를 읽는다. 언어 우선순위와 +82 변환 규칙은 floweroneul 의
 * 명함 인식에서 가져왔다 — 국내 명함은 한글·영문이 나란히 적히고 번호가 국제 표기인 경우가 흔하다.
 */
const prompt = `이 명함 이미지에서 담당자 정보를 추출하세요.

언어 우선순위:
- 이름, 부서, 직함에 한글과 영문이 모두 있으면 한글을 넣으세요. 한글이 없을 때만 영문을 넣으세요.
- 이메일과 전화번호는 적힌 그대로 넣으세요.

전화번호:
- 휴대전화가 있으면 휴대전화를, 없으면 사무실 번호를 넣으세요.
- +82 로 시작하면 국내 표기로 바꾸세요 (+82.10.3606.6474 → 010-3606-6474).

없는 항목은 빈 문자열로 두고 지어내지 마세요. 회사명과 주소는 추출하지 마세요.`;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) return Response.json({ error: "기업 정보를 확인하지 못했습니다." }, { status: 400 });

    const body = await request.json() as { image?: string; mimeType?: string };
    const image = typeof body.image === "string" ? body.image : "";
    const mimeType = typeof body.mimeType === "string" ? body.mimeType : "";
    if (!image || !mimeType.startsWith("image/")) {
      return Response.json({ error: "명함 이미지를 확인하지 못했습니다." }, { status: 400 });
    }
    // base64 는 원본의 약 4/3 이라 대략만 걸러도 과대한 요청을 막을 수 있다.
    if (image.length * 0.75 > MAX_CARD_BYTES) {
      return Response.json({ error: "명함 이미지는 8MB까지 올릴 수 있습니다." }, { status: 400 });
    }

    const generated = await generateWithGemini({
      role: "documentExtraction",
      prompt,
      media: [{ inlineData: { mimeType, data: image } }],
      responseSchema: cardSchema,
      temperature: 0.05,
      maxOutputTokens: 2_048,
      timeoutMs: 45_000,
      budgetMs: 100_000,
      maxRetryWaitMs: 30_000,
    });

    const contact = sanitizeContact(JSON.parse(generated.text));
    if (!contact.name && !contact.email && !contact.phone) {
      return Response.json(
        { error: "명함에서 정보를 찾지 못했습니다. 더 선명한 사진으로 다시 시도해 주세요." },
        { status: 422 },
      );
    }
    // 저장하지 않고 돌려준다. 담당자가 확인·수정한 뒤 PATCH 로 저장한다.
    return Response.json({ contact });
  } catch (error) {
    return Response.json({ error: detail(error) || "명함을 읽지 못했습니다." }, { status: 422 });
  }
}
