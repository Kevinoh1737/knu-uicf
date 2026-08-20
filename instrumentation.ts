/**
 * 서버가 스스로 잡지 못한 오류를 남긴다.
 *
 * 우리 라우트는 대부분 오류를 잡아 한국어 안내와 함께 422 로 돌려주므로, 그런 실패는
 * 화면 쪽 수집기(app/telemetry-client.tsx)에 잡힌다. 여기 걸리는 것은 그러지 못한 것들이다 —
 * 서버 컴포넌트가 그리다 터졌거나, 라우트가 try 밖에서 죽었거나.
 *
 * 즉 여기 기록이 쌓이면 그건 '예상하지 못한 고장' 이라는 뜻이라, 실패 목록에서 가장 먼저
 * 봐야 할 것들이다.
 */
import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  try {
    const { normalizePath, track } = await import("@/lib/telemetry");
    await track({
      kind: "server",
      name: normalizePath(String(request.path || "")),
      method: String(request.method || ""),
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      detail: {
        // 어디서 터졌는지. 라우트인지 렌더링인지에 따라 볼 곳이 다르다.
        routerKind: context.routerKind,
        routePath: context.routePath,
        routeType: context.routeType,
      },
      source: "server",
    });
  } catch {
    // 오류를 기록하다 오류를 내지 않는다.
  }
};
