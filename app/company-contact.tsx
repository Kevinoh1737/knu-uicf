"use client";

import { useRef, useState } from "react";
import { CompanyContact, EMPTY_CONTACT, hasContact, parseRememberText, sanitizeContact } from "@/lib/contacts";
import { Icon } from "./ui";

type Mode = "card" | "remember" | "manual";

/**
 * 기업 담당자. 상담 일정을 잡고 브리프를 보내고 계약을 진행할 상대라 기업 화면 어디서나
 * 보여야 한다. 입력은 명함 사진·리멤버 텍스트·직접 입력 세 갈래다.
 */
export function CompanyContactPanel({ companyId, initial, onSaved }: {
  companyId: string;
  initial?: CompanyContact | null;
  onSaved?: (contact: CompanyContact) => void;
}) {
  const [contact, setContact] = useState<CompanyContact>(initial ? sanitizeContact(initial) : EMPTY_CONTACT);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("card");
  const [draft, setDraft] = useState<CompanyContact>(EMPTY_CONTACT);
  const [remember, setRemember] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filled = hasContact(contact);

  const start = () => {
    setDraft(filled ? contact : EMPTY_CONTACT);
    setRemember(""); setError(""); setMode(filled ? "manual" : "card"); setOpen(true);
  };

  const readCard = async (file: File) => {
    // 같은 파일을 다시 고를 수 있도록 무엇보다 먼저 입력을 비운다.
    if (fileInputRef.current) fileInputRef.current.value = "";
    setError("");
    if (!file.type.startsWith("image/")) return setError("이미지 파일을 올려 주세요.");
    if (file.size > 8 * 1024 * 1024) return setError("명함 이미지는 8MB까지 올릴 수 있습니다.");

    setBusy(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
        reader.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
        reader.readAsDataURL(file);
      });
      const response = await fetch(`/api/companies/${companyId}/contact`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64, mimeType: file.type }),
      });
      const result = await response.json() as { error?: string; contact?: CompanyContact };
      if (!response.ok || !result.contact) throw new Error(result.error || "명함을 읽지 못했습니다.");
      setDraft(result.contact); setMode("manual");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "명함을 읽지 못했습니다.");
    } finally { setBusy(false); }
  };

  const readRemember = () => {
    setError("");
    const parsed = parseRememberText(remember);
    if (!parsed) return setError("명함 정보를 알아보지 못했습니다. 리멤버에서 받은 내용을 그대로 붙여 넣어 주세요.");
    setDraft(parsed); setMode("manual");
  };

  const save = async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/companies/${companyId}/contact`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const result = await response.json() as { error?: string; contact?: CompanyContact };
      if (!response.ok || !result.contact) throw new Error(result.error || "저장하지 못했습니다.");
      setContact(result.contact); onSaved?.(result.contact); setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "저장하지 못했습니다.");
    } finally { setBusy(false); }
  };

  const field = (label: string, key: keyof CompanyContact, placeholder = "") =>
    <label key={key}>{label}
      <input value={draft[key]} placeholder={placeholder} disabled={busy}
        onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} />
    </label>;

  return <>
    <div className="contact-card">
      {filled ? <>
        <div>
          <small>담당자</small>
          <b>{contact.name || "이름 미입력"}</b>
          <p>{[contact.position, contact.department].filter(Boolean).join(" · ") || "직급 미입력"}</p>
          <p className="contact-lines">{[contact.email, contact.phone].filter(Boolean).join(" · ") || "연락처 미입력"}</p>
        </div>
        <button type="button" onClick={start}>수정</button>
      </> : <>
        <div><small>담당자</small><p>등록된 담당자가 없습니다</p></div>
        <button type="button" onClick={start}>등록</button>
      </>}
    </div>

    {open && <div className="modal-backdrop">
      <button type="button" className="modal-scrim" aria-label="닫기" onClick={() => setOpen(false)} disabled={busy} />
      <div className="modal instructor-modal" aria-busy={busy}>
        <div className="modal-head">
          <div>
            <span>COMPANY CONTACT</span>
            <h2>담당자 정보</h2>
            <p>명함 사진이나 리멤버 텍스트를 넣으면 자동으로 채워집니다.</p>
          </div>
          <button className="modal-close" type="button" onClick={() => setOpen(false)} aria-label="닫기" disabled={busy}>×</button>
        </div>

        <div className="input-tabs" role="tablist" aria-label="담당자 입력 방법">
          {([["card", "01", "명함 사진"], ["remember", "02", "리멤버"], ["manual", "03", "직접 입력"]] as const)
            .map(([id, number, label]) => <button type="button" role="tab" key={id}
              aria-selected={mode === id} className={mode === id ? "active" : ""}
              onClick={() => { setMode(id); setError(""); }} disabled={busy}>
              <span>{number}</span>{label}
            </button>)}
        </div>

        {mode === "card" && <div className="input-panel" role="tabpanel">
          <div className="pdf-field">
            <div className="pdf-label-line"><span>명함 사진</span><small className="pdf-limit">최대 8MB</small></div>
            <label className="pdf-upload-label">
              <input ref={fileInputRef} className="pdf-file-input" type="file" accept="image/*" disabled={busy}
                onChange={(event) => { const file = event.target.files?.[0]; if (file) void readCard(file); }} />
              <span className="pdf-upload-control">
                <Icon name="upload" size={20} />
                <span className="pdf-upload-copy"><b>이미지 선택</b></span>
              </span>
            </label>
          </div>
        </div>}

        {mode === "remember" && <div className="input-panel" role="tabpanel">
          <label>리멤버 명함 내용
            <textarea className="remember-input" rows={6} value={remember} disabled={busy}
              placeholder={"이름: 홍길동\n회사: ○○기업\n직책: 팀장\n휴대폰: 010-0000-0000\n이메일: hong@example.com"}
              onChange={(event) => setRemember(event.target.value)} />
          </label>
          <div className="modal-actions">
            <button type="button" className="primary-small" onClick={readRemember} disabled={busy || !remember.trim()}>
              내용 읽기
            </button>
          </div>
        </div>}

        {mode === "manual" && <div className="profile-form">
          {field("이름", "name", "홍길동")}
          <div className="form-row">{field("직급 · 직책", "position", "팀장")}{field("부서", "department", "인재개발팀")}</div>
          <div className="form-row">{field("이메일", "email", "name@example.com")}{field("연락처", "phone", "010-0000-0000")}</div>
        </div>}

        {busy && <div className="modal-processing" role="status" aria-live="polite">
          <i aria-hidden="true" /><span>처리 중</span>
        </div>}
        {error && <p className="modal-error" role="alert">{error}</p>}

        <div className="modal-actions">
          <button type="button" onClick={() => setOpen(false)} disabled={busy}>취소</button>
          {mode === "manual" && <button type="button" className="primary-small" onClick={save} disabled={busy}>저장</button>}
        </div>
      </div>
    </div>}
  </>;
}
