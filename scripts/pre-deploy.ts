/**
 * 배포 전 영향 분석.
 *
 * 답해야 하는 질문은 하나다 — **지금 올라가 있는 것과 무엇이 달라지는가.**
 * 파일 목록이 아니라 사용자에게 보이는 변화, 그리고 위험한 것부터 본다.
 *
 * 기준점은 `deploy-log.md` 의 마지막 줄이다. 배포할 때마다 한 줄씩 쌓으므로,
 * '지금 라이브인 커밋' 을 언제든 알 수 있다. Vercel 에 물어보지 않는 이유는 CLI 배포가
 * 로컬 폴더를 통째로 올려서 커밋 정보를 남기지 않기 때문이다.
 *
 * 실행: npm run pre-deploy
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

function liveCommit() {
  const logPath = path.join(root, "deploy-log.md");
  if (!existsSync(logPath)) return null;
  // 표의 마지막 줄에서 커밋 해시를 뽑는다. 형식: | 날짜 | 해시 | 내용 |
  const rows = readFileSync(logPath, "utf8").split("\n")
    .map((line) => line.match(/^\|\s*[\d-]+\s*\|\s*`?([0-9a-f]{7,40})`?\s*\|/))
    .filter((match): match is RegExpMatchArray => Boolean(match));
  return rows.length ? rows[rows.length - 1][1] : null;
}

/** 바뀐 파일을 '사용자에게 무엇이 달라지는가' 로 묶는다. */
const BUCKETS: Array<[RegExp, string, boolean]> = [
  [/^supabase\/migrations\//, "데이터베이스 스키마", true],
  [/^app\/api\//, "서버 라우트", true],
  [/^proxy\.ts$|^instrumentation\.ts$|^next\.config|^vercel\.json$/, "앱 전체 설정", true],
  [/^app\/.*\.tsx$/, "화면", false],
  [/^app\/globals\.css$/, "화면 스타일", false],
  [/^lib\//, "공용 로직", false],
  [/^scripts\/|^docs\/|\.md$/, "문서·스크립트 (배포에 영향 없음)", false],
];

function bucketOf(file: string) {
  for (const [pattern, label, risky] of BUCKETS) if (pattern.test(file)) return { label, risky };
  return { label: "기타", risky: false };
}

const base = process.argv[2] || liveCommit();
const head = git("rev-parse", "--short", "HEAD");

console.log("═══ 배포 전 영향 분석 ═══\n");

if (!base) {
  console.log("⚠ 기준점을 모릅니다. deploy-log.md 가 비어 있습니다.");
  console.log("  이번에는 무엇이 달라지는지 셀 수 없습니다 — 배포 후 반드시 한 줄 남기세요.\n");
} else {
  let range: string;
  try {
    git("cat-file", "-e", `${base}^{commit}`);
    range = `${base}..HEAD`;
  } catch {
    console.log(`⚠ 기준 커밋 ${base} 를 찾을 수 없습니다.\n`);
    process.exit(1);
  }

  const commits = git("log", "--oneline", range).split("\n").filter(Boolean);
  const files = git("diff", "--name-only", range).split("\n").filter(Boolean);

  console.log(`지금 라이브: ${base}`);
  console.log(`올릴 것:     ${head}`);
  console.log(`커밋 ${commits.length}개 · 파일 ${files.length}개\n`);

  if (!commits.length) {
    console.log("✓ 달라진 것이 없습니다. 배포할 이유가 없습니다.\n");
    process.exit(0);
  }

  console.log("── 무엇이 달라지나 ──");
  const grouped = new Map<string, { files: string[]; risky: boolean }>();
  files.forEach((file) => {
    const { label, risky } = bucketOf(file);
    const current = grouped.get(label) || { files: [], risky };
    current.files.push(file);
    grouped.set(label, current);
  });
  // 위험한 것부터. 스키마와 라우트가 사용자를 직접 깨뜨린다.
  [...grouped.entries()]
    .sort((left, right) => Number(right[1].risky) - Number(left[1].risky))
    .forEach(([label, group]) => {
      console.log(`\n${group.risky ? "▲" : "·"} ${label} (${group.files.length})`);
      group.files.slice(0, 12).forEach((file) => console.log(`    ${file}`));
      if (group.files.length > 12) console.log(`    … 외 ${group.files.length - 12}개`);
    });

  console.log("\n── 커밋 ──");
  commits.forEach((line) => console.log(`  ${line}`));
}

// ── 아직 적용 안 된 마이그레이션 ────────────────────────────────────────────
// 코드가 먼저 올라가면 새 코드가 없는 칸을 찾는다. 배포 전에 반드시 걸러야 한다.
console.log("\n── 마이그레이션 ──");
const migrationDir = path.join(root, "supabase", "migrations");
const migrations = existsSync(migrationDir)
  ? readdirSync(migrationDir).filter((name) => name.endsWith(".sql")).sort()
  : [];
if (!base) {
  console.log("  기준점을 몰라 새것만 가릴 수 없습니다. 전부 적용됐는지 직접 확인하세요.");
} else {
  const changed = git("diff", "--name-only", `${base}..HEAD`).split("\n")
    .filter((file) => file.startsWith("supabase/migrations/"));
  if (!changed.length) console.log("  새 마이그레이션 없음");
  else {
    changed.forEach((file) => console.log(`  ▲ ${path.basename(file)}`));
    console.log("\n  이것들을 DB 에 먼저 적용한 뒤 배포하세요. 순서가 반대면 새 코드가 없는 칸을 찾습니다.");
  }
}
console.log(`  (저장소 전체 마이그레이션 ${migrations.length}개)`);

// ── 작업트리 ────────────────────────────────────────────────────────────────
// vercel 은 git 이 아니라 로컬 폴더를 통째로 올린다. 커밋 안 한 파일도 같이 간다.
console.log("\n── 작업트리 ──");
const dirty = git("status", "--porcelain").split("\n").filter(Boolean);
if (!dirty.length) console.log("  ✓ 깨끗함");
else {
  console.log(`  ⚠ 커밋 안 된 변경 ${dirty.length}개 — vercel 은 이것도 함께 올립니다.`);
  dirty.slice(0, 10).forEach((line) => console.log(`    ${line}`));
}

console.log("\n── 배포 전 확인 ──");
console.log("  1. 위 '무엇이 달라지나' 를 말로 정리해 대표에게 보고했는가");
console.log("  2. 새 마이그레이션을 DB 에 먼저 적용했는가");
console.log("  3. 작업트리가 깨끗한가");
console.log("  4. 지금이 사람이 안 쓰는 시간인가 (/admin 의 '언제 쓰나')");
console.log("  5. 묶을 수 있는 다른 변경이 남아 있지 않은가\n");
