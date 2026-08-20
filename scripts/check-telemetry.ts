/**
 * 사용 기록 이름 정리 검증.
 *
 * 경로에서 id 를 못 걷어내면 회사마다 다른 이름이 되어 아무것도 모이지 않는다. 조용히
 * 깨지는 종류라 — 화면에는 표가 그려지고 숫자만 흩어진다 — 눈으로는 알아채기 어렵다.
 *
 * 실행:
 *   npx esbuild scripts/check-telemetry.ts --bundle --platform=node --format=esm \
 *     --target=node22 --tsconfig=tsconfig.json --outfile=./_check.mjs --packages=external
 *   node ./_check.mjs && rm ./_check.mjs
 */
import assert from "node:assert/strict";
import { friendlyName, isMeaningful, normalizePath } from "@/lib/telemetry";

let checks = 0;
const check = (label: string, run: () => void) => { run(); checks += 1; console.log(`  ✓ ${label}`); };

const UUID_A = "3f2a1b4c-5d6e-4f70-8a91-b2c3d4e5f607";
const UUID_B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

console.log("── 경로 정리 ──");
check("회사 id 를 걷어낸다", () =>
  assert.equal(normalizePath(`/api/companies/${UUID_A}/consultations`), "/api/companies/:id/consultations"));
check("서로 다른 회사가 한 이름으로 모인다", () =>
  assert.equal(normalizePath(`/api/companies/${UUID_A}/sessions`), normalizePath(`/api/companies/${UUID_B}/sessions`)));
check("id 가 둘이어도 모두 걷어낸다", () =>
  assert.equal(normalizePath(`/api/companies/${UUID_A}/consultations/${UUID_B}`), "/api/companies/:id/consultations/:id"));
check("질의 문자열은 버린다", () =>
  assert.equal(normalizePath("/api/admin/events?days=30"), "/api/admin/events"));
// 응답 링크의 토큰은 신원이다. 기록에 남으면 그것만으로 남의 응답 화면에 들어갈 수 있다.
check("만족도 토큰은 남기지 않는다", () =>
  assert.equal(normalizePath("/api/survey/AbCd1234EfGh5678"), "/api/survey/:token"));
check("id 가 없는 경로는 그대로", () =>
  assert.equal(normalizePath("/api/learners/extract"), "/api/learners/extract"));

console.log("\n── 읽기 좋은 이름 ──");
check("상담 녹취", () => assert.equal(friendlyName("POST", "/api/companies/:id/consultations"), "상담 녹취 처리"));
check("직접 입력·메모", () => assert.equal(friendlyName("POST", "/api/companies/:id/consultations/note"), "상담 직접 입력·메모"));
check("결과지 들여오기", () => assert.equal(friendlyName("POST", "/api/surveys/:id/import"), "만족도 결과지 들여오기"));
// 녹취와 메모는 서로 다른 기능이다. 경로가 겹쳐 한 이름으로 뭉치면 어느 쪽이 실패하는지 모른다.
check("녹취와 메모가 뭉치지 않는다", () => assert.notEqual(
  friendlyName("POST", "/api/companies/:id/consultations"),
  friendlyName("POST", "/api/companies/:id/consultations/note")));
check("이름이 없는 것도 빈칸이 되지 않는다", () => {
  const name = friendlyName("PATCH", "/api/instructors/:id");
  assert.ok(name.length > 0, "이름이 비었다");
});

console.log("\n── 셀 만한 것 고르기 ──");
check("쓰기는 센다", () => assert.equal(isMeaningful("POST", "/api/companies/:id/consultations"), true));
check("삭제도 센다", () => assert.equal(isMeaningful("DELETE", "/api/instructors/:id"), true));
// 조회는 화면을 열 때마다 나가서 수가 압도적이다. 무엇을 '했는지' 보는 데 방해가 된다.
check("단순 조회는 빼고 센다", () => assert.equal(isMeaningful("GET", "/api/companies/:id/sessions"), false));
check("PDF 내려받기는 센다", () => assert.equal(isMeaningful("GET", "/api/surveys/:id/report"), true));

console.log(`\n${checks}개 모두 통과`);
