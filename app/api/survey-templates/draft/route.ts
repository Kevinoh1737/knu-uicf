import { generateWithGemini } from "@/lib/ai/gemini";
import { requireTeamSession } from "@/lib/auth/guard";
import { DEFAULT_QUESTIONS, MAX_SURVEY_PDF_SIZE, sanitizeQuestions } from "@/lib/surveys";

export const runtime = "nodejs";
export const maxDuration = 300;

const CALL_MS = 120_000;
const BUDGET_MS = 260_000;
const RETRY_WAIT_MS = 60_000;

const schema = {
  type: "OBJECT",
  properties: {
    name: { type: "STRING" },
    intro: { type: "STRING" },
    questions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          type: { type: "STRING", enum: ["scale", "choice", "text"] },
          text: { type: "STRING" },
          options: { type: "ARRAY", items: { type: "STRING" } },
          required: { type: "BOOLEAN" },
        },
        required: ["id", "type", "text", "options", "required"],
      },
    },
  },
  required: ["name", "intro", "questions"],
};

/**
 * 질문지 초안. 만드는 자리는 만족도 메뉴 한 곳이고, 교육과정은 여기서 만든 것을 골라 쓰기만
 * 한다 — 과정마다 문항을 새로 쓰면 문항 id 가 갈려 과정끼리 견줄 수 없다.
 *
 * 그래서 이 초안에는 특정 교육 이야기를 넣지 않는다. 여러 교육에 두고두고 쓸 한 장이다.
 */
function buildPrompt(fromPdf: boolean) {
  return `당신은 강원대학교 산학협력단 교육사업팀의 교육 담당자입니다. 기업 대상 교육에 두고두고 쓸 표준 만족도 질문지를 만드세요.

${fromPdf
  ? "첨부한 PDF 는 이 팀이 실제로 써 온 만족도 질문지입니다. 문항·순서·말투를 최대한 그대로 옮기는 것이 가장 중요합니다. 없는 문항을 새로 지어내지 말고, 글자가 뭉개져 읽히지 않는 부분만 자연스럽게 채우세요. 특정 교육·회사 이름이 들어간 문항은 어느 교육에나 쓸 수 있는 말로 바꾸세요."
  : "이 팀이 쓰던 질문지가 없으므로 표준 문항으로 새로 만드세요."}

작성 규칙:
1. 문항은 8~12개. 앞쪽에 5점 척도(scale), 뒤쪽에 서술형(text) 두세 개를 둡니다.
2. 다음 축은 반드시 포함하세요 — 내용의 업무 적용성, 난이도·진행 속도, 강사의 전달력, 교육 시간·분량, 동료 추천 의향.
3. 특정 교육에만 해당하는 문항(다룬 도구·실습 이름)은 넣지 마세요. 어느 교육에 붙여도 말이 되어야 합니다.
4. 서술형은 "가장 도움이 된 내용", "개선점", "다음에 더 다뤘으면 하는 주제" 중에서 고르세요. 서술형은 required 를 false 로 둡니다.
5. 척도 문항은 모두 "그렇다/아니다"로 답할 수 있는 평서문으로 쓰세요. 질문형("~했습니까?")이나 이중 질문("내용과 강사가 좋았다")은 쓰지 마세요.
6. id 는 영문 소문자와 밑줄만 사용하고 문항 내용을 알 수 있게 지으세요(예: content_useful).
7. choice 형은 꼭 필요할 때만 쓰고, 쓸 때는 보기를 3개 이상 넣으세요.
8. intro 는 두 문장 이내로, 왜 묻는지와 익명 처리 여부를 적으세요.
9. name 은 이 질문지를 목록에서 알아볼 짧은 이름입니다(예: 표준 교육 만족도).
10. 모든 문구는 존댓말 한국어로, 수강생이 읽는 말투로 쓰세요.`;
}

export async function POST(request: Request) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    // 쓰던 설문지는 읽기만 하고 보관하지 않는다 — 지난 설문지에는 응답자 이름이 남아 있는
    // 경우가 있어 우리 저장소에 둘 이유가 없다.
    let pdf: { mimeType: string; data: string } | null = null;
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (file instanceof File) {
        if (!/\.pdf$/i.test(file.name) || file.type !== "application/pdf") {
          return Response.json({ error: "질문지는 PDF 파일만 올릴 수 있습니다." }, { status: 400 });
        }
        if (file.size > MAX_SURVEY_PDF_SIZE) {
          return Response.json({ error: "PDF 는 최대 10MB까지 올릴 수 있습니다." }, { status: 400 });
        }
        pdf = { mimeType: "application/pdf", data: Buffer.from(await file.arrayBuffer()).toString("base64") };
      }
    }

    const generated = await generateWithGemini({
      role: "surveyDesign",
      prompt: buildPrompt(Boolean(pdf)),
      media: pdf ? [{ inlineData: pdf }] : [],
      responseSchema: schema,
      temperature: 0.3,
      maxOutputTokens: 4_096,
      timeoutMs: CALL_MS,
      budgetMs: BUDGET_MS,
      maxRetryWaitMs: RETRY_WAIT_MS,
    });

    const parsed = JSON.parse(generated.text) as { name?: string; intro?: string; questions?: unknown };
    // 질문지의 문항은 전부 표준이다 — 이 질문지를 쓰는 모든 교육이 같은 축으로 묶인다.
    const questions = sanitizeQuestions(parsed.questions).map((question) => ({ ...question, source: "standard" as const }));
    if (!questions.length) {
      return Response.json(
        { error: "초안을 만들지 못했습니다. 기본 문항으로 시작해 주세요.", questions: DEFAULT_QUESTIONS },
        { status: 422 },
      );
    }

    return Response.json({
      name: (parsed.name || "").trim().slice(0, 120),
      intro: (parsed.intro || "").trim().slice(0, 600),
      questions,
      fromExisting: Boolean(pdf),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message
      : (error && typeof error === "object" && "message" in error) ? String((error as { message: unknown }).message) : "";
    return Response.json({ error: detail || "초안을 만들지 못했습니다." }, { status: 422 });
  }
}
