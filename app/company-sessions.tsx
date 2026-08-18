"use client";

import { useEffect, useRef, useState } from "react";
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
import {
  SESSION_STATUS_CHOICES, SESSION_STATUS_LABEL, SESSION_STATUS_TONE, SessionStatus, withRo,
} from "@/lib/company-stage";
import { LEARNER_STATUS_LABEL, LearnerInput, LearnerStatus } from "@/lib/learners";
import { SURVEY_STATUS_LABEL, SurveyStatus } from "@/lib/surveys";
import { formatHeldOn } from "@/lib/course-time";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { Feedback, Icon, useConfirm } from "./ui";

type InstructorOption = { id: string; name: string; affiliation: string; job_title: string };

type EnrolledRow = {
  id: string; status: string; learner_id: string;
  learners?: { id: string; name: string; department: string; job_title: string; email: string } | null;
};

type PoolRow = { id: string; name: string; department: string; job_title: string; email: string };

const EMPTY_LEARNER: LearnerInput = { name: "", department: "", jobTitle: "", email: "", notes: "" };

/** 만족도 메뉴에서 관리하는 표준 질문지. 여기서는 고르기만 한다. */
type SurveyTemplateOption = { id: string; name: string; questionCount: number; isDefault: boolean };

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
function SessionSurvey({ session, busy, templates, onSend, onCreate }: {
  session: SessionRow; busy: boolean;
  templates: SurveyTemplateOption[];
  onSend: () => void; onCreate: (templateId: string) => void;
}) {
  // 기본 질문지를 미리 골라 둔다 — 대부분은 그대로 쓰고, 다른 것을 쓸 때만 손이 간다.
  const [templateId, setTemplateId] = useState("");
  const picked = templateId || templates.find((template) => template.isDefault)?.id || templates[0]?.id || "";
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
        <a className="upload-chip" href={`/api/surveys/${survey.id}/pdf`} target="_blank" rel="noreferrer"
          aria-label="설문지 PDF 내려받기" title="설문지 PDF 내려받기"><Icon name="download" size={15} />설문지 PDF</a>
      </div>
      <p className="survey-hint">문항 편집·응답 상세는 만족도 메뉴에서</p>
    </> : <>
      {/* 질문지는 만족도 메뉴에서 관리하고 여기서는 골라 오기만 한다 — 과정마다 새로 쓰면
          문항 id 가 갈려서 과정끼리 견줄 수 없다. 회사별로 더 물을 것은 만든 뒤에 더한다. */}
      <p className="body-text">표준 질문지를 불러와 만듭니다. 이 회사에만 물을 것은 만든 뒤에 문항을 더하면 됩니다.</p>
      <div className="session-actions">
        {templates.length > 1 && <label className="survey-template-pick">
          <span className="sr-only">질문지 고르기</span>
          <select value={picked} disabled={busy} onChange={(event) => setTemplateId(event.target.value)}>
            {templates.map((template) => <option key={template.id} value={template.id}>
              {template.name}{template.isDefault ? " (기본)" : ""} · 문항 {template.questionCount}개
            </option>)}
          </select>
        </label>}
        <button type="button" className="upload-chip lead" disabled={busy} onClick={() => onCreate(picked)}>
          {templates.length ? "이 질문지로 설문지 만들기" : "설문지 만들기"}
        </button>
      </div>
    </>}
  </div>;
}

function formatDate(session: { held_on: string | null; start_time?: string | null; duration_hours?: number }) {
  return formatHeldOn(session.held_on, session.start_time, session.duration_hours) || "일자 미정";
}

/**
 * 교육과정별 수강생. 사람은 기업 명단에 한 번 쌓이고, 여기서는 '이번 교육에 누가
 * 들어오는가'만 고른다 — 한 회사가 교육을 여러 번 하면 회차마다 오는 사람이 다르다.
 * 그래서 기업 명단 전체가 자동으로 들어오지 않는다.
 */
function SessionRoster({ roster, busy, onEnroll, onChange, onRemoveMany, onSheet, onAddOne }: {
  roster: { enrolled: EnrolledRow[]; available: PoolRow[] } | null;
  busy: boolean;
  onEnroll: (learnerIds: string[]) => void;
  onChange: (learnerId: string, patch: { status?: string; remove?: boolean }) => void;
  onRemoveMany: (learnerIds: string[]) => void;
  onSheet: (file: File) => void;
  onAddOne: (learner: LearnerInput) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [dropped, setDropped] = useState<string[]>([]);
  const [manual, setManual] = useState(false);
  const [draft, setDraft] = useState<LearnerInput>(EMPTY_LEARNER);
  const [fromList, setFromList] = useState(false);
  const sheetInputRef = useRef<HTMLInputElement>(null);
  if (!roster) return <p className="body-text">수강생 불러오는 중</p>;

  const toggle = (id: string) => setPicked((current) =>
    current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);

  // 서른 명이 넘으면 눈으로 찾는 것이 일이 된다. 부서·직급·이메일까지 같이 훑는다.
  const keyword = query.trim().toLowerCase();
  const visible = keyword
    ? roster.available.filter((learner) => [learner.name, learner.department, learner.job_title, learner.email]
        .filter(Boolean).join(" ").toLowerCase().includes(keyword))
    : roster.available;
  const allPicked = visible.length > 0 && visible.every((learner) => picked.includes(learner.id));
  // 전체 선택은 '지금 보이는 것'에만 건다 — 검색으로 부서를 걸러 놓고 누르면 그 부서만
  // 들어온다. 화면에 없는 사람이 조용히 딸려 들어가면 그게 사고다.
  const toggleAll = () => setPicked((current) => allPicked
    ? current.filter((id) => !visible.some((learner) => learner.id === id))
    : [...new Set([...current, ...visible.map((learner) => learner.id)])]);

  const total = roster.enrolled.length + roster.available.length;

  // 들어와 있는 사람 쪽에도 같은 손잡이를 준다 — 한 번에 넣었다가 몇 명만 남기는 일이
  // 실제로 잦은데, 한 줄씩 '제외'를 스무 번 누르게 두면 아무도 고치지 않는다.
  const allDropped = roster.enrolled.length > 0 && roster.enrolled.every((row) => dropped.includes(row.learner_id));
  const toggleAllDropped = () => setDropped(allDropped ? [] : roster.enrolled.map((row) => row.learner_id));

  return <div className="roster">
    <h4>이 교육 수강생 {roster.enrolled.length}명 <small>기업 명단 {total}명 중</small></h4>
    {roster.enrolled.length === 0
      ? <p className="body-text">아직 없습니다. 아래에서 골라 넣으세요.</p>
      : <>
        <div className="roster-tools">
          <button type="button" className="upload-chip" onClick={toggleAllDropped} disabled={busy}>
            {allDropped ? "선택 해제" : "전체 선택"}
          </button>
          <button type="button" className="upload-chip danger" disabled={busy || !dropped.length}
            onClick={() => { onRemoveMany(dropped); setDropped([]); }}>
            선택한 {dropped.length}명 빼기
          </button>
          <span className="roster-count">{dropped.length ? `${dropped.length}명 선택함` : "빼려면 왼쪽 칸을 고르세요"}</span>
        </div>
        <table className="roster-table">
          <thead><tr><th className="pick-col"><span className="sr-only">선택</span></th><th>이름</th><th>부서 · 직급</th><th>출결</th><th /></tr></thead>
          <tbody>
            {roster.enrolled.map((row) => <tr key={row.id} className={dropped.includes(row.learner_id) ? "picked" : ""}>
              <td className="pick-col">
                <input type="checkbox" checked={dropped.includes(row.learner_id)} disabled={busy}
                  aria-label={`${row.learners?.name || "수강생"} 선택`}
                  onChange={() => setDropped((current) => current.includes(row.learner_id)
                    ? current.filter((id) => id !== row.learner_id)
                    : [...current, row.learner_id])} />
              </td>
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
        </table>
      </>}

    {/* 명단은 대개 고객사가 정해서 엑셀로 넘겨 준다. 그러니 그 길이 첫 번째다 —
        올리면 이 교육에 바로 들어가고, 기업 명단에도 같이 쌓인다(같은 사람은 이메일로
        알아보고 겹쳐 쓴다). 손으로 넣는 길과 기존 명단에서 고르는 길은 그 뒤에 둔다. */}
    <h4>이 교육에 넣기</h4>
    <div className="roster-intake">
      <label className="upload-chip lead">
        <input ref={sheetInputRef} className="pdf-file-input" type="file" accept=".xlsx" disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) onSheet(file);
          }} />
        <Icon name="upload" size={15} />명단 엑셀 올리기
      </label>
      <button type="button" className="upload-chip" disabled={busy}
        onClick={() => { setManual((current) => !current); setDraft(EMPTY_LEARNER); }}>
        <Icon name="plus" size={15} />한 명 직접 추가
      </button>
      <button type="button" className="upload-chip" disabled={busy || roster.available.length === 0}
        onClick={() => setFromList((current) => !current)}>
        기업 명단에서 고르기{roster.available.length ? ` (${roster.available.length})` : ""}
      </button>
    </div>
    <p className="action-hint">엑셀 첫 줄에 이름·부서·직급·이메일 머리글이 있으면 됩니다. 이미 있는 사람은 새로 만들지 않고 정보만 갱신합니다.</p>

    {manual && <div className="session-form roster-manual">
      <div className="form-row">
        <label>이름<input value={draft.name} disabled={busy} placeholder="홍길동"
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
        <label>부서<input value={draft.department} disabled={busy} placeholder="인재개발팀"
          onChange={(event) => setDraft((current) => ({ ...current, department: event.target.value }))} /></label>
      </div>
      <div className="form-row">
        <label>직급 · 직책<input value={draft.jobTitle} disabled={busy} placeholder="과장"
          onChange={(event) => setDraft((current) => ({ ...current, jobTitle: event.target.value }))} /></label>
        <label>이메일<input value={draft.email} disabled={busy} placeholder="name@example.com"
          onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} /></label>
      </div>
      <div className="modal-actions">
        <button type="button" onClick={() => setManual(false)} disabled={busy}>취소</button>
        <button type="button" className="primary-small" disabled={busy || !draft.name.trim()}
          onClick={() => { onAddOne(draft); setDraft(EMPTY_LEARNER); setManual(false); }}>넣기</button>
      </div>
    </div>}

    {fromList && roster.available.length > 0 && <><h4>기업 명단에서 고르기 <small>{roster.available.length}명 대기</small></h4>
    {/* 빈 이유를 갈라 말한다. 예전에는 둘 다 '명단을 먼저 등록하세요'로 나와서, 이미 다
        넣은 상태인데도 아무것도 안 한 것처럼 보였다. */}
    {roster.available.length === 0
      ? <p className="body-text">
          {total === 0
            ? "기업에 등록된 수강생이 없습니다. 수강생 탭에서 명단을 먼저 올려 주세요."
            : `기업 명단 ${total}명이 모두 이 교육에 들어와 있습니다.`}
        </p>
      : <>
          <div className="roster-tools">
            <div className="searchbox">
              <Icon name="search" size={15} />
              <input value={query} onChange={(event) => setQuery(event.target.value)}
                placeholder="이름 또는 부서" aria-label="기업 명단에서 검색" />
            </div>
            <button type="button" className="upload-chip" onClick={toggleAll} disabled={busy || !visible.length}>
              {allPicked ? "선택 해제" : keyword ? `검색된 ${visible.length}명 선택` : "전체 선택"}
            </button>
            <span className="roster-count">{picked.length ? `${picked.length}명 선택함` : "선택한 사람 없음"}</span>
          </div>
          <div className="roster-pick">
            {visible.map((learner) => <label key={learner.id}>
              <input type="checkbox" checked={picked.includes(learner.id)} disabled={busy}
                onChange={() => toggle(learner.id)} />
              <b>{learner.name}</b>
              <small>{[learner.department, learner.job_title].filter(Boolean).join(" · ") || "부서 미입력"}</small>
            </label>)}
          </div>
          {keyword && visible.length === 0 && <p className="body-text">‘{query.trim()}’ 에 맞는 사람이 없습니다.</p>}
          <div className="modal-actions">
            <button type="button" className="primary-small" disabled={busy || !picked.length}
              onClick={() => { onEnroll(picked); setPicked([]); setQuery(""); }}>
              {picked.length ? `고른 ${picked.length}명 넣기` : "고른 사람 넣기"}
            </button>
          </div>
        </>}</>}
  </div>;
}

export function CompanySessionsTab({ companyId, onDataChanged }: { companyId: string; onDataChanged?: () => void }) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [instructors, setInstructors] = useState<InstructorOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState("");
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const [form, setForm] = useState({ title: "", heldOn: "", startTime: "", location: "", headcount: "", durationHours: "4" });
  const [roster, setRoster] = useState<{ enrolled: EnrolledRow[]; available: PoolRow[] } | null>(null);
  const [rosterFor, setRosterFor] = useState<string | null>(null);
  const [templates, setTemplates] = useState<SurveyTemplateOption[]>([]);
  const { ask, confirmDialog } = useConfirm();

  const reload = () => fetch(`/api/companies/${companyId}/sessions`)
    .then(async (response) => {
      const result = await response.json() as { sessions?: SessionRow[]; instructors?: InstructorOption[] };
      if (!response.ok) throw new Error("교육 진행 정보 조회 실패");
      setSessions(result.sessions || []);
      setInstructors(result.instructors || []);
      onDataChanged?.();
    })
    .catch(() => undefined);

  // 질문지 목록은 만족도 메뉴가 주인이다. 여기서는 고를 것을 보여 주기 위해 읽기만 한다.
  useEffect(() => {
    void fetch("/api/survey-templates")
      .then(async (response) => {
        const result = await response.json() as { templates?: Array<{ id: string; name: string; questions: unknown[]; is_default: boolean }> };
        if (!response.ok) return;
        setTemplates((result.templates || []).map((template) => ({
          id: template.id, name: template.name,
          questionCount: Array.isArray(template.questions) ? template.questions.length : 0,
          isDefault: Boolean(template.is_default),
        })));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void reload().finally(() => setLoading(false));
    // reload 는 companyId 만 참조한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  /**
   * 교육과정 상태. 예정 → 교육 완료·취소는 사람이 판단한다(일정이 지났다고 자동으로 넘어가지
   * 않는다 — 미룬 교육, 당일 취소가 전부 완료로 보이게 된다). 회사 단계는 이 값들에서 읽는다.
   */
  const changeSessionStatus = async (session: SessionRow, next: string) => {
    if (next === session.status) return;
    setBusyId(session.id); setFeedback(null);
    try {
      const response = await fetch(`/api/course-sessions/${session.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "상태를 바꾸지 못했습니다.");
      await reload();
      onDataChanged?.();
      setFeedback({ message: `${withRo(SESSION_STATUS_LABEL[next] || next)} 바꿨습니다.`, error: false });
    } catch (caught) {
      setFeedback({ message: caught instanceof Error ? caught.message : "상태를 바꾸지 못했습니다.", error: true });
    } finally { setBusyId(""); }
  };

  /**
   * 수정. 지우고 다시 만들면 붙어 있던 수강생 배정과 설문지·응답까지 사라지므로, 날짜가
   * 밀리거나 장소가 바뀌는 흔한 일에는 수정이 맞는 길이다.
   *
   * 과정에 관한 값은 강사까지 포함해 여기 한 곳에서만 고친다. 카드 위에서 곧바로 고치는
   * 칸을 따로 두면 같은 일을 하는 자리가 둘이 되고, 어느 쪽이 정본인지 알 수 없어진다.
   */
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ title: "", heldOn: "", startTime: "", location: "", headcount: "", durationHours: "4", instructorId: "" });

  const startEdit = (session: SessionRow) => {
    setEditId(session.id);
    setEditForm({
      title: session.title,
      instructorId: session.instructor_id || "",
      heldOn: session.held_on ? String(session.held_on).slice(0, 10) : "",
      // DB 의 time 은 "14:00:00" 으로 온다. input[type=time] 은 분까지만 받는다.
      startTime: session.start_time ? String(session.start_time).slice(0, 5) : "",
      location: session.location || "",
      headcount: session.headcount ? String(session.headcount) : "",
      durationHours: String(session.duration_hours ?? 4),
    });
  };

  const saveEdit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editId) return;
    if (!editForm.title.trim()) return setFeedback({ message: "과정명을 입력해 주세요.", error: true });
    setBusyId(editId); setFeedback(null);
    try {
      // 강사는 계약서와 묶여 있어 라우트가 다르다(계약이 나간 뒤에는 바꿀 수 없다). 그쪽이
      // 더 엄격하니 먼저 부른다 — 막힐 일이면 나머지 값을 건드리기 전에 막히는 편이 낫다.
      const current = sessions.find((row) => row.id === editId);
      if (current && editForm.instructorId !== (current.instructor_id || "")) {
        const assigned = await fetch(`/api/course-sessions/${editId}/assign`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instructorId: editForm.instructorId || null }),
        });
        const assignResult = await assigned.json() as { error?: string };
        if (!assigned.ok) throw new Error(assignResult.error || "강사를 배정하지 못했습니다.");
      }

      const response = await fetch(`/api/course-sessions/${editId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editForm.title, heldOn: editForm.heldOn, startTime: editForm.startTime,
          location: editForm.location, headcount: editForm.headcount,
          durationHours: Number(editForm.durationHours) || 4,
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "교육과정을 수정하지 못했습니다.");
      await reload();
      onDataChanged?.();
      setEditId(null);
      setFeedback({ message: "교육과정을 수정했습니다.", error: false });
    } catch (caught) {
      setFeedback({ message: caught instanceof Error ? caught.message : "교육과정을 수정하지 못했습니다.", error: true });
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

  /**
   * 고객사가 보낸 명단 엑셀을 이 교육에 그대로 들인다. 읽기(회사 라우트)와 저장(수강생
   * 라우트)을 잇는 것뿐이고, 같은 사람 판정은 서버가 한다 — 이메일이 같으면 같은 사람이라
   * 새로 만들지 않고 정보만 갱신한다(이메일이 없으면 이름+부서). 그래서 같은 명단을 두 번
   * 올려도 사람이 두 배가 되지 않는다.
   */
  const uploadRoster = async (sessionId: string, file: File) => {
    setBusyId(sessionId); setFeedback(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const read = await fetch(`/api/companies/${companyId}/learners`, { method: "POST", body: form });
      const parsed = await read.json() as { error?: string; learners?: LearnerInput[] };
      if (!read.ok || !parsed.learners) throw new Error(parsed.error || "엑셀을 읽지 못했습니다.");
      if (!parsed.learners.length) throw new Error("명단에서 사람을 찾지 못했습니다. 첫 줄 머리글을 확인해 주세요.");

      const saveResult = await saveLearners(sessionId, parsed.learners);
      const notes = [
        `명단 ${parsed.learners.length}명을 읽었습니다`,
        saveResult.enrolled ? `이 교육에 ${saveResult.enrolled}명 추가` : "이 교육에 새로 들어온 사람 없음",
        saveResult.updated ? `기존 ${saveResult.updated}명 정보 갱신` : "",
        saveResult.withoutEmail ? `이메일 없는 ${saveResult.withoutEmail}명은 이름·부서로 맞췄습니다` : "",
      ].filter(Boolean);
      setFeedback({ message: notes.join(" · "), error: false });
    } catch (caught) {
      setFeedback({ message: caught instanceof Error ? caught.message : "명단을 올리지 못했습니다.", error: true });
    } finally { setBusyId(""); }
  };

  /** 한 명 직접 추가. 엑셀과 같은 길을 쓰므로 중복 판정도 똑같이 걸린다. */
  const addOneLearner = async (sessionId: string, learner: LearnerInput) => {
    setBusyId(sessionId); setFeedback(null);
    try {
      const result = await saveLearners(sessionId, [learner]);
      setFeedback({
        message: result.enrolled
          ? `${learner.name} 님을 이 교육에 넣었습니다.`
          : `${learner.name} 님은 이미 이 교육에 있습니다.`,
        error: false,
      });
    } catch (caught) {
      setFeedback({ message: caught instanceof Error ? caught.message : "수강생을 넣지 못했습니다.", error: true });
    } finally { setBusyId(""); }
  };

  /** 기업 명단에 쌓고 이 교육에 잇는 한 번의 저장. 화면 갱신까지 포함한다. */
  const saveLearners = async (sessionId: string, learners: LearnerInput[]) => {
    const response = await fetch("/api/learners", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, courseSessionId: sessionId, learners }),
    });
    const result = await response.json() as {
      error?: string; saved?: number; updated?: number; enrolled?: number; withoutEmail?: number;
    };
    if (!response.ok) throw new Error(result.error || "수강생을 등록하지 못했습니다.");
    await Promise.all([reload(), openRosterAgain(sessionId)]);
    onDataChanged?.();
    return {
      saved: result.saved || 0, updated: result.updated || 0,
      enrolled: result.enrolled || 0, withoutEmail: result.withoutEmail || 0,
    };
  };

  /**
   * 여럿을 한 번에 이 교육에서 뺀다. 사람 자체는 기업 명단에 그대로 남는다 — 다음 회차에
   * 다시 부를 수 있어야 하고, 다른 과정의 수강 이력도 건드리면 안 된다.
   */
  const removeMany = async (sessionId: string, learnerIds: string[]) => {
    const agreed = await ask({
      title: `선택한 ${learnerIds.length}명을 이 교육에서 뺄까요?`,
      message: "기업 명단에는 그대로 남습니다. 이 교육의 출결 기록만 사라집니다.",
      confirmLabel: "빼기", danger: true,
    });
    if (!agreed) return;

    setBusyId(sessionId); setFeedback(null);
    try {
      const response = await fetch(`/api/course-sessions/${sessionId}/learners`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ learnerIds, remove: true }),
      });
      const result = await response.json() as { error?: string; removed?: number };
      if (!response.ok) throw new Error(result.error || "수강생을 빼지 못했습니다.");
      await Promise.all([reload(), openRosterAgain(sessionId)]);
      setFeedback({ message: `${result.removed}명을 이 교육에서 뺐습니다.`, error: false });
    } catch (caught) {
      setFeedback({ message: caught instanceof Error ? caught.message : "수강생을 빼지 못했습니다.", error: true });
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

  /**
   * 교육과정 삭제. 과정에 매달린 것들이 함께 사라지므로(수강생 배정·설문지와 응답·계약서
   * 초안·올린 자료) 무엇이 없어지는지 세어서 먼저 보여 준다 — "정말 삭제할까요?"만으로는
   * 사람이 무엇을 잃는지 알 수 없다. 서명이 끝난 계약이 걸린 과정은 서버가 막는다.
   */
  const deleteSession = async (session: SessionRow) => {
    const losses = [
      (session.learners?.total || 0) > 0 ? `수강생 배정 ${session.learners?.total}명` : "",
      session.survey ? (session.survey.responded > 0
        ? `만족도 설문지와 응답 ${session.survey.responded}건`
        : "만족도 설문지") : "",
      session.contract ? `계약서 ${session.contract.contract_no}` : "",
    ].filter(Boolean);
    const agreed = await ask({
      title: `‘${session.title}’ 교육과정을 삭제할까요?`,
      message: losses.length ? "함께 사라집니다." : "되돌릴 수 없습니다.",
      lines: losses,
      confirmLabel: "삭제",
      danger: true,
    });
    if (!agreed) return;

    setBusyId(session.id); setFeedback(null);
    try {
      const response = await fetch(`/api/course-sessions/${session.id}`, { method: "DELETE" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "교육과정을 삭제하지 못했습니다.");
      await reload();
      onDataChanged?.();
      setFeedback({ message: "교육과정을 삭제했습니다.", error: false });
    } catch (caught) {
      setFeedback({ message: caught instanceof Error ? caught.message : "교육과정을 삭제하지 못했습니다.", error: true });
    } finally { setBusyId(""); }
  };

  const createSurvey = async (sessionId: string, templateId?: string) => {
    setBusyId(sessionId); setFeedback(null);
    try {
      const response = await fetch("/api/surveys", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseSessionId: sessionId, templateId }),
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
    const agreed = await ask({
      title: already ? "아직 못 받은 사람에게 보낼까요?" : `수강생 ${session.learners?.total || 0}명에게 설문 링크를 보낼까요?`,
      message: already ? `이미 ${already}명에게 보냈습니다.` : undefined,
      confirmLabel: "보내기",
    });
    if (!agreed) return;

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


  return <section className="tab-content">
    {confirmDialog}
    <div className="content-title">
      <div>
        <h2>교육 진행</h2>
      </div>
      <div className="title-actions">
        {/* 교육 완료·취소는 사람이 정한다(일정이 지났다고 자동으로 넘어가지 않는다). 다만
            한 과정에서 많아야 한 번 누르는 것이라 카드로 세워 두지 않고, 지금 상태가 보이는
            선택 하나로 둔다. 만들어 둔 과정이 없으면 완료로 표시할 것도 없어 나오지 않는다. */}
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
              // 지금 이 과정에 비어 있는 칸 하나. 실제 순서(구성 → 자료 → 수강생 → 계약)를
              // 그대로 따라가므로, 진한 칩 하나만 좇으면 교육 하나가 끝난다.
              const leadAction = !hasOutline ? "outline"
                : !hasMaterials ? "materials"
                : (session.learners?.total || 0) === 0 ? "roster"
                : !session.contract && session.instructor_id ? "contract"
                : "";
              return <div className={open ? "session open" : "session"} key={session.id}>
                <div className="session-head">
                  {/* 펼치기 버튼을 뒤에 깔고, 누를 것(상태·수정·삭제)만 그 위에 올린다 —
                      버튼 안에 버튼을 넣을 수 없고, 카드를 여는 넓은 자리도 포기할 수 없다. */}
                  <button type="button" className="session-toggle" aria-expanded={open}
                    aria-label={`${session.title} ${open ? "접기" : "펼치기"}`}
                    onClick={() => setOpenId(open ? null : session.id)} />
                  <div className="session-title">
                    <b className="session-name">{session.title}</b>
                    <small className={session.instructors?.name ? "session-instructor" : "session-instructor none"}>
                      {/* 소속은 적지 않는다 — 프리랜서 자격으로 오는 강사라 소속이
                          강사를 가리키는 정보가 아니다. */}
                      {session.instructors?.name || "강사 미배정"}
                    </small>
                  </div>
                  {/* 머리 줄에 남기는 것은 일시와 상태뿐이다. 구성·자료·수강생을 칩으로
                      세워 두던 때에는 상태가 두 벌로 보였다 — 진짜 상태는 오른쪽 하나다. */}
                  <div className="session-meta"><small>{formatDate(session)}</small></div>
                  <label className={`stage-pick head ${SESSION_STATUS_TONE[session.status] || "neutral"}`}>
                    <i className="stage-dot" aria-hidden="true" />
                    <select value={session.status} disabled={busyId === session.id} aria-label={`${session.title} 진행 상태`}
                      onChange={(event) => void changeSessionStatus(session, event.target.value)}>
                      {SESSION_STATUS_CHOICES.map((value) => <option key={value} value={value}>
                        {SESSION_STATUS_LABEL[value]}
                      </option>)}
                      {!SESSION_STATUS_CHOICES.includes(session.status as SessionStatus) &&
                        <option value={session.status}>{SESSION_STATUS_LABEL[session.status] || session.status}</option>}
                    </select>
                    <svg className="stage-caret" width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">
                      <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </label>
                  {/* 수정은 카드를 펼쳐야 나오던 것이라, 고칠 일이 있는 사람이 두 번 찾아야
                      했다. 삭제와 나란히 머리 줄에 둔다 — 누르면 카드를 열고 폼까지 편다. */}
                  <button type="button" className="session-edit" disabled={busyId === session.id}
                    aria-pressed={editId === session.id}
                    aria-label={`${session.title} 정보 수정`} title="교육과정 정보 수정"
                    onClick={() => {
                      if (editId === session.id) return setEditId(null);
                      setOpenId(session.id);
                      startEdit(session);
                    }}>
                    <Icon name="pencil" size={16} />
                  </button>
                  <button type="button" className="session-delete" disabled={busyId === session.id}
                    onClick={() => void deleteSession(session)} aria-label={`${session.title} 삭제`} title="교육과정 삭제">
                    {busyId === session.id ? <i className="spinner" aria-hidden="true"/> : <Icon name="trash" size={17}/>}
                  </button>
                </div>
                {open && <div className="session-body">
                  {editId === session.id
                    ? <form className="session-form" onSubmit={saveEdit} aria-busy={busyId === session.id}>
                        <label>과정명<input value={editForm.title} disabled={busyId === session.id}
                          onChange={(event) => setEditForm((current) => ({ ...current, title: event.target.value }))} required /></label>
                        <div className="form-row">
                          <label>교육 일자<input type="date" value={editForm.heldOn} disabled={busyId === session.id}
                            onChange={(event) => setEditForm((current) => ({ ...current, heldOn: event.target.value }))} /></label>
                          <label>시작 시각<input type="time" step={300} value={editForm.startTime} disabled={busyId === session.id}
                            onChange={(event) => setEditForm((current) => ({ ...current, startTime: event.target.value }))} /></label>
                          <label>교육 시간<input type="number" min="0.5" step="0.5" value={editForm.durationHours} disabled={busyId === session.id}
                            onChange={(event) => setEditForm((current) => ({ ...current, durationHours: event.target.value }))} /></label>
                        </div>
                        <div className="form-row">
                          <label>장소<input value={editForm.location} placeholder="본사 교육장" disabled={busyId === session.id}
                            onChange={(event) => setEditForm((current) => ({ ...current, location: event.target.value }))} /></label>
                          <label>참석 인원<input type="number" min="1" value={editForm.headcount} placeholder="30" disabled={busyId === session.id}
                            onChange={(event) => setEditForm((current) => ({ ...current, headcount: event.target.value }))} /></label>
                          <label>담당 강사
                            <select value={editForm.instructorId} disabled={busyId === session.id}
                              onChange={(event) => setEditForm((current) => ({ ...current, instructorId: event.target.value }))}>
                              <option value="">미배정</option>
                              {instructors.map((instructor) => <option key={instructor.id} value={instructor.id}>
                                {instructor.name}
                              </option>)}
                            </select>
                          </label>
                        </div>
                        <div className="modal-actions">
                          <button type="button" onClick={() => setEditId(null)} disabled={busyId === session.id}>취소</button>
                          <button type="submit" className="primary-small" disabled={busyId === session.id}>
                            {busyId === session.id ? "저장 중" : "수정 저장"}
                          </button>
                        </div>
                      </form>
                    : null}
                  <dl className="session-facts">
                    <div><dt>장소</dt><dd>{session.location || "미정"}</dd></div>
                    <div><dt>인원</dt><dd>{session.headcount ? `${session.headcount}명` : "미정"}</dd></div>
                    <div><dt>교육 시간</dt><dd>{session.duration_hours}시간</dd></div>
                    <div><dt>수강생</dt><dd>{session.learners?.total ? `${session.learners.total}명${session.learners.attended ? ` · 참석 ${session.learners.attended}` : ""}` : "미등록"}</dd></div>
                    <div><dt>계약</dt><dd>{session.contract ? `${CONTRACT_STATUS_LABEL[session.contract.status]} · ${session.contract.contract_no}` : "미작성"}</dd></div>
                  </dl>

                  {/* 할 일은 읽을거리 위에 둔다. 강의 구성이 길면 작업 줄이 카드 700px 아래로
                      밀려, 무언가 하려고 카드를 연 사람이 스크롤부터 해야 했다.
                      다섯 개를 똑같은 무게로 늘어놓지 않고, 지금 비어 있는 칸을 채우는 것
                      하나만 진하게 한다 — 나머지는 있되 부르지 않는다. */}
                  <div className="session-actions">
                    {/* 화살표가 방향을 말하므로 '올리기·내려받기'를 글로 되풀이하지 않는다.
                        이름만 남기고, 읽어 주는 말은 aria-label 로 온전히 남긴다. */}
                    {(["outline", "materials"] as const).map((kind) => {
                      const label = kind === "outline" ? "강의 구성" : "강의 자료";
                      const done = kind === "outline" ? hasOutline : hasMaterials;
                      // 강사 배정을 기다리지 않는다 — 자료부터 받아 두는 순서가 실제로 흔하다.
                      // 강사가 정해지면 그때 올려 둔 자료에 주인이 적힌다(assign 라우트).
                      return <label className={`upload-chip${leadAction === kind ? " lead" : ""}`} key={kind}
                        aria-label={`${label} ${done ? "다시 " : ""}올리기`} title={`${label} ${done ? "다시 " : ""}올리기`}>
                        <input className="pdf-file-input" type="file" accept={INSTRUCTOR_DOCUMENT_ACCEPT}
                          disabled={busyId === session.id}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = "";
                            if (file) void uploadDocument(session.id, kind, file);
                          }} />
                        <Icon name="upload" size={15} />{label}
                      </label>;
                    })}
                    <button type="button" className={`upload-chip${leadAction === "roster" ? " lead" : ""}`}
                      onClick={() => void openRoster(session.id)}>
                      {rosterFor === session.id ? "수강생 닫기" : "수강생 등록"}
                    </button>
                    {session.contract
                      ? <a className="upload-chip" href={`/api/contracts/${session.contract.id}/pdf`} target="_blank" rel="noreferrer"
                          aria-label="계약서 내려받기" title="계약서 내려받기"><Icon name="download" size={15} />계약서</a>
                      : <button type="button" className={`upload-chip${leadAction === "contract" ? " lead" : ""}`}
                          disabled={busyId === session.id || !session.instructor_id}
                          onClick={() => void createContract(session.id)}>
                          계약서 만들기
                        </button>}
                    <a className="upload-chip" href={`/api/course-sessions/${session.id}/brief`} target="_blank" rel="noreferrer"
                      aria-label="강사용 브리프 내려받기" title="강사용 브리프 내려받기">
                      <Icon name="download" size={15} />강사용 브리프
                    </a>
                  </div>
                  {/* 못 누르는 이유는 마우스를 올려야 보이는 말풍선이 아니라 글로 적는다 —
                      휴대폰에는 hover 가 없어 이유를 볼 방법이 아예 없었다. */}
                  {!session.contract && !session.instructor_id &&
                    <p className="action-hint">계약서는 담당 강사를 배정한 뒤에 만들 수 있습니다. 강사는 카드 오른쪽 연필에서 고릅니다.</p>}

                  {/* 강사가 낸 자료에서 뽑은 것을 다 보여 준다. 도구·성과·사전 준비까지 있어야
                      "이 수업이 무엇을 남기는가"를 담당자가 고객사에 설명할 수 있다. */}
                  {session.outline?.objective && <div className="outline-block">
                    <h4>학습목표</h4><p className="body-text">{session.outline.objective}</p>
                  </div>}
                  {hasOutline && <div className="outline-block">
                    <h4>구성 <small>{session.outline.modules.length}교시 · {session.outline.modules.reduce((sum, module) => sum + (module.minutes || 0), 0)}분</small></h4>
                    <ol className="module-list">
                      {session.outline.modules.map((module, index) => <li key={`${module.title}-${index}`}>
                        <div className="module-head">
                          <span className="module-time">{module.minutes}분</span>
                          <b>{module.title}</b>
                          <em className={`module-mode ${module.mode}`}>{module.mode}</em>
                        </div>
                        {module.outcome && <p className="module-outcome">{module.outcome}</p>}
                        {module.tools.length > 0 && <p className="module-tools">
                          {module.tools.map((tool) => <i key={tool}>{tool}</i>)}
                        </p>}
                      </li>)}
                    </ol>
                  </div>}
                  {(session.outline?.prerequisites?.length || session.outline?.deliverables?.length) ? <div className="outline-block outline-side">
                    {session.outline.prerequisites.length > 0 && <div>
                      <h4>사전 준비</h4>
                      <ul className="plain-list">{session.outline.prerequisites.map((item) => <li key={item}>{item}</li>)}</ul>
                    </div>}
                    {session.outline.deliverables.length > 0 && <div>
                      <h4>수강생이 얻는 것</h4>
                      <ul className="plain-list">{session.outline.deliverables.map((item) => <li key={item}>{item}</li>)}</ul>
                    </div>}
                  </div> : null}
                  {ratio !== null && <p className={ratio < 50 ? "case-ratio warn" : "case-ratio"}>
                    맞춤 사례 {ratio}% · 사용 사례 {session.materials.caseExamples.length}건
                    {ratio < 50 && " — 일반 사례 비중이 높습니다"}
                  </p>}

                  {busyId === session.id && <p className="body-text">처리 중</p>}

                  <SessionSurvey session={session} busy={busyId === session.id} templates={templates}
                    onSend={() => void sendSurvey(session)}
                    onCreate={(templateId) => void createSurvey(session.id, templateId)} />

                  {rosterFor === session.id && <SessionRoster
                    roster={roster}
                    busy={busyId === session.id}
                    onEnroll={(ids) => void enroll(session.id, ids)}
                    onChange={(learnerId, patch) => void changeEnrollment(session.id, learnerId, patch)}
                    onRemoveMany={(ids) => void removeMany(session.id, ids)}
                    onSheet={(file) => void uploadRoster(session.id, file)}
                    onAddOne={(learner) => void addOneLearner(session.id, learner)}
                  />}
                </div>}
              </div>;
            })}
          </div>}
  </section>;
}
