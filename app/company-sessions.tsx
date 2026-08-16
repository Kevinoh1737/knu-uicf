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
import { createSupabaseBrowser } from "@/lib/supabase/browser";

type InstructorOption = { id: string; name: string; affiliation: string; job_title: string };

type SessionRow = {
  id: string;
  title: string;
  held_on: string | null;
  location: string;
  headcount: number | null;
  duration_hours: number;
  status: string;
  outline: CourseOutline;
  materials: CourseMaterials;
  instructor_id: string;
  instructors?: { id: string; name: string; affiliation: string; job_title: string; email: string } | null;
  contract?: { id: string; contract_no: string; status: ContractStatus } | null;
};

const STATUS_LABEL: Record<string, string> = {
  planned: "예정", contracted: "계약 완료", delivered: "진행 완료", cancelled: "취소",
};

function formatDate(value: string | null) {
  if (!value) return "일자 미정";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeZone: "Asia/Seoul" }).format(new Date(value));
}

export function CompanySessionsTab({ companyId }: { companyId: string }) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [instructors, setInstructors] = useState<InstructorOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState("");
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const [form, setForm] = useState({ instructorId: "", title: "", heldOn: "", location: "", headcount: "", durationHours: "4" });

  const reload = () => fetch(`/api/companies/${companyId}/sessions`)
    .then(async (response) => {
      const result = await response.json() as { sessions?: SessionRow[]; instructors?: InstructorOption[] };
      if (!response.ok) throw new Error("교육 진행 정보 조회 실패");
      setSessions(result.sessions || []);
      setInstructors(result.instructors || []);
    })
    .catch(() => undefined);

  useEffect(() => {
    void reload().finally(() => setLoading(false));
    // reload 는 companyId 만 참조한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const createSession = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.instructorId) return setFeedback({ message: "강사를 선택해 주세요.", error: true });
    if (!form.title.trim()) return setFeedback({ message: "과정명을 입력해 주세요.", error: true });
    setBusyId("new"); setFeedback(null);
    try {
      const response = await fetch("/api/course-sessions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId, instructorId: form.instructorId, title: form.title, heldOn: form.heldOn,
          location: form.location, headcount: Number(form.headcount) || undefined,
          durationHours: Number(form.durationHours) || 4,
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "강의를 등록하지 못했습니다.");
      await reload();
      setAdding(false);
      setForm({ instructorId: "", title: "", heldOn: "", location: "", headcount: "", durationHours: "4" });
      setFeedback({ message: "강사를 배정했습니다. 브리프를 내려받아 전달하세요.", error: false });
    } catch (caught) {
      setFeedback({ message: caught instanceof Error ? caught.message : "강의를 등록하지 못했습니다.", error: true });
    } finally { setBusyId(""); }
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
      setFeedback({ message: `계약서 ${result.contract.contract_no} 를 만들었습니다.`, error: false });
    } catch (caught) {
      setFeedback({ message: caught instanceof Error ? caught.message : "계약서를 만들지 못했습니다.", error: true });
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
    <div className="content-title">
      <div>
        <h2>교육 진행</h2>
        <p>강사를 배정하고, 브리프를 전달하고, 받은 자료를 등록합니다.</p>
      </div>
      <button type="button" onClick={() => setAdding((current) => !current)} disabled={!instructors.length}>
        {adding ? "닫기" : "＋ 강사 배정"}
      </button>
    </div>

    {!loading && !instructors.length && <p className="body-text">
      등록된 강사가 없습니다. 강사 풀에서 먼저 강사를 등록해 주세요.
    </p>}

    {adding && <form className="session-form" onSubmit={createSession} aria-busy={busyId === "new"}>
      <label>강사
        <select value={form.instructorId} onChange={set("instructorId")} required disabled={busyId === "new"}>
          <option value="">선택하세요</option>
          {instructors.map((instructor) => <option key={instructor.id} value={instructor.id}>
            {[instructor.name, instructor.affiliation].filter(Boolean).join(" · ")}
          </option>)}
        </select>
      </label>
      <label>과정명<input value={form.title} onChange={set("title")} placeholder="생성형 AI 업무 적용" required disabled={busyId === "new"} /></label>
      <div className="form-row">
        <label>교육 일자<input type="date" value={form.heldOn} onChange={set("heldOn")} disabled={busyId === "new"} /></label>
        <label>교육 시간<input type="number" min="0.5" step="0.5" value={form.durationHours} onChange={set("durationHours")} disabled={busyId === "new"} /></label>
      </div>
      <div className="form-row">
        <label>장소<input value={form.location} onChange={set("location")} placeholder="본사 교육장" disabled={busyId === "new"} /></label>
        <label>참석 인원<input type="number" min="1" value={form.headcount} onChange={set("headcount")} placeholder="30" disabled={busyId === "new"} /></label>
      </div>
      <div className="modal-actions">
        <button type="submit" className="primary-small" disabled={busyId === "new"}>
          {busyId === "new" ? "배정 중" : "강사 배정"}
        </button>
      </div>
    </form>}

    {feedback && <p className={feedback.error ? "modal-error" : "modal-notice"} role={feedback.error ? "alert" : undefined}>{feedback.message}</p>}

    {loading
      ? <p className="body-text">불러오는 중</p>
      : sessions.length === 0
        ? <p className="body-text">아직 배정된 강의가 없습니다.</p>
        : <div className="session-list company-sessions">
            {sessions.map((session) => {
              const open = openId === session.id;
              const ratio = tailoredCaseRatio(session.materials);
              const hasOutline = Boolean(session.outline?.modules?.length);
              const hasMaterials = Boolean(session.materials?.caseExamples?.length || session.materials?.toolsUsed?.length);
              return <div className={open ? "session open" : "session"} key={session.id}>
                <button type="button" onClick={() => setOpenId(open ? null : session.id)}>
                  <div>
                    <b>{session.instructors?.name || "강사 미상"}</b>
                    <p>{session.title}</p>
                  </div>
                  <div className="session-meta">
                    {/* 준비 상태가 목록에서 바로 보여야 "누구를 재촉할지"가 눈에 들어온다. */}
                    <small>{hasOutline ? "구성 접수" : "구성 대기"}{hasMaterials ? " · 자료 접수" : " · 자료 대기"}</small>
                    <small>{formatDate(session.held_on)}</small>
                    <span className={session.status === "delivered" ? "available" : "pending"}>
                      {STATUS_LABEL[session.status] || session.status}
                    </span>
                  </div>
                </button>
                {open && <div className="session-body">
                  <dl>
                    <div><dt>소속</dt><dd>{session.instructors?.affiliation || "미입력"}</dd></div>
                    <div><dt>인원</dt><dd>{session.headcount ? `${session.headcount}명` : "미정"}</dd></div>
                    <div><dt>시간</dt><dd>{session.duration_hours}시간</dd></div>
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
                    {session.contract
                      ? <a className="upload-chip" href={`/api/contracts/${session.contract.id}/pdf`} target="_blank" rel="noreferrer">계약서 열기</a>
                      : <button type="button" className="upload-chip" disabled={busyId === session.id} onClick={() => void createContract(session.id)}>
                          계약서 만들기
                        </button>}
                  </div>
                  {busyId === session.id && <p className="body-text">처리 중</p>}
                </div>}
              </div>;
            })}
          </div>}
  </section>;
}
