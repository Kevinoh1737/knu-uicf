import { SurveyQuestion, sanitizeQuestions } from "@/lib/surveys";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * 토큰으로 설문을 여는 길. 응답 페이지(서버 렌더)와 제출 API 가 같은 판단을 쓰도록 한곳에 둔다 —
 * 페이지는 열리는데 제출은 막히거나 그 반대가 되면 수강생은 이유를 알 수 없다.
 */
export const SURVEY_TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

export type PublicSurvey = {
  title: string;
  intro: string;
  status: string;
  courseTitle: string;
  companyName: string;
  heldOn: string | null;
  questions: SurveyQuestion[];
  answered: boolean;
};

type InviteRow = {
  id: string;
  survey_id: string;
  responded_at: string | null;
  surveys: unknown;
};

export async function loadInviteByToken(token: string) {
  if (!SURVEY_TOKEN.test(token)) return null;
  const supabase = createSupabaseAdmin();
  const { data } = await supabase
    .from("survey_invites")
    .select("id,survey_id,responded_at,surveys(id,title,intro,questions,status,course_sessions(title,held_on,company_research(name)))")
    .eq("token", token)
    .maybeSingle();
  if (!data) return null;
  return { supabase, invite: data as InviteRow };
}

/**
 * 밖으로 나가는 모양. 이름·이메일·다른 사람의 응답은 절대 넣지 않는다 — 링크가 잘못 전달되면
 * 그 자체가 개인정보 유출이 된다.
 */
export function publicSurveyShape(invite: InviteRow): PublicSurvey {
  const survey = invite.surveys as {
    title?: string; intro?: string; questions?: unknown; status?: string;
    course_sessions?: { title?: string; held_on?: string | null; company_research?: { name?: string } | null } | null;
  } | null;
  const session = survey?.course_sessions || null;
  return {
    title: String(survey?.title || "교육 만족도 조사"),
    intro: String(survey?.intro || ""),
    status: String(survey?.status || "draft"),
    courseTitle: String(session?.title || ""),
    companyName: String(session?.company_research?.name || ""),
    heldOn: session?.held_on || null,
    questions: sanitizeQuestions(survey?.questions),
    answered: Boolean(invite.responded_at),
  };
}
