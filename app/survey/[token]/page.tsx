import type { Metadata } from "next";
import { loadInviteByToken, publicSurveyShape } from "@/lib/survey-token";
import { SurveyForm } from "./form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 링크가 메신저에 붙었을 때 미리보기로 교육명이 새지 않도록 제목은 고정한다. */
export const metadata: Metadata = {
  title: "교육 만족도 조사",
  robots: { index: false, follow: false },
};

function Frame({ children }: { children: React.ReactNode }) {
  return <main className="survey-page"><div className="survey-card">{children}</div></main>;
}

export default async function SurveyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const loaded = await loadInviteByToken(token);

  if (!loaded) {
    return <Frame>
      <h1>만족도 조사를 찾을 수 없습니다</h1>
      <p className="survey-note">주소가 잘못되었거나 만족도 조사가 삭제되었습니다. 메일에 있는 링크를 다시 확인해 주세요.</p>
    </Frame>;
  }

  const survey = publicSurveyShape(loaded.invite);
  const heldOn = survey.heldOn
    ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "long", timeZone: "Asia/Seoul" }).format(new Date(survey.heldOn))
    : "";
  const subtitle = [survey.companyName, survey.courseTitle, heldOn].filter(Boolean).join(" · ");

  if (survey.answered) {
    return <Frame>
      <h1>응답해 주셔서 감사합니다</h1>
      <p className="survey-note">{subtitle}</p>
      <p className="survey-note">이미 제출하신 만족도 조사입니다. 남겨 주신 의견은 다음 교육 설계에 반영됩니다.</p>
    </Frame>;
  }

  if (survey.status !== "open") {
    return <Frame>
      <h1>{survey.status === "closed" ? "마감된 만족도 조사입니다" : "아직 열리지 않은 만족도 조사입니다"}</h1>
      <p className="survey-note">{subtitle}</p>
      <p className="survey-note">문의: 강원대학교 산학협력단 교육사업팀</p>
    </Frame>;
  }

  return <Frame>
    <p className="survey-eyebrow">강원대학교 산학협력단 교육사업팀</p>
    <h1>{survey.title}</h1>
    {subtitle && <p className="survey-note">{subtitle}</p>}
    {survey.intro && <p className="survey-intro">{survey.intro}</p>}
    <SurveyForm token={token} questions={survey.questions} />
  </Frame>;
}
