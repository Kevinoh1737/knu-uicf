import { randomBytes } from "node:crypto";
import { requireTeamSession } from "@/lib/auth/guard";
import { formatHeldOn } from "@/lib/course-time";
import { emailConfigured, sendEmail, surveyInviteEmail } from "@/lib/email";
import { sanitizeQuestions } from "@/lib/surveys";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
/** 한 사람씩 보내고 실패도 사람 단위로 남긴다. 30명이면 30번의 왕복이라 넉넉히 잡는다. */
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SEND_BUDGET_MS = 240_000;

/** 링크는 메일에 그대로 박히므로 나중에 바뀌면 안 된다. 배포 주소를 우선 쓰고 없으면 요청 기준. */
function baseUrl(request: Request) {
  const configured = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_BASE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (production) return `https://${production}`;
  return new URL(request.url).origin;
}

/**
 * 수강생에게 만족도 조사 링크를 보낸다.
 *
 * 이미 보낸 사람에게는 다시 보내지 않는다(재발송은 resend=true 로 명시). 사람마다 토큰이 달라
 * 누가 답했는지는 알 수 있지만, 응답 화면에는 이름을 쓰지 않는다 — 익명이라고 안내하고
 * 이름을 붙여 보여 주면 거짓말이 된다.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) return Response.json({ error: "만족도 조사를 확인하지 못했습니다." }, { status: 400 });
    if (!emailConfigured()) {
      return Response.json(
        { error: "메일 발송 설정이 아직 없습니다. Resend API 키와 인증된 발신 도메인을 등록해야 보낼 수 있습니다." },
        { status: 503 },
      );
    }

    const body = await request.json().catch(() => ({})) as { resend?: boolean };
    const supabase = createSupabaseAdmin();

    const { data: survey, error } = await supabase
      .from("surveys")
      .select("id,title,questions,status,course_session_id,course_sessions(id,title,held_on,start_time,duration_hours,company_research(name))")
      .eq("id", id)
      .single();
    if (error || !survey) throw error || new Error("만족도 조사를 찾지 못했습니다.");

    const questions = sanitizeQuestions(survey.questions);
    if (!questions.length) return Response.json({ error: "문항이 없습니다. 질문지를 먼저 완성해 주세요." }, { status: 400 });

    const session = survey.course_sessions as {
      id?: string; title?: string; held_on?: string | null; start_time?: string | null; duration_hours?: number | null;
      company_research?: { name?: string } | null;
    } | null;

    // 받는 사람은 그 교육과정에 배정된 수강생이다. 회사 전체 명단이 아니다.
    const { data: enrolled, error: enrolledError } = await supabase
      .from("session_learners")
      .select("learner_id,status,learners(id,name,email)")
      .eq("course_session_id", survey.course_session_id)
      .neq("status", "cancelled");
    if (enrolledError) throw enrolledError;

    const recipients = (enrolled || [])
      .map((row) => row.learners as { id?: string; name?: string; email?: string } | null)
      .filter((learner): learner is { id: string; name: string; email: string } =>
        Boolean(learner?.id && learner?.email));
    const withoutEmail = (enrolled || []).length - recipients.length;

    if (!recipients.length) {
      return Response.json(
        { error: withoutEmail ? "배정된 수강생에게 이메일 주소가 없습니다." : "이 교육과정에 배정된 수강생이 없습니다." },
        { status: 400 },
      );
    }

    const { data: existingInvites } = await supabase
      .from("survey_invites").select("id,learner_id,token,sent_at").eq("survey_id", id);
    const byLearner = new Map((existingInvites || []).map((invite) => [invite.learner_id as string, invite]));

    // 링크가 없는 사람만 새로 만든다. 토큰은 한 번 만들면 그 사람의 주소로 남는다.
    const fresh = recipients.filter((learner) => !byLearner.has(learner.id));
    if (fresh.length) {
      const { data: created, error: inviteError } = await supabase
        .from("survey_invites")
        .insert(fresh.map((learner) => ({
          survey_id: id, learner_id: learner.id, token: randomBytes(24).toString("base64url"),
        })))
        .select("id,learner_id,token,sent_at");
      if (inviteError) throw inviteError;
      (created || []).forEach((invite) => byLearner.set(invite.learner_id as string, invite));
    }

    const startedAt = Date.now();
    const base = baseUrl(request);
    let sent = 0;
    let skipped = 0;
    const failures: Array<{ name: string; email: string; reason: string }> = [];
    let stoppedEarly = 0;

    for (const learner of recipients) {
      const invite = byLearner.get(learner.id);
      if (!invite) continue;
      if (invite.sent_at && !body.resend) { skipped += 1; continue; }
      // 시간이 다 되면 남은 사람은 손대지 않는다. 절반만 보내고 500 으로 끝나는 것보다,
      // 몇 명이 남았는지 알려 주고 다시 누르게 하는 편이 낫다.
      if (Date.now() - startedAt > SEND_BUDGET_MS) { stoppedEarly += 1; continue; }

      const mail = surveyInviteEmail({
        learnerName: learner.name || "수강생",
        companyName: session?.company_research?.name || "",
        courseTitle: session?.title || String(survey.title || "교육"),
        heldOn: formatHeldOn(session?.held_on, session?.start_time, session?.duration_hours, "long"),
        link: `${base}/survey/${invite.token}`,
        questionCount: questions.length,
      });

      const result = await sendEmail({
        to: learner.email, toName: learner.name,
        subject: mail.subject, html: mail.html, text: mail.text,
      });
      if (result.ok) {
        sent += 1;
        await supabase.from("survey_invites")
          .update({ sent_at: new Date().toISOString(), send_error: null }).eq("id", invite.id);
      } else {
        failures.push({ name: learner.name, email: learner.email, reason: result.error });
        await supabase.from("survey_invites").update({ send_error: result.error.slice(0, 300) }).eq("id", invite.id);
      }
    }

    // 한 명이라도 나갔으면 응답을 받는 상태여야 한다. 응답 페이지가 '마감'을 막고 있기 때문이다.
    if (sent > 0 && survey.status !== "open") {
      await supabase.from("surveys").update({ status: "open", updated_at: new Date().toISOString() }).eq("id", id);
    }

    return Response.json({ sent, skipped, withoutEmail, stoppedEarly, failures, total: recipients.length });
  } catch (error) {
    const detail = error instanceof Error ? error.message
      : (error && typeof error === "object" && "message" in error) ? String((error as { message: unknown }).message) : "";
    return Response.json({ error: detail || "만족도 조사를 보내지 못했습니다." }, { status: 422 });
  }
}
