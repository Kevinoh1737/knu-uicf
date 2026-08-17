import { requireTeamSession } from "@/lib/auth/guard";
import { generateWithGemini } from "@/lib/ai/gemini";
import { INSTRUCTOR_DOCUMENTS_BUCKET, sanitizeMaterials, sanitizeOutline } from "@/lib/instructors";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PARSE_CALL_MS = 120_000;
const PARSE_BUDGET_MS = 260_000;
const PARSE_RETRY_WAIT_MS = 60_000;

const outlineSchema = {
  type: "OBJECT",
  properties: {
    objective: { type: "STRING" },
    modules: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" }, minutes: { type: "NUMBER" },
          mode: { type: "STRING" }, tools: { type: "ARRAY", items: { type: "STRING" } },
          outcome: { type: "STRING" },
        },
        required: ["title", "minutes", "mode", "tools", "outcome"],
      },
    },
    prerequisites: { type: "ARRAY", items: { type: "STRING" } },
    deliverables: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["objective", "modules", "prerequisites", "deliverables"],
};

const materialsSchema = {
  type: "OBJECT",
  properties: {
    toolsUsed: { type: "ARRAY", items: { type: "STRING" } },
    practiceTasks: { type: "ARRAY", items: { type: "STRING" } },
    caseExamples: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { title: { type: "STRING" }, tailored: { type: "BOOLEAN" } },
        required: ["title", "tailored"],
      },
    },
    practiceRatio: { type: "NUMBER" },
    slideCount: { type: "NUMBER" },
  },
  required: ["toolsUsed", "practiceTasks", "caseExamples", "practiceRatio", "slideCount"],
};

function outlinePrompt(companyName: string) {
  return `당신은 강원대학교 산학협력단 교육사업팀의 교육 담당자입니다. 첨부한 문서는 강사가 ${companyName}에 제출한 강의 구성 아웃라인입니다. 담당자가 나중에 다시 찾아보고 다른 과정과 비교할 수 있도록 구조화하세요.

규칙:
1. 문서에 적힌 내용만 사용하세요. 없는 항목은 빈 값으로 두고 지어내지 마세요.
2. modules 는 진행 순서대로 적고, minutes 는 각 구간의 분 단위 시간입니다. 시간이 적혀 있지 않으면 0으로 두세요.
3. mode 는 강의, 실습, 토의, 데모 중 하나만 고르세요. 판단이 어려우면 강의로 두세요.
4. objective 는 교육이 끝난 뒤 참석자가 실제로 할 수 있게 되는 것을 한 문장으로 적으세요.
5. prerequisites 는 참석자 PC, 계정, 네트워크, 설치 프로그램처럼 사전에 준비해야 하는 것입니다.
6. deliverables 는 참석자가 교육을 마치고 가져가는 결과물입니다.
7. 짧은 명사형 한국어로 쓰세요.`;
}

function materialsPrompt(companyName: string) {
  return `당신은 강원대학교 산학협력단 교육사업팀의 교육 담당자입니다. 첨부한 문서는 강사가 ${companyName} 강의에서 실제로 사용하는 강의 자료입니다. 내용을 요약하지 말고 아래 항목만 골라내세요.

규칙:
1. toolsUsed 는 자료에서 실제로 다루는 AI·소프트웨어 도구입니다.
2. practiceTasks 는 참석자가 직접 해보는 실습 과제입니다. 실습이 없으면 빈 배열로 두세요.
3. caseExamples 는 자료에 등장하는 사례입니다. tailored 는 그 사례가 ${companyName}의 업무·제품·조직에 맞춘 것이면 true, 일반적인 사례이거나 다른 회사 사례이면 false 로 판단하세요. 이 구분이 가장 중요합니다.
4. practiceRatio 는 전체 분량 중 실습이 차지하는 비중을 0~100 사이 숫자로 추정하세요.
5. slideCount 는 슬라이드 수입니다. 셀 수 없으면 0으로 두세요.
6. 판단이 어려우면 지어내지 말고 비워 두세요.`;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) return Response.json({ error: "강의를 확인하지 못했습니다." }, { status: 400 });

    const body = await request.json() as { kind?: string; storagePath?: string; fileName?: string; mimeType?: string; fileSize?: number };
    const kind = body.kind === "outline" || body.kind === "materials" ? body.kind : "";
    const storagePath = typeof body.storagePath === "string" ? body.storagePath : "";
    const fileName = (body.fileName || "").trim();
    if (!kind || !storagePath || !fileName) {
      return Response.json({ error: "업로드 정보를 확인하지 못했습니다." }, { status: 400 });
    }

    const supabase = createSupabaseAdmin();
    const { data: session, error: sessionError } = await supabase
      .from("course_sessions")
      .select("id,instructor_id,company_research(name)")
      .eq("id", id)
      .single();
    if (sessionError || !session) throw sessionError || new Error("강의를 찾지 못했습니다.");

    // 강의 구성·자료는 '누가 낸 것인가'가 함께 남아야 강사별 이력이 된다(instructor_documents
    // .instructor_id 는 not null). 강사가 없는 교육에 올리면 여기서 막히는데, 예전에는 그 사실이
    // "자료를 등록하지 못했습니다" 한 줄로만 나와서 무엇을 해야 하는지 알 수 없었다.
    if (!session.instructor_id) {
      return Response.json(
        { error: "담당 강사를 먼저 배정해 주세요. 강의 구성·자료는 강사별 이력으로 쌓입니다 — 카드 오른쪽 연필에서 강사를 고른 뒤 다시 올려 주세요." },
        { status: 409 },
      );
    }

    const companyName = (session.company_research as { name?: string } | null)?.name || "고객사";
    const parsable = storagePath.toLowerCase().endsWith(".pdf");

    // 원본은 무조건 기록한다. 파싱 여부와 무관하게 자료가 있었다는 사실이 자산이다.
    const { data: document, error: documentError } = await supabase
      .from("instructor_documents")
      .insert({
        instructor_id: session.instructor_id,
        course_session_id: id,
        kind,
        file_name: fileName,
        storage_path: storagePath,
        mime_type: body.mimeType || "",
        file_size: Math.max(0, Number(body.fileSize) || 0),
        parse_status: parsable ? "parsing" : "skipped",
        parse_error: parsable ? "" : "PDF 가 아니라 자동 추출을 건너뛰었습니다.",
      })
      .select("id")
      .single();
    if (documentError) throw documentError;

    if (!parsable) {
      return Response.json({
        documentId: document.id,
        parsed: false,
        notice: "원본은 보관했습니다. 자동 추출은 PDF 만 가능합니다.",
      });
    }

    try {
      const { data: file, error: downloadError } = await supabase
        .storage.from(INSTRUCTOR_DOCUMENTS_BUCKET)
        .download(storagePath);
      if (downloadError || !file) throw new Error(downloadError?.message || "파일을 불러오지 못했습니다.");

      const generated = await generateWithGemini({
        role: "documentExtraction",
        prompt: kind === "outline" ? outlinePrompt(companyName) : materialsPrompt(companyName),
        media: [{ inlineData: { mimeType: "application/pdf", data: Buffer.from(await file.arrayBuffer()).toString("base64") } }],
        responseSchema: kind === "outline" ? outlineSchema : materialsSchema,
        temperature: 0.05,
        maxOutputTokens: 8_192,
        timeoutMs: PARSE_CALL_MS,
        budgetMs: PARSE_BUDGET_MS,
        maxRetryWaitMs: PARSE_RETRY_WAIT_MS,
      });

      const raw = JSON.parse(generated.text);
      const parsed = kind === "outline" ? sanitizeOutline(raw) : sanitizeMaterials(raw);

      await supabase.from("instructor_documents")
        .update({ parse_status: "completed", parsed, updated_at: new Date().toISOString() })
        .eq("id", document.id);
      await supabase.from("course_sessions")
        .update({ [kind]: parsed, updated_at: new Date().toISOString() })
        .eq("id", id);

      return Response.json({ documentId: document.id, parsed: true, [kind]: parsed });
    } catch (parseError) {
      // 파싱 실패가 업로드를 무효로 만들지는 않는다. 원본은 남고 상태만 실패로 기록한다.
      const message = parseError instanceof Error ? parseError.message : "자료를 읽지 못했습니다.";
      await supabase.from("instructor_documents")
        .update({ parse_status: "failed", parse_error: message.slice(0, 500), updated_at: new Date().toISOString() })
        .eq("id", document.id);
      return Response.json({ documentId: document.id, parsed: false, error: message }, { status: 422 });
    }
  } catch (error) {
    // Supabase 오류는 Error 인스턴스가 아니다. instanceof 로만 거르면 원인이 통째로 사라져
    // 화면에는 "자료를 등록하지 못했습니다" 한 줄만 남는다(실제로 그렇게 한 번 헤맸다).
    const message = error instanceof Error ? error.message
      : (error && typeof error === "object" && "message" in error) ? String((error as { message: unknown }).message)
      : "";
    console.error(`[documents] 등록 실패: ${message}`);
    return Response.json({ error: message || "자료를 등록하지 못했습니다." }, { status: 422 });
  }
}
