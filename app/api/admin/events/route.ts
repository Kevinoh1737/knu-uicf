/**
 * 베타 사용 현황을 모아 돌려준다.
 *
 * 한 번에 필요한 것을 다 준다 — 화면이 여섯 번 물어보면 그 여섯 번도 기록에 쌓여서
 * 보려는 것을 흐린다.
 */
import { requireTeamSession } from "@/lib/auth/guard";
import { friendlyName, isMeaningful } from "@/lib/telemetry";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_ROWS = 4_000;
const FAILURE_LIST = 60;

type Row = {
  at: string; kind: string; name: string; method: string;
  status: number | null; ok: boolean; duration_ms: number | null;
  message: string; detail: Record<string, unknown>; session_key: string; source: string;
};

/** 한국 시간 기준의 날짜(YYYY-MM-DD). 서버는 UTC 라 그냥 자르면 오전 9시 이전이 전날이 된다. */
function seoulDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date(value));
}

function seoulHour(value: string) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", hour12: false }).format(new Date(value)));
}

export async function GET(request: Request) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const days = Math.max(1, Math.min(30, Number(new URL(request.url).searchParams.get("days")) || 7));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase
      .from("app_events")
      .select("at,kind,name,method,status,ok,duration_ms,message,detail,session_key,source")
      .gte("at", since)
      .order("at", { ascending: false })
      .limit(MAX_ROWS);
    if (error) throw error;
    const rows = (data || []) as Row[];

    // ─── 기능별 ─────────────────────────────────────────────────────────────
    const byFeature = new Map<string, { label: string; total: number; failed: number; totalMs: number; timed: number; slowestMs: number }>();
    rows.forEach((row) => {
      if (row.kind !== "api" || !isMeaningful(row.method, row.name)) return;
      const key = `${row.method} ${row.name}`;
      const current = byFeature.get(key) || { label: friendlyName(row.method, row.name), total: 0, failed: 0, totalMs: 0, timed: 0, slowestMs: 0 };
      current.total += 1;
      if (!row.ok) current.failed += 1;
      if (typeof row.duration_ms === "number") {
        current.totalMs += row.duration_ms;
        current.timed += 1;
        current.slowestMs = Math.max(current.slowestMs, row.duration_ms);
      }
      byFeature.set(key, current);
    });
    const features = [...byFeature.values()]
      .map((item) => ({
        label: item.label, total: item.total, failed: item.failed,
        averageMs: item.timed ? Math.round(item.totalMs / item.timed) : null,
        slowestMs: item.slowestMs || null,
      }))
      .sort((left, right) => right.total - left.total);

    // ─── 실패 ───────────────────────────────────────────────────────────────
    // 같은 실패가 열 번 나면 열 줄이 아니라 한 줄에 '10번' 이라고 적어야 읽힌다.
    const failureGroups = new Map<string, { label: string; message: string; status: number | null; count: number; lastAt: string; source: string; kind: string }>();
    rows.filter((row) => !row.ok).forEach((row) => {
      const key = `${row.kind}|${row.name}|${row.status}|${row.message.slice(0, 120)}`;
      const current = failureGroups.get(key);
      if (current) { current.count += 1; return; }
      failureGroups.set(key, {
        label: row.kind === "error" ? "화면 오류" : friendlyName(row.method, row.name),
        message: row.message, status: row.status, count: 1, lastAt: row.at,
        source: row.source, kind: row.kind,
      });
    });
    const failures = [...failureGroups.values()]
      .sort((left, right) => right.lastAt.localeCompare(left.lastAt))
      .slice(0, FAILURE_LIST);

    // ─── 날짜별·시간대별 ────────────────────────────────────────────────────
    const byDay = new Map<string, { total: number; failed: number; people: Set<string> }>();
    const byHour = new Array<number>(24).fill(0);
    rows.forEach((row) => {
      if (row.kind !== "api") return;
      const day = seoulDate(row.at);
      const current = byDay.get(day) || { total: 0, failed: 0, people: new Set<string>() };
      current.total += 1;
      if (!row.ok) current.failed += 1;
      if (row.session_key) current.people.add(row.session_key);
      byDay.set(day, current);
      if (isMeaningful(row.method, row.name)) byHour[seoulHour(row.at)] += 1;
    });
    const daily = [...byDay.entries()]
      .map(([day, item]) => ({ day, total: item.total, failed: item.failed, people: item.people.size }))
      .sort((left, right) => left.day.localeCompare(right.day));

    // ─── 품질 신호 ──────────────────────────────────────────────────────────
    const quality = rows
      .filter((row) => row.kind === "quality")
      .slice(0, 40)
      .map((row) => ({ at: row.at, name: row.name, detail: row.detail }));

    const apiRows = rows.filter((row) => row.kind === "api");
    const failed = rows.filter((row) => !row.ok).length;

    return Response.json({
      days,
      // 기록이 4천 건에서 잘렸으면 화면이 그 사실을 알아야 한다. 모르면 '조용한 하루'로 읽힌다.
      truncated: rows.length >= MAX_ROWS,
      totals: {
        requests: apiRows.length,
        failures: failed,
        failureRate: apiRows.length ? Math.round((failed / apiRows.length) * 1000) / 10 : 0,
        people: new Set(rows.map((row) => row.session_key).filter(Boolean)).size,
        activeDays: daily.filter((day) => day.total > 0).length,
      },
      features, failures, daily, hourly: byHour, quality,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "사용 현황을 불러오지 못했습니다.";
    // 표가 아직 없으면(마이그레이션 전) 무엇을 해야 하는지 알려 준다.
    if (/app_events/.test(message)) {
      return Response.json({ error: "사용 기록 표가 아직 없습니다. 마이그레이션 20260821110000 을 적용해 주세요." }, { status: 409 });
    }
    return Response.json({ error: message }, { status: 500 });
  }
}
