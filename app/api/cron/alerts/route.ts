/**
 * 사용 기록을 훑어 텔레그램으로 알린다. 스케줄러가 부른다.
 *
 * 로그인 뒤에 둘 수 없다 — 부르는 쪽이 사람이 아니다. 대신 `CRON_SECRET` 을 스스로 검사한다
 * (`/api/ai/health` 와 같은 방식이고, proxy.ts 의 OPEN_PATHS 에 함께 올라가 있다).
 *
 *   GET /api/cron/alerts?mode=hourly   지난 알림 뒤로 새로 생긴 것만. 없으면 안 보낸다.
 *   GET /api/cron/alerts?mode=daily    오늘(한국 시간) 하루치 요약. 조용했어도 보낸다.
 *
 * 어디까지 알렸는지는 별도의 표를 만들지 않고 **사용 기록 자체에** 남긴다. 성공한 실행이
 * 자기가 훑은 끝 시각을 detail.until 에 적어 두고, 다음 실행이 그 자리부터 읽는다.
 * 보내기에 실패하면 그 자리를 옮기지 않는다 — 그래야 다음 실행이 다시 집어 든다.
 */
import {
  buildBaseline, composeAlert, EventRow, type AlertMode,
} from "@/lib/alerts";
import { isTelegramConfigured, sendTelegram } from "@/lib/telegram";
import { track } from "@/lib/telemetry";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_ROWS = 4_000;
const BASELINE_DAYS = 7;

/** 처음 도는 날에는 앞선 기록이 없다. 그렇다고 표 전체를 한 장에 담을 수는 없다. */
const FIRST_RUN_WINDOW_MS = 2 * 60 * 60 * 1000;

/** 스케줄러가 며칠 멈춰 있었더라도 하루치까지만 본다. 밀린 것을 다 쏟으면 아무도 안 읽는다. */
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;

const RUN_NAME: Record<AlertMode, string> = {
  hourly: "/cron/alerts/hourly",
  daily: "/cron/alerts/daily",
};

function unauthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET 이 설정되지 않았습니다." }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/** 한국 시간으로 오늘 0시. 서버는 UTC 라 그냥 자르면 오전 9시 이전이 전날이 된다. */
function seoulMidnight(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  return new Date(`${parts}T00:00:00+09:00`);
}

export async function GET(request: Request) {
  const denied = unauthorized(request);
  if (denied) return denied;

  const mode: AlertMode = new URL(request.url).searchParams.get("mode") === "daily" ? "daily" : "hourly";
  const startedAt = Date.now();
  const until = new Date();

  try {
    if (!isTelegramConfigured()) {
      // 조용히 넘기지 않는다. 설정이 빠진 채로 몇 주가 지나면 '알림이 안 온다' 가
      // '알릴 일이 없다' 로 읽힌다.
      throw new Error("텔레그램 환경변수(TELEGRAM_BUG_BOT_TOKEN·TELEGRAM_BUG_CHAT_ID)가 없습니다.");
    }
    const supabase = createSupabaseAdmin();

    // ── 어디부터 읽을까 ──────────────────────────────────────────────────
    let since: Date;
    if (mode === "daily") {
      since = seoulMidnight(until);
    } else {
      const { data: lastRun } = await supabase
        .from("app_events")
        .select("detail")
        .eq("kind", "server")
        .eq("name", RUN_NAME.hourly)
        .eq("ok", true)
        .order("at", { ascending: false })
        .limit(1);
      const mark = (lastRun?.[0]?.detail as { until?: string } | undefined)?.until;
      since = mark ? new Date(mark) : new Date(until.getTime() - FIRST_RUN_WINDOW_MS);
    }
    if (until.getTime() - since.getTime() > MAX_WINDOW_MS) {
      since = new Date(until.getTime() - MAX_WINDOW_MS);
    }

    // ── 창 안의 기록 ─────────────────────────────────────────────────────
    const { data, error } = await supabase
      .from("app_events")
      .select("at,kind,name,method,status,ok,duration_ms,message,detail,session_key,source")
      .gte("at", since.toISOString())
      .lt("at", until.toISOString())
      .order("at", { ascending: false })
      .limit(MAX_ROWS);
    if (error) throw error;
    // 크론 자신의 실행 기록은 알림거리가 아니다. 실패했다면 그건 이미 텔레그램이 아니라
    // /admin 에서 볼 일이고, 여기 넣으면 알림이 자기 얘기로 채워진다.
    const rows = ((data || []) as EventRow[]).filter(
      (row) => !(row.kind === "server" && (row.name === RUN_NAME.hourly || row.name === RUN_NAME.daily)),
    );

    // ── 느림의 잣대 ──────────────────────────────────────────────────────
    const baselineSince = new Date(until.getTime() - BASELINE_DAYS * 24 * 60 * 60 * 1000);
    const { data: baselineData } = await supabase
      .from("app_events")
      .select("at,kind,name,method,status,ok,duration_ms,message,detail,session_key,source")
      .eq("kind", "api")
      .gte("at", baselineSince.toISOString())
      .order("at", { ascending: false })
      .limit(MAX_ROWS);
    const baseline = buildBaseline((baselineData || []) as EventRow[]);

    const origin = process.env.NEXT_PUBLIC_SITE_URL || "https://knu-eduflow.vercel.app";
    const composed = composeAlert({
      mode, rows, baseline,
      since: since.toISOString(), until: until.toISOString(),
      adminUrl: `${origin}/admin`,
      truncated: rows.length >= MAX_ROWS,
    });

    // 수시 알림은 새 소식이 없으면 보내지 않는다. 조용한 시간에 "이상 없음" 이 오면
    // 사람은 곧 알림 전체를 무시하게 되고, 정작 필요한 한 통도 같이 묻힌다.
    const shouldSend = mode === "daily" || composed.notable;
    const result = shouldSend ? await sendTelegram(composed.text) : ({ sent: false, reason: "새 소식 없음" } as const);

    if (shouldSend && !result.sent) {
      // 보내기에 실패했으면 자리를 옮기지 않는다. 다음 실행이 같은 창을 다시 집는다.
      throw new Error(result.reason);
    }

    await track({
      kind: "server",
      name: RUN_NAME[mode],
      method: "GET",
      ok: true,
      durationMs: Date.now() - startedAt,
      message: shouldSend ? "" : "새 소식 없음",
      detail: { until: until.toISOString(), since: since.toISOString(), events: rows.length, sent: shouldSend },
      source: "server",
    });

    return Response.json({ mode, sent: shouldSend, events: rows.length, since: since.toISOString(), until: until.toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알림을 보내지 못했습니다.";
    await track({
      kind: "server", name: RUN_NAME[mode], method: "GET", ok: false,
      durationMs: Date.now() - startedAt, message, source: "server",
    });
    return Response.json({ error: message }, { status: 500 });
  }
}
