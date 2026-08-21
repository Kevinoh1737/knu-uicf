import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

/**
 * 로그인 담장 밖에 두는 경로.
 *
 * - `/api/ai/health` · `/api/cron/alerts` — 부르는 쪽이 사람이 아니다. 스스로 CRON_SECRET 을 검사한다.
 * - `/opengraph-image` · `/icon` — 링크를 공유했을 때 카카오톡·슬랙이 가지러 오는 그림이다.
 *   **아래 matcher 는 확장자로 거르는데 이 둘은 확장자가 없어** 그냥 두면 담장에 걸리고,
 *   수집기는 PNG 대신 로그인 리다이렉트를 받아 카드가 비어 보인다(2026-08-21 실측).
 *   담기는 것은 우리 로고와 팀 이름뿐이라 밖에 있어도 된다.
 */
const OPEN_PATHS = new Set([
  "/login", "/api/auth/login", "/api/auth/logout",
  "/api/ai/health", "/api/cron/alerts",
  "/opengraph-image", "/icon", "/apple-icon",
]);

/**
 * 수강생용 만족도 응답. 받는 사람은 우리 시스템 계정이 없으므로 로그인 뒤에 둘 수 없다 —
 * 대신 링크의 토큰이 신원이고, 두 경로 모두 토큰을 스스로 검사한다(lib/survey-token.ts).
 */
const OPEN_PREFIXES = ["/survey/", "/api/survey/"];

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (OPEN_PATHS.has(pathname)) return NextResponse.next();
  if (OPEN_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return NextResponse.next();

  if (await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const signIn = request.nextUrl.clone();
  signIn.pathname = "/login";
  signIn.search = `?next=${encodeURIComponent(`${pathname}${search}`)}`;
  return NextResponse.redirect(signIn);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|ttf|woff|woff2)$).*)"],
};
