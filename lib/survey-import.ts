/**
 * 구글폼 결과지를 우리 집계로 들여오기.
 *
 * 현장에서는 수업이 끝나자마자 휴대폰으로 받는다. 그 결과가 구글폼에 쌓이고, 담당자는
 * 엑셀로 내려받는다. 여기서 하는 일은 그 표를 우리 문항에 짝지어 주는 것뿐이다.
 *
 * 짝짓기가 이 일의 전부이자 어려운 부분이다. 구글폼 열 제목은 담당자가 폼에 적은 문장이고
 * 우리 문항은 질문지에 적힌 문장이라, 글자가 같을 이유가 없다 — 게다가 폼 문구는 해마다
 * 조금씩 손본다. 그래서 여기서는 '확실한 것만' 기계로 짝짓고, 나머지는 사람에게 넘긴다.
 * 반쯤 맞는 짝을 조용히 확정하면 엉뚱한 문항에 점수가 쌓이고, 그건 비교 화면에서
 * 색깔로만 드러나서 아무도 원인을 못 찾는다.
 */
import { SCALE_LABELS, SCALE_MAX, SurveyQuestion } from "@/lib/surveys";

export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_COLUMNS = 60;
export const MAX_SURVEY_IMPORT_SIZE = 5 * 1024 * 1024;
export const SURVEY_IMPORT_ACCEPT = ".xlsx,.csv";

/** 구글폼이 스스로 붙이는 열. 문항이 아니므로 짝짓기 후보에서 빼 둔다. */
const TIMESTAMP_HEADERS = ["타임스탬프", "timestamp", "제출 시간", "응답 시간"];
const EMAIL_HEADERS = ["이메일 주소", "email address", "이메일", "email", "메일"];
const NAME_HEADERS = ["이름", "성명", "name", "참석자", "수강생", "성함"];

export type ImportColumn = {
  index: number;
  header: string;
  /** 이 열의 실제 값 몇 개. 사람이 짝을 확인할 때 제목만으로는 부족하다. */
  samples: string[];
};

export type ColumnRole = "question" | "name" | "email" | "timestamp" | "skip";

export type ColumnMapping = {
  index: number;
  role: ColumnRole;
  /** role 이 question 일 때만 쓴다. */
  questionId: string;
  /** 기계가 짝지은 것인가, 사람이 고른 것인가. 화면이 갈라 보여 준다. */
  auto: boolean;
  /** 왜 이렇게 짝지었는지 한 줄. 사람이 확인할 때 읽는다. */
  reason: string;
};

function normalize(value: string) {
  // 문장부호·공백·괄호는 폼마다 다르게 붙는다. 글자만 남겨 견준다.
  return value.toLowerCase().replace(/[\s ]+/g, "").replace(/[.,!?()[\]{}'"·：:;/\\-]/g, "");
}

function matchesAny(header: string, candidates: string[]) {
  const target = normalize(header);
  return candidates.some((candidate) => target === normalize(candidate) || target.startsWith(normalize(candidate)));
}

/** 쓰인 글자가 얼마나 겹치는가. 어미·조사가 달라도 남는 신호다. */
function charOverlap(left: string, right: string) {
  const a = new Set(left);
  const b = new Set(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  a.forEach((character) => { if (b.has(character)) shared += 1; });
  return shared / (a.size + b.size - shared);
}

/**
 * 순서를 지키며 얼마나 겹치는가(최장 공통 부분수열).
 *
 * 글자 집합만 보면 '교육 시간과 진도는 적절했나요' 와 '교육 시간과 분량이 적절했다' 가
 * 47% 로 떨어진다 — 사람이 보면 같은 문항인데, 짧은 문장이라 몇 글자 차이가 크게 먹힌다.
 * 순서까지 보면 앞의 '교육 시간과' 와 뒤의 '적절했' 이 통째로 살아 훨씬 정확해진다.
 */
function orderedOverlap(left: string, right: string) {
  const a = left, b = right;
  if (!a.length || !b.length) return 0;
  // 문항 문장은 길어야 수십 자라 한 줄짜리 표로 충분하다.
  let previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = a[i - 1] === b[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1]);
    }
    previous = current;
  }
  return (2 * previous[b.length]) / (a.length + b.length);
}

/**
 * 두 문장이 얼마나 같은가. 0~1.
 *
 * 두 잣대 중 높은 쪽을 쓴다. 어느 하나로는 놓치는 짝이 있어서다 — 글자 집합은 어순이
 * 크게 바뀐 문장에 강하고, 순서 겹침은 어미만 다른 문장에 강하다. 둘 다 낮으면 정말로
 * 다른 문항이다.
 */
function similarity(left: string, right: string) {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return 0;
  return Math.max(charOverlap(a, b), orderedOverlap(a, b));
}

/**
 * 자동으로 확정할 기준.
 *
 * 낮게 잡으면 아무 문항이나 걸리고, 높게 잡으면 사람이 다 고르게 된다. 0.62 는 어미만
 * 다른 문장은 통과하고 주제가 다른 문장은 떨어지는 자리다 — 어차피 사람이 확인 화면에서
 * 한 번 보므로, 애매하면 비워 두는 쪽으로 기운다.
 */
const AUTO_MATCH_MIN = 0.62;
/** 1등과 2등이 이만큼도 안 벌어지면 고른 것이 아니라 찍은 것이다. */
const AUTO_MATCH_MARGIN = 0.08;

export function proposeMapping(columns: ImportColumn[], questions: SurveyQuestion[]): ColumnMapping[] {
  const taken = new Set<string>();
  return columns.map((column) => {
    const base = { index: column.index, questionId: "", auto: true };
    if (matchesAny(column.header, TIMESTAMP_HEADERS)) return { ...base, role: "timestamp" as const, reason: "구글폼이 붙인 응답 시각" };
    if (matchesAny(column.header, EMAIL_HEADERS)) return { ...base, role: "email" as const, reason: "이메일 열" };
    if (matchesAny(column.header, NAME_HEADERS)) return { ...base, role: "name" as const, reason: "이름 열" };

    const scored = questions
      .filter((question) => !taken.has(question.id))
      .map((question) => ({ question, score: similarity(column.header, question.text) }))
      .sort((left, right) => right.score - left.score);

    const best = scored[0];
    const runnerUp = scored[1];
    if (!best || best.score < AUTO_MATCH_MIN || (runnerUp && best.score - runnerUp.score < AUTO_MATCH_MARGIN)) {
      return {
        ...base, role: "skip" as const, auto: false,
        reason: best ? `가장 비슷한 문항과도 ${Math.round(best.score * 100)}%만 닮았습니다` : "짝지을 문항이 없습니다",
      };
    }
    taken.add(best.question.id);
    return {
      ...base, role: "question" as const, questionId: best.question.id,
      reason: `문항과 ${Math.round(best.score * 100)}% 닮았습니다`,
    };
  });
}

/**
 * 결과지의 한 칸을 우리 답으로 바꾼다.
 *
 * 구글폼의 5점 척도는 폼 설정에 따라 숫자로도, 글자로도 나온다("5", "5점", "매우 그렇다").
 * 셋 다 받아야 한다 — 담당자가 폼을 어떻게 만들었는지에 따라 갈리는데, 그건 폼을 만들 때
 * 정해지는 것이라 나중에 알 수가 없다.
 */
export function toAnswer(question: SurveyQuestion, raw: string): number | string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;

  if (question.type === "scale") {
    const digits = value.match(/-?\d+(\.\d+)?/);
    if (digits) {
      const score = Math.round(Number(digits[0]));
      return score >= 1 && score <= SCALE_MAX ? score : null;
    }
    const labelIndex = SCALE_LABELS.findIndex((label) => normalize(label) === normalize(value));
    if (labelIndex >= 0) return labelIndex + 1;
    // 폼마다 문구가 조금씩 다르다. 가장 닮은 눈금을 고르되, 닮지 않았으면 버린다.
    const scored = SCALE_LABELS
      .map((label, index) => ({ score: similarity(label, value), value: index + 1 }))
      .sort((left, right) => right.score - left.score);
    return scored[0] && scored[0].score >= 0.6 ? scored[0].value : null;
  }

  if (question.type === "choice") {
    const exact = question.options.find((option) => normalize(option) === normalize(value));
    if (exact) return exact;
    const near = question.options
      .map((option) => ({ option, score: similarity(option, value) }))
      .sort((left, right) => right.score - left.score)[0];
    return near && near.score >= 0.7 ? near.option : null;
  }

  return value;
}

export type ImportedRow = {
  name: string;
  note: string;
  answers: Record<string, number | string>;
  /** 짝지은 문항인데 값을 못 알아본 것. 몇 칸이 버려졌는지 사람에게 알린다. */
  unreadable: number;
};

export function buildRows(
  rows: string[][],
  mappings: ColumnMapping[],
  questions: SurveyQuestion[],
): ImportedRow[] {
  const byId = new Map(questions.map((question) => [question.id, question]));
  const nameColumn = mappings.find((mapping) => mapping.role === "name");
  const timeColumn = mappings.find((mapping) => mapping.role === "timestamp");
  const questionColumns = mappings.filter((mapping) => mapping.role === "question" && byId.has(mapping.questionId));

  return rows.map((row) => {
    const answers: Record<string, number | string> = {};
    let unreadable = 0;
    questionColumns.forEach((mapping) => {
      const question = byId.get(mapping.questionId);
      if (!question) return;
      const raw = row[mapping.index] ?? "";
      if (!String(raw).trim()) return;
      const answer = toAnswer(question, String(raw));
      if (answer === null) { unreadable += 1; return; }
      answers[question.id] = answer;
    });
    return {
      name: nameColumn ? String(row[nameColumn.index] ?? "").trim() : "",
      note: timeColumn ? String(row[timeColumn.index] ?? "").trim() : "",
      answers,
      unreadable,
    };
  // 전부 빈 줄은 결과지 끝의 빈 행이다. 응답 0건짜리 사람을 만들어 응답률을 떨어뜨리지 않는다.
  }).filter((row) => Object.keys(row.answers).length > 0);
}

/** CSV 한 장을 행 배열로. 구글 시트에서 CSV 로 내려받는 담당자도 있다. */
export function readCsvRows(text: string, maxRows = MAX_IMPORT_ROWS + 1): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  // 엑셀이 붙이는 BOM 이 남아 있으면 첫 머리글이 안 걸린다.
  const source = text.replace(/^﻿/, "");

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') { field += '"'; index += 1; }
        else quoted = false;
      } else field += character;
      continue;
    }
    if (character === '"') { quoted = true; continue; }
    if (character === ",") { row.push(field); field = ""; continue; }
    if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field); field = "";
      rows.push(row); row = [];
      if (rows.length >= maxRows) return rows;
      continue;
    }
    field += character;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}
