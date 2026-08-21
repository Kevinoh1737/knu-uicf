/**
 * 텔레그램으로 알림을 보낸다.
 *
 * 규칙은 사용 기록(lib/telemetry.ts)과 같다: **알림이 일을 망치지 않는다.** 여기서 나는
 * 어떤 오류도 부르는 쪽으로 넘기지 않는다. 알림을 못 보낸 것 때문에 크론이 500 을 뱉으면
 * 그 실패가 다시 알림거리가 되어 서로를 물고 늘어진다.
 *
 * 담는 것은 사용 기록에 담긴 것까지다 — 경로·상태·소요시간·우리가 쓴 안내 문구. 상담
 * 내용이나 수강생 이름은 애초에 app_events 에 없으므로 여기로 새어 나갈 길이 없다.
 */

const API_BASE = "https://api.telegram.org";

/** 텔레그램 한 메시지의 상한은 4096자다. 잘릴 바에는 우리가 잘랐다고 알리고 자른다. */
const MAX_LENGTH = 3_900;

export type TelegramResult =
  | { sent: true }
  | { sent: false; reason: string };

export function isTelegramConfigured() {
  return Boolean(process.env.TELEGRAM_BUG_BOT_TOKEN && process.env.TELEGRAM_BUG_CHAT_ID);
}

/** HTML 서식으로 보내므로 값에 든 꺾쇠와 앰퍼샌드를 막아야 한다. 오류 문구에 자주 들어 있다. */
export function escapeHtml(value: string) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function sendTelegram(text: string): Promise<TelegramResult> {
  const token = process.env.TELEGRAM_BUG_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_BUG_CHAT_ID;
  if (!token || !chatId) {
    return { sent: false, reason: "텔레그램 환경변수가 설정되지 않았습니다." };
  }

  const body = text.length > MAX_LENGTH
    ? `${text.slice(0, MAX_LENGTH)}\n\n…(길어서 줄였습니다. 나머지는 /admin 에서 보세요)`
    : text;

  try {
    // 크론 한 번이 여기서 오래 매달리면 함수가 통째로 시간 초과된다. 10초면 충분하다.
    const response = await fetch(`${API_BASE}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: body,
        parse_mode: "HTML",
        // 링크 미리보기가 뜨면 짧은 알림이 화면 한 장을 차지한다.
        link_preview_options: { is_disabled: true },
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      // 텔레그램의 실패 사유는 본문에 있다(chat not found, bot was blocked …).
      // 토큰은 주소에만 있고 본문에는 없으므로 그대로 남겨도 새지 않는다.
      const detail = await response.text().catch(() => "");
      return { sent: false, reason: `텔레그램 ${response.status}: ${detail.slice(0, 200)}` };
    }
    return { sent: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "알 수 없음";
    return { sent: false, reason: `텔레그램 전송 실패: ${reason}` };
  }
}
