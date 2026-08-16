import { SURVEY_TOKEN, loadInviteByToken, publicSurveyShape } from "@/lib/survey-token";
import { missingRequired, sanitizeAnswers } from "@/lib/surveys";

export const runtime = "nodejs";

/**
 * 수강생이 쓰는 공개 라우트. 로그인 대신 토큰이 신원이다 — proxy.ts 의 열린 경로에 있으므로
 * 여기서 스스로를 지켜야 한다. 토큰 형태를 먼저 거르고(무작위 조회 차단), 응답 상태가 아니면
 * 막고, 내보내는 값에는 사람 정보를 싣지 않는다.
 */
export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!SURVEY_TOKEN.test(token)) return Response.json({ error: "설문 주소가 올바르지 않습니다." }, { status: 404 });
  const loaded = await loadInviteByToken(token);
  if (!loaded) return Response.json({ error: "설문 주소가 올바르지 않습니다." }, { status: 404 });
  return Response.json({ survey: publicSurveyShape(loaded.invite) });
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!SURVEY_TOKEN.test(token)) return Response.json({ error: "설문 주소가 올바르지 않습니다." }, { status: 404 });

  try {
    const loaded = await loadInviteByToken(token);
    if (!loaded) return Response.json({ error: "설문 주소가 올바르지 않습니다." }, { status: 404 });
    const { supabase, invite } = loaded;
    const survey = publicSurveyShape(invite);

    if (invite.responded_at) return Response.json({ error: "이미 응답하셨습니다. 감사합니다." }, { status: 409 });
    if (survey.status === "closed") return Response.json({ error: "마감된 설문입니다." }, { status: 409 });
    if (survey.status !== "open") return Response.json({ error: "아직 응답을 받고 있지 않습니다." }, { status: 409 });

    const body = await request.json() as { answers?: unknown };
    const answers = sanitizeAnswers(survey.questions, body.answers);
    const missing = missingRequired(survey.questions, answers);
    if (missing.length) {
      return Response.json(
        { error: `답하지 않은 문항이 있습니다: ${missing[0].text}`, missing: missing.map((question) => question.id) },
        { status: 400 },
      );
    }

    const { error } = await supabase.from("survey_responses").insert({
      survey_id: invite.survey_id, invite_id: invite.id, answers,
    });
    // 같은 링크로 두 번 냈다면 DB 의 유일 제약이 먼저 막는다. 사고가 아니라 정상 흐름이다.
    if (error) {
      const message = String((error as { message?: string }).message || "");
      if (message.includes("duplicate") || message.includes("unique")) {
        return Response.json({ error: "이미 응답하셨습니다. 감사합니다." }, { status: 409 });
      }
      throw error;
    }

    await supabase.from("survey_invites")
      .update({ responded_at: new Date().toISOString() }).eq("id", invite.id);

    return Response.json({ submitted: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message
      : (error && typeof error === "object" && "message" in error) ? String((error as { message: unknown }).message) : "";
    return Response.json({ error: detail || "응답을 저장하지 못했습니다." }, { status: 422 });
  }
}
