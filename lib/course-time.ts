/**
 * 교육 일시. 날짜(held_on)와 시작 시각(start_time)이 따로 저장돼 있어, 화면·PDF·메일이
 * 제각각 조립하면 같은 수업이 자리마다 다르게 보인다. 만드는 자리를 여기 하나로 둔다.
 *
 * 끝나는 시각은 저장하지 않는다 — duration_hours 가 이미 있고, 둘을 따로 저장하면 한쪽만
 * 고쳐졌을 때 어느 쪽이 맞는지 알 수 없게 된다.
 */
const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** "14:00" 형태만 남긴다. DB 의 time 은 "14:00:00" 으로 돌아오므로 초를 잘라 받는다. */
export function sanitizeStartTime(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().slice(0, 5);
  return TIME.test(trimmed) ? trimmed.padStart(5, "0") : "";
}

function addHours(startTime: string, hours: number) {
  const [hour, minute] = startTime.split(":").map(Number);
  const total = hour * 60 + minute + Math.round((Number(hours) || 0) * 60);
  // 자정을 넘기는 교육은 없지만, 넘더라도 24시 표기로 새는 것보다 하루를 접는 편이 낫다.
  const wrapped = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

/** "14:00~18:00". 시간이 없으면 빈 문자열이라 부르는 쪽에서 그냥 빼면 된다. */
export function timeRange(startTime: unknown, durationHours?: number | null) {
  const start = sanitizeStartTime(startTime);
  if (!start) return "";
  const hours = Number(durationHours);
  return hours > 0 ? `${start}~${addHours(start, hours)}` : start;
}

export type HeldOnStyle = "short" | "long";

/**
 * 화면에 쓰는 일시 한 줄. short 는 "2026. 9. 3. 14:00~18:00", long 은 계약서·브리프처럼
 * 격식이 필요한 곳에 쓰는 "2026년 9월 3일 14:00~18:00" 이다.
 */
export function formatHeldOn(
  heldOn: string | null | undefined,
  startTime?: unknown,
  durationHours?: number | null,
  style: HeldOnStyle = "short",
) {
  if (!heldOn) return "";
  const date = new Intl.DateTimeFormat("ko-KR", {
    dateStyle: style === "long" ? "long" : "medium",
    timeZone: "Asia/Seoul",
  }).format(new Date(heldOn));
  const range = timeRange(startTime, durationHours);
  return range ? `${date} ${range}` : date;
}
