/**
 * 결과지 들여오기 검증.
 *
 * 이 레포에는 테스트 러너가 붙어 있지 않아 스크립트로 남긴다. 손대고 나서 한 번 돌려 보면
 * 조용히 깨졌는지 알 수 있다 — 특히 척도 변환은 틀려도 화면이 멀쩡해 보이고, 평균만
 * 슬그머니 달라진다.
 *
 * 실행:
 *   npx esbuild scripts/check-survey-import.ts --bundle --platform=node --format=esm \
 *     --target=node22 --tsconfig=tsconfig.json --outfile=./_check.mjs --packages=external
 *   node ./_check.mjs && rm ./_check.mjs
 */
import assert from "node:assert/strict";
import { DEFAULT_QUESTIONS, SurveyQuestion } from "@/lib/surveys";
import { buildRows, proposeMapping, readCsvRows, toAnswer, ImportColumn } from "@/lib/survey-import";

const questions = DEFAULT_QUESTIONS;
const scale = questions.find((question) => question.type === "scale") as SurveyQuestion;
const text = questions.find((question) => question.type === "text") as SurveyQuestion;
let checks = 0;
const check = (label: string, run: () => void) => { run(); checks += 1; console.log(`  ✓ ${label}`); };

console.log("── 척도 변환 ──");
// 구글폼은 폼 설정에 따라 숫자로도 글자로도 내보낸다. 셋 다 같은 점수가 되어야 한다.
check("숫자 그대로", () => assert.equal(toAnswer(scale, "4"), 4));
check("'3점' 처럼 단위가 붙어도", () => assert.equal(toAnswer(scale, "3점"), 3));
check("우리 눈금 문구", () => assert.equal(toAnswer(scale, "매우 그렇다"), 5));
check("가운데 눈금", () => assert.equal(toAnswer(scale, "보통이다"), 3));
check("공백이 달라도", () => assert.equal(toAnswer(scale, " 그렇다 "), 4));
// 범위 밖은 버린다. 7점 척도 폼을 잘못 올렸을 때 5점으로 눌러 담으면 평균이 거짓이 된다.
check("범위 밖은 버림", () => assert.equal(toAnswer(scale, "7"), null));
check("0 도 버림", () => assert.equal(toAnswer(scale, "0"), null));
check("빈 칸은 무응답", () => assert.equal(toAnswer(scale, ""), null));
check("모르는 말은 버림", () => assert.equal(toAnswer(scale, "몰라요"), null));
check("서술형은 글 그대로", () => assert.equal(toAnswer(text, " 좋았습니다 "), "좋았습니다"));

console.log("\n── 짝짓기 ──");
const headers = [
  "타임스탬프", "이메일 주소", "이름",
  "강사의 설명이 이해하기 쉬웠나요?",          // 어미만 다름 → 붙어야 한다
  "교육 시간과 진도는 적절했나요?",            // 낱말 하나 다름 → 붙어야 한다
  "더 다뤘으면 하는 내용이나 개선점이 있다면 적어 주세요", // 마침표만 다름 → 붙어야 한다
  "오늘 점심은 어떠셨나요?",                   // 남의 문항 → 절대 붙으면 안 된다
];
const columns: ImportColumn[] = headers.map((header, index) => ({ index, header, samples: [] }));
const mappings = proposeMapping(columns, questions);
const roleAt = (index: number) => mappings.find((mapping) => mapping.index === index);

check("타임스탬프 열을 알아본다", () => assert.equal(roleAt(0)?.role, "timestamp"));
check("이메일 열을 알아본다", () => assert.equal(roleAt(1)?.role, "email"));
check("이름 열을 알아본다", () => assert.equal(roleAt(2)?.role, "name"));
check("어미만 다른 문항이 붙는다", () => assert.equal(roleAt(3)?.questionId, "delivery"));
check("낱말 하나 다른 문항이 붙는다", () => assert.equal(roleAt(4)?.questionId, "duration"));
check("마침표만 다른 문항이 붙는다", () => assert.equal(roleAt(5)?.questionId, "improve"));
// 가장 중요한 검사다. 엉뚱한 짝은 조용히 틀린 평균을 만들고, 비교 화면의 색으로만 드러난다.
check("남의 문항은 붙지 않는다", () => assert.equal(roleAt(6)?.role, "skip"));
check("한 문항에 두 열이 걸리지 않는다", () => {
  const used = mappings.filter((mapping) => mapping.role === "question").map((mapping) => mapping.questionId);
  assert.equal(new Set(used).size, used.length);
});

console.log("\n── 표 읽기 ──");
const csv = `타임스탬프,이름,강사의 설명이 이해하기 쉬웠나요?,교육 시간과 진도는 적절했나요?
2026/08/20 오후 5:02:11,김민수,5,4
2026/08/20 오후 5:03:40,"이,서연",매우 그렇다,3
2026/08/20 오후 5:04:02,박준호,,
,,,`;
const rows = readCsvRows(csv);
const body = rows.slice(1).filter((row) => row.some((cell) => cell.trim()));
const built = buildRows(body, proposeMapping(
  rows[0].map((header, index) => ({ index, header, samples: [] })), questions,
), questions);

check("따옴표 안의 쉼표를 지킨다", () => assert.equal(rows[2][1], "이,서연"));
check("답이 하나도 없는 줄은 버린다", () => assert.equal(built.length, 2));
check("이름을 가져온다", () => assert.deepEqual(built.map((row) => row.name), ["김민수", "이,서연"]));
check("글자 눈금도 점수가 된다", () => assert.equal(built[1].answers.delivery, 5));
check("빈 칸은 못읽음으로 세지 않는다", () => assert.equal(built.reduce((sum, row) => sum + row.unreadable, 0), 0));

console.log(`\n${checks}개 모두 통과`);
