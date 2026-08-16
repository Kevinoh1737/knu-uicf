"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  EMPTY_PROFILE,
  INSTRUCTOR_DOCUMENT_ACCEPT,
  INSTRUCTOR_FORMAT_LABEL,
  InstructorProfile,
  MAX_INSTRUCTOR_DOCUMENT_SIZE,
  resolveInstructorDocument,
  tailoredCaseRatio,
  CONTRACT_STATUS_LABEL,
  ContractStatus,
  CourseMaterials,
  CourseOutline,
} from "@/lib/instructors";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { Icon, formatFileSize } from "./ui";

export type InstructorStats = { delivered: number; planned: number; lastHeldOn: string | null };

export type InstructorItem = {
  id: string;
  name: string;
  affiliation: string;
  job_title: string;
  email: string;
  phone: string;
  expertise: InstructorProfile["expertise"];
  career: InstructorProfile["career"];
  education: InstructorProfile["education"];
  teaching_history: InstructorProfile["teachingHistory"];
  certifications: string[];
  preferred_style: string;
  notes: string;
  reuse_aggregate: boolean;
  reuse_share_original: boolean;
  status: "active" | "inactive";
  stats?: InstructorStats;
};

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
  company_id: string;
  company_research?: { id: string; name: string } | null;
};

type ContractRow = {
  id: string;
  course_session_id: string;
  contract_no: string;
  status: ContractStatus;
  sent_to: string;
  created_at: string;
};

const TONES = ["mint", "sky", "sand"] as const;

function toneFor(name: string) {
  const sum = Array.from(name).reduce((total, character) => total + character.charCodeAt(0), 0);
  return TONES[sum % TONES.length];
}

/** 두 글자 성. 앞 한 글자만 자르면 남궁·황보 같은 이름이 틀린 성으로 보인다. */
const COMPOUND_SURNAMES = ["남궁", "황보", "제갈", "사공", "선우", "서문", "독고", "동방", "어금", "강전", "망절"];

function surname(name: string) {
  const cleaned = name.replace(/\s+/g, "");
  if (!cleaned) return "강사";
  const leading = cleaned.slice(0, 2);
  return COMPOUND_SURNAMES.includes(leading) ? leading : cleaned.slice(0, 1);
}

function formatDate(value: string | null) {
  if (!value) return "미정";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeZone: "Asia/Seoul" }).format(new Date(value));
}

const SESSION_STATUS_LABEL: Record<string, string> = {
  planned: "예정",
  contracted: "계약 완료",
  delivered: "진행 완료",
  cancelled: "취소",
};

// ─── 목록 ────────────────────────────────────────────────────────────────────

export function InstructorsPanel({ onSelect }: { onSelect: (instructor: InstructorItem) => void }) {
  const [instructors, setInstructors] = useState<InstructorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState(false);

  useEffect(() => {
    fetch("/api/instructors")
      .then(async (response) => {
        const result = await response.json() as { instructors?: InstructorItem[] };
        if (!response.ok) throw new Error("강사 목록 조회 실패");
        setInstructors(result.instructors || []);
      })
      .catch(() => setInstructors([]))
      .finally(() => setLoading(false));
  }, []);

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return instructors;
    return instructors.filter((instructor) => {
      const haystack = [
        instructor.name, instructor.affiliation, instructor.job_title,
        ...(instructor.expertise?.industries || []), ...(instructor.expertise?.topics || []),
        ...(instructor.expertise?.tools || []),
      ].join(" ").toLowerCase();
      return haystack.includes(keyword);
    });
  }, [instructors, query]);

  const delivered = instructors.reduce((total, instructor) => total + (instructor.stats?.delivered || 0), 0);
  const planned = instructors.reduce((total, instructor) => total + (instructor.stats?.planned || 0), 0);
  const topics = useMemo(() => {
    const counts = new Map<string, number>();
    instructors.forEach((instructor) => (instructor.expertise?.topics || []).forEach((topic) => counts.set(topic, (counts.get(topic) || 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([topic]) => topic);
  }, [instructors]);

  return <section className="workspace-panel">
    <div className="instructor-summary">
      <div><span>등록 강사</span><b>{instructors.length}명</b></div>
      <div><span>진행 완료</span><b>{delivered}건</b></div>
      <div><span>예정</span><b>{planned}건</b></div>
      <div className="expertise"><span>주요 전문분야</span><p>{topics.length ? topics.map((topic) => <i key={topic}>{topic}</i>) : <i>등록된 분야 없음</i>}</p></div>
    </div>

    <div className="toolbar">
      <div className="searchbox">⌕ <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="강사명, 소속 또는 전문분야 검색" aria-label="강사 검색" /></div>
      <div><button type="button" className="primary-small" onClick={() => setModal(true)}>강사 등록</button></div>
    </div>

    {loading
      ? <p className="instructor-empty">강사 목록 불러오는 중</p>
      : visible.length === 0
        ? <p className="instructor-empty">{instructors.length ? "검색 결과가 없습니다." : "등록된 강사가 없습니다. 강사가 제출한 프로필 PDF를 올리면 양식이 자동으로 채워집니다."}</p>
        : <div className="instructor-list">
            {visible.map((instructor) => <article key={instructor.id}>
              <span className={`avatar ${toneFor(instructor.name)}`}>{surname(instructor.name)}</span>
              <div className="instructor-name">
                <h3>{instructor.name}</h3>
                <p>{[instructor.affiliation, instructor.job_title].filter(Boolean).join(" · ") || "소속 미입력"}</p>
              </div>
              <div className="rating">
                <b>{instructor.stats?.delivered || 0}</b><small>진행 완료</small>
              </div>
              <span className={instructor.status === "active" ? "available" : "pending"}>
                {instructor.status === "active" ? "진행 가능" : "비활성"}
              </span>
              <button type="button" onClick={() => onSelect(instructor)}>프로필 보기 →</button>
            </article>)}
          </div>}

    {modal && <NewInstructorModal
      onClose={() => setModal(false)}
      onCreated={(instructor) => { setInstructors((current) => [instructor, ...current]); setModal(false); }}
    />}
  </section>;
}

// ─── 등록 ────────────────────────────────────────────────────────────────────

type Phase = "pick" | "uploading" | "extracting" | "review" | "saving";

function NewInstructorModal({ onClose, onCreated }: { onClose: () => void; onCreated: (instructor: InstructorItem) => void }) {
  const [phase, setPhase] = useState<Phase>("pick");
  const [mode, setMode] = useState<"file" | "manual">("file");
  const [picked, setPicked] = useState<File | null>(null);
  const [profile, setProfile] = useState<InstructorProfile>(EMPTY_PROFILE);
  const [source, setSource] = useState<{ storagePath: string; fileName: string; mimeType: string; fileSize: number; parsed: boolean } | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const busy = phase === "uploading" || phase === "extracting" || phase === "saving";
  // 직접 입력을 고른 순간부터 양식을 보여준다. 파일 경로에서는 추출이 끝난 뒤에 나온다.
  const showForm = phase === "review" || (phase === "pick" && mode === "manual");

  const handleFile = async (file: File) => {
    // 실패한 파일을 다시 고를 수 있도록 무엇보다 먼저 입력을 비운다. 같은 파일 재선택은
    // change 이벤트를 발생시키지 않아, 성공 시에만 비우면 "눌러도 아무 일이 없다"가 된다.
    if (fileInputRef.current) fileInputRef.current.value = "";
    setError(""); setNotice("");

    // 프로필은 PDF 만 받는다. 읽지 못하는 형식을 받아 두면 "올렸는데 아무것도 안 채워짐"이 되고,
    // 그건 이 화면이 하려는 일과 정반대다. 한글·워드는 'PDF로 저장' 후 올린다.
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      return setError("PDF 파일만 올릴 수 있습니다. 한글·워드는 'PDF로 저장' 후 올려 주세요.");
    }
    if (file.size > MAX_INSTRUCTOR_DOCUMENT_SIZE) return setError("파일은 최대 50MB까지 올릴 수 있습니다.");
    setPicked(file);

    try {
      setPhase("uploading");
      const tokenResponse = await fetch("/api/uploads/instructor-document", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, fileSize: file.size, kind: "profile" }),
      });
      const token = await tokenResponse.json() as { error?: string; bucket?: string; path?: string; token?: string; parsable?: boolean };
      if (!tokenResponse.ok || !token.bucket || !token.path || !token.token) throw new Error(token.error || "업로드를 준비하지 못했습니다.");

      const { error: uploadError } = await createSupabaseBrowser()
        .storage.from(token.bucket)
        .uploadToSignedUrl(token.path, token.token, file, { contentType: "application/pdf" });
      if (uploadError) throw new Error(uploadError.message);

      const uploaded = { storagePath: token.path, fileName: file.name, mimeType: "application/pdf", fileSize: file.size, parsed: false };

      setPhase("extracting");
      const extractResponse = await fetch("/api/instructors/extract-profile", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storagePath: token.path }),
      });
      const extracted = await extractResponse.json() as { error?: string; profile?: InstructorProfile; extracted?: boolean };
      if (!extractResponse.ok || !extracted.profile) throw new Error(extracted.error || "프로필을 읽지 못했습니다.");

      setProfile(extracted.profile);
      setSource({ ...uploaded, parsed: true });
      if (!extracted.extracted) setNotice("문서에서 이름을 찾지 못했습니다. 확인 후 직접 채워 주세요.");
      setPhase("review");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "파일을 처리하지 못했습니다.");
      setPhase("pick");
    }
  };

  const save = async () => {
    if (!profile.name.trim()) return setError("강사 이름은 반드시 필요합니다.");
    setError(""); setPhase("saving");
    try {
      const response = await fetch("/api/instructors", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile, sourceDocument: source }),
      });
      const result = await response.json() as { error?: string; instructor?: InstructorItem };
      if (!response.ok || !result.instructor) throw new Error(result.error || "강사를 등록하지 못했습니다.");
      onCreated(result.instructor);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "강사를 등록하지 못했습니다.");
      setPhase("review");
    }
  };

  const field = (label: string, key: keyof InstructorProfile, placeholder = "") =>
    <label key={key as string}>{label}
      <input value={profile[key] as string} placeholder={placeholder} disabled={busy}
        onChange={(event) => setProfile((current) => ({ ...current, [key]: event.target.value }))} />
    </label>;

  const tagField = (label: string, key: keyof InstructorProfile["expertise"], placeholder: string) =>
    <label key={key}>{label}
      <input value={(profile.expertise[key] || []).join(", ")} placeholder={placeholder} disabled={busy}
        onChange={(event) => setProfile((current) => ({
          ...current,
          expertise: { ...current.expertise, [key]: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) },
        }))} />
    </label>;

  // 바깥을 눌러 닫는 동작은 진짜 버튼으로 둔다. div 에 onClick 을 다는 방식은 키보드로 닿지 않는다.
  return <div className="modal-backdrop">
    <button type="button" className="modal-scrim" aria-label="닫기" onClick={onClose} disabled={busy} />
    <div className="modal instructor-modal" aria-busy={busy}>
      <div className="modal-head">
        <div>
          <span>NEW INSTRUCTOR</span>
          <h2>{phase === "review" ? "확인 후 저장" : "강사 등록"}</h2>
          <p>{phase === "review"
            ? "추출한 내용을 확인하고 고칠 수 있습니다."
            : mode === "file"
              ? "강사가 제출한 프로필 파일을 올리면 양식이 채워집니다."
              : "필요한 항목만 채우면 됩니다. 나중에 프로필 파일을 올려 보완할 수 있습니다."}</p>
        </div>
        <button className="modal-close" type="button" onClick={onClose} aria-label="닫기" disabled={busy}>×</button>
      </div>

      {phase === "pick" && <>
        <div className="input-tabs" role="tablist" aria-label="강사 등록 방법">
          {([["file", "01", "프로필 PDF"], ["manual", "02", "직접 입력"]] as const).map(([id, number, label]) =>
            <button type="button" role="tab" key={id} aria-selected={mode === id} className={mode === id ? "active" : ""}
              onClick={() => { setMode(id); setError(""); setNotice(""); }} disabled={busy}>
              <span>{number}</span>{label}
            </button>)}
        </div>
        {mode === "file" && <div className="input-panel" role="tabpanel">
          <div className="pdf-field">
            <div className="pdf-label-line"><span>강사 프로필 PDF</span><small className="pdf-limit">최대 50MB</small></div>
            <label className="pdf-upload-label">
              <input ref={fileInputRef} className="pdf-file-input" type="file" accept="application/pdf,.pdf" disabled={busy}
                onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleFile(file); }} />
              <span className="pdf-upload-control">
                <Icon name="upload" size={20} />
                <span className="pdf-upload-copy">
                  <b>{picked?.name || "PDF 파일 선택"}</b>
                  {picked && <small>{formatFileSize(picked.size)}</small>}
                </span>
              </span>
            </label>
          </div>
        </div>}
      </>}

      {showForm && <div className="profile-form">
        {field("이름", "name", "홍길동")}
        <div className="form-row">{field("소속", "affiliation", "○○컨설팅")}{field("직함", "jobTitle", "대표 강사")}</div>
        <div className="form-row">{field("업무 이메일", "email", "name@example.com")}{field("연락처", "phone", "010-0000-0000")}</div>
        {tagField("산업 경험", "industries", "제조, 공공, 의료")}
        {tagField("강의 주제", "topics", "생성형 AI 활용, 업무 자동화")}
        {tagField("도구", "tools", "ChatGPT, Copilot, Excel")}
        {tagField("가르쳐 본 대상", "audienceLevels", "관리자, 실무자, 현장직")}
        <label>선호 강의 방식
          <input value={profile.preferredStyle} disabled={busy} placeholder="실습 중심, 사례 토의 등"
            onChange={(event) => setProfile((current) => ({ ...current, preferredStyle: event.target.value }))} />
        </label>
        {(profile.career.length > 0 || profile.education.length > 0 || profile.teachingHistory.length > 0) && <div className="extracted-lists">
          {profile.career.length > 0 && <div><b>경력 {profile.career.length}건</b><p>{profile.career.slice(0, 3).map((item) => `${item.organization} ${item.role}`.trim()).join(" · ")}</p></div>}
          {profile.education.length > 0 && <div><b>학력 {profile.education.length}건</b><p>{profile.education.slice(0, 2).map((item) => `${item.school} ${item.major}`.trim()).join(" · ")}</p></div>}
          {profile.teachingHistory.length > 0 && <div><b>강의 이력 {profile.teachingHistory.length}건</b><p>{profile.teachingHistory.slice(0, 3).map((item) => `${item.client} ${item.subject}`.trim()).join(" · ")}</p></div>}
        </div>}
      </div>}

      {busy && <div className="modal-processing" role="status" aria-live="polite">
        <i aria-hidden="true" />
        <span>{phase === "uploading" ? "파일 올리는 중" : phase === "extracting" ? "프로필 읽는 중" : "저장 중"}</span>
      </div>}
      {notice && <p className="modal-notice">{notice}</p>}
      {error && <p className="modal-error" role="alert">{error}</p>}

      <div className="modal-actions">
        <button type="button" onClick={onClose} disabled={busy}>취소</button>
        {showForm && <button type="button" className="primary-small" onClick={save} disabled={busy}>강사 저장</button>}
      </div>
    </div>
  </div>;
}

// ─── 강의 등록 ────────────────────────────────────────────────────────────────

function NewSessionForm({ instructorId, onCreated }: { instructorId: string; onCreated: (session: SessionRow) => void }) {
  const [companies, setCompanies] = useState<Array<{ id: string; name: string }>>([]);
  const [form, setForm] = useState({ companyId: "", title: "", heldOn: "", location: "", headcount: "", durationHours: "4" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/companies")
      .then(async (response) => {
        const result = await response.json() as { companies?: Array<{ id: string; name: string }> };
        if (!response.ok) throw new Error("기업 목록 조회 실패");
        setCompanies(result.companies || []);
      })
      .catch(() => setCompanies([]));
  }, []);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.companyId) return setError("기업을 선택해 주세요.");
    if (!form.title.trim()) return setError("과정명을 입력해 주세요.");
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/course-sessions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: form.companyId, instructorId, title: form.title, heldOn: form.heldOn,
          location: form.location, headcount: Number(form.headcount) || undefined,
          durationHours: Number(form.durationHours) || 4,
        }),
      });
      const result = await response.json() as { error?: string; session?: SessionRow };
      if (!response.ok || !result.session) throw new Error(result.error || "강의를 등록하지 못했습니다.");
      onCreated(result.session);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "강의를 등록하지 못했습니다.");
    } finally { setSaving(false); }
  };

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  return <form className="session-form" onSubmit={submit} aria-busy={saving}>
    <label>기업
      <select value={form.companyId} onChange={set("companyId")} disabled={saving} required>
        <option value="">선택하세요</option>
        {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
      </select>
    </label>
    <label>과정명<input value={form.title} onChange={set("title")} placeholder="생성형 AI 업무 적용" disabled={saving} required /></label>
    <div className="form-row">
      <label>교육 일자<input type="date" value={form.heldOn} onChange={set("heldOn")} disabled={saving} /></label>
      <label>교육 시간<input type="number" min="0.5" step="0.5" value={form.durationHours} onChange={set("durationHours")} disabled={saving} /></label>
    </div>
    <div className="form-row">
      <label>장소<input value={form.location} onChange={set("location")} placeholder="본사 교육장" disabled={saving} /></label>
      <label>참석 인원<input type="number" min="1" value={form.headcount} onChange={set("headcount")} placeholder="30" disabled={saving} /></label>
    </div>
    {error && <p className="modal-error" role="alert">{error}</p>}
    <div className="modal-actions">
      <button type="submit" className="primary-small" disabled={saving}>{saving ? "등록 중" : "강의 등록"}</button>
    </div>
  </form>;
}

// ─── 상세 ────────────────────────────────────────────────────────────────────

export function InstructorDetail({ instructor, onBack }: { instructor: InstructorItem; onBack: () => void }) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openSession, setOpenSession] = useState<string | null>(null);
  const [addingSession, setAddingSession] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);

  const reload = () => fetch(`/api/instructors/${instructor.id}`)
    .then(async (response) => {
      const result = await response.json() as { sessions?: SessionRow[]; contracts?: ContractRow[] };
      if (!response.ok) throw new Error("강사 정보 조회 실패");
      setSessions(result.sessions || []);
      setContracts(result.contracts || []);
    })
    .catch(() => undefined);

  useEffect(() => {
    void reload().finally(() => setLoading(false));
    // reload 는 instructor.id 만 참조한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instructor.id]);

  const createContract = async (sessionId: string) => {
    setBusyId(sessionId); setFeedback(null);
    try {
      const response = await fetch("/api/contracts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseSessionId: sessionId }),
      });
      const result = await response.json() as { error?: string; contract?: ContractRow };
      if (!response.ok || !result.contract) throw new Error(result.error || "계약서를 만들지 못했습니다.");
      setContracts((current) => [result.contract as ContractRow, ...current]);
      setFeedback({ message: `계약서 ${result.contract.contract_no} 를 만들었습니다.`, error: false });
    } catch (caught) {
      setFeedback({ message: caught instanceof Error ? caught.message : "계약서를 만들지 못했습니다.", error: true });
    } finally { setBusyId(""); }
  };

  const uploadSessionDocument = async (sessionId: string, kind: "outline" | "materials", file: File) => {
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
      const result = await response.json() as { error?: string; notice?: string; parsed?: boolean };
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

  const delivered = sessions.filter((session) => session.status === "delivered");
  const industries = new Map<string, number>();
  sessions.forEach((session) => {
    const name = session.company_research?.name || "";
    if (name) industries.set(name, (industries.get(name) || 0) + 1);
  });
  const contractBySession = new Map(contracts.map((contract) => [contract.course_session_id, contract]));

  return <section className="workspace-panel">
    <button type="button" className="link-button" onClick={onBack}>← 강사 목록</button>

    {/* 이름은 상단 제목이 맡는다. 여기서 반복하면 같은 글자가 두 번 보인다. */}
    <div className="instructor-hero">
      <span className={`avatar ${toneFor(instructor.name)}`}>{surname(instructor.name)}</span>
      <div>
        <p>{[instructor.affiliation, instructor.job_title].filter(Boolean).join(" · ") || "소속 미입력"}</p>
        <p className="contact">{[instructor.email, instructor.phone].filter(Boolean).join(" · ") || "연락처 미입력"}</p>
      </div>
      <div className="instructor-counts">
        <div><span>진행 완료</span><b>{delivered.length}</b></div>
        <div><span>전체 강의</span><b>{sessions.length}</b></div>
        <div><span>거래 기업</span><b>{industries.size}</b></div>
      </div>
    </div>

    <div className="instructor-columns">
      <article>
        <h3>전문분야</h3>
        {(["industries", "topics", "tools", "audienceLevels"] as const).map((key) => {
          const label = { industries: "산업", topics: "주제", tools: "도구", audienceLevels: "대상" }[key];
          const values = instructor.expertise?.[key] || [];
          return <div className="expertise-row" key={key}>
            <small>{label}</small>
            <div className="chips">{values.length ? values.map((value) => <span key={value}>{value}</span>) : <span className="muted">미입력</span>}</div>
          </div>;
        })}
        {instructor.preferred_style && <><h3>선호 방식</h3><p className="body-text">{instructor.preferred_style}</p></>}
        <h3>자료 재사용 합의</h3>
        <p className="body-text">
          집계·패턴 활용 {instructor.reuse_aggregate ? "동의" : "미동의"} · 원본 제공 {instructor.reuse_share_original ? "동의" : "미동의"}
        </p>
        <small className="footnote">계약서에서 합의한 결과입니다.</small>
      </article>

      <article>
        <div className="section-head">
          <h3>강의 이력</h3>
          <button type="button" className="link-button" onClick={() => setAddingSession((current) => !current)}>
            {addingSession ? "닫기" : "＋ 강의 등록"}
          </button>
        </div>
        {addingSession && <NewSessionForm
          instructorId={instructor.id}
          onCreated={(session) => { setSessions((current) => [session, ...current]); setAddingSession(false); setOpenSession(session.id); }}
        />}
        {feedback && <p className={feedback.error ? "modal-error" : "modal-notice"} role={feedback.error ? "alert" : undefined}>{feedback.message}</p>}
        {loading
          ? <p className="body-text">불러오는 중</p>
          : sessions.length === 0
            ? <p className="body-text">등록된 강의가 없습니다.</p>
            : <div className="session-list">
                {sessions.map((session) => {
                  const contract = contractBySession.get(session.id);
                  const ratio = tailoredCaseRatio(session.materials);
                  const open = openSession === session.id;
                  return <div className={open ? "session open" : "session"} key={session.id}>
                    <button type="button" onClick={() => setOpenSession(open ? null : session.id)}>
                      <div>
                        <b>{session.company_research?.name || "기업 미상"}</b>
                        <p>{session.title}</p>
                      </div>
                      <div className="session-meta">
                        <small>{formatDate(session.held_on)}</small>
                        <span className={session.status === "delivered" ? "available" : "pending"}>
                          {SESSION_STATUS_LABEL[session.status] || session.status}
                        </span>
                      </div>
                    </button>
                    {open && <div className="session-body">
                      <dl>
                        <div><dt>장소</dt><dd>{session.location || "미정"}</dd></div>
                        <div><dt>인원</dt><dd>{session.headcount ? `${session.headcount}명` : "미정"}</dd></div>
                        <div><dt>시간</dt><dd>{session.duration_hours}시간</dd></div>
                        <div><dt>계약</dt><dd>{contract ? `${CONTRACT_STATUS_LABEL[contract.status]} · ${contract.contract_no}` : "미작성"}</dd></div>
                      </dl>
                      {session.outline?.objective && <><h4>학습목표</h4><p className="body-text">{session.outline.objective}</p></>}
                      {session.outline?.modules?.length > 0 && <><h4>구성</h4><ul className="module-list">
                        {session.outline.modules.map((module, index) => <li key={`${module.title}-${index}`}>
                          <span>{module.minutes}분</span><b>{module.title}</b><em>{module.mode}</em>
                        </li>)}
                      </ul></>}
                      {ratio !== null && <p className={ratio < 50 ? "case-ratio warn" : "case-ratio"}>
                        맞춤 사례 {ratio}% · 사용 사례 {session.materials.caseExamples.length}건
                        {ratio < 50 && " — 일반 사례 비중이 높습니다"}
                      </p>}
                      {session.materials?.toolsUsed?.length > 0 && <div className="chips">{session.materials.toolsUsed.map((tool) => <span key={tool}>{tool}</span>)}</div>}

                      <div className="session-actions">
                        {(["outline", "materials"] as const).map((kind) => <label className="upload-chip" key={kind}>
                          <input className="pdf-file-input" type="file" accept={INSTRUCTOR_DOCUMENT_ACCEPT} disabled={busyId === session.id}
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              event.target.value = "";
                              if (file) void uploadSessionDocument(session.id, kind, file);
                            }} />
                          {kind === "outline"
                            ? (session.outline?.modules?.length ? "강의 구성 다시 올리기" : "강의 구성 올리기")
                            : (session.materials?.caseExamples?.length ? "강의 자료 다시 올리기" : "강의 자료 올리기")}
                        </label>)}
                        {contract
                          ? <a className="upload-chip" href={`/api/contracts/${contract.id}/pdf`} target="_blank" rel="noreferrer">계약서 열기</a>
                          : <button type="button" className="upload-chip" disabled={busyId === session.id} onClick={() => void createContract(session.id)}>
                              계약서 만들기
                            </button>}
                      </div>
                      {busyId === session.id && <p className="body-text">처리 중</p>}
                      <p className="survey-slot">만족도 조사 미실시</p>
                    </div>}
                  </div>;
                })}
              </div>}
      </article>
    </div>
  </section>;
}
