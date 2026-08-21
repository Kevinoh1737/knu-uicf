/**
 * 텔레그램 알림 고르기 검증.
 *
 * 이 코드가 조용히 깨지는 방식은 둘이다. **너무 안 보내거나**(실패가 났는데 문턱에 안 걸려
 * 아무 일 없는 척) **너무 보내거나**(조용한 시간에도 알림이 와서 사람이 곧 다 무시하게
 * 된다). 둘 다 화면에는 아무 표시가 안 난다 — 안 온 알림은 눈에 띄지 않는다.
 *
 * 오류 문구에 든 꺾쇠도 여기서 잡는다. 텔레그램 HTML 서식은 잘못된 태그를 만나면 메시지
 * 전체를 거절하므로, 한 글자 때문에 그 시간 알림이 통째로 사라진다.
 *
 * 실행:
 *   npx esbuild scripts/check-alerts.ts --bundle --platform=node --format=esm \
 *     --target=node22 --tsconfig=tsconfig.json --outfile=./_check.mjs --packages=external
 *   node ./_check.mjs && rm ./_check.mjs
 */
import assert from "node:assert/strict";
import {
  buildBaseline, composeAlert, EventRow, groupFailures, qualityWarnings, slowRuns,
} from "@/lib/alerts";
import { escapeHtml } from "@/lib/telegram";

let checks = 0;
const check = (label: string, run: () => void) => { run(); checks += 1; console.log(`  ✓ ${label}`); };

const BASE = "2026-08-21T02:00:00.000Z";
const at = (minutes: number) => new Date(new Date(BASE).getTime() + minutes * 60_000).toISOString();

function row(partial: Partial<EventRow>): EventRow {
  return {
    at: at(0), kind: "api", name: "/api/companies/:id/consultations", method: "POST",
    status: 200, ok: true, duration_ms: null, message: "", detail: {},
    session_key: "s1", source: "client",
    ...partial,
  };
}

const ARGS = { since: at(-60), until: at(0), adminUrl: "https://knu-uicf-edu.synthya.ai/admin" };

console.log("\n── 실패 묶기 ──");

check("같은 실패는 한 줄에 횟수로", () => {
  const groups = groupFailures([
    row({ ok: false, status: 422, message: "메모에서 글을 충분히 읽지 못했습니다." }),
    row({ ok: false, status: 422, message: "메모에서 글을 충분히 읽지 못했습니다.", at: at(5) }),
    row({ ok: false, status: 422, message: "메모에서 글을 충분히 읽지 못했습니다.", at: at(9) }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 3);
  // 마지막에 난 시각이어야 한다. 처음 것으로 적으면 '언제부터 계속인가' 를 못 읽는다.
  assert.equal(groups[0].lastAt, at(9));
});

check("다른 실패는 갈라 놓는다", () => {
  const groups = groupFailures([
    row({ ok: false, status: 422, message: "가" }),
    row({ ok: false, status: 500, message: "나" }),
  ]);
  assert.equal(groups.length, 2);
});

check("성공은 실패에 섞이지 않는다", () => {
  assert.equal(groupFailures([row({ ok: true }), row({ ok: true, status: 200 })]).length, 0);
});

check("화면 오류에도 어느 기능인지 붙는다", () => {
  // '화면 오류' 만 오면 /admin 을 열기 전까지 무엇이 안 되는지 알 수 없다.
  const groups = groupFailures([
    row({ kind: "error", ok: false, name: "/api/uploads/consultation-audio", message: "Failed to fetch" }),
  ]);
  assert.equal(groups[0].label, "화면 오류 · 파일 업로드 준비");
});

console.log("\n── 반쯤 된 결과 고르기 ──");

check("못 읽은 자리가 여럿이면 알린다", () => {
  const warnings = qualityWarnings([
    row({ kind: "quality", name: "상담 메모 판독", detail: { chars: 900, unreadableMarks: 4 } }),
  ]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].note, /4곳/);
});

check("멀쩡히 읽힌 메모는 조용하다", () => {
  const warnings = qualityWarnings([
    row({ kind: "quality", name: "상담 메모 판독", detail: { chars: 1400, unreadableMarks: 0 } }),
  ]);
  assert.equal(warnings.length, 0);
});

check("읽어 낸 글이 너무 짧아도 알린다", () => {
  const warnings = qualityWarnings([
    row({ kind: "quality", name: "상담 메모 판독", detail: { chars: 80, unreadableMarks: 0 } }),
  ]);
  assert.equal(warnings.length, 1);
});

check("자동 짝짓기가 절반이면 알린다", () => {
  const warnings = qualityWarnings([
    row({ kind: "quality", name: "결과지 짝짓기 제안", detail: { questions: 10, autoMatched: 5 } }),
  ]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].note, /10개 중 5개/);
});

check("거의 다 붙었으면 조용하다", () => {
  const warnings = qualityWarnings([
    row({ kind: "quality", name: "결과지 짝짓기 제안", detail: { questions: 10, autoMatched: 9 } }),
  ]);
  assert.equal(warnings.length, 0);
});

check("사람이 손으로 고쳤으면 알린다", () => {
  const warnings = qualityWarnings([
    row({ kind: "quality", name: "결과지 들여오기 확정", detail: { correctedByHand: 3, unreadableCells: 0, matchedQuestions: 8, totalQuestions: 8 } }),
  ]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].note, /3개 고침/);
});

check("깨끗이 들여왔으면 조용하다", () => {
  const warnings = qualityWarnings([
    row({ kind: "quality", name: "결과지 들여오기 확정", detail: { correctedByHand: 0, unreadableCells: 0, matchedQuestions: 8, totalQuestions: 8 } }),
  ]);
  assert.equal(warnings.length, 0);
});

console.log("\n── 느림 재기 ──");

const slowBaseline = buildBaseline(
  // 평소 30초 걸리는 기능. 표본을 다섯 건 이상 줘야 잣대로 인정된다.
  Array.from({ length: 6 }, (_, index) => row({ name: "/api/companies/research", duration_ms: 30_000, at: at(-index) })),
);

check("표본이 다섯 건 미만이면 잣대로 쓰지 않는다", () => {
  const thin = buildBaseline([row({ name: "/api/x", duration_ms: 1_000 }), row({ name: "/api/x", duration_ms: 1_000 })]);
  assert.equal(thin.size, 0);
});

check("평소의 두 배를 넘으면 느리다", () => {
  const slow = slowRuns([row({ name: "/api/companies/research", duration_ms: 95_000 })], slowBaseline);
  assert.equal(slow.length, 1);
  assert.equal(slow[0].baselineMs, 30_000);
});

check("두 배 안쪽이면 조용하다", () => {
  assert.equal(slowRuns([row({ name: "/api/companies/research", duration_ms: 50_000 })], slowBaseline).length, 0);
});

check("평소가 짧은 일은 두 배라도 넘어간다", () => {
  // 0.2초가 0.5초가 된 것은 사람이 못 느낀다. 바닥값 아래는 세지 않는다.
  const quick = buildBaseline(Array.from({ length: 6 }, () => row({ name: "/api/learners", duration_ms: 200 })));
  assert.equal(slowRuns([row({ name: "/api/learners", duration_ms: 900 })], quick).length, 0);
});

check("실패한 실행은 잣대에 넣지 않는다", () => {
  // 3초 만에 터진 실행이 평균을 끌어내리면 멀쩡한 실행이 전부 '느림' 이 된다.
  const mixed = buildBaseline([
    ...Array.from({ length: 6 }, () => row({ name: "/api/companies/research", duration_ms: 30_000 })),
    ...Array.from({ length: 6 }, () => row({ name: "/api/companies/research", duration_ms: 3_000, ok: false })),
  ]);
  assert.equal(mixed.get("POST /api/companies/research"), 30_000);
});

console.log("\n── 보낼까 말까 ──");

check("조용한 시간에는 수시 알림을 안 보낸다", () => {
  const composed = composeAlert({
    mode: "hourly", rows: [row({ ok: true }), row({ ok: true })],
    baseline: new Map(), ...ARGS,
  });
  assert.equal(composed.notable, false);
});

check("기록이 아예 없어도 수시 알림은 안 보낸다", () => {
  assert.equal(composeAlert({ mode: "hourly", rows: [], baseline: new Map(), ...ARGS }).notable, false);
});

check("실패가 하나라도 있으면 보낸다", () => {
  const composed = composeAlert({
    mode: "hourly", rows: [row({ ok: false, status: 500, message: "터졌습니다" })],
    baseline: new Map(), ...ARGS,
  });
  assert.equal(composed.notable, true);
  assert.match(composed.text, /터졌습니다/);
});

check("품질 경고만 있어도 보낸다", () => {
  const composed = composeAlert({
    mode: "hourly",
    rows: [row({ kind: "quality", name: "상담 메모 판독", detail: { chars: 900, unreadableMarks: 5 } })],
    baseline: new Map(), ...ARGS,
  });
  assert.equal(composed.notable, true);
});

check("마감 요약은 조용했어도 보낸다", () => {
  const composed = composeAlert({ mode: "daily", rows: [], baseline: new Map(), ...ARGS });
  assert.equal(composed.text.includes("마감"), true);
  assert.match(composed.text, /아무도 쓰지 않았습니다/);
});

check("마감 요약에 사람 수와 횟수가 들어간다", () => {
  const composed = composeAlert({
    mode: "daily",
    rows: [row({ session_key: "a" }), row({ session_key: "b" }), row({ session_key: "a" })],
    baseline: new Map(), ...ARGS,
  });
  assert.match(composed.text, /2명이 3번/);
});

check("마감 요약에 무엇을 썼는지 들어간다", () => {
  const composed = composeAlert({
    mode: "daily", rows: [row({}), row({})], baseline: new Map(), ...ARGS,
  });
  assert.match(composed.text, /상담 녹취 처리 2번/);
});

check("잘린 기록은 잘렸다고 말한다", () => {
  // 이걸 안 적으면 상한에 걸려 잘린 하루가 '조용한 하루' 로 읽힌다.
  const composed = composeAlert({ mode: "daily", rows: [row({})], baseline: new Map(), truncated: true, ...ARGS });
  assert.match(composed.text, /잘렸습니다/);
});

console.log("\n── 서식 지키기 ──");

check("오류 문구의 꺾쇠가 태그가 되지 않는다", () => {
  const composed = composeAlert({
    mode: "hourly",
    rows: [row({ ok: false, message: 'Unexpected token <!DOCTYPE "html"> & more' })],
    baseline: new Map(), ...ARGS,
  });
  // 우리가 연 태그(<b> 등)를 뺀 나머지에 날 꺾쇠가 남아 있으면 텔레그램이 메시지를 거절한다.
  const stripped = composed.text.replace(/<\/?(b|i|a)(\s[^>]*)?>/g, "");
  assert.equal(stripped.includes("<"), false, "escape 되지 않은 꺾쇠가 남았습니다");
  assert.match(composed.text, /&lt;!DOCTYPE/);
  assert.match(composed.text, /&amp; more/);
});

check("escapeHtml 은 세 글자를 모두 바꾼다", () => {
  assert.equal(escapeHtml('<a & b>'), "&lt;a &amp; b&gt;");
});

check("한 통이 텔레그램 상한에 닿지 않는다", () => {
  // 실패가 쏟아진 최악의 하루에도 4096자를 넘기지 않아야 한다.
  const many = Array.from({ length: 200 }, (_, index) => row({
    ok: false, status: 500, at: at(-index),
    name: `/api/companies/:id/thing-${index}`,
    message: "무엇인가 크게 잘못되었습니다. ".repeat(20),
  }));
  const composed = composeAlert({ mode: "daily", rows: many, baseline: new Map(), ...ARGS });
  assert.ok(composed.text.length < 4_096, `길이 ${composed.text.length}`);
});

check("/admin 링크가 늘 붙는다", () => {
  const composed = composeAlert({ mode: "daily", rows: [], baseline: new Map(), ...ARGS });
  assert.match(composed.text, /knu-uicf-edu\.synthya\.ai\/admin/);
});

console.log(`\n${checks}개 모두 통과\n`);
