"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { INSTRUCTOR_DOCUMENTS_BUCKET, MAX_INSTRUCTOR_DOCUMENT_SIZE } from "@/lib/instructors";
import { LearnerInput } from "@/lib/learners";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { Feedback, Icon, formatFileSize, useConfirm, useEscapeClose } from "./ui";

type LearnerRow = {
  id: string;
  company_id: string;
  name: string;
  department: string;
  job_title: string;
  email: string;
  notes: string;
  company_research?: { id: string; name: string } | null;
  stats?: { total: number; attended: number };
};

type CompanyOption = { id: string; name: string };

export function LearnersPanel() {
  const [learners, setLearners] = useState<LearnerRow[]>([]);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [modal, setModal] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const { ask, confirmDialog } = useConfirm();

  const reload = () => fetch("/api/learners")
    .then(async (response) => {
      const result = await response.json() as { learners?: LearnerRow[] };
      if (!response.ok) throw new Error("수강생 목록 조회 실패");
      setLearners(result.learners || []);
    })
    .catch(() => setLearners([]));

  useEffect(() => {
    void Promise.all([
      reload(),
      fetch("/api/companies").then(async (response) => {
        const result = await response.json() as { companies?: CompanyOption[] };
        if (response.ok) setCompanies(result.companies || []);
      }).catch(() => undefined),
    ]).finally(() => setLoading(false));
  }, []);

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return learners.filter((learner) => {
      if (companyFilter && learner.company_id !== companyFilter) return false;
      if (!keyword) return true;
      return [learner.name, learner.department, learner.job_title, learner.email, learner.company_research?.name]
        .filter(Boolean).join(" ").toLowerCase().includes(keyword);
    });
  }, [learners, query, companyFilter]);

  const attended = visible.filter((learner) => (learner.stats?.attended || 0) > 0).length;
  const repeat = visible.filter((learner) => (learner.stats?.total || 0) > 1).length;

  const remove = async (learner: LearnerRow) => {
    const agreed = await ask({
      title: `‘${learner.name}’ 수강생을 삭제할까요?`,
      message: "참석 이력도 함께 사라집니다.",
      confirmLabel: "삭제", danger: true,
    });
    if (!agreed) return;
    setFeedback(null);
    try {
      const response = await fetch(`/api/learners/${learner.id}`, { method: "DELETE" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "삭제하지 못했습니다.");
      setLearners((current) => current.filter((item) => item.id !== learner.id));
    } catch (caught) {
      setFeedback({ message: caught instanceof Error ? caught.message : "삭제하지 못했습니다.", error: true });
    }
  };

  return <section className="workspace-panel">
    {confirmDialog}
    <div className="instructor-summary">
      <div><span>등록 수강생</span><b>{visible.length}명</b></div>
      <div><span>참석 이력 있음</span><b>{attended}명</b></div>
      <div><span>2회 이상 수강</span><b>{repeat}명</b></div>
      <div className="expertise"><span>소속 기업</span><p>{companies.length ? <i>{companies.length}곳</i> : <i>없음</i>}</p></div>
    </div>

    <div className="toolbar">
      <div className="searchbox">⌕ <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="이름, 부서 또는 이메일 검색" aria-label="수강생 검색" /></div>
      <div>
        <select className="filter" value={companyFilter} onChange={(event) => setCompanyFilter(event.target.value)} aria-label="기업 선택">
          <option value="">모든 기업</option>
          {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
        </select>
        <button type="button" className="primary-small" onClick={() => setModal(true)} disabled={!companies.length}>명단 등록</button>
      </div>
    </div>

    <Feedback value={feedback} onClose={() => setFeedback(null)} />

    {loading
      ? <p className="instructor-empty">수강생 목록 불러오는 중</p>
      : visible.length === 0
        ? <p className="instructor-empty">
            {learners.length ? "검색 결과가 없습니다." : "등록된 수강생이 없습니다. 명단 PDF를 올리면 사람을 뽑아 정리합니다."}
          </p>
        : <div className="learner-table">
            <table>
              <thead>
                <tr><th>이름</th><th>부서 · 직급</th><th>기업</th><th>이메일</th><th>수강</th><th /></tr>
              </thead>
              <tbody>
                {visible.map((learner) => <tr key={learner.id}>
                  <td><b>{learner.name}</b></td>
                  <td>{[learner.department, learner.job_title].filter(Boolean).join(" · ") || "—"}</td>
                  <td>{learner.company_research?.name || "—"}</td>
                  <td>{learner.email || <span className="muted">미수집</span>}</td>
                  <td>
                    <span className={(learner.stats?.attended || 0) > 0 ? "attend" : "check"}>
                      {learner.stats?.total || 0}회{(learner.stats?.attended || 0) > 0 ? ` · 참석 ${learner.stats?.attended}` : ""}
                    </span>
                  </td>
                  <td><button type="button" className="row-delete" onClick={() => void remove(learner)} aria-label={`${learner.name} 삭제`}>삭제</button></td>
                </tr>)}
              </tbody>
            </table>
          </div>}

    {modal && <RosterModal
      companies={companies}
      onClose={() => setModal(false)}
      onSaved={async (message) => { await reload(); setModal(false); setFeedback({ message, error: false }); }}
    />}
  </section>;
}

// ─── 명단 등록 ────────────────────────────────────────────────────────────────

type Phase = "pick" | "uploading" | "extracting" | "review" | "saving";

function RosterModal({ companies, onClose, onSaved }: {
  companies: CompanyOption[];
  onClose: () => void;
  onSaved: (message: string) => void | Promise<void>;
}) {
  const [phase, setPhase] = useState<Phase>("pick");
  const [companyId, setCompanyId] = useState(companies[0]?.id || "");
  const [picked, setPicked] = useState<File | null>(null);
  const [rows, setRows] = useState<LearnerInput[]>([]);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const busy = phase === "uploading" || phase === "extracting" || phase === "saving";
  useEscapeClose(!busy, onClose);

  const handleFile = async (file: File) => {
    // 실패한 파일을 다시 고를 수 있도록 무엇보다 먼저 입력을 비운다.
    if (fileInputRef.current) fileInputRef.current.value = "";
    setError("");
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      return setError("PDF 파일만 올릴 수 있습니다. 엑셀·한글은 'PDF로 저장' 후 올려 주세요.");
    }
    if (file.size > MAX_INSTRUCTOR_DOCUMENT_SIZE) return setError("파일은 최대 50MB까지 올릴 수 있습니다.");
    setPicked(file);

    try {
      setPhase("uploading");
      const tokenResponse = await fetch("/api/uploads/instructor-document", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, fileSize: file.size, kind: "roster" }),
      });
      const token = await tokenResponse.json() as { error?: string; bucket?: string; path?: string; token?: string };
      if (!tokenResponse.ok || !token.bucket || !token.path || !token.token) throw new Error(token.error || "업로드를 준비하지 못했습니다.");

      const { error: uploadError } = await createSupabaseBrowser()
        .storage.from(INSTRUCTOR_DOCUMENTS_BUCKET)
        .uploadToSignedUrl(token.path, token.token, file, { contentType: "application/pdf" });
      if (uploadError) throw new Error(uploadError.message);

      setPhase("extracting");
      const response = await fetch("/api/learners/extract", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storagePath: token.path }),
      });
      const result = await response.json() as { error?: string; learners?: LearnerInput[] };
      if (!response.ok || !result.learners) throw new Error(result.error || "명단을 읽지 못했습니다.");
      if (!result.learners.length) throw new Error("명단에서 사람을 찾지 못했습니다. 표 형태인지 확인해 주세요.");

      setRows(result.learners);
      setPhase("review");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "명단을 처리하지 못했습니다.");
      setPhase("pick");
    }
  };

  const save = async () => {
    if (!companyId) return setError("기업을 선택해 주세요.");
    setError(""); setPhase("saving");
    try {
      const response = await fetch("/api/learners", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, learners: rows }),
      });
      const result = await response.json() as { error?: string; saved?: number; withoutEmail?: number };
      if (!response.ok) throw new Error(result.error || "수강생을 등록하지 못했습니다.");
      const extra = result.withoutEmail ? ` (이메일 없는 ${result.withoutEmail}명은 중복 확인이 되지 않습니다)` : "";
      await onSaved(`수강생 ${result.saved}명을 등록했습니다.${extra}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "수강생을 등록하지 못했습니다.");
      setPhase("review");
    }
  };

  return <div className="modal-backdrop">
    <button type="button" className="modal-scrim" aria-label="닫기" onClick={onClose} disabled={busy} />
    <div className="modal instructor-modal" aria-busy={busy}>
      <div className="modal-head">
        <div>
          <span>NEW LEARNERS</span>
          <h2>{phase === "review" ? "확인 후 등록" : "수강생 명단 등록"}</h2>
          <p>{phase === "review"
            ? `${rows.length}명을 찾았습니다. 잘못 읽힌 줄은 지우고 등록하세요.`
            : "명단 PDF에서 사람을 뽑아 정리합니다."}</p>
        </div>
        <button className="modal-close" type="button" onClick={onClose} aria-label="닫기" disabled={busy}>×</button>
      </div>

      <label>기업
        <select value={companyId} onChange={(event) => setCompanyId(event.target.value)} disabled={busy}>
          {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
        </select>
      </label>

      {phase !== "review" && <div className="input-panel" role="tabpanel">
        <div className="pdf-field">
          <div className="pdf-label-line"><span>참석자 명단 PDF</span><small className="pdf-limit">최대 50MB</small></div>
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

      {phase === "review" && <div className="roster-review">
        <table>
          <thead><tr><th>이름</th><th>부서 · 직급</th><th>이메일</th><th /></tr></thead>
          <tbody>
            {rows.map((row, index) => <tr key={`${row.name}-${index}`}>
              <td><b>{row.name}</b></td>
              <td>{[row.department, row.jobTitle].filter(Boolean).join(" · ") || "—"}</td>
              <td>{row.email || <span className="muted">없음</span>}</td>
              <td><button type="button" className="row-delete" disabled={busy}
                onClick={() => setRows((current) => current.filter((_, position) => position !== index))}
                aria-label={`${row.name} 제외`}>제외</button></td>
            </tr>)}
          </tbody>
        </table>
      </div>}

      {busy && <div className="modal-processing" role="status" aria-live="polite">
        <i aria-hidden="true" />
        <span>{phase === "uploading" ? "파일 올리는 중" : phase === "extracting" ? "명단 읽는 중" : "등록 중"}</span>
      </div>}
      {error && <p className="modal-error" role="alert">{error}</p>}

      <div className="modal-actions">
        <button type="button" onClick={onClose} disabled={busy}>취소</button>
        {phase === "review" && <button type="button" className="primary-small" onClick={save} disabled={busy || !rows.length}>
          {rows.length}명 등록
        </button>}
      </div>
    </div>
  </div>;
}
