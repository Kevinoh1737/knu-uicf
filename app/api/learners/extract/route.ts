import { requireTeamSession } from "@/lib/auth/guard";
import { generateWithGemini } from "@/lib/ai/gemini";
import { INSTRUCTOR_DOCUMENTS_BUCKET } from "@/lib/instructors";
import { sanitizeLearners } from "@/lib/learners";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

const EXTRACT_CALL_MS = 120_000;
const EXTRACT_BUDGET_MS = 260_000;
const EXTRACT_RETRY_WAIT_MS = 60_000;

const schema = {
  type: "OBJECT",
  properties: {
    learners: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          department: { type: "STRING" },
          jobTitle: { type: "STRING" },
          email: { type: "STRING" },
          notes: { type: "STRING" },
        },
        required: ["name", "department", "jobTitle", "email", "notes"],
      },
    },
  },
  required: ["learners"],
};

/**
 * 제출받은 명단에는 생년월일·사번·휴대전화가 함께 실려 오는 일이 흔하다. 프롬프트에서 먼저
 * 막고, sanitizeLearners 가 다시 좁힌다 — 모델이 뽑아도 저장되지 않는다.
 */
const prompt = `당신은 강원대학교 산학협력단 교육사업팀의 교육 운영 담당자입니다. 첨부한 교육 참석자 명단을 읽고 표에 있는 사람들을 정리하세요.

절대 추출하지 않을 항목:
- 주민등록번호, 생년월일, 나이
- 사번, 사원번호
- 휴대전화번호, 집 주소
명단에 있어도 위 항목은 어떤 필드에도 넣지 마세요.

작성 규칙:
1. 명단에 적힌 사람만 넣으세요. 표의 머리글, 합계 행, 안내 문구는 사람이 아닙니다.
2. name 은 이름입니다. 반드시 채워야 하며, 이름을 알 수 없는 행은 아예 빼세요.
3. department 는 부서나 팀, jobTitle 은 직급이나 직책입니다. 한 칸에 '영업팀 과장'처럼 붙어 있으면 나눠 담으세요.
4. email 은 업무용 이메일 주소만 넣고, 형식이 아니면 비워 두세요.
5. notes 에는 비고란의 내용처럼 교육 운영에 참고가 될 짧은 메모만 넣으세요. 없으면 비워 두세요.
6. 사람 수를 늘리거나 줄이지 마세요. 명단에 있는 그대로 옮깁니다.`;

export async function POST(request: Request) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const body = await request.json() as { storagePath?: string };
    const storagePath = typeof body.storagePath === "string" ? body.storagePath : "";
    if (!storagePath || !storagePath.toLowerCase().endsWith(".pdf")) {
      return Response.json(
        { error: "명단은 PDF 로 올려 주세요. 엑셀·한글은 'PDF로 저장' 후 올리면 됩니다." },
        { status: 400 },
      );
    }

    const { data: file, error: downloadError } = await createSupabaseAdmin()
      .storage.from(INSTRUCTOR_DOCUMENTS_BUCKET)
      .download(storagePath);
    if (downloadError || !file) throw new Error(downloadError?.message || "명단 파일을 불러오지 못했습니다.");

    const generated = await generateWithGemini({
      role: "documentExtraction",
      prompt,
      media: [{ inlineData: { mimeType: "application/pdf", data: Buffer.from(await file.arrayBuffer()).toString("base64") } }],
      responseSchema: schema,
      temperature: 0.05,
      maxOutputTokens: 16_384,
      timeoutMs: EXTRACT_CALL_MS,
      budgetMs: EXTRACT_BUDGET_MS,
      maxRetryWaitMs: EXTRACT_RETRY_WAIT_MS,
    });

    const parsed = JSON.parse(generated.text) as { learners?: unknown };
    const learners = sanitizeLearners(parsed.learners);
    return Response.json({ learners, count: learners.length });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "명단을 읽지 못했습니다." },
      { status: 422 },
    );
  }
}
