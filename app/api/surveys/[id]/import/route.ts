/**
 * 결과지 파일에서 만족도 응답을 들여온다.
 *
 * 두 걸음으로 나눈다.
 *   preview — 파일을 읽어 열 목록과 짝짓기 제안을 돌려준다. 아무것도 저장하지 않는다.
 *   commit  — 사람이 확인한 짝짓기로 응답을 넣는다.
 *
 * 나눈 이유는 하나다. 열 제목과 문항 문장은 같을 리가 없어서 짝짓기가 늘 추측인데, 틀린
 * 짝을 조용히 확정하면 엉뚱한 문항에 점수가 쌓인다. 그건 나중에 비교 화면의 색깔로만
 * 드러나고, 그때는 원인을 찾을 방법이 없다. 그래서 저장 전에 반드시 사람이 한 번 본다.
 *
 * 파일은 서버에 두지 않는다. preview 가 읽어 낸 표를 화면이 들고 있다가 commit 에 돌려준다 —
 * 30명 결과지는 작고, 보관할 이유가 없는 중간 산출물이다.
 */
import { requireTeamSession } from "@/lib/auth/guard";
import { sanitizeAnswers, sanitizeQuestions } from "@/lib/surveys";
import {
  ColumnMapping,
  ImportColumn,
  MAX_IMPORT_COLUMNS,
  MAX_IMPORT_ROWS,
  buildRows,
  proposeMapping,
  readCsvRows,
} from "@/lib/survey-import";
import { readSheetRows } from "@/lib/xlsx";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { trackQuality } from "@/lib/telemetry";

export const runtime = "nodejs";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function loadSurvey(id: string) {
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("surveys")
    .select("id,questions,course_sessions(title)")
    .eq("id", id)
    .single();
  if (error || !data) throw error || new Error("만족도 조사를 찾지 못했습니다.");
  return { supabase, survey: data, questions: sanitizeQuestions(data.questions) };
}

/** 첫 줄이 머리글이고 그 아래가 응답이다. 위쪽 빈 줄은 내려받기 방식에 따라 붙는다. */
function splitTable(rows: string[][]) {
  const start = rows.findIndex((row) => row.some((cell) => String(cell ?? "").trim()));
  if (start < 0) return { headers: [] as string[], body: [] as string[][] };
  const headers = (rows[start] || []).map((cell) => String(cell ?? "").trim());
  const body = rows.slice(start + 1)
    .filter((row) => row.some((cell) => String(cell ?? "").trim()))
    .slice(0, MAX_IMPORT_ROWS);
  return { headers, body };
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) return Response.json({ error: "만족도 조사를 확인하지 못했습니다." }, { status: 400 });

    const body = await request.json() as {
      step?: string;
      fileName?: string;
      /** base64 로 받은 xlsx, 또는 csv 원문. */
      content?: string;
      headers?: string[];
      rows?: string[][];
      mappings?: ColumnMapping[];
    };

    const { supabase, survey, questions } = await loadSurvey(id);
    if (!questions.length) {
      return Response.json({ error: "이 교육의 질문지에 문항이 없습니다. 먼저 질문지를 정해 주세요." }, { status: 409 });
    }

    // ─── 1) 미리보기 ────────────────────────────────────────────────────────
    if (body.step !== "commit") {
      const fileName = String(body.fileName || "").trim();
      const content = String(body.content || "");
      if (!content) return Response.json({ error: "결과지 파일을 읽지 못했습니다." }, { status: 400 });

      let rows: string[][];
      try {
        rows = fileName.toLowerCase().endsWith(".csv")
          ? readCsvRows(Buffer.from(content, "base64").toString("utf8"))
          : readSheetRows(Buffer.from(content, "base64"), MAX_IMPORT_ROWS + 5);
      } catch {
        return Response.json(
          { error: "결과지를 읽지 못했습니다. 구글 시트에서 'Microsoft Excel(.xlsx)' 또는 'CSV' 로 내려받아 올려 주세요." },
          { status: 422 },
        );
      }

      const { headers, body: table } = splitTable(rows);
      if (headers.length < 2 || !table.length) {
        return Response.json({ error: "결과지에서 응답을 찾지 못했습니다. 첫 줄이 문항 제목이고 그 아래가 응답이어야 합니다." }, { status: 422 });
      }

      const columns: ImportColumn[] = headers.slice(0, MAX_IMPORT_COLUMNS).map((header, index) => ({
        index,
        header,
        samples: table.slice(0, 3).map((row) => String(row[index] ?? "").trim()).filter(Boolean),
      }));
      const mappings = proposeMapping(columns, questions);
      const preview = buildRows(table, mappings, questions);
      // 자동 짝짓기가 실제 구글폼에서 얼마나 맞는지는 우리가 지어낸 열 제목으로는 알 수 없다.
      // 붙은 문항 수와 놓친 열의 제목을 남겨, 문턱을 조정할 근거로 쓴다.
      await trackQuality("결과지 짝짓기 제안", {
        columns: columns.length,
        questions: questions.length,
        autoMatched: mappings.filter((mapping) => mapping.role === "question").length,
        respondents: preview.length,
        missedHeaders: mappings
          .filter((mapping) => mapping.role === "skip")
          .map((mapping) => columns.find((column) => column.index === mapping.index)?.header || "")
          .filter(Boolean)
          .slice(0, 10),
      });

      return Response.json({
        columns,
        mappings,
        headers,
        rows: table,
        questions: questions.map((question) => ({ id: question.id, text: question.text, type: question.type })),
        respondents: preview.length,
        courseTitle: (survey.course_sessions as { title?: string } | null)?.title || "",
      });
    }

    // ─── 2) 확정 ────────────────────────────────────────────────────────────
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, MAX_IMPORT_ROWS) : [];
    const mappings = Array.isArray(body.mappings) ? body.mappings : [];
    if (!rows.length || !mappings.length) {
      return Response.json({ error: "들여올 응답이 없습니다." }, { status: 400 });
    }
    const matched = mappings.filter((mapping) => mapping.role === "question" && mapping.questionId);
    if (!matched.length) {
      return Response.json({ error: "문항과 짝지은 열이 하나도 없습니다. 짝을 지어 주세요." }, { status: 400 });
    }

    const built = buildRows(rows, mappings, questions);
    if (!built.length) {
      return Response.json({ error: "읽어 낸 응답이 없습니다. 짝지은 열이 맞는지 확인해 주세요." }, { status: 422 });
    }

    // 다시 올리기가 흔하다 — 빠진 사람이 나중에 답하거나, 잘못 짝지어 올렸거나. 그때 같은
    // 결과지가 두 번 쌓이면 응답 수가 부풀고 평균이 흔들린다. 파일에서 온 것만 걷어내고
    // 다시 넣는다. 링크로 받은 응답은 건드리지 않는다.
    const { error: clearError } = await supabase
      .from("survey_responses")
      .delete()
      .eq("survey_id", id)
      .eq("source", "import");
    if (clearError) throw clearError;

    const records = built.map((row) => ({
      survey_id: id,
      invite_id: null,
      source: "import",
      respondent_name: row.name.slice(0, 100),
      respondent_note: row.note.slice(0, 100),
      answers: sanitizeAnswers(questions, row.answers),
    }));
    const { error: insertError } = await supabase.from("survey_responses").insert(records);
    if (insertError) throw insertError;

    // 응답이 들어왔으면 이 조사는 이미 '받는 중' 을 지났다. 화면의 상태를 사실에 맞춘다.
    await supabase.from("surveys")
      .update({ status: "closed", updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "draft");

    const unreadable = built.reduce((total, row) => total + row.unreadable, 0);
    // 사람이 손댄 횟수가 자동 짝짓기의 진짜 성적표다. 0 에 가까우면 확인 화면은 형식적
    // 절차가 되고, 많으면 문턱이나 방식을 바꿔야 한다는 뜻이다.
    await trackQuality("결과지 들여오기 확정", {
      imported: records.length,
      named: built.filter((row) => row.name).length,
      unreadableCells: unreadable,
      correctedByHand: mappings.filter((mapping) => mapping.auto === false && mapping.role === "question").length,
      matchedQuestions: matched.length,
      totalQuestions: questions.length,
    });
    return Response.json({
      imported: records.length,
      named: built.filter((row) => row.name).length,
      unreadable,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message
      : (error && typeof error === "object" && "message" in error) ? String((error as { message: unknown }).message)
      : "결과지를 들여오지 못했습니다.";
    console.error(`[surveys/import] 실패: ${message}`);
    // 마이그레이션(20260821100000) 전에는 초대장 없는 응답이 거부된다. 그때 화면에 뜨는 것이
    // Postgres 문장이면 담당자는 무엇을 해야 할지 알 수 없다.
    if (/invite_id/.test(message) && /null/i.test(message)) {
      return Response.json(
        { error: "이 데이터베이스는 아직 결과지 들여오기를 받지 못합니다. 관리자에게 문의해 주세요." },
        { status: 409 },
      );
    }
    return Response.json({ error: message }, { status: 422 });
  }
}
