"use client";

/**
 * 베타 관찰 화면.
 *
 * 메뉴에 걸지 않는다. 교육사업팀이 쓰는 화면이 아니라 우리가 보는 화면이고, 메뉴에 있으면
 * '내가 감시당하는 화면' 으로 읽힌다. 주소를 아는 사람만 연다(/admin).
 *
 * 읽는 순서를 화면 순서로 삼았다 — 먼저 실패, 그다음 무엇을 썼는지, 마지막이 품질 신호.
 * 실패가 없으면 위쪽이 조용하고, 그때 비로소 사용 패턴이 눈에 들어온다.
 */
import { useEffect, useState } from "react";
import { Icon } from "../ui";

type Feature = { label: string; total: number; failed: number; averageMs: number | null; slowestMs: number | null };
type Failure = { label: string; message: string; status: number | null; count: number; lastAt: string; source: string; kind: string };
type Day = { day: string; total: number; failed: number; people: number };
type Quality = { at: string; name: string; detail: Record<string, unknown> };

type Report = {
  days: number;
  truncated: boolean;
  totals: { requests: number; failures: number; failureRate: number; people: number; activeDays: number };
  features: Feature[];
  failures: Failure[];
  daily: Day[];
  hourly: number[];
  quality: Quality[];
};

const RANGES = [[1, "오늘"], [7, "7일"], [30, "30일"]] as const;

function when(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}

function duration(ms: number | null) {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}초`;
  return `${Math.round(ms / 60_000)}분 ${Math.round((ms % 60_000) / 1000)}초`;
}

export default function AdminPage() {
  const [days, setDays] = useState(7);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  // 상태를 effect 안에서 곧바로 바꾸지 않는다 — 렌더가 연달아 도는 원인이 된다.
  // '불러오는 중' 으로 바꾸는 것은 누른 쪽(기간 바꾸기·새로 고침)의 일이고,
  // 여기서는 결과가 왔을 때만 손댄다.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/events?days=${days}`)
      .then(async (response) => {
        const result = await response.json() as Report & { error?: string };
        if (!response.ok) throw new Error(result.error || "사용 현황을 불러오지 못했습니다.");
        if (cancelled) return;
        setReport(result); setError("");
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "사용 현황을 불러오지 못했습니다.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    // 기간을 빠르게 두 번 바꾸면 먼저 보낸 응답이 나중에 도착해 뒤엣것을 덮을 수 있다.
    return () => { cancelled = true; };
  }, [days, reloadKey]);

  const showRange = (value: number) => { setLoading(true); setDays(value); };
  const refresh = () => { setLoading(true); setReloadKey((current) => current + 1); };

  const busiestHour = report ? report.hourly.indexOf(Math.max(...report.hourly)) : -1;
  const peak = report ? Math.max(...report.hourly, 1) : 1;
  const maxDay = report ? Math.max(...report.daily.map((day) => day.total), 1) : 1;

  return <main className="admin">
    <header className="admin-head">
      <div>
        <h1>베타 관찰</h1>
        <p>교육사업팀이 무엇을 썼고, 무엇이 실패했는지</p>
      </div>
      <div className="admin-range">
        {RANGES.map(([value, label]) => <button key={value} type="button"
          className={days === value ? "active" : ""} onClick={() => showRange(value)}>{label}</button>)}
        <button type="button" onClick={refresh} aria-label="새로 고침" title="새로 고침">
          <Icon name="clock" size={16} />
        </button>
      </div>
    </header>

    {error && <p className="admin-error" role="alert">{error}</p>}
    {loading && !report && <p className="admin-empty">불러오는 중</p>}

    {report && <>
      {report.truncated && <p className="admin-warn">기록이 많아 최근 4,000건만 셌습니다. 기간을 좁혀 보세요.</p>}

      <div className="admin-totals">
        <div><dt>요청</dt><dd>{report.totals.requests.toLocaleString()}</dd></div>
        <div className={report.totals.failures ? "bad" : ""}>
          <dt>실패</dt><dd>{report.totals.failures}<small>{report.totals.failureRate}%</small></dd>
        </div>
        <div><dt>쓴 사람</dt><dd>{report.totals.people}<small>브라우저 기준</small></dd></div>
        <div><dt>사용한 날</dt><dd>{report.totals.activeDays}<small>/ {report.days}일</small></dd></div>
      </div>

      <section className="admin-block">
        <h2>실패 {report.failures.length > 0 && <em>{report.failures.length}</em>}</h2>
        {report.failures.length === 0
          ? <p className="admin-empty ok">이 기간에 실패한 요청이 없습니다.</p>
          : <div className="admin-table"><table>
              <thead><tr><th>무엇</th><th>내용</th><th>횟수</th><th>마지막</th></tr></thead>
              <tbody>
                {report.failures.map((failure, index) => <tr key={index}>
                  <td>
                    <b>{failure.label}</b>
                    <small>{failure.kind === "server" ? "서버가 못 잡은 오류" : failure.kind === "error" ? "화면" : failure.status ? `HTTP ${failure.status}` : "전송 실패"}</small>
                  </td>
                  <td className="admin-message">{failure.message || <span className="muted">메시지 없음</span>}</td>
                  <td className="tnum">{failure.count}</td>
                  <td className="tnum">{when(failure.lastAt)}</td>
                </tr>)}
              </tbody>
            </table></div>}
      </section>

      <section className="admin-block">
        <h2>무엇을 썼나</h2>
        {report.features.length === 0
          ? <p className="admin-empty">아직 기록이 없습니다.</p>
          : <div className="admin-table"><table>
              <thead><tr><th>기능</th><th>횟수</th><th>실패</th><th>평균</th><th>가장 오래</th></tr></thead>
              <tbody>
                {report.features.map((feature) => <tr key={feature.label}>
                  <td><b>{feature.label}</b></td>
                  <td className="tnum">{feature.total}</td>
                  <td className={`tnum ${feature.failed ? "bad" : ""}`}>{feature.failed || "—"}</td>
                  <td className="tnum">{duration(feature.averageMs)}</td>
                  <td className="tnum">{duration(feature.slowestMs)}</td>
                </tr>)}
              </tbody>
            </table></div>}
      </section>

      <section className="admin-block admin-two">
        <div>
          <h2>날짜별</h2>
          {report.daily.length === 0 ? <p className="admin-empty">기록 없음</p> : <ul className="admin-bars">
            {report.daily.map((day) => <li key={day.day}>
              <span className="admin-bar-label">{day.day.slice(5)}</span>
              <span className="admin-bar"><i style={{ width: `${(day.total / maxDay) * 100}%` }} /></span>
              <span className="tnum">{day.total}{day.failed > 0 && <em className="bad"> 실패 {day.failed}</em>}</span>
            </li>)}
          </ul>}
        </div>
        <div>
          <h2>언제 쓰나</h2>
          <p className="admin-hint">
            {busiestHour >= 0 && report.hourly[busiestHour] > 0
              ? `${busiestHour}시에 가장 많이 씁니다. 배포는 그 시간을 피하는 게 좋습니다.`
              : "아직 판단할 만큼 쌓이지 않았습니다."}
          </p>
          <ol className="admin-hours" aria-label="시간대별 사용">
            {report.hourly.map((count, hour) => <li key={hour} title={`${hour}시 · ${count}건`}>
              <i style={{ height: `${Math.max(2, (count / peak) * 100)}%` }} />
              {hour % 6 === 0 && <span>{hour}</span>}
            </li>)}
          </ol>
        </div>
      </section>

      <section className="admin-block">
        <h2>품질 신호</h2>
        <p className="admin-hint">실패는 스스로 드러나지만 &lsquo;반쯤 된 결과&rsquo;는 그렇지 않습니다. 이 값들이 다음에 무엇을 고칠지 알려 줍니다.</p>
        {report.quality.length === 0
          ? <p className="admin-empty">아직 기록이 없습니다.</p>
          : <div className="admin-table"><table>
              <thead><tr><th>언제</th><th>무엇</th><th>값</th></tr></thead>
              <tbody>
                {report.quality.map((item, index) => <tr key={index}>
                  <td className="tnum">{when(item.at)}</td>
                  <td><b>{item.name}</b></td>
                  <td className="admin-detail">{Object.entries(item.detail).map(([key, value]) => <span key={key}>
                    {key} <b>{Array.isArray(value) ? value.join(", ") || "없음" : String(value)}</b>
                  </span>)}</td>
                </tr>)}
              </tbody>
            </table></div>}
      </section>
    </>}
  </main>;
}
