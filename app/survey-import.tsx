"use client";

/**
 * 결과지 올리기 창.
 *
 * 파일을 고르면 곧바로 저장하지 않는다. 열과 문항의 짝을 표로 보여 주고, 사람이 확인한
 * 뒤에 저장한다 — 짝짓기는 늘 추측이고, 틀린 짝은 나중에 비교 화면의 색깔로만 드러나서
 * 그때는 원인을 찾을 수 없기 때문이다.
 *
 * 그래서 이 화면이 하는 말은 하나다: "이 열을 이 문항으로 읽겠습니다. 맞습니까?"
 */
import { useRef, useState } from "react";
import { Icon, useEscapeClose } from "./ui";
import {
  ColumnMapping,
  ColumnRole,
  ImportColumn,
  MAX_SURVEY_IMPORT_SIZE,
  SURVEY_IMPORT_ACCEPT,
} from "@/lib/survey-import";

type PreviewQuestion = { id: string; text: string; type: string };

type Preview = {
  columns: ImportColumn[];
  mappings: ColumnMapping[];
  headers: string[];
  rows: string[][];
  questions: PreviewQuestion[];
  respondents: number;
  courseTitle: string;
};

const ROLE_LABEL: Record<ColumnRole, string> = {
  question: "문항",
  name: "이름",
  email: "이메일",
  timestamp: "응답 시각",
  skip: "쓰지 않음",
};

export function SurveyImportModal({ surveyId, onClose, onImported }: {
  surveyId: string;
  onClose: () => void;
  onImported: (result: { imported: number; named: number; unreadable: number }) => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [busy, setBusy] = useState<"reading" | "saving" | "">("");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  useEscapeClose(!busy, onClose);

  const readFile = async (file?: File) => {
    if (!file || busy) return;
    if (fileRef.current) fileRef.current.value = "";
    if (file.size > MAX_SURVEY_IMPORT_SIZE) { setError("결과지는 최대 5MB까지 올릴 수 있습니다."); return; }
    setBusy("reading"); setError("");
    try {
      const buffer = await file.arrayBuffer();
      // btoa 는 한 글자씩 넘겨야 큰 파일에서 스택이 터지지 않는다.
      let binary = "";
      const bytes = new Uint8Array(buffer);
      for (let index = 0; index < bytes.length; index += 8192) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
      }
      const response = await fetch(`/api/surveys/${surveyId}/import`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "preview", fileName: file.name, content: btoa(binary) }),
      });
      const result = await response.json() as Preview & { error?: string };
      if (!response.ok) throw new Error(result.error || "결과지를 읽지 못했습니다.");
      setPreview(result);
      setMappings(result.mappings);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "결과지를 읽지 못했습니다.");
    } finally {
      setBusy("");
    }
  };

  const changeMapping = (index: number, value: string) => {
    setMappings((current) => current.map((mapping) => {
      if (mapping.index !== index) return mapping;
      if (value === "skip" || value === "name" || value === "email" || value === "timestamp") {
        return { ...mapping, role: value as ColumnRole, questionId: "", auto: false, reason: "직접 고름" };
      }
      return { ...mapping, role: "question", questionId: value, auto: false, reason: "직접 고름" };
    }));
  };

  const commit = async () => {
    if (!preview || busy) return;
    setBusy("saving"); setError("");
    try {
      const response = await fetch(`/api/surveys/${surveyId}/import`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "commit", rows: preview.rows, mappings }),
      });
      const result = await response.json() as { imported?: number; named?: number; unreadable?: number; error?: string };
      if (!response.ok) throw new Error(result.error || "응답을 저장하지 못했습니다.");
      onImported({ imported: result.imported || 0, named: result.named || 0, unreadable: result.unreadable || 0 });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "응답을 저장하지 못했습니다.");
    } finally {
      setBusy("");
    }
  };

  const matched = mappings.filter((mapping) => mapping.role === "question").length;
  const unmatched = preview ? preview.questions.length - matched : 0;
  // 같은 문항에 두 열이 걸리면 뒤엣것이 앞엣것을 덮어써서 한쪽이 조용히 사라진다.
  const duplicated = new Set(
    mappings.filter((m) => m.role === "question")
      .map((m) => m.questionId)
      .filter((id, index, all) => all.indexOf(id) !== index),
  );

  return <div className="modal-backdrop">
    <button type="button" className="modal-scrim" aria-label="닫기" onClick={onClose} disabled={Boolean(busy)} />
    <div className="modal import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <div className="modal-head">
        <div>
          <h2 id="import-title">결과지 올리기</h2>
          <p>{preview
            ? "각 열을 어떤 문항으로 읽을지 확인해 주세요. 틀린 것만 고치면 됩니다."
            : "구글폼에서 내려받은 엑셀(.xlsx) 또는 CSV 파일을 올려 주세요."}</p>
        </div>
        <button type="button" onClick={onClose} disabled={Boolean(busy)} aria-label="닫기">×</button>
      </div>

      {error && <p className="consultation-error" role="alert">{error}</p>}

      {!preview ? <>
        <input ref={fileRef} className="sr-only" type="file" accept={SURVEY_IMPORT_ACCEPT}
          onChange={(event) => void readFile(event.target.files?.[0])} />
        <div className="import-drop">
          <span><Icon name="upload" size={22} /></span>
          <b>결과지 파일을 선택하세요</b>
          <p>구글 시트에서 파일 → 다운로드 → Microsoft Excel(.xlsx)<br />첫 줄이 문항 제목이고 그 아래가 응답이어야 합니다</p>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={Boolean(busy)}>
            {busy === "reading" ? "읽는 중…" : "파일 선택"}
          </button>
        </div>
      </> : <>
        <div className="import-summary">
          <div><dt>응답</dt><dd>{preview.respondents}명</dd></div>
          <div><dt>짝지은 문항</dt><dd>{matched} / {preview.questions.length}</dd></div>
          {preview.courseTitle && <div><dt>교육</dt><dd>{preview.courseTitle}</dd></div>}
        </div>

        {unmatched > 0 && <p className="import-warn" role="status">
          문항 {unmatched}개가 아직 짝을 못 찾았습니다. 그대로 저장하면 그 문항은 응답 없음으로 남습니다.
        </p>}
        {duplicated.size > 0 && <p className="import-warn error" role="alert">
          한 문항에 두 열이 걸려 있습니다. 하나를 &lsquo;쓰지 않음&rsquo;으로 바꿔 주세요.
        </p>}

        <div className="import-table">
          <table>
            <thead><tr><th>결과지 열</th><th>읽은 값</th><th>무엇으로 읽을까</th></tr></thead>
            <tbody>
              {preview.columns.map((column) => {
                const mapping = mappings.find((item) => item.index === column.index);
                const value = mapping?.role === "question" ? mapping.questionId : (mapping?.role || "skip");
                const isDuplicate = mapping?.role === "question" && duplicated.has(mapping.questionId);
                return <tr key={column.index} className={isDuplicate ? "duplicate" : ""}>
                  <td>
                    <b>{column.header || <span className="muted">제목 없음</span>}</b>
                    {mapping && !mapping.auto && mapping.role === "skip" && <small>{mapping.reason}</small>}
                  </td>
                  <td className="import-samples">{column.samples.length
                    ? column.samples.map((sample, index) => <span key={index}>{sample}</span>)
                    : <span className="muted">비어 있음</span>}</td>
                  <td>
                    <label>
                      <span className="sr-only">{column.header} 열을 무엇으로 읽을지 고르기</span>
                      <select value={value} disabled={Boolean(busy)}
                        onChange={(event) => changeMapping(column.index, event.target.value)}>
                        <option value="skip">{ROLE_LABEL.skip}</option>
                        <option value="name">{ROLE_LABEL.name}</option>
                        <option value="email">{ROLE_LABEL.email}</option>
                        <option value="timestamp">{ROLE_LABEL.timestamp}</option>
                        <optgroup label="문항">
                          {preview.questions.map((question) => <option key={question.id} value={question.id}>
                            {question.text}
                          </option>)}
                        </optgroup>
                      </select>
                    </label>
                  </td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>

        <div className="modal-actions">
          <button type="button" onClick={() => { setPreview(null); setError(""); }} disabled={Boolean(busy)}>다른 파일</button>
          <button type="button" className="primary-small" onClick={() => void commit()}
            disabled={Boolean(busy) || !matched || duplicated.size > 0}>
            {busy === "saving" ? "저장하는 중…" : `응답 ${preview.respondents}명 들여오기`}
          </button>
        </div>
        {/* 이미 들여온 것이 있으면 갈아 끼운다는 사실을 저장 전에 알린다. */}
        <p className="import-note">이미 결과지에서 들여온 응답이 있으면 이번 것으로 바뀝니다. 링크로 받은 응답은 그대로 둡니다.</p>
      </>}
    </div>
  </div>;
}
