/**
 * 베타 사용 기록.
 *
 * 규칙 하나: **기록이 일을 망치지 않는다.** 여기서 나는 어떤 오류도 부르는 쪽으로 넘기지
 * 않는다. 상담 녹취를 다 처리해 놓고 기록을 남기다 실패해서 사용자에게 오류를 보여 주는
 * 것은, 모니터링이 사고를 만드는 셈이다.
 *
 * 규칙 둘: **내용은 담지 않는다.** 경로·상태·걸린 시간·우리가 쓴 안내 문구까지다. 상담
 * 내용, 문서 본문, 수강생 이름은 들어가지 않는다. 무엇이 얼마나 자주 실패하는지 아는 데
 * 그것들은 필요 없고, 남겨 두면 지켜야 할 것만 늘어난다.
 */
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export type EventKind = "api" | "error" | "server" | "quality";

export type AppEvent = {
  kind: EventKind;
  name: string;
  method?: string;
  status?: number | null;
  ok?: boolean;
  durationMs?: number | null;
  message?: string;
  detail?: Record<string, unknown>;
  sessionKey?: string;
  source?: "client" | "server";
};

const MAX_MESSAGE = 500;
const MAX_NAME = 200;

/**
 * 경로에서 id 를 걷어낸다.
 *
 * `/api/companies/3f2a…/consultations` 를 그대로 세면 회사마다 다른 이름이 되어 아무것도
 * 모이지 않는다. id 자리를 `:id` 로 바꿔야 '상담 올리기를 몇 번 했는가' 를 셀 수 있다.
 */
export function normalizePath(path: string) {
  const [withoutQuery] = path.split("?");
  return withoutQuery
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, "/:id")
    // 만족도 응답 링크의 토큰. 길이가 제각각이라 uuid 규칙에 걸리지 않는다.
    .replace(/\/survey\/[^/]+/, "/survey/:token")
    .slice(0, MAX_NAME);
}

/** 화면에 보여 줄 이름. 경로는 우리끼리 쓰는 말이라 그대로 두면 읽는 데 시간이 든다. */
const FRIENDLY: Array<[RegExp, string]> = [
  [/^POST \/api\/companies\/research$/, "기업 조사"],
  [/^POST \/api\/companies\/discover$/, "기업 찾기"],
  [/^POST \/api\/companies\/:id\/consultations$/, "상담 녹취 처리"],
  [/^POST \/api\/companies\/:id\/consultations\/note$/, "상담 직접 입력·메모"],
  [/^POST \/api\/companies\/:id\/consultation-briefing$/, "통합 브리핑"],
  [/^POST \/api\/companies\/:id\/questions$/, "니즈 질문지 저장"],
  [/^POST \/api\/course-sessions\/:id\/documents$/, "강의 구성·자료 판독"],
  [/^POST \/api\/course-sessions\/:id\/brief$/, "강사 브리핑"],
  [/^POST \/api\/instructors\/extract-profile$/, "강사 프로필 판독"],
  [/^POST \/api\/learners\/extract$/, "수강생 명단 판독"],
  [/^POST \/api\/surveys\/:id\/import$/, "만족도 결과지 들여오기"],
  [/^POST \/api\/surveys\/:id\/send$/, "만족도 메일 발송"],
  [/^GET \/api\/surveys\/:id\/report$/, "만족도 결과 PDF"],
  [/^GET \/api\/surveys\/:id\/pdf$/, "질문지 PDF"],
  [/^GET \/api\/contracts\/:id\/pdf$/, "계약서 PDF"],
  [/^POST \/api\/survey-templates\/draft$/, "질문지 초안"],
  [/^POST \/api\/uploads\//, "파일 업로드 준비"],
  [/^POST \/api\/auth\/login$/, "로그인"],
  [/^(GET|POST|PATCH|DELETE) \/api\//, ""],
];

export function friendlyName(method: string, name: string) {
  const key = `${method} ${name}`.trim();
  for (const [pattern, label] of FRIENDLY) {
    if (pattern.test(key)) return label || name.replace(/^\/api\//, "");
  }
  return name;
}

/** 조회(GET)는 화면을 열 때마다 나가서 수가 압도적이다. 무엇을 '했는지' 보는 데 방해가 된다. */
export function isMeaningful(method: string, name: string) {
  if (method !== "GET") return true;
  return /\/(report|pdf|export)/.test(name);
}

function sanitize(event: AppEvent) {
  return {
    kind: event.kind,
    name: String(event.name || "").slice(0, MAX_NAME),
    method: String(event.method || "").slice(0, 10).toUpperCase(),
    status: typeof event.status === "number" && Number.isFinite(event.status) ? Math.trunc(event.status) : null,
    ok: event.ok !== false,
    duration_ms: typeof event.durationMs === "number" && Number.isFinite(event.durationMs)
      ? Math.max(0, Math.min(3_600_000, Math.round(event.durationMs))) : null,
    message: String(event.message || "").slice(0, MAX_MESSAGE),
    detail: event.detail && typeof event.detail === "object" ? event.detail : {},
    session_key: String(event.sessionKey || "").slice(0, 40),
    source: event.source === "server" ? "server" : "client",
  };
}

/**
 * 한 건 남긴다. 기다릴 필요가 없으면 await 하지 않아도 된다 — 어차피 실패해도 조용하다.
 *
 * 서버리스에서는 응답을 보내고 나면 프로세스가 곧 멈출 수 있어, 라우트 안에서 부를 때는
 * await 하는 편이 안전하다. 한 번의 insert 라 몇 ms 다.
 */
export async function track(event: AppEvent) {
  try {
    await createSupabaseAdmin().from("app_events").insert(sanitize({ source: "server", ...event }));
  } catch (error) {
    // 표가 아직 없는 데이터베이스에서도 앱은 그대로 돌아야 한다(마이그레이션 전).
    console.error(`[telemetry] 기록 실패: ${error instanceof Error ? error.message : "알 수 없음"}`);
  }
}

export async function trackMany(events: AppEvent[]) {
  if (!events.length) return;
  try {
    await createSupabaseAdmin().from("app_events").insert(events.map(sanitize));
  } catch (error) {
    console.error(`[telemetry] 묶음 기록 실패: ${error instanceof Error ? error.message : "알 수 없음"}`);
  }
}

/**
 * 결과가 얼마나 멀쩡했는지 남긴다.
 *
 * 실패는 스스로 드러나지만 '반쯤 된 결과'는 그렇지 않다 — 메모에서 글자를 절반만 읽었거나,
 * 결과지에서 못 알아본 칸이 많았거나, 자동 짝짓기를 사람이 여러 번 고쳤거나. 이런 것이
 * 쌓여야 다음에 무엇을 고칠지 정할 수 있다.
 */
export async function trackQuality(name: string, detail: Record<string, unknown>, message = "") {
  await track({ kind: "quality", name, ok: true, detail, message, source: "server" });
}
