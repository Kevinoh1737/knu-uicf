import { generateWithGemini } from "@/lib/ai/gemini";
import { requireTeamSession } from "@/lib/auth/guard";
import { DEFAULT_QUESTIONS, MAX_SURVEY_PDF_SIZE, sanitizeQuestions } from "@/lib/surveys";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

const CALL_MS = 120_000;
const BUDGET_MS = 260_000;
const RETRY_WAIT_MS = 60_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const schema = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
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
  required: ["title", "intro", "questions"],
};

/**
 * 초안 규칙. 만족도 설문은 '좋았나요'를 여러 번 묻는 것으로 끝나기 쉬운데, 그러면 다음 교육을
 * 어떻게 고칠지가 나오지 않는다. 그래서 공통 축(내용·난이도·전달·시간)은 고정하고, 이 교육에만
 * 해당하는 문항 몇 개를 실제 강의 내용에서 뽑게 한다.
 */
function buildPrompt({ courseTitle, companyName, outline, materials, consultation, existing }: {
  courseTitle: string;
  companyName: string;
  outline: string;
  materials: string;
  consultation: string;
  existing: boolean;
}) {
  return `당신은 강원대학교 산학협력단 교육사업팀의 교육 담당자입니다. 아래 교육에 대한 수강생 만족도 설문지 초안을 만드세요.

교육명: ${courseTitle}
고객사: ${companyName || "미상"}
강의 구성: ${outline || "자료 없음"}
강의 자료 특징: ${materials || "자료 없음"}
상담에서 파악된 회사의 요구: ${consultation || "자료 없음"}
${existing ? "\n첨부한 PDF 는 이 팀이 실제로 써 온 만족도 설문지입니다. 문항 순서와 말투를 최대한 그대로 살리고, 위 교육 내용에 맞지 않는 문항만 고치거나 보태세요. 첨부에 없는 문항을 새로 만들 때만 아래 규칙을 따르세요.\n" : ""}
작성 규칙:
1. 문항은 8~12개. 앞쪽에 5점 척도(scale), 뒤쪽에 서술형(text) 두세 개를 둡니다.
2. 다음 축은 반드시 포함하세요 — 내용의 업무 적용성, 난이도·진행 속도, 강사의 전달력, 교육 시간·분량, 동료 추천 의향.
3. 위 축 외에 이 교육에만 해당하는 척도 문항을 2~3개 만드세요. 실제 다룬 도구나 실습을 문항에 그대로 넣습니다. 예: "수업에서 다룬 ○○를 내 업무에 바로 써 볼 수 있겠다".
4. 서술형은 "가장 도움이 된 내용", "개선점", "다음에 더 다뤘으면 하는 주제" 중에서 고르세요. 서술형은 required 를 false 로 둡니다.
5. 척도 문항은 모두 "그렇다/아니다"로 답할 수 있는 평서문으로 쓰세요. 질문형("~했습니까?")이나 이중 질문("내용과 강사가 좋았다")은 쓰지 마세요.
6. id 는 영문 소문자와 밑줄만 사용하고 문항 내용을 알 수 있게 지으세요(예: tool_apply).
7. choice 형은 꼭 필요할 때만 쓰고, 쓸 때는 보기를 3개 이상 넣으세요.
8. intro 는 두 문장 이내로, 왜 묻는지와 익명 처리 여부를 적으세요.
9. 모든 문구는 존댓말 한국어로, 수강생이 읽는 말투로 쓰세요.`;
}

function textFrom(value: unknown, limit = 900) {
  if (!value) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.replace(/\s+/g, " ").trim().slice(0, limit);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) return Response.json({ error: "설문지를 확인하지 못했습니다." }, { status: 400 });

    // 이미 쓰던 설문지가 있으면 PDF 로 함께 올린다. 저장하지 않고 읽기만 한다 — 지난 설문지에는
    // 응답자 이름이 남아 있는 경우가 있어 보관할 이유가 없다.
    let pdf: { mimeType: string; data: string } | null = null;
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (file instanceof File) {
        if (!/\.pdf$/i.test(file.name) || file.type !== "application/pdf") {
          return Response.json({ error: "설문지는 PDF 파일만 올릴 수 있습니다." }, { status: 400 });
        }
        if (file.size > MAX_SURVEY_PDF_SIZE) {
          return Response.json({ error: "PDF 는 최대 10MB까지 올릴 수 있습니다." }, { status: 400 });
        }
        pdf = { mimeType: "application/pdf", data: Buffer.from(await file.arrayBuffer()).toString("base64") };
      }
    }

    const supabase = createSupabaseAdmin();
    const { data: survey, error } = await supabase
      .from("surveys")
      .select("id,course_session_id,course_sessions(title,outline,materials,company_id,company_research(name,research))")
      .eq("id", id)
      .single();
    if (error || !survey) throw error || new Error("설문지를 찾지 못했습니다.");

    const session = survey.course_sessions as {
      title?: string; outline?: unknown; materials?: unknown; company_id?: string;
      company_research?: { name?: string; research?: unknown } | null;
    } | null;
    const company = session?.company_research || null;

    // 상담 요약은 "회사가 무엇을 원했는지"라서, 만족도 문항이 그 요구를 되짚게 만든다.
    let consultation = "";
    if (session?.company_id) {
      const { data: latest } = await supabase
        .from("company_consultations")
        .select("summary").eq("company_id", session.company_id).eq("status", "completed")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      const summary = latest?.summary as { overview?: string; keyNeeds?: Array<{ title?: string }> } | null;
      consultation = [
        textFrom(summary?.overview, 400),
        (summary?.keyNeeds || []).map((need) => need?.title).filter(Boolean).join(", "),
      ].filter(Boolean).join(" / ").slice(0, 900);
    }

    const generated = await generateWithGemini({
      role: "surveyDesign",
      prompt: buildPrompt({
        courseTitle: session?.title || "교육",
        companyName: company?.name || "",
        outline: textFrom(session?.outline),
        materials: textFrom(session?.materials),
        consultation: consultation || textFrom((company?.research as { summary?: string } | null)?.summary, 400),
        existing: Boolean(pdf),
      }),
      media: pdf ? [{ inlineData: pdf }] : [],
      responseSchema: schema,
      temperature: 0.3,
      maxOutputTokens: 4_096,
      timeoutMs: CALL_MS,
      budgetMs: BUDGET_MS,
      maxRetryWaitMs: RETRY_WAIT_MS,
    });

    const parsed = JSON.parse(generated.text) as { title?: string; intro?: string; questions?: unknown };
    const questions = sanitizeQuestions(parsed.questions);
    if (!questions.length) {
      return Response.json({ error: "초안을 만들지 못했습니다. 기본 문항으로 시작해 주세요.", questions: DEFAULT_QUESTIONS }, { status: 422 });
    }

    return Response.json({
      title: (parsed.title || "").trim().slice(0, 120),
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
