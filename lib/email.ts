/**
 * 메일 발송. Resend 를 REST 로 직접 부른다 — 이 저장소는 Gemini 도 SDK 없이 부르고 있어
 * 의존성을 하나 더 들이지 않는 편이 결이 맞는다.
 *
 * 보내는 주소는 Resend 에서 도메인 인증을 마친 것이어야 한다. 인증 전에는 어떤 코드로도
 * 발송되지 않으므로, 실패를 조용히 삼키지 말고 그대로 올려 보낸다 — "보냈다"고 표시된 뒤
 * 아무도 못 받는 것이 가장 나쁜 결과다.
 */
const ENDPOINT = "https://api.resend.com/emails";

export type SendResult = { ok: true; id: string } | { ok: false; error: string };

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

/** 사람 이름이 그대로 헤더에 들어가면 따옴표·꺾쇠로 주소가 깨진다. */
function displayName(name: string) {
  return name.replace(/["<>\r\n]/g, "").trim();
}

export function senderAddress() {
  const from = process.env.EMAIL_FROM || "";
  return from.includes("<") ? from : `강원대학교 산학협력단 교육사업팀 <${from}>`;
}

export async function sendEmail({ to, toName, subject, html, text, replyTo }: {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !process.env.EMAIL_FROM) {
    return { ok: false, error: "메일 발송 설정이 없습니다. RESEND_API_KEY 와 EMAIL_FROM 을 등록해 주세요." };
  }
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: senderAddress(),
        to: [toName ? `${displayName(toName)} <${to}>` : to],
        subject,
        html,
        text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json().catch(() => ({})) as { id?: string; message?: string; name?: string };
    if (!response.ok) return { ok: false, error: result.message || `발송 실패 (${response.status})` };
    return { ok: true, id: String(result.id || "") };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "발송 실패" };
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * 만족도 설문 안내 메일. 받는 사람은 수강생이지 담당자가 아니다 — 무엇에 대한 설문인지,
 * 얼마나 걸리는지, 누가 보냈는지가 첫 화면에서 보여야 링크를 누른다.
 */
export function surveyInviteEmail({ learnerName, companyName, courseTitle, heldOn, link, questionCount }: {
  learnerName: string;
  companyName: string;
  courseTitle: string;
  heldOn: string;
  link: string;
  questionCount: number;
}) {
  const subject = `[${courseTitle}] 교육 만족도 조사에 참여해 주세요`;
  const when = heldOn ? `${heldOn} 진행` : "최근 진행";
  const minutes = Math.max(1, Math.round(questionCount / 4));
  const text = [
    `${learnerName}님, 안녕하세요.`,
    "",
    `강원대학교 산학협력단 교육사업팀입니다. ${companyName}에서 ${when}한 '${courseTitle}' 교육의 만족도 조사입니다.`,
    `문항은 ${questionCount}개이고 약 ${minutes}분이면 끝납니다. 답해 주신 내용은 다음 교육 설계에 그대로 반영됩니다.`,
    "",
    `설문 참여: ${link}`,
    "",
    "이 링크는 본인 전용입니다. 다른 분과 공유하지 말아 주세요.",
    "",
    "강원대학교 산학협력단 교육사업팀",
  ].join("\n");

  const html = `<!doctype html><html lang="ko"><body style="margin:0;background:#f4f6f8;padding:28px 12px;font-family:'Pretendard','Apple SD Gothic Neo',sans-serif;color:#17242f">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e3e9ef">
    <tr><td style="background:#173452;padding:22px 28px;color:#fff;font-size:14px;font-weight:600;letter-spacing:-0.02em">강원대학교 산학협력단 교육사업팀</td></tr>
    <tr><td style="padding:30px 28px 8px">
      <h1 style="margin:0 0 14px;font-size:20px;letter-spacing:-0.03em">교육 만족도 조사</h1>
      <p style="margin:0 0 6px;font-size:14px;line-height:1.7;color:#3d4a56">${escapeHtml(learnerName)}님, 안녕하세요.</p>
      <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#3d4a56">
        ${escapeHtml(companyName)}에서 ${escapeHtml(when)}한 <b>${escapeHtml(courseTitle)}</b> 교육의 만족도 조사입니다.
        문항은 ${questionCount}개이고 약 ${minutes}분이면 끝납니다. 답해 주신 내용은 다음 교육 설계에 그대로 반영됩니다.
      </p>
      <a href="${link}" style="display:inline-block;background:#173452;color:#fff;text-decoration:none;padding:13px 26px;border-radius:10px;font-size:14px;font-weight:600">설문 참여하기</a>
      <p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:#8b969f">
        버튼이 눌리지 않으면 아래 주소를 복사해 열어 주세요.<br>
        <span style="color:#5c7a91;word-break:break-all">${link}</span>
      </p>
    </td></tr>
    <tr><td style="padding:20px 28px 26px">
      <p style="margin:0;padding-top:16px;border-top:1px solid #eef1f5;font-size:11.5px;line-height:1.6;color:#98a3ad">
        이 링크는 본인 전용입니다. 다른 분과 공유하지 말아 주세요.
      </p>
    </td></tr>
  </table></body></html>`;

  return { subject, text, html };
}
