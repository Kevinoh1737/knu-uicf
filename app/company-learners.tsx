"use client";

import { useEffect, useRef, useState } from "react";
import { LearnerInput, sanitizeLearner } from "@/lib/learners";
import { Feedback, Icon } from "./ui";

type LearnerRow = {
  id: string; name: string; department: string; job_title: string; email: string;
  stats?: { total: number; attended: number };
};

const EMPTY_ROW: LearnerInput = { name: "", department: "", jobTitle: "", email: "", notes: "" };

/**
 * 기업별 수강생. 고객사가 보내 준 엑셀을 그대로 올리는 것이 주 경로이고, 직접 입력과
 * 수정도 여기서 한다. 여기서 더한 사람은 상위 수강생 메뉴에서도 그대로 보인다.
 */
export function CompanyLearnersTab({ companyId, companyName, onDataChanged }: { companyId: string; companyName: string; onDataChanged?: () => void }) {
  const [learners, setLearners] = useState<LearnerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const [editing, setEditing] = useState<LearnerRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<LearnerInput>(EMPTY_ROW);
  const [preview, setPreview] = useState<LearnerInput[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reload = () => fetch(`/api/learners?companyId=${companyId}`)
    .then(async (response) => {
      const result = await response.json() as { learners?: LearnerRow[] };
      if (!response.ok) throw new Error("수강생 목록 조회 실패");
      setLearners(result.learners || []);
      onDataChanged?.();
    })
    .catch(() => undefined);

  useEffect(() => {
    void reload().finally(() => setLoading(false));
    // reload 는 companyId 만 참조한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const uploadSheet = async (file: File) => {
    // 같은 파일을 다시 고를 수 있도록 무엇보다 먼저 입력을 비운다.
    if (fileInputRef.current) fileInputRef.current.value = "";
    setBusy(true); setFeedback(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`/api/companies/${companyId}/learners`, { method: "POST", body: form });
      const result = await response.json() as { error?: string; learners?: LearnerInput[] };
      if (!response.ok || !result.learners) throw new Error(result.error || "엑셀을 읽지 못했습니다.");
      setPreview(result.learners);
    } catch (caught) {
      setFeedback({ message: caught instanceof Error ? caught.message : "엑셀을 읽지 못했습니다.", error: true });
    } finally { setBusy(false); }
  };

  const saveMany = async (rows: LearnerInput[]) => {
    setBusy(true); setFeedback(null);
    try {
      const response = await fetch("/api/learners", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, learners: rows }),
      });
      const result = await response.json() as { error?: string; saved?: number; updated?: number };
      if (!response.ok) throw new Error(result.error || "저장하지 못했습니다.");
      await reload();
      setPreview(null); setAdding(false); setDraft(EMPTY_ROW);
      const updated = result.updated ? ` (기존 ${result.updated}명 갱신)` : "";
      setFeedback({ message: `수강생 ${result.saved}명을 반영했습니다.${updated}`, error: false });
    } catch (caught) {
      setFeedback({ message: caught instanceof Error ? caught.message : "저장하지 못했습니다.", error: true });
    } finally { setBusy(false); }
  };

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true); setFeedback(null);
    try {
      const response = await fetch(`/api/learners/${editing.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sanitizeLearner(draft)),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "저장하지 못했습니다.");
      await reload();
      setEditing(null); setDraft(EMPTY_ROW);
    } catch (caught) {
      setFeedback({ message: caught instanceof Error ? caught.message : "저장하지 못했습니다.", error: true });
    } finally { setBusy(false); }
  };

  const remove = async (learner: LearnerRow) => {
    const warning = learner.stats?.total
      ? `‘${learner.name}’ 수강생을 삭제할까요? 교육과정 ${learner.stats.total}건의 참석 이력도 함께 사라집니다.`
      : `‘${learner.name}’ 수강생을 삭제할까요?`;
    if (!window.confirm(warning)) return;
    setBusy(true); setFeedback(null);
    try {
      const response = await fetch(`/api/learners/${learner.id}`, { method: "DELETE" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "삭제하지 못했습니다.");
      await reload();
    } catch (caught) {
      setFeedback({ message: caught instanceof Error ? caught.message : "삭제하지 못했습니다.", error: true });
    } finally { setBusy(false); }
  };

  const startEdit = (learner: LearnerRow) => {
    setEditing(learner); setAdding(false);
    setDraft({ name: learner.name, department: learner.department, jobTitle: learner.job_title, email: learner.email, notes: "" });
  };

  const field = (label: string, key: keyof LearnerInput, placeholder = "") =>
    <label key={key}>{label}
      <input value={draft[key]} placeholder={placeholder} disabled={busy}
        onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} />
    </label>;

  const form = <div className="session-form">
    {field("이름", "name", "홍길동")}
    <div className="form-row">{field("부서", "department", "인재개발팀")}{field("직급 · 직책", "jobTitle", "과장")}</div>
    {field("이메일", "email", "name@example.com")}
    <div className="modal-actions">
      <button type="button" onClick={() => { setEditing(null); setAdding(false); setDraft(EMPTY_ROW); }} disabled={busy}>취소</button>
      <button type="button" className="primary-small" disabled={busy || !draft.name.trim()}
        onClick={() => (editing ? void saveEdit() : void saveMany([draft]))}>
        {editing ? "수정 저장" : "추가"}
      </button>
    </div>
  </div>;

  return <section className="tab-content">
    <div className="content-title">
      <div>
        <h2>수강생</h2>
        <p>고객사가 보내 준 명단 엑셀을 올리거나 직접 입력합니다. 여기 등록한 사람은 수강생 메뉴에서도 보입니다.</p>
      </div>
      <div className="title-actions">
        <label className="upload-chip">
          <input ref={fileInputRef} className="pdf-file-input" type="file" accept=".xlsx" disabled={busy}
            onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadSheet(file); }} />
          <Icon name="upload" size={15} /> 명단 엑셀 올리기
        </label>
        <a className="upload-chip" href={`/api/companies/${companyId}/learners/export`}>
          <Icon name="download" size={15} /> 현재 명단 내려받기
        </a>
        <button type="button" className="upload-chip" onClick={() => { setAdding((current) => !current); setEditing(null); setDraft(EMPTY_ROW); }}>
          <Icon name="plus" size={15} /> 직접 추가
        </button>
      </div>
    </div>

    <Feedback value={feedback} onClose={() => setFeedback(null)} />
    {busy && <p className="body-text">처리 중</p>}

    {/* 엑셀은 바로 저장하지 않는다. 사람 이름이 들어가는 자료라 한 번 보여 주고 넣는다. */}
    {preview && <div className="roster preview">
      <h4>엑셀에서 {preview.length}명을 읽었습니다</h4>
      <table className="roster-table">
        <thead><tr><th>이름</th><th>부서</th><th>직급</th><th>이메일</th><th /></tr></thead>
        <tbody>
          {preview.map((row, index) => <tr key={`${row.name}-${index}`}>
            <td><b>{row.name}</b></td><td>{row.department || "—"}</td><td>{row.jobTitle || "—"}</td>
            <td>{row.email || <span className="muted">없음</span>}</td>
            <td><button type="button" className="row-delete" disabled={busy}
              onClick={() => setPreview((current) => (current || []).filter((_, position) => position !== index))}>제외</button></td>
          </tr>)}
        </tbody>
      </table>
      <div className="modal-actions">
        <button type="button" onClick={() => setPreview(null)} disabled={busy}>취소</button>
        <button type="button" className="primary-small" disabled={busy || !preview.length}
          onClick={() => void saveMany(preview)}>{preview.length}명 반영</button>
      </div>
    </div>}

    {(adding || editing) && form}

    {loading
      ? <p className="body-text">불러오는 중</p>
      : learners.length === 0
        ? <p className="body-text">등록된 수강생이 없습니다. {companyName}에서 받은 명단 엑셀을 올려 보세요.</p>
        : <div className="learner-table">
            <table>
              <thead><tr><th>이름</th><th>부서 · 직급</th><th>이메일</th><th>수강</th><th /></tr></thead>
              <tbody>
                {learners.map((learner) => <tr key={learner.id}>
                  <td><b>{learner.name}</b></td>
                  <td>{[learner.department, learner.job_title].filter(Boolean).join(" · ") || "—"}</td>
                  <td>{learner.email || <span className="muted">미수집</span>}</td>
                  <td><span className={(learner.stats?.attended || 0) > 0 ? "attend" : "check"}>
                    {learner.stats?.total || 0}회
                  </span></td>
                  <td className="row-tools">
                    <button type="button" className="row-delete" disabled={busy} onClick={() => startEdit(learner)}>수정</button>
                    <button type="button" className="row-delete" disabled={busy} onClick={() => void remove(learner)}>삭제</button>
                  </td>
                </tr>)}
              </tbody>
            </table>
          </div>}
  </section>;
}
