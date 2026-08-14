import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "./session";

export async function hasTeamSession() {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

/**
 * Second gate behind `proxy.ts`. Route handlers stay protected even if a request
 * reaches them without passing through the proxy.
 */
export async function requireTeamSession(): Promise<Response | null> {
  if (await hasTeamSession()) return null;
  return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
}
