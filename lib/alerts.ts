/**
 * 사용 기록에서 '지금 알려야 할 것' 만 골라 텔레그램 한 장으로 만든다.
 *
 * `/admin` 은 열어야 보인다. 베타 중에 정작 필요한 것은 **열지 않아도 오는 것** 이다 —
 * 교육사업팀이 상담을 못 올리고 있는데 우리가 저녁에야 아는 상황을 없애는 게 목적이다.
 *
 * 두 가지를 보낸다:
 *   - 수시(hourly): 지난 알림 뒤로 **새로 생긴** 실패·품질 경고·느린 작업. 없으면 안 보낸다.
 *     조용한 시간에도 "이상 없음" 이 오면 사람은 곧 알림을 무시하게 된다.
 *   - 마감(daily): 그날 무슨 일이 있었는지 한 장. 조용했어도 보낸다 — '조용했다' 도 정보다.
 *
 * 여기 함수들은 DB 를 모른다. 행을 받아 글자를 돌려줄 뿐이라 시험하기 쉽다
 * (scripts/check-alerts.ts).
 */
import { escapeHtml } from "@/lib/telegram";
import { friendlyName, isMeaningful } from "@/lib/telemetry";

export type EventRow = {
  at: string;
  kind: string;
  name: string;
  method: string;
  status: number | null;
  ok: boolean;
  duration_ms: number | null;
  message: string;
  detail: Record<string, unknown>;
  session_key: string;
  source: string;
};

export type AlertMode = "hourly" | "daily";

/**
 * 느림의 기준.
 *
 * 이 시스템은 느린 게 정상인 일을 한다 — 기업 조사도 상담 분석도 모델이 한참 생각한다.
 * 그래서 '몇 초 넘으면 느림' 이라는 절대 기준은 쓸 수 없다. 지난 이레의 그 기능 평균과
 * 견줘서 두 배 넘게 걸렸을 때만 느리다고 본다. 다만 평소가 워낙 짧은 기능은 두 배라
 * 해봐야 사람이 못 느끼므로, 바닥값을 두어 그 아래는 조용히 넘긴다.
 */
const SLOW_MULTIPLIER = 2;
const SLOW_FLOOR_MS = 45_000;

const LIST_LIMIT = 8;
const MESSAGE_CLIP = 160;

/** 지난 이레 기준 기능별 평균 소요시간. 느림 판정의 잣대다. */
export type Baseline = Map<string, number>;

export function featureKey(row: { method: string; name: string }) {
  return `${row.method} ${row.name}`;
}

export function buildBaseline(rows: EventRow[]): Baseline {
  const totals = new Map<string, { sum: number; count: number }>();
  rows.forEach((row) => {
    if (row.kind !== "api" || typeof row.duration_ms !== "number" || !row.ok) return;
    const key = featureKey(row);
    const current = totals.get(key) || { sum: 0, count: 0 };
    current.sum += row.duration_ms;
    current.count += 1;
    totals.set(key, current);
  });
  const baseline: Baseline = new Map();
  totals.forEach((value, key) => {
    // 한두 번 돌아본 기능의 '평균' 은 평균이 아니다. 표본이 적으면 잣대로 쓰지 않는다.
    if (value.count >= 5) baseline.set(key, value.sum / value.count);
  });
  return baseline;
}

export function seoulTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value));
}

export function seoulDay(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short",
  }).format(new Date(value));
}

function seconds(ms: number) {
  return ms >= 60_000 ? `${Math.round(ms / 6_000) / 10}분` : `${Math.round(ms / 100) / 10}초`;
}

function clip(value: string, limit = MESSAGE_CLIP) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

// ─── 실패 ──────────────────────────────────────────────────────────────────

export type FailureGroup = {
  label: string;
  message: string;
  status: number | null;
  count: number;
  lastAt: string;
  kind: string;
};

/** 같은 실패가 열 번 나면 열 줄이 아니라 한 줄에 '10번' 이라고 적어야 읽힌다. */
export function groupFailures(rows: EventRow[]): FailureGroup[] {
  const groups = new Map<string, FailureGroup>();
  rows.filter((row) => !row.ok).forEach((row) => {
    const key = `${row.kind}|${row.name}|${row.status}|${row.message.slice(0, 120)}`;
    const current = groups.get(key);
    if (current) {
      current.count += 1;
      if (row.at > current.lastAt) current.lastAt = row.at;
      return;
    }
    groups.set(key, {
      // 화면에서 터진 오류도 어느 기능인지 붙여 준다. '화면 오류' 만 오면 열어 보기 전까지
      // 무엇이 안 되는지 알 수 없어, 알림이 알림 구실을 못 한다.
      label: row.kind === "error"
        ? `화면 오류 · ${friendlyName(row.method, row.name)}`
        : friendlyName(row.method, row.name),
      message: row.message,
      status: row.status,
      count: 1,
      lastAt: row.at,
      kind: row.kind,
    });
  });
  return [...groups.values()].sort((left, right) => right.lastAt.localeCompare(left.lastAt));
}

// ─── 품질 신호 ─────────────────────────────────────────────────────────────

export type QualityWarning = { at: string; label: string; note: string };

/**
 * '반쯤 된 결과' 를 골라낸다.
 *
 * 실패는 스스로 드러나지만 이건 아니다 — 화면에는 표가 그려지고 사람은 넘어간다. 그래서
 * 무엇이 얼마나 모자랐는지 숫자로 남겨 뒀고(lib/telemetry.ts trackQuality), 여기서 그 숫자가
 * 사람 손을 부를 만한지 판단한다. 문턱은 실제 기록이 쌓이면 조정할 값이다.
 */
export function qualityWarnings(rows: EventRow[]): QualityWarning[] {
  const warnings: QualityWarning[] = [];
  rows.filter((row) => row.kind === "quality").forEach((row) => {
    const detail = row.detail || {};
    const num = (key: string) => (typeof detail[key] === "number" ? detail[key] as number : null);

    if (row.name === "상담 메모 판독") {
      const unreadable = num("unreadableMarks") ?? 0;
      const chars = num("chars") ?? 0;
      // 판독불가 표시가 여럿이면 사진이 흐렸다는 뜻이고, 그 상담 기록은 반쯤 비어 있다.
      if (unreadable >= 3) warnings.push({ at: row.at, label: row.name, note: `못 읽은 자리 ${unreadable}곳 (읽어 낸 글 ${chars}자)` });
      else if (chars > 0 && chars < 200) warnings.push({ at: row.at, label: row.name, note: `읽어 낸 글이 ${chars}자뿐` });
    }

    if (row.name === "결과지 짝짓기 제안") {
      const auto = num("autoMatched") ?? 0;
      const questions = num("questions") ?? 0;
      // 자동으로 못 붙인 문항이 많으면 사람이 그만큼 손으로 짝지어야 한다.
      if (questions > 0 && auto / questions < 0.7) {
        warnings.push({ at: row.at, label: row.name, note: `문항 ${questions}개 중 ${auto}개만 자동으로 붙음` });
      }
    }

    if (row.name === "결과지 들여오기 확정") {
      const corrected = num("correctedByHand") ?? 0;
      const unreadableCells = num("unreadableCells") ?? 0;
      const matched = num("matchedQuestions") ?? 0;
      const total = num("totalQuestions") ?? 0;
      const parts: string[] = [];
      // 사람이 손댄 횟수가 자동 짝짓기의 진짜 성적표다.
      if (corrected > 0) parts.push(`사람이 ${corrected}개 고침`);
      if (unreadableCells > 0) parts.push(`못 읽은 칸 ${unreadableCells}개`);
      if (total > 0 && matched < total) parts.push(`문항 ${total}개 중 ${matched}개만 채워짐`);
      if (parts.length) warnings.push({ at: row.at, label: row.name, note: parts.join(" · ") });
    }
  });
  return warnings.sort((left, right) => right.at.localeCompare(left.at));
}

// ─── 느린 작업 ─────────────────────────────────────────────────────────────

export type SlowRun = { at: string; label: string; ms: number; baselineMs: number };

export function slowRuns(rows: EventRow[], baseline: Baseline): SlowRun[] {
  const slow: SlowRun[] = [];
  rows.forEach((row) => {
    if (row.kind !== "api" || typeof row.duration_ms !== "number") return;
    if (row.duration_ms < SLOW_FLOOR_MS) return;
    const base = baseline.get(featureKey(row));
    if (!base || row.duration_ms < base * SLOW_MULTIPLIER) return;
    slow.push({ at: row.at, label: friendlyName(row.method, row.name), ms: row.duration_ms, baselineMs: Math.round(base) });
  });
  return slow.sort((left, right) => right.ms - left.ms);
}

// ─── 사용량 ────────────────────────────────────────────────────────────────

export type FeatureUse = { label: string; total: number; failed: number; averageMs: number | null; slowestMs: number | null };

export function featureUsage(rows: EventRow[]): FeatureUse[] {
  const byFeature = new Map<string, { label: string; total: number; failed: number; totalMs: number; timed: number; slowestMs: number }>();
  rows.forEach((row) => {
    if (row.kind !== "api" || !isMeaningful(row.method, row.name)) return;
    const key = featureKey(row);
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
  return [...byFeature.values()]
    .map((item) => ({
      label: item.label, total: item.total, failed: item.failed,
      averageMs: item.timed ? Math.round(item.totalMs / item.timed) : null,
      slowestMs: item.slowestMs || null,
    }))
    .sort((left, right) => right.total - left.total);
}

// ─── 한 장으로 ─────────────────────────────────────────────────────────────

export type Composed = { notable: boolean; text: string };

export function composeAlert(input: {
  mode: AlertMode;
  rows: EventRow[];
  baseline: Baseline;
  since: string;
  until: string;
  adminUrl: string;
  truncated?: boolean;
}): Composed {
  const { mode, rows, baseline, since, until, adminUrl } = input;
  const failures = groupFailures(rows);
  const warnings = qualityWarnings(rows);
  const slow = slowRuns(rows, baseline);
  const usage = featureUsage(rows);

  const apiRows = rows.filter((row) => row.kind === "api");
  const failedCount = rows.filter((row) => !row.ok).length;
  const people = new Set(rows.map((row) => row.session_key).filter(Boolean)).size;

  const notable = failures.length > 0 || warnings.length > 0 || slow.length > 0;
  const lines: string[] = [];

  if (mode === "hourly") {
    lines.push(`<b>KNU 교육사업 · 새 소식</b>`);
    lines.push(`<i>${escapeHtml(seoulTime(since))}~${escapeHtml(seoulTime(until))}</i>`);
  } else {
    lines.push(`<b>KNU 교육사업 · ${escapeHtml(seoulDay(until))} 마감</b>`);
    lines.push(
      apiRows.length
        ? `<i>${people || "?"}명이 ${apiRows.length}번 썼고, 그중 ${failedCount}번 실패했습니다.</i>`
        : `<i>오늘은 아무도 쓰지 않았습니다.</i>`,
    );
  }

  if (input.truncated) {
    lines.push(`\n⚠ 기록이 상한에서 잘렸습니다. 아래 숫자는 실제보다 적습니다.`);
  }

  if (failures.length) {
    lines.push(`\n<b>실패 ${failures.length}종</b>`);
    failures.slice(0, LIST_LIMIT).forEach((item) => {
      const times = item.count > 1 ? ` ×${item.count}` : "";
      const status = item.status ? ` [${item.status}]` : "";
      lines.push(`• <b>${escapeHtml(item.label)}</b>${escapeHtml(times)}${escapeHtml(status)} — ${escapeHtml(seoulTime(item.lastAt))}`);
      if (item.message) lines.push(`  ${escapeHtml(clip(item.message))}`);
    });
    if (failures.length > LIST_LIMIT) lines.push(`  …외 ${failures.length - LIST_LIMIT}종`);
  }

  if (warnings.length) {
    lines.push(`\n<b>반쯤 된 결과 ${warnings.length}건</b>`);
    warnings.slice(0, LIST_LIMIT).forEach((item) => {
      lines.push(`• ${escapeHtml(item.label)} — ${escapeHtml(item.note)} (${escapeHtml(seoulTime(item.at))})`);
    });
    if (warnings.length > LIST_LIMIT) lines.push(`  …외 ${warnings.length - LIST_LIMIT}건`);
  }

  if (slow.length) {
    lines.push(`\n<b>평소보다 느림 ${slow.length}건</b>`);
    slow.slice(0, 5).forEach((item) => {
      lines.push(`• ${escapeHtml(item.label)} — ${escapeHtml(seconds(item.ms))} (평소 ${escapeHtml(seconds(item.baselineMs))}) ${escapeHtml(seoulTime(item.at))}`);
    });
    if (slow.length > 5) lines.push(`  …외 ${slow.length - 5}건`);
  }

  if (mode === "daily" && usage.length) {
    lines.push(`\n<b>무엇을 썼나</b>`);
    usage.slice(0, LIST_LIMIT).forEach((item) => {
      const failed = item.failed ? ` (실패 ${item.failed})` : "";
      const took = item.averageMs ? ` · 평균 ${seconds(item.averageMs)}` : "";
      lines.push(`• ${escapeHtml(item.label)} ${item.total}번${escapeHtml(failed)}${escapeHtml(took)}`);
    });
    if (usage.length > LIST_LIMIT) lines.push(`  …외 ${usage.length - LIST_LIMIT}가지`);
  }

  if (mode === "daily" && !notable && apiRows.length) {
    lines.push(`\n실패도 품질 경고도 없었습니다.`);
  }

  lines.push(`\n<a href="${escapeHtml(adminUrl)}">/admin 에서 자세히 보기</a>`);
  return { notable, text: lines.join("\n") };
}
