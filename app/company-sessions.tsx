"use client";

import { useEffect, useState } from "react";
import {
  CONTRACT_STATUS_LABEL,
  ContractStatus,
  CourseMaterials,
  CourseOutline,
  INSTRUCTOR_DOCUMENT_ACCEPT,
  INSTRUCTOR_FORMAT_LABEL,
  MAX_INSTRUCTOR_DOCUMENT_SIZE,
  resolveInstructorDocument,
  tailoredCaseRatio,
} from "@/lib/instructors";
import { STORED_STAGES, StoredStage, stageChoiceLabel, withRo } from "@/lib/company-stage";
import { LEARNER_STATUS_LABEL, LearnerStatus } from "@/lib/learners";
import { SURVEY_STATUS_LABEL, SurveyStatus } from "@/lib/surveys";
import { formatHeldOn } from "@/lib/course-time";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { Feedback } from "./ui";

type InstructorOption = { id: string; name: string; affiliation: string; job_title: string };

type EnrolledRow = {
  id: string; status: string; learner_id: string;
  learners?: { id: string; name: string; department: string; job_title: string; email: string } | null;
};

type PoolRow = { id: string; name: string; department: string; job_title: string; email: string };

type SessionRow = {
  id: string;
  title: string;
  held_on: string | null;
  start_time: string | null;
  location: string;
  headcount: number | null;
  duration_hours: number;
  status: string;
  outline: CourseOutline;
  materials: CourseMaterials;
  instructor_id: string;
  instructors?: { id: string; name: string; affiliation: string; job_title: string; email: string } | null;
  contract?: { id: string; contract_no: string; status: ContractStatus } | null;
  learners?: { total: number; attended: number };
  survey?: {
    id: string; title: string; status: string; questionCount: number;
    sent: number; responded: number; responseRate: number; overall: number | null;
  } | null;
};

/**
 * 교육과정 안의 만족도. 문항을 고치는 곳은 만족도 메뉴이고, 여기서는 '보내고 결과를 보는'
 * 두 가지만 한다 — 발송은 그 교육과정에 배정된 수강생에게만 나간다.
 */
function SessionSurvey({ session, busy, onSend, onCreate }: {
  session: SessionRow; busy: boolean; onSend: () => void; onCreate: () => void;
}) {
  const survey = session.survey;
  const learners = session.learners?.total || 0;
  return <div className="session-survey">
    <div className="session-survey-head">
      <h4>만족도</h4>
      {survey
        ? <span className={`stage ${survey.status === "open" ? "progress" : survey.status === "closed" ? "done" : "neutral"}`}>
            {SURVEY_STATUS_LABEL[(survey.status as SurveyStatus)] || survey.status}
          </span>
        : <span className="stage neutral">설문지 없음</span>}
    </div>

    {survey ? <>
      <dl className="session-survey-metrics">
        <div><dt>발송</dt><dd>{survey.sent}명</dd></div>
        <div><dt>응답</dt><dd>{survey.responded}명 · {survey.responseRate}%</dd></div>
        <div><dt>평균</dt><dd>{survey.overall === null ? "—" : `${survey.overall} / 5`}</dd></div>
      </dl>
      <div className="session-actions">
        <button type="button" className="upload-chip" disabled={busy || !learners || !survey.questionCount}
          title={learners ? undefined : "이 교육과정에 배정된 수강생이 없습니다"}
          onClick={onSend}>
          {survey.sent ? "설문 링크 다시 보내기" : "수강생에게 설문 보내기"}
        </button>
        <a className="upload-chip" href={`/api/surveys/${survey.id}/pdf`} target="_blank" rel="noreferrer">설문지 PDF</a>
      </div>
      <p className="survey-hint">문항 편집과 응답 상세는 왼쪽 메뉴의 만족도에서 볼 수 있습니다.</p>
    </> : <>
      <p className="body-text">아직 설문지가 없습니다. 만들고 나면 만족도 메뉴에서 문항을 다듬을 수 있습니다.</p>
      <div className="session-actions">
        <button type="button" className="upload-chip" disabled={busy} onClick={onCreate}>설문지 만들기</button>
      </div>
    </>}
  </div>;
}

const STATUS_LABEL: Record<string, string> = {
  planned: "예정", contracted: "계약 완료", delivered: "진행 완료", cancelled: "취소",
};

function formatDate(session: { held_on: string | null; start_time?: string | null; duration_hours?: number }) {
  return formatHeldOn(session.held_on, session.start_time, session.duration_hours) || "일자 미정";
}

/** 교육과정별 수강생. 사람은 기업 수강생 목록에서 고르고, 여기서는 연결과 출결만 다룬다. */
function SessionRoster({ roster, busy, onEnroll, onChange }: {
  roster: { enrolled: EnrolledRow[]; available: PoolRow[] } | null;
  busy: boolean;
  onEnroll: (learnerIds: string[]) => void;
  onChange: (learnerId: string, patch: { status?: string; remove?: boolean }) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  if (!roster) return <p className="body-text">수강생 불러오는 중</p>;

  const toggle = (id: string) => setPicked((current) =>
    current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);

  return <div className="roster">
    <h4>등록된 수강생 {roster.enrolled.length}명</h4>
    {roster.enrolled.length === 0
      ? <p className="body-text">아직 없습니다. 아래에서 골라 넣으세요.</p>
      : <table className="roster-table">
          <thead><tr><th>이름</th><th>부서 · 직급</th><th>출결</th><th /></tr></thead>
          <tbody>
            {roster.enrolled.map((row) => <tr key={row.id}>
              <td><b>{row.learners?.name || "—"}</b></td>
              <td>{[row.learners?.department, row.learners?.job_title].filter(Boolean).join(" · ") || "—"}</td>
              <td>
                <select value={row.status} disabled={busy}
                  onChange={(event) => onChange(row.learner_id, { status: event.target.value })}>
                  {(Object.keys(LEARNER_STATUS_LABEL) as LearnerStatus[]).map((value) =>
                    <option key={value} value={value}>{LEARNER_STATUS_LABEL[value]}</option>)}
                </select>
              </td>
              <td><button type="button" className="row-delete" disabled={busy}
                onClick={() => onChange(row.learner_id, { remove: true })}>제외</button></td>
            </tr>)}
          </tbody>
        </table>}

    <h4>기업 수강생에서 고르기</h4>
    {roster.available.length === 0
      ? <p className="body-text">더 넣을 수강생이 없습니다. 수강생 메뉴에서 명단을 먼저 등록하세요.</p>
      : <>
          <div className="roster-pick">
            {roster.available.map((learner) => <label key={learner.id}>
              <input type="checkbox" checked={picked.includes(learner.id)} disabled={busy}
                onChange={() => toggle(learner.id)} />
              <b>{learner.name}</b>
              <small>{[learner.department, learner.job_title].filter(Boolean).join(" · ") || "부서 미입력"}</small>
            </label>)}
          </div>
          <div className="modal-actions">
            <button type="button" className="primary-small" disabled={busy || !picked.length}
              onClick={() => { onEnroll(picked); setPicked([]); }}>
              {picked.length ? `${picked.length}명 넣기` : "선택하세요"}
            </button>
          </div>
        </>}
  </div>;
}

export function CompanySessionsTab({ companyId, storedStage, onStageChange, onDataChanged }: { companyId: string; storedStage?: string; onStageChange?: (stage: StoredStage) => void; onDataChanged?: () => void }) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [instructors, setInstructors] = useState<InstructorOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState("");
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const [form, setForm] = useState({ title: "", heldOn: "", startTime: "", location: "", headcount: "", durationHours: "4" });
  const [stage, setStage] = useState<StoredStage>((storedStage as StoredStage) || "research_complete");
  const [roster, setRoster] = useState<{ enrolled: EnrolledRow[]; available: PoolRow[] } | null>(null);
  const [rosterFor, setRosterFor] = useState<string | null>(null);

  const reload = () => fetch(`/api/companies/${companyId}/sessions`)
    .then(async (response) => {
      const result = await response.json() as { sessions?: SessionRow[]; instructors?: InstructorOption[] };
      if (!response.ok) throw new Error("교육 진행 정보 조회 실패");
      setSessions(result.sessions || []);
      setInstructors(result.instructors || []);
      onDataChanged?.();
    })
    .catch(() => undefined);

  useEffect(() => {
    void reload().finally(() => setLoading(false));
    // reload 는 companyId 만 참조한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const changeStage = async (next: StoredStage) => {
    if (next === stage) return;
    setBusyId("stage"); setFeedback(null);
    try {
      const response = await fetch(`/api/companies/${companyId}/stage`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: next }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "상태를 바꾸지 못했습니다.");
      setStage(next);
      onStageChange?.(next);
      setFeedback({ message: `${withRo(stageChoiceLabel(next))} 바꿨습니다.`, error: false });
    } catch (caught) {
      setFeedback({ message: caught instanceof Error ? caught.message : "상태를 바꾸지 못했습니다.", error: true });
    } finally { setBusyId(""); }
  };

  const createSession = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.title.trim()) return setFeedback({ message: "과정명을 입력해 주세요.", error: true });
    setBusyId("new"); setFeedback(null);
    try {
      const response = await fetch("/api/course-sessions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId, title: form.title, heldOn: form.heldOn, startTime: form.startTime,
          location: form.location, headcount: Number(form.headcount) || undefined,
          durationHours: Number(form.durationHours) || 4,
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "교육과정을 만들지 못했습니다.");
      await reload();
      setAdding(false);
      setForm({ title: "", heldOn: "", startTime: "", location: "", headcount: "", durationHours: "4" });
      setFeedback({ message: "교육과정을 만들었습니다.", error: false });
    } catch (caught) {
      setFeedback({ message: caught instanceof Error ? caught.message : "교육과정을 만들지 못했습니다.", error: true });
    } finally { setBusyId(""); }
  };

  const assignInstructor = async (sessionId: string, instructorId: string) => {
    setBusyId(sessionId); setFeedback(null);
    try {
      const response = await fetch(`/api/course-sessions/${sessionId}/assign`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instructorId: instructorId || null }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "강사를 배정하지 못했습니다.");
      await reload();
      setFeedback({
        message: instructorId ? "강사를 배정했습니다." : "강사 배정을 해제했습니다.",
        error: false,
      });
    } catch (caught) {
      setFeedback({ message: caught instanceof Error ? caught.message : "강사를 배정하지 못했습니다.", error: true });
    } finally { setBusyId(""); }
  };

  const openRoster = async (sessionId: string) => {
    if (rosterFor === sessionId) { setRosterFor(null); return; }
    setRosterFor(sessionId); setRoster(null); setFeedback(null);
    try {
      const response = await fetch(`/api/course-sessions/${sessionId}/learners`);
      const result = await response.json() as { error?: string; enrolled?: EnrolledRow[]; available?: PoolRow[] };
      if (!response.ok) throw new Error(result.error || "수강생을 불러오지 못했습니다.");
      setRoster({ enrolled: result.enrolled || [], available: result.available || [] });
    } catch (caught) {
      setFeedback({ message: caught instanceof Error ? caught.message : "수강생을 불러오지 못했습니다.", error: true });
      setRosterFor(null);
    }
  };

  const enroll = async (sessionId: string, learnerIds: string[]) => {
    setBusyId(sessionId); setFeedback(null);
    try {
      const response = await fetch(`/api/course-sessions/${sessionId}/learners`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ learnerIds }),
      });
      const result = await response.json() as { error?: string; added?: number };
      if (!response.ok) throw new Error(result.error || "수강생을 추가하지 못했습니다.");
      await Promise.all([reload(), openRosterAgain(sessionId)]);
      setFeedback({ message: `수강생 ${result.added}명을 추가했습니다.`, error: false });
    } catch (caught) {
      setFeedback({ message: caught instanceof Error ? caught.message : "수강생을 추가하지 못했습니다.", error: true });
    } finally { setBusyId(""); }
  };

  const changeEnrollment = async (sessionId: string, learnerId: string, patch: { status?: string; remove?: boolean }) => {
    setBusyId(sessionId); setFeedback(null);
    try {
      const response = await fetch(`/api/course-sessions/${sessionId}/learners`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ learnerId, ...patch }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "수강생 정보를 바꾸지 못했습니다.");
      await Promise.all([reload(), openRosterAgain(sessionId)]);
    } catch (caught) {
      setFeedback({ message: caught instanceof Error ? caught.message : "수강생 정보를 바꾸지 못했습니다.", error: true });
    } finally { setBusyId(""); }
  };

  /** 목록을 갱신하되 열려 있는 패널을 닫지 않는다. */
  const openRosterAgain = async (sessionId: string) => {
    const response = await fetch(`/api/course-sessions/${sessionId}/learners`);
    const result = await response.json() as { enrolled?: EnrolledRow[]; available?: PoolRow[] };
    if (response.ok) setRoster({ enrolled: result.enrolled || [], available: result.available || [] });
  };

  const createContract = async (sessionId: string) => {
    setBusyId(sessionId); setFeedback(null);
    try {
      const response = await fetch("/api/contracts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseSessionId: sessionId }),
      });
      const result = await response.json() as { error?: string; contract?: { contract_no: string } };
      if (!response.ok || !result.contract) throw new Error(result.error || "계약서를 만들지 못했습니다.");
      await reload();
      setFeedback({ message: `계약서를 만들었습니다 · ${result.contract.contract_no}`, error: false });
    } catch (caught) {
      setFeedback({ message: caught instanceof Error ? caught.message : "계약서를 만들지 못했습니다.", error: true });
    } finally { setBusyId(""); }
  };

  const createSurvey = async (sessionId: string) => {
    setBusyId(sessionId); setFeedback(null);
    try {
      const response = await fetch("/api/surveys", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseSessionId: sessionId }),
      });
      const result = await response.json() as { error?: string; survey?: { id: string } };
      if (!response.ok || !result.survey) throw new Error(result.error || "설문지를 만들지 못했습니다.");
      await reload();
      setFeedback({ message: "설문지를 만들었습니다.", error: false });
    } catch (caught) {
      setFeedback({ message: caught instanceof Error ? caught.message : "설문지를 만들지 못했습니다.", error: true });
    } finally { setBusyId(""); }
  };

  const sendSurvey = async (session: SessionRow) => {
    if (!session.survey) return;
    const already = session.survey.sent;
    // 메일은 되돌릴 수 없다. 몇 명에게 나가는지 먼저 말하고 확인을 받는다.
    const message = already
      ? `이미 ${already}명에게 보냈습니다. 아직 못 받은 사람에게 보내려면 확인을 눌러 주세요.`
      : `배정된 수강생 ${session.learners?.total || 0}명에게 설문 링크를 보냅니다. 계속할까요?`;
    if (!window.confirm(message)) return;

    setBusyId(session.id); setFeedback(null);
    try {
      const response = await fetch(`/api/surveys/${session.survey.id}/send`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resend: false }),
      });
      const result = await response.json() as {
        sent?: number; skipped?: number; withoutEmail?: number; stoppedEarly?: number;
        failures?: Array<{ name: string; reason: string }>; error?: string;
      };
      if (!response.ok) throw new Error(result.error || "설문 링크를 보내지 못했습니다.");
      const notes = [
        `${result.sent || 0}명에게 보냈습니다`,
        result.skipped ? `이미 받은 ${result.skipped}명 제외` : "",
        result.withoutEmail ? `이메일 없는 ${result.withoutEmail}명 제외` : "",
        result.stoppedEarly ? `${result.stoppedEarly}명 남음 — 다시 눌러 주세요` : "",
        result.failures?.length ? `실패 ${result.failures.length}명 (${result.failures[0].reason})` : "",
      ].filter(Boolean);
      await reload();
      setFeedback({ message: notes.join(" · "), error: Boolean(result.failures?.length) });
    } catch (caught) {
      setFeedback({ message: caught instanceof Error ? caught.message : "설문 링크를 보내지 못했습니다.", error: true });
    } finally { setBusyId(""); }
  };

  const uploadDocument = async (sessionId: string, kind: "outline" | "materials", file: File) => {
    setBusyId(sessionId); setFeedback(null);
    try {
      const resolved = resolveInstructorDocument(file.name);
      if (!resolved) throw new Error(`${INSTRUCTOR_FORMAT_LABEL} 파일만 올릴 수 있습니다.`);
      if (file.size > MAX_INSTRUCTOR_DOCUMENT_SIZE) throw new Error("파일은 최대 50MB까지 올릴 수 있습니다.");

      const tokenResponse = await fetch("/api/uploads/instructor-document", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, fileSize: file.size, kind }),
      });
      const token = await tokenResponse.json() as { error?: string; bucket?: string; path?: string; token?: string };
      if (!tokenResponse.ok || !token.bucket || !token.path || !token.token) throw new Error(token.error || "업로드를 준비하지 못했습니다.");

      const { error: uploadError } = await createSupabaseBrowser()
        .storage.from(token.bucket)
        .uploadToSignedUrl(token.path, token.token, file, { contentType: resolved.mimeType });
      if (uploadError) throw new Error(uploadError.message);

      const response = await fetch(`/api/course-sessions/${sessionId}/documents`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, storagePath: token.path, fileName: file.name, mimeType: resolved.mimeType, fileSize: file.size }),
      });
      const result = await response.json() as { error?: string; notice?: string };
      if (!response.ok) throw new Error(result.error || "자료를 읽지 못했습니다.");
      await reload();
      setFeedback({
        message: result.notice || (kind === "outline" ? "강의 구성을 정리했습니다." : "강의 자료를 정리했습니다."),
        error: false,
      });
    } catch (caught) {
      setFeedback({ message: caught instanceof Error ? caught.message : "자료를 올리지 못했습니다.", error: true });
    } finally { setBusyId(""); }
  };

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  // 과정이 하나도 없으면 완료로 표시할 것이 없다. 이미 완료·취소로 바꿔 둔 경우에는 되돌릴
  // 길이 있어야 하므로 계속 보여 준다.
  const showStageControl = sessions.some((session) => session.status !== "cancelled") || stage !== "research_complete";

  return <section className="tab-content">
    <div className="content-title">
      <div>
        <h2>교육 진행</h2>
        <p>교육과정을 만들고, 강사를 배정하고, 브리프를 전달하고, 받은 자료를 등록합니다.</p>
      </div>
      <div className="title-actions">
        {/* 교육 완료·취소는 사람이 정한다(일정이 지났다고 자동으로 넘어가지 않는다). 다만
            한 과정에서 많아야 한 번 누르는 것이라 카드로 세워 두지 않고, 지금 상태가 보이는
            선택 하나로 둔다. 만들어 둔 과정이 없으면 완료로 표시할 것도 없어 나오지 않는다. */}
        {showStageControl && <label className="stage-select">
          <span>진행</span>
          <select value={stage} disabled={busyId === "stage"}
            onChange={(event) => void changeStage(event.target.value as StoredStage)}>
            {STORED_STAGES.map((value) => <option key={value} value={value}>{stageChoiceLabel(value)}</option>)}
          </select>
        </label>}
        <button type="button" onClick={() => setAdding((current) => !current)}>
          {adding ? "닫기" : "＋ 교육과정 생성"}
        </button>
      </div>
    </div>


    {!loading && !instructors.length && <p className="body-text">
      등록된 강사가 없습니다. 교육과정은 만들 수 있지만 배정하려면 강사 메뉴에서 먼저 등록해 주세요.
    </p>}

    {adding && <form className="session-form" onSubmit={createSession} aria-busy={busyId === "new"}>
      <label>과정명<input value={form.title} onChange={set("title")} placeholder="생성형 AI 업무 적용" required disabled={busyId === "new"} /></label>
      <div className="form-row">
        <label>교육 일자<input type="date" value={form.heldOn} onChange={set("heldOn")} disabled={busyId === "new"} /></label>
        {/* 4시간 특강이라 오전·오후가 갈린다. 끝나는 시각은 교육 시간으로 계산해 보여 준다. */}
        <label>시작 시각<input type="time" step={300} value={form.startTime} onChange={set("startTime")} disabled={busyId === "new"} /></label>
        <label>교육 시간<input type="number" min="0.5" step="0.5" value={form.durationHours} onChange={set("durationHours")} disabled={busyId === "new"} /></label>
      </div>
      <div className="form-row">
        <label>장소<input value={form.location} onChange={set("location")} placeholder="본사 교육장" disabled={busyId === "new"} /></label>
        <label>참석 인원<input type="number" min="1" value={form.headcount} onChange={set("headcount")} placeholder="30" disabled={busyId === "new"} /></label>
      </div>
      <div className="modal-actions">
        <button type="submit" className="primary-small" disabled={busyId === "new"}>
          {busyId === "new" ? "생성 중" : "교육과정 생성"}
        </button>
      </div>
    </form>}

    <Feedback value={feedback} onClose={() => setFeedback(null)} />

    {loading
      ? <p className="body-text">불러오는 중</p>
      : sessions.length === 0
        ? <p className="body-text">아직 만든 교육과정이 없습니다.</p>
        : <div className="session-list company-sessions">
            {sessions.map((session) => {
              const open = openId === session.id;
              const ratio = tailoredCaseRatio(session.materials);
              const hasOutline = Boolean(session.outline?.modules?.length);
              const hasMaterials = Boolean(session.materials?.caseExamples?.length || session.materials?.toolsUsed?.length);
              return <div className={open ? "session open" : "session"} key={session.id}>
                <button type="button" onClick={() => setOpenId(open ? null : session.id)}>
                  <div>
                    <b>{session.title}</b>
                    <p>{session.instructors?.name ? `${session.instructors.name} 강사` : "강사 미배정"}</p>
                  </div>
                  <div className="session-meta">
                    {/* 진행이 목록에서 바로 보여야 "무엇이 밀렸는지"가 눈에 들어온다. */}
                    <span className="course-progress">
                      {([["강사", Boolean(session.instructor_id)], ["구성", hasOutline], ["자료", hasMaterials],
                         ["수강생", (session.learners?.total || 0) > 0]] as Array<[string, boolean]>)
                        .map(([label, complete]) => <i key={label} className={complete ? "done" : ""}>{label}</i>)}
                    </span>
                    <small>{formatDate(session)}</small>
                    <span className={session.status === "delivered" ? "available" : "pending"}>
                      {STATUS_LABEL[session.status] || session.status}
                    </span>
                  </div>
                </button>
                {open && <div className="session-body">
                  <dl>
                    <div><dt>강사</dt><dd>{session.instructors?.name || "미배정"}</dd></div>
                    <div><dt>인원</dt><dd>{session.headcount ? `${session.headcount}명` : "미정"}</dd></div>
                    <div><dt>시간</dt><dd>{session.duration_hours}시간</dd></div>
                    <div><dt>수강생</dt><dd>{session.learners?.total ? `${session.learners.total}명${session.learners.attended ? ` · 참석 ${session.learners.attended}` : ""}` : "미등록"}</dd></div>
                    <div><dt>계약</dt><dd>{session.contract ? `${CONTRACT_STATUS_LABEL[session.contract.status]} · ${session.contract.contract_no}` : "미작성"}</dd></div>
                  </dl>

                  {session.outline?.objective && <><h4>학습목표</h4><p className="body-text">{session.outline.objective}</p></>}
                  {hasOutline && <><h4>구성</h4><ul className="module-list">
                    {session.outline.modules.map((module, index) => <li key={`${module.title}-${index}`}>
                      <span>{module.minutes}분</span><b>{module.title}</b><em>{module.mode}</em>
                    </li>)}
                  </ul></>}
                  {ratio !== null && <p className={ratio < 50 ? "case-ratio warn" : "case-ratio"}>
                    맞춤 사례 {ratio}% · 사용 사례 {session.materials.caseExamples.length}건
                    {ratio < 50 && " — 일반 사례 비중이 높습니다"}
                  </p>}

                  <div className="assign-row">
                    <label>담당 강사
                      <select value={session.instructor_id || ""} disabled={busyId === session.id}
                        onChange={(event) => void assignInstructor(session.id, event.target.value)}>
                        <option value="">미배정</option>
                        {instructors.map((instructor) => <option key={instructor.id} value={instructor.id}>
                          {[instructor.name, instructor.affiliation].filter(Boolean).join(" · ")}
                        </option>)}
                      </select>
                    </label>
                  </div>

                  <div className="session-actions">
                    <a className="upload-chip" href={`/api/course-sessions/${session.id}/brief`} target="_blank" rel="noreferrer">
                      강사용 브리프 내려받기
                    </a>
                    {(["outline", "materials"] as const).map((kind) => <label className="upload-chip" key={kind}>
                      <input className="pdf-file-input" type="file" accept={INSTRUCTOR_DOCUMENT_ACCEPT} disabled={busyId === session.id}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = "";
                          if (file) void uploadDocument(session.id, kind, file);
                        }} />
                      {kind === "outline"
                        ? (hasOutline ? "강의 구성 다시 올리기" : "받은 강의 구성 올리기")
                        : (hasMaterials ? "강의 자료 다시 올리기" : "받은 강의 자료 올리기")}
                    </label>)}
                    <button type="button" className="upload-chip" onClick={() => void openRoster(session.id)}>
                      {rosterFor === session.id ? "수강생 닫기" : "수강생 등록"}
                    </button>
                    {session.contract
                      ? <a className="upload-chip" href={`/api/contracts/${session.contract.id}/pdf`} target="_blank" rel="noreferrer">계약서 열기</a>
                      : <button type="button" className="upload-chip" disabled={busyId === session.id || !session.instructor_id}
                          title={session.instructor_id ? undefined : "강사를 배정하면 만들 수 있습니다"}
                          onClick={() => void createContract(session.id)}>
                          계약서 만들기
                        </button>}
                  </div>
                  {busyId === session.id && <p className="body-text">처리 중</p>}

                  <SessionSurvey session={session} busy={busyId === session.id}
                    onSend={() => void sendSurvey(session)} onCreate={() => void createSurvey(session.id)} />

                  {rosterFor === session.id && <SessionRoster
                    roster={roster}
                    busy={busyId === session.id}
                    onEnroll={(ids) => void enroll(session.id, ids)}
                    onChange={(learnerId, patch) => void changeEnrollment(session.id, learnerId, patch)}
                  />}
                </div>}
              </div>;
            })}
          </div>}
  </section>;
}
