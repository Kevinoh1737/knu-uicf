import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

/** `/api/ai/health` carries its own CRON_SECRET check so scheduled runs keep working. */
const OPEN_PATHS = new Set(["/login", "/api/auth/login", "/api/auth/logout", "/api/ai/health"]);

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (OPEN_PATHS.has(pathname)) return NextResponse.next();

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
