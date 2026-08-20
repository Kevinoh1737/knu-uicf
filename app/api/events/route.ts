/**
 * 화면이 모아 보낸 사용 기록을 받는다.
 *
 * 로그인 뒤에 있다(proxy 가 막는다). 기록을 받다가 실패해도 화면에는 알리지 않는다 —
 * 화면은 이 응답을 읽지 않고, 읽어 봐야 사용자가 할 수 있는 일이 없다.
 */
import { requireTeamSession } from "@/lib/auth/guard";
import { AppEvent, normalizePath, trackMany } from "@/lib/telemetry";

export const runtime = "nodejs";
export const maxDuration = 15;

const MAX_EVENTS = 60;

export async function POST(request: Request) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const body = await request.json() as {
      sessionKey?: string;
      events?: Array<Record<string, unknown>>;
    };
    const sessionKey = String(body.sessionKey || "").slice(0, 40);
    const incoming = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS) : [];

    const events: AppEvent[] = incoming
      .filter((item) => item && typeof item === "object" && item.name)
      .map((item) => ({
        // 화면이 보낸 값을 그대로 믿지 않는다. 종류는 둘 중 하나로 좁힌다.
        kind: item.kind === "error" ? "error" : "api",
        name: normalizePath(String(item.name)),
        method: String(item.method || ""),
        status: typeof item.status === "number" ? item.status : null,
        ok: item.ok !== false,
        durationMs: typeof item.durationMs === "number" ? item.durationMs : null,
        message: String(item.message || ""),
        sessionKey,
        source: "client",
      }));

    await trackMany(events);
    return Response.json({ received: events.length });
  } catch {
    // 기록을 못 받은 것으로 사용자를 방해하지 않는다.
    return Response.json({ received: 0 });
  }
}
