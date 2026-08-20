"use client";

/**
 * 화면에서 일어난 일을 모아 보낸다.
 *
 * `fetch` 를 한 번 감싼다. 라우트 50개에 기록 코드를 흩뿌리는 대신 한 자리에서 전부 잡기
 * 위해서다 — 그래야 새 기능을 만들 때 기록을 붙이는 걸 잊지 않는다.
 *
 * 서버가 아니라 화면에서 잡는 이유가 하나 더 있다. 아이폰 음성 메모(.m4a)를 못 올리던
 * 버그는 브라우저가 업로드에서 거절당해 **서버에 닿지 않았다**. 서버 로그에는 아무것도
 * 없었고, 사장님이 오류 문구를 옮겨 주시기 전까지 아무도 몰랐다. 여기서 보면 그런 것도
 * 남는다.
 *
 * 보내는 것: 경로(id 를 걷어낸 것)·방식·상태·걸린 시간·우리가 쓴 안내 문구.
 * 보내지 않는 것: 요청 본문, 응답 본문, 상담 내용, 사람 이름. 무엇이 실패하는지 아는 데
 * 필요하지 않고, 남기면 지켜야 할 것만 늘어난다.
 */
import { useEffect } from "react";

type Queued = {
  kind: "api" | "error";
  name: string;
  method: string;
  status: number | null;
  ok: boolean;
  durationMs: number | null;
  message: string;
};

const FLUSH_AFTER_MS = 5_000;
const MAX_QUEUE = 40;
const SESSION_STORAGE_KEY = "knu-telemetry-session";

function sessionKey() {
  try {
    const existing = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;
    // 계정이 아직 하나뿐이라 '몇 사람이 쓰는지' 를 알 길이 이것뿐이다. 누구인지는 담기지 않는다.
    const created = Math.random().toString(36).slice(2, 12);
    window.localStorage.setItem(SESSION_STORAGE_KEY, created);
    return created;
  } catch {
    return "";
  }
}

function normalizePath(path: string) {
  const [withoutQuery] = path.split("?");
  return withoutQuery
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, "/:id")
    .replace(/\/survey\/[^/]+/, "/survey/:token")
    .slice(0, 200);
}

let queue: Queued[] = [];
let timer: number | null = null;

function send(useBeacon: boolean) {
  if (!queue.length) return;
  const events = queue;
  queue = [];
  if (timer) { window.clearTimeout(timer); timer = null; }
  const payload = JSON.stringify({ sessionKey: sessionKey(), events });
  try {
    // 창을 닫는 중에는 fetch 가 취소된다. 그때 마지막 묶음이 사라지지 않도록 beacon 을 쓴다.
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon("/api/events", new Blob([payload], { type: "application/json" }));
      return;
    }
    void fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // 기록이 앱을 방해하지 않는다.
  }
}

function enqueue(event: Queued) {
  queue.push(event);
  if (queue.length >= MAX_QUEUE) { send(false); return; }
  if (timer) return;
  timer = window.setTimeout(() => send(false), FLUSH_AFTER_MS);
}

export function Telemetry() {
  useEffect(() => {
    const originalFetch = window.fetch;
    // 이미 감쌌으면 두 번 감싸지 않는다(개발 중 두 번 실행되는 효과 때문에 실제로 겹친다).
    if ((originalFetch as { __wrapped?: boolean }).__wrapped) return;

    const wrapped: typeof window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input
        : input instanceof URL ? input.href
        : (input as Request).url;
      const method = (init?.method || (input instanceof Request ? input.method : "GET") || "GET").toUpperCase();

      let path = "";
      try {
        const resolved = new URL(url, window.location.origin);
        // 우리 API 만 본다. 남의 주소(스토리지 업로드 등)는 경로에 서명이 들어 있어 담지 않는다.
        if (resolved.origin === window.location.origin && resolved.pathname.startsWith("/api/")) {
          path = normalizePath(resolved.pathname);
        }
      } catch { /* 주소를 못 읽으면 그냥 넘긴다 */ }

      // 기록을 보내는 요청까지 기록하면 끝없이 돈다.
      if (!path || path === "/api/events") return originalFetch(input, init);

      const startedAt = performance.now();
      try {
        const response = await originalFetch(input, init);
        const durationMs = performance.now() - startedAt;
        let message = "";
        if (!response.ok) {
          // 실패했을 때만 본문을 들여다본다. 우리 라우트는 { error } 로 한국어 안내를 준다.
          try {
            const copy = response.clone();
            const body = await copy.json() as { error?: string };
            message = String(body?.error || "").slice(0, 300);
          } catch { /* JSON 이 아니면 상태 코드만으로 충분하다 */ }
        }
        enqueue({
          kind: "api", name: path, method, status: response.status,
          ok: response.ok, durationMs, message,
        });
        return response;
      } catch (error) {
        // 여기가 서버에 닿지도 못한 실패다 — 네트워크 끊김, 업로드 거절, 취소.
        enqueue({
          kind: "api", name: path, method, status: null, ok: false,
          durationMs: performance.now() - startedAt,
          message: error instanceof Error ? error.message.slice(0, 300) : "요청이 전송되지 못했습니다",
        });
        throw error;
      }
    };
    (wrapped as { __wrapped?: boolean }).__wrapped = true;
    window.fetch = wrapped;

    const onError = (event: ErrorEvent) => {
      enqueue({
        kind: "error", name: normalizePath(window.location.pathname), method: "", status: null, ok: false,
        durationMs: null,
        message: `${event.message || "화면 오류"} (${(event.filename || "").split("/").pop()}:${event.lineno || 0})`.slice(0, 300),
      });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      enqueue({
        kind: "error", name: normalizePath(window.location.pathname), method: "", status: null, ok: false,
        durationMs: null,
        message: (reason instanceof Error ? reason.message : String(reason || "처리되지 않은 오류")).slice(0, 300),
      });
    };
    const onHide = () => send(true);

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("pagehide", onHide);

    return () => {
      window.fetch = originalFetch;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("pagehide", onHide);
      send(true);
    };
  }, []);

  return null;
}
