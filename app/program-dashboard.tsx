"use client";

import { useEffect, useMemo, useState } from "react";
import { SESSION_STATUS_LABEL, SESSION_STATUS_TONE } from "@/lib/company-stage";
import { timeRange } from "@/lib/course-time";
import { Feedback, Icon } from "./ui";
import { displayCompanyName } from "@/lib/company-name";

type ProgramSession = {
  id: string; title: string; heldOn: string | null; startTime: string | null; durationHours: number;
  location: string; headcount: number | null; status: string;
  companyId: string; companyName: string; instructorName: string;
  learnerCount: number; attendedCount: number;
};

type Range = "month" | "week";

const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

/** 로컬 자정 기준. 날짜만 있는 값을 Date 로 바로 읽으면 UTC 자정이라 한국에서 하루가 밀린다. */
function toDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function toKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function startOfWeek(date: Date) {
  const start = new Date(date);
  start.setDate(start.getDate() - start.getDay());
  start.setHours(0, 0, 0, 0);
  return start;
}

/** 보이는 구간. 월은 그 달 1일~말일, 주는 일요일~토요일. */
function windowFor(range: Range, anchor: Date) {
  if (range === "week") {
    const from = startOfWeek(anchor);
    const to = new Date(from);
    to.setDate(to.getDate() + 6);
    return { from, to };
  }
  return {
    from: new Date(anchor.getFullYear(), anchor.getMonth(), 1),
    to: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0),
  };
}

function windowLabel(range: Range, anchor: Date) {
  if (range === "month") return `${anchor.getFullYear()}년 ${anchor.getMonth() + 1}월`;
  const { from, to } = windowFor("week", anchor);
  const sameMonth = from.getMonth() === to.getMonth();
  return sameMonth
    ? `${from.getFullYear()}년 ${from.getMonth() + 1}월 ${from.getDate()}일~${to.getDate()}일`
    : `${from.getMonth() + 1}월 ${from.getDate()}일~${to.getMonth() + 1}월 ${to.getDate()}일`;
}

function timeLabel(session: ProgramSession) {
  if (!session.startTime) return "시간 미정";
  return timeRange(session.startTime, session.durationHours) || "시간 미정";
}

/**
 * 사업 대시보드. 기업 화면이 '이 회사에서 무슨 일이 있었나'라면, 여기는 '이번 달에 무엇이
 * 돌아가는가'다 — 교육이 여러 회사에서 동시에 굴러갈 때 담당자가 먼저 보는 화면.
 */
export function ProgramDashboard({ onOpenCompany }: { onOpenCompany: (companyId: string) => void }) {
  const [sessions, setSessions] = useState<ProgramSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<Range>("month");
  const [anchor, setAnchor] = useState(() => { const now = new Date(); now.setHours(0, 0, 0, 0); return now; });
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);

  useEffect(() => {
    void fetch("/api/course-sessions/list")
      .then(async (response) => {
        const result = await response.json() as { sessions?: ProgramSession[]; error?: string };
        if (!response.ok) throw new Error(result.error || "교육 일정을 불러오지 못했습니다.");
        setSessions(result.sessions || []);
      })
      .catch((caught) => setFeedback({ message: caught instanceof Error ? caught.message : "교육 일정을 불러오지 못했습니다.", error: true }))
      .finally(() => setLoading(false));
  }, []);

  const today = useMemo(() => { const now = new Date(); now.setHours(0, 0, 0, 0); return now; }, []);
  const todayKey = toKey(today);

  const dated = useMemo(() => sessions.filter((session) => session.heldOn), [sessions]);
  const undated = useMemo(() => sessions.filter((session) => !session.heldOn && session.status !== "cancelled"), [sessions]);

  const { from, to } = windowFor(range, anchor);
  const fromKey = toKey(from);
  const toKeyValue = toKey(to);

  const inWindow = useMemo(
    () => dated.filter((session) => {
      const key = String(session.heldOn).slice(0, 10);
      return key >= fromKey && key <= toKeyValue;
    }).sort((left, right) => String(left.heldOn).localeCompare(String(right.heldOn)) || (left.startTime || "").localeCompare(right.startTime || "")),
    [dated, fromKey, toKeyValue],
  );

  const byDate = useMemo(() => {
    const map = new Map<string, ProgramSession[]>();
    inWindow.forEach((session) => {
      const key = String(session.heldOn).slice(0, 10);
      map.set(key, [...(map.get(key) || []), session]);
    });
    return map;
  }, [inWindow]);

  // 구간과 무관하게 늘 보여 주는 두 줄 — 담당자가 매일 확인하는 것은 결국 이 둘이다.
  const upcoming = useMemo(() => dated
    .filter((session) => String(session.heldOn).slice(0, 10) >= todayKey && session.status !== "cancelled" && session.status !== "delivered")
    .sort((left, right) => String(left.heldOn).localeCompare(String(right.heldOn)))
    .slice(0, 5), [dated, todayKey]);
  const recent = useMemo(() => dated
    .filter((session) => String(session.heldOn).slice(0, 10) < todayKey && session.status !== "cancelled")
    .sort((left, right) => String(right.heldOn).localeCompare(String(left.heldOn)))
    .slice(0, 5), [dated, todayKey]);
  const needsClosing = useMemo(() => dated.filter((session) =>
    String(session.heldOn).slice(0, 10) < todayKey && session.status === "planned"), [dated, todayKey]);

  const live = inWindow.filter((session) => session.status !== "cancelled");
  const summary = {
    sessions: live.length,
    delivered: live.filter((session) => session.status === "delivered").length,
    learners: live.reduce((total, session) => total + session.learnerCount, 0),
    companies: new Set(live.map((session) => session.companyId)).size,
  };

  const step = (direction: -1 | 1) => setAnchor((current) => {
    const next = new Date(current);
    if (range === "month") next.setMonth(next.getMonth() + direction);
    else next.setDate(next.getDate() + direction * 7);
    return next;
  });

  // 달력은 그 달을 감싸는 주 단위로 그린다 — 1일이 수요일이면 앞의 빈칸도 자리를 잡아야 한다.
  const calendarDays = useMemo(() => {
    const first = startOfWeek(from);
    const days: Date[] = [];
    const last = new Date(to);
    const end = startOfWeek(last);
    end.setDate(end.getDate() + 6);
    for (let day = new Date(first); day <= end; day.setDate(day.getDate() + 1)) days.push(new Date(day));
    return days;
  }, [fromKey, toKeyValue]);

  const card = (session: ProgramSession) => <button type="button" key={session.id} className="program-session"
    onClick={() => onOpenCompany(session.companyId)}>
    <span className={`stage ${SESSION_STATUS_TONE[session.status] || "neutral"}`}>{SESSION_STATUS_LABEL[session.status] || session.status}</span>
    <b>{session.title}</b>
    <small>{[displayCompanyName(session.companyName), timeLabel(session), session.instructorName ? `${session.instructorName} 강사` : "강사 미배정"].filter(Boolean).join(" · ")}</small>
    <small className="muted">{[session.location || "장소 미정", `수강생 ${session.learnerCount}명`].join(" · ")}</small>
  </button>;

  return <section className="workspace-panel">
    <div className="content-title">
      <div>
        <h2>사업 현황</h2>
      </div>
      <div className="title-actions">
        <div className="range-switch" role="group" aria-label="기간 단위">
          {([["month", "월"], ["week", "주"]] as Array<[Range, string]>).map(([value, label]) =>
            <button type="button" key={value} className={range === value ? "active" : ""} aria-pressed={range === value}
              onClick={() => setRange(value)}>{label}</button>)}
        </div>
      </div>
    </div>

    <Feedback value={feedback} onClose={() => setFeedback(null)} />

    <div className="program-bar">
      <div className="program-nav">
        <button type="button" onClick={() => step(-1)} aria-label="이전 기간">←</button>
        <b>{windowLabel(range, anchor)}</b>
        <button type="button" onClick={() => step(1)} aria-label="다음 기간">→</button>
        <button type="button" className="upload-chip" onClick={() => setAnchor(today)}>오늘</button>
      </div>
      <dl className="program-summary">
        <div><dt>교육</dt><dd>{summary.sessions}건<small>완료 {summary.delivered}</small></dd></div>
        <div><dt>수강생</dt><dd>{summary.learners}명</dd></div>
        <div><dt>기업</dt><dd>{summary.companies}곳</dd></div>
      </dl>
    </div>

    {needsClosing.length > 0 && <p className="action-hint">지난 교육 {needsClosing.length}건이 아직 교육 예정으로 남아 있습니다. 기업 화면에서 완료로 바꿔 주세요.</p>}

    {loading ? <p className="body-text">불러오는 중</p> : range === "month"
      ? <div className="calendar">
          {DAY_LABELS.map((label) => <span key={label} className="calendar-head">{label}</span>)}
          {calendarDays.map((day) => {
            const key = toKey(day);
            const items = byDate.get(key) || [];
            const outside = day < from || day > to;
            return <div key={key} className={`calendar-day${outside ? " outside" : ""}${key === todayKey ? " today" : ""}`}>
              <span className="calendar-date">{day.getDate()}</span>
              {items.map((session) => <button type="button" key={session.id}
                className={`calendar-chip ${SESSION_STATUS_TONE[session.status] || "neutral"}`}
                title={`${displayCompanyName(session.companyName)} · ${session.title} · ${timeLabel(session)}`}
                onClick={() => onOpenCompany(session.companyId)}>
                {session.startTime ? session.startTime.slice(0, 5) : ""} {displayCompanyName(session.companyName) || session.title}
              </button>)}
            </div>;
          })}
        </div>
      : <div className="week-list">
          {Array.from({ length: 7 }, (_, offset) => {
            const day = new Date(from);
            day.setDate(day.getDate() + offset);
            const key = toKey(day);
            const items = byDate.get(key) || [];
            return <div key={key} className={`week-day${key === todayKey ? " today" : ""}`}>
              <div className="week-date">
                <b>{day.getDate()}</b>
                <small>{DAY_LABELS[day.getDay()]}</small>
              </div>
              <div className="week-items">
                {items.length ? items.map(card) : <p className="body-text">교육 없음</p>}
              </div>
            </div>;
          })}
        </div>}

    <div className="program-columns">
      <div>
        <h3>다가오는 교육</h3>
        {upcoming.length ? <div className="program-list">{upcoming.map(card)}</div> : <p className="body-text">예정된 교육이 없습니다.</p>}
      </div>
      <div>
        <h3>지난 교육</h3>
        {recent.length ? <div className="program-list">{recent.map(card)}</div> : <p className="body-text">아직 끝난 교육이 없습니다.</p>}
      </div>
    </div>

    {undated.length > 0 && <div className="program-undated">
      <h3>일자 미정 <small>{undated.length}건</small></h3>
      <div className="program-list">{undated.map(card)}</div>
    </div>}

    {!loading && sessions.length === 0 && <div className="company-empty"><span><Icon name="calendar" size={26}/></span>
      <h2>아직 교육과정이 없습니다</h2>
      <p>기업 화면에서 교육과정을 만들면<br/>여기에 일정이 모입니다.</p></div>}
  </section>;
}
