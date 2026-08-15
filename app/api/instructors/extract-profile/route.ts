import { requireTeamSession } from "@/lib/auth/guard";
import { generateWithGemini } from "@/lib/ai/gemini";
import { INSTRUCTOR_DOCUMENTS_BUCKET, sanitizeProfile } from "@/lib/instructors";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

const EXTRACT_CALL_MS = 120_000;
const EXTRACT_BUDGET_MS = 260_000;
const EXTRACT_RETRY_WAIT_MS = 60_000;

const profileSchema = {
  type: "OBJECT",
  properties: {
    name: { type: "STRING" },
    affiliation: { type: "STRING" },
    jobTitle: { type: "STRING" },
    email: { type: "STRING" },
    phone: { type: "STRING" },
    expertise: {
      type: "OBJECT",
      properties: {
        industries: { type: "ARRAY", items: { type: "STRING" } },
        topics: { type: "ARRAY", items: { type: "STRING" } },
        tools: { type: "ARRAY", items: { type: "STRING" } },
        audienceLevels: { type: "ARRAY", items: { type: "STRING" } },
      },
      required: ["industries", "topics", "tools", "audienceLevels"],
    },
    career: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { period: { type: "STRING" }, organization: { type: "STRING" }, role: { type: "STRING" } },
        required: ["period", "organization", "role"],
      },
    },
    education: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { period: { type: "STRING" }, school: { type: "STRING" }, major: { type: "STRING" }, degree: { type: "STRING" } },
        required: ["period", "school", "major", "degree"],
      },
    },
    teachingHistory: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { year: { type: "STRING" }, client: { type: "STRING" }, subject: { type: "STRING" } },
        required: ["year", "client", "subject"],
      },
    },
    certifications: { type: "ARRAY", items: { type: "STRING" } },
    preferredStyle: { type: "STRING" },
    notes: { type: "STRING" },
  },
  required: [
    "name", "affiliation", "jobTitle", "email", "phone", "expertise",
    "career", "education", "teachingHistory", "certifications", "preferredStyle", "notes",
  ],
};

/**
 * 강사 제출 프로필은 사실상 이력서다. 주민등록번호·계좌번호·주소·가족관계가 함께 들어 있는
 * 경우가 흔해 프롬프트에서 먼저 막고, 응답은 sanitizeProfile 이 다시 한 번 좁힌다.
 * 모델이 뽑아내더라도 저장되지 않아야 한다 — docs/instructor-asset-loop.md 5절.
 */
const prompt = `당신은 강원대학교 산학협력단 교육사업팀의 강사 관리 담당자입니다. 첨부한 강사 프로필 문서를 읽고 아래 양식에 맞게 정리하세요.

절대 추출하지 않을 항목:
- 주민등록번호, 외국인등록번호, 여권번호
- 계좌번호, 카드번호
- 집 주소 등 상세 주소
- 가족관계, 병역, 생년월일
문서에 있어도 위 항목은 어떤 필드에도 넣지 마세요.

작성 규칙:
1. 문서에 적힌 사실만 사용하세요. 없는 항목은 빈 문자열이나 빈 배열로 두고 추측하지 마세요.
2. expertise.industries 는 이 강사가 경험한 산업(제조, 공공, 의료 등), topics 는 강의 주제, tools 는 다룰 수 있는 AI·소프트웨어 도구, audienceLevels 는 가르쳐 본 대상(경영진, 관리자, 실무자, 현장직 등)입니다.
3. teachingHistory 는 문서에 적힌 외부 강의 이력입니다. 연도, 발주처, 과목을 나눠 적으세요.
4. email 과 phone 은 업무용 연락처만 넣으세요.
5. preferredStyle 은 문서에 강의 방식이나 선호가 적혀 있을 때만 채우세요.
6. notes 에는 위 항목에 들어가지 않지만 강사 배정에 참고가 될 내용만 짧게 적으세요.
7. 짧은 명사형 한국어로 쓰세요.`;

export async function POST(request: Request) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const body = await request.json() as { storagePath?: string };
    const storagePath = typeof body.storagePath === "string" ? body.storagePath : "";
    if (!storagePath.startsWith("profile/")) {
      return Response.json({ error: "프로필 파일을 확인하지 못했습니다." }, { status: 400 });
    }
    if (!storagePath.toLowerCase().endsWith(".pdf")) {
      return Response.json(
        { error: "자동 추출은 PDF 만 가능합니다. 한글·워드에서 'PDF로 저장' 후 다시 올려 주세요." },
        { status: 400 },
      );
    }

    const { data: file, error: downloadError } = await createSupabaseAdmin()
      .storage.from(INSTRUCTOR_DOCUMENTS_BUCKET)
      .download(storagePath);
    if (downloadError || !file) throw new Error(downloadError?.message || "프로필 파일을 불러오지 못했습니다.");

    const generated = await generateWithGemini({
      role: "documentExtraction",
      prompt,
      media: [{ inlineData: { mimeType: "application/pdf", data: Buffer.from(await file.arrayBuffer()).toString("base64") } }],
      responseSchema: profileSchema,
      temperature: 0.05,
      maxOutputTokens: 8_192,
      timeoutMs: EXTRACT_CALL_MS,
      budgetMs: EXTRACT_BUDGET_MS,
      maxRetryWaitMs: EXTRACT_RETRY_WAIT_MS,
    });

    const profile = sanitizeProfile(JSON.parse(generated.text));
    return Response.json({ profile, extracted: Boolean(profile.name) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "프로필을 읽지 못했습니다." },
      { status: 422 },
    );
  }
}
