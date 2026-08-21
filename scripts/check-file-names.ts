/**
 * 올라온 파일 이름 정규화 검증.
 *
 * 이 결함은 **눈으로 절대 못 잡는다.** NFC 와 NFD 는 화면에 똑같이 그려진다. 실제로
 * 2026-08-16 부터 닷새 동안 맥에서 올린 파일 이름이 전부 분해된 채로 쌓였는데, 시연을
 * 되짚어 DB 에 물어보기 전까지 아무도 몰랐다.
 *
 * 그래서 여기서는 '보기에 같다'가 아니라 **글자로 같은가**를 본다.
 *
 * 실행:
 *   npx esbuild scripts/check-file-names.ts --bundle --platform=node --format=esm \
 *     --target=node22 --tsconfig=tsconfig.json --outfile=./_check.mjs --packages=external
 *   node ./_check.mjs && rm ./_check.mjs
 */
import assert from "node:assert/strict";
import { cleanFileName } from "@/lib/file-names";

let checks = 0;
const check = (label: string, run: () => void) => { run(); checks += 1; console.log(`  ✓ ${label}`); };

// 맥에서 올라오는 모양 그대로. 자모가 따로 떨어져 있다.
const NFD = "면담녹취_한주케미칼_20260814.m4a".normalize("NFD");
const NFC = "면담녹취_한주케미칼_20260814.m4a".normalize("NFC");

console.log("\n── 자모 분해 되돌리기 ──");

check("맥에서 온 이름과 사람이 친 이름이 같아진다", () => {
  // 이것이 이 파일의 존재 이유다. 고치기 전에는 이 둘이 다른 문자열이었다.
  assert.notEqual(NFD, NFC, "시험 자체가 틀렸다 — 두 값이 애초에 같으면 검증이 되지 않는다");
  assert.equal(cleanFileName(NFD), NFC);
});

check("길이가 실제로 줄어든다", () => {
  // 23자짜리 이름이 37자로 저장돼 있었다. 글자수가 곧 증거다.
  assert.equal(NFD.length, 37);
  assert.equal(cleanFileName(NFD).length, 23);
});

check("이미 멀쩡한 이름은 건드리지 않는다", () => {
  assert.equal(cleanFileName(NFC), NFC);
});

check("검색이 맞는다", () => {
  // 실제로 깨졌던 것이 이 비교다. DB 에서 like '%한주케미칼%' 이 0건을 돌려줬다.
  assert.equal(NFD.includes("한주케미칼"), false);
  assert.equal(cleanFileName(NFD).includes("한주케미칼"), true);
});

console.log("\n── 나머지 손질 ──");

check("앞뒤 공백을 턴다", () => {
  assert.equal(cleanFileName("  강사프로필.pdf  "), "강사프로필.pdf");
});

check("확장자는 그대로 남는다", () => {
  // 확장자로 mime 을 정하는 자리가 여럿이라 여기서 망가지면 업로드가 통째로 거절된다.
  assert.equal(cleanFileName(NFD).endsWith(".m4a"), true);
  assert.equal(cleanFileName("강의구성.PDF").toLowerCase().endsWith(".pdf"), true);
});

check("문자열이 아니면 빈 값", () => {
  assert.equal(cleanFileName(undefined), "");
  assert.equal(cleanFileName(null), "");
  assert.equal(cleanFileName(12345), "");
});

check("터무니없이 긴 이름은 자른다", () => {
  assert.equal(cleanFileName(`${"가".repeat(500)}.pdf`).length, 300);
});

check("자르기는 정규화 뒤에 한다", () => {
  // 순서가 반대면 NFD 상태로 세어 300자에서 자르고, 그 뒤 정규화하면 300자보다 짧아진다.
  // 더 나쁜 것은 자모 하나가 잘려 나가 글자가 깨지는 경우다.
  const long = `${"각".repeat(400)}.pdf`.normalize("NFD");
  const cleaned = cleanFileName(long);
  assert.equal(cleaned.length, 300);
  assert.equal(cleaned, cleaned.normalize("NFC"), "자른 뒤에 분해된 자모가 남았다");
});

console.log(`\n${checks}개 모두 통과\n`);
