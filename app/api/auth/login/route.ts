import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from "@/lib/auth/session";

export const runtime = "nodejs";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const attempts = new Map<string, { count: number; resetAt: number }>();

function clientKey(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

function rateLimited(key: string) {
  const now = Date.now();
  if (attempts.size > 500) for (const [entry, value] of attempts) if (value.resetAt < now) attempts.delete(entry);
  const current = attempts.get(key);
  if (!current || current.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > MAX_ATTEMPTS;
}

/** Hashing first keeps the comparison constant-time even when the lengths differ. */
function codeMatches(supplied: string, expected: string) {
  return timingSafeEqual(createHash("sha256").update(supplied).digest(), createHash("sha256").update(expected).digest());
}

export async function POST(request: Request) {
  try {
    const expected = process.env.TEAM_ACCESS_CODE;
    if (!expected || !process.env.AUTH_SECRET) {
      return NextResponse.json({ error: "접근 설정이 완료되지 않았습니다. 관리자에게 문의해 주세요." }, { status: 503 });
    }

    const key = clientKey(request);
    if (rateLimited(key)) {
      return NextResponse.json({ error: "시도 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요." }, { status: 429 });
    }

    const { accessCode } = await request.json() as { accessCode?: string };
    if (!accessCode?.trim() || !codeMatches(accessCode.trim(), expected)) {
      return NextResponse.json({ error: "접근 코드가 올바르지 않습니다." }, { status: 401 });
    }

    attempts.delete(key);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, await createSessionToken(), sessionCookieOptions());
    return response;
  } catch {
    return NextResponse.json({ error: "로그인을 처리하지 못했습니다." }, { status: 400 });
  }
}
