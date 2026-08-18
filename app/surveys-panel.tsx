"use client";

import { useEffect, useRef, useState } from "react";
import {
  SCALE_LABELS,
  SURVEY_STATUS_LABEL,
  SurveyQuestion,
  SurveyStatus,
  SurveySummary,
} from "@/lib/surveys";
import { formatHeldOn } from "@/lib/course-time";
import { Feedback, Icon, useConfirm } from "./ui";

type SurveyBrief = {
  id: string; title: string; status: SurveyStatus; questionCount: number;
  updatedAt: string; sentCount: number; responseCount: number;
};

type SurveyItem = {
  sessionId: string; title: string; heldOn: string | null; startTime: string | null; durationHours: number | null; location: string; headcount: number | null;
  companyId: string; companyName: string; instructorName: string; learnerCount: number;
  survey: SurveyBrief | null;
};

type SurveyTemplate = {
  id: string; name: string; intro: string; questions: SurveyQuestion[];
  is_default: boolean; usedCount: number;
};

type Detail = {
  survey: { id: string; title: string; intro: string; questions: SurveyQuestion[]; status: SurveyStatus };
  invites: Array<{ id: string; sentAt: string | null; sendError: string | null; respondedAt: string | null; learnerName: string; learnerEmail: string }>;
  summary: SurveySummary;
};

const TYPE_LABEL: Record<SurveyQuestion["type"], string> = {
  scale: "5점 척도", choice: "보기 선택", text: "서술형",
};

function formatDate(value: string | null, startTime?: string | null, durationHours?: number | null) {
  return formatHeldOn(value, startTime, durationHours) || "미정";
}

/**
 * 만족도. 목록의 단위는 설문지가 아니라 교육과정이다 — 설문지는 과정에 한 장씩 붙는 것이라,
 * 아직 없는 과정도 같은 자리에 보여야 만들 곳이 생긴다.
 */
export function SurveysPanel() {
  const [items, setItems] = useState<SurveyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>("");
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);

  const reload = () => fetch("/api/surveys")
    .then(async (response) => {
      const result = await response.json() as { items?: SurveyItem[]; error?: string };
      if (!response.ok) throw new Error(result.error || "목록을 불러오지 못했습니다.");
      setItems(result.items || []);
    })
    .catch((caught) => setFeedback({ message: caught instanceof Error ? caught.message : "목록을 불러오지 못했습니다.", error: true }));

  useEffect(() => { void reload().finally(() => setLoading(false)); }, []);

  const create = async (item: SurveyItem) => {
    setFeedback(null);
    try {
      const response = await fetch("/api/surveys", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseSessionId: item.sessionId }),
      });
      const result = await response.json() as { survey?: { id: string }; error?: string };
      if (!response.ok || !result.survey) throw new Error(result.error || "설문지를 만들지 못했습니다.");
      await reload();
      setSelected(result.survey.id);
    } catch (caught) {
      setFeedback({ message: caught instanceof Error ? caught.message : "설문지를 만들지 못했습니다.", error: true });
    }
  };

  if (selected) {
    return <SurveyEditor surveyId={selected} onBack={() => { setSelected(""); void reload(); }} />;
  }

  return <section className="workspace-panel">
    <div className="content-title">
      <div>
        <h2>만족도 설문</h2>
      </div>
    </div>

    <Feedback value={feedback} onClose={() => setFeedback(null)} />

    {/* 질문지가 먼저다. 과정마다 새로 쓰는 것이 아니라 여기 있는 것을 불러다 쓴다 —
        같은 문항 id 로 물어야 과정끼리 견줄 수 있다. */}
    <SurveyTemplates onChanged={() => void reload()} />

    {loading ? <p className="body-text">불러오는 중</p>
      : items.length === 0
        ? <div className="company-empty"><span><Icon name="survey" size={26}/></span>
            <h2>교육과정이 아직 없습니다</h2>
            <p>기업 화면에서 교육과정을 만들면<br/>여기에 설문지를 붙일 수 있습니다.</p></div>
        : <div className="survey-list">
            {items.map((item) => <article key={item.sessionId} className="survey-row">
              <div className="survey-row-main">
                <div className="survey-row-head">
                  <h3>{item.title}</h3>
                  {item.survey
                    ? <span className={`stage ${item.survey.status === "open" ? "progress" : item.survey.status === "closed" ? "done" : "neutral"}`}>
                        {SURVEY_STATUS_LABEL[item.survey.status]}
                      </span>
                    : <span className="stage neutral">설문지 없음</span>}
                </div>
                <p className="survey-row-meta">
                  {[item.companyName, formatDate(item.heldOn, item.startTime, item.durationHours), item.instructorName ? `${item.instructorName} 강사` : ""].filter(Boolean).join(" · ")}
                </p>
                <p className="survey-row-meta">
                  {item.survey
                    ? `문항 ${item.survey.questionCount}개 · 발송 ${item.survey.sentCount}명 · 응답 ${item.survey.responseCount}명`
                    : `수강생 ${item.learnerCount}명`}
                </p>
              </div>
              <div className="survey-row-actions">
                {item.survey
                  ? <button type="button" className="primary-small" onClick={() => setSelected(item.survey!.id)}>설문지 열기</button>
                  : <button type="button" className="primary-small" onClick={() => void create(item)}>설문지 만들기</button>}
              </div>
            </article>)}
          </div>}
  </section>;
}

/**
 * 표준 질문지 관리. 만족도 설문은 과정마다 새로 쓰지 않고 이 몇 장을 계속 돌려 쓴다 —
 * 같은 문항 id 로 물어야 과정끼리 견줄 수 있기 때문이다. 회사마다 따로 묻고 싶은 것은
 * 그 과정 설문지에 문항을 더해 해결한다(여기서 늘리면 모든 과정이 함께 늘어난다).
 */
function SurveyTemplates({ onChanged }: { onChanged: () => void }) {
  const [templates, setTemplates] = useState<SurveyTemplate[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SurveyTemplate | null>(null);
  const [draft, setDraft] = useState<{ name: string; intro: string; questions: SurveyQuestion[] }>({ name: "", intro: "", questions: [] });
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const { ask, confirmDialog } = useConfirm();

  const [ready, setReady] = useState(true);
  const load = () => fetch("/api/survey-templates")
    .then(async (response) => {
      const result = await response.json() as { templates?: SurveyTemplate[]; ready?: boolean; error?: string };
      if (!response.ok) throw new Error(result.error || "질문지를 불러오지 못했습니다.");
      setTemplates(result.templates || []);
      setReady(result.ready !== false);
    })
    .catch((caught) => setFeedback({ message: caught instanceof Error ? caught.message : "질문지를 불러오지 못했습니다.", error: true }));

  useEffect(() => { void load(); }, []);

  const startNew = () => {
    setEditing(null);
    setDraft({ name: "", intro: "", questions: [] });
    setOpen(true);
  };
  const startEdit = (template: SurveyTemplate) => {
    setEditing(template);
    setDraft({ name: template.name, intro: template.intro, questions: template.questions });
    setOpen(true);
  };

  const save = async () => {
    setBusy(true); setFeedback(null);
    try {
      const response = await fetch(editing ? `/api/survey-templates/${editing.id}` : "/api/survey-templates", {
        method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft.name, intro: draft.intro, ...(editing || draft.questions.length ? { questions: draft.questions } : {}) }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "질문지를 저장하지 못했습니다.");
      await load();
      onChanged();
      setOpen(false);
      setFeedback({ message: editing ? "질문지를 저장했습니다." : "질문지를 만들었습니다.", error: false });
    } catch (caught) {
      setFeedback({ message: caught instanceof Error ? caught.message : "질문지를 저장하지 못했습니다.", error: true });
    } finally { setBusy(false); }
  };

  const makeDefault = async (template: SurveyTemplate) => {
    setBusy(true); setFeedback(null);
    try {
      const response = await fetch(`/api/survey-templates/${template.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isDefault: true }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "기본 질문지를 바꾸지 못했습니다.");
      await load();
      setFeedback({ message: `‘${template.name}’ 을 기본 질문지로 정했습니다.`, error: false });
    } catch (caught) {
      setFeedback({ message: caught instanceof Error ? caught.message : "기본 질문지를 바꾸지 못했습니다.", error: true });
    } finally { setBusy(false); }
  };

  const archive = async (template: SurveyTemplate) => {
    const agreed = await ask({
      title: `‘${template.name}’ 질문지를 목록에서 치울까요?`,
      message: template.usedCount
        ? `이미 ${template.usedCount}개 교육이 이 질문지로 만들어졌습니다. 그 설문지와 응답은 그대로 남습니다.`
        : "새 교육에서 고를 수 없게 됩니다.",
      confirmLabel: "치우기", danger: true,
    });
    if (!agreed) return;
    setBusy(true); setFeedback(null);
    try {
      const response = await fetch(`/api/survey-templates/${template.id}`, { method: "DELETE" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "질문지를 치우지 못했습니다.");
      await load();
      setFeedback({ message: "질문지를 목록에서 치웠습니다.", error: false });
    } catch (caught) {
      setFeedback({ message: caught instanceof Error ? caught.message : "질문지를 치우지 못했습니다.", error: true });
    } finally { setBusy(false); }
  };

  const update = (index: number, patch: Partial<SurveyQuestion>) =>
    setDraft((current) => ({ ...current, questions: current.questions.map((question, position) => position === index ? { ...question, ...patch } : question) }));
  const move = (index: number, direction: -1 | 1) => setDraft((current) => {
    const target = index + direction;
    if (target < 0 || target >= current.questions.length) return current;
    const next = [...current.questions];
    [next[index], next[target]] = [next[target], next[index]];
    return { ...current, questions: next };
  });

  return <div className="template-block">
    {confirmDialog}
    <div className="template-head">
      <h3>표준 질문지 <small>{templates.length}장</small></h3>
      <button type="button" className="upload-chip" onClick={startNew} disabled={busy || !ready}>
        <Icon name="plus" size={15} /> 새 질문지
      </button>
    </div>
    <p className="action-hint">교육마다 여기 있는 질문지를 불러다 씁니다. 회사별로 더 묻고 싶은 것은 그 교육 설문지에서 문항을 추가하세요.</p>

    <Feedback value={feedback} onClose={() => setFeedback(null)} />

    {!ready
      ? <p className="body-text">질문지 보관함이 아직 준비되지 않았습니다(데이터베이스 준비 필요). 그동안에도 교육에서 설문지는 표준 문항으로 만들 수 있습니다.</p>
      : templates.length === 0
      ? <p className="body-text">아직 질문지가 없습니다. 새 질문지를 만들면 표준 문항으로 시작합니다.</p>
      : <div className="template-list">
          {templates.map((template) => <article key={template.id} className="template-row">
            <div>
              <b>{template.name}</b>
              {template.is_default && <span className="question-tag standard">기본</span>}
              <small>문항 {template.questions.length}개 · 사용 {template.usedCount}개 교육</small>
            </div>
            <div className="template-tools">
              <button type="button" className="upload-chip" onClick={() => startEdit(template)} disabled={busy}>편집</button>
              {!template.is_default && <button type="button" className="upload-chip" onClick={() => void makeDefault(template)} disabled={busy}>기본으로</button>}
              {!template.is_default && <button type="button" className="upload-chip danger" onClick={() => void archive(template)} disabled={busy}>치우기</button>}
            </div>
          </article>)}
        </div>}

    {open && <div className="template-editor">
      <div className="survey-fields">
        <label>질문지 이름
          <input value={draft.name} disabled={busy} placeholder="표준 교육 만족도"
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
        </label>
        <label>안내 문구
          <textarea rows={2} value={draft.intro} disabled={busy} placeholder="수강생이 처음 보는 안내"
            onChange={(event) => setDraft((current) => ({ ...current, intro: event.target.value }))} />
        </label>
      </div>
      {draft.questions.length === 0
        ? <p className="body-text">저장하면 표준 문항 8개로 시작합니다. 문항을 직접 넣으려면 아래에서 추가하세요.</p>
        : <QuestionRows questions={draft.questions} disabled={busy} onUpdate={update} onMove={move}
            onRemove={(index) => setDraft((current) => ({ ...current, questions: current.questions.filter((_, position) => position !== index) }))} />}
      <div className="savebar">
        <button type="button" className="upload-chip" disabled={busy}
          onClick={() => setDraft((current) => ({ ...current, questions: [...current.questions, {
            id: `q_${Date.now().toString(36)}`, type: "scale", text: "", options: [], required: true, source: "standard",
          }] }))}>
          <Icon name="plus" size={15} /> 문항 추가
        </button>
        <span />
        <button type="button" onClick={() => setOpen(false)} disabled={busy}>취소</button>
        <button type="button" className="primary-small" disabled={busy || !draft.name.trim()} onClick={() => void save()}>
          {busy ? "저장 중" : "질문지 저장"}
        </button>
      </div>
    </div>}
  </div>;
}

/**
 * 문항 편집 줄. 과정 설문지와 표준 질문지가 같은 손놀림을 쓰도록 한 곳에 둔다 —
 * 두 벌로 두면 한쪽만 고쳐져 서로 다르게 동작한다.
 */
function QuestionRows({ questions, disabled, showSource, onUpdate, onMove, onRemove }: {
  questions: SurveyQuestion[];
  disabled: boolean;
  /** 표준 문항과 이 과정 전용 문항을 갈라 보여 줄 것인가. 질문지 편집에서는 전부 표준이라 끈다. */
  showSource?: boolean;
  onUpdate: (index: number, patch: Partial<SurveyQuestion>) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (index: number) => void;
}) {
  return <div className="survey-questions">
    {questions.map((question, index) => <article key={question.id} className="survey-edit-row">
      <div className="survey-edit-head">
        <span className="survey-number">{String(index + 1).padStart(2, "0")}</span>
        {showSource && <span className={question.source === "standard" ? "question-tag standard" : "question-tag"}>
          {question.source === "standard" ? "표준" : "이 교육"}
        </span>}
        <select value={question.type} disabled={disabled}
          onChange={(event) => onUpdate(index, { type: event.target.value as SurveyQuestion["type"] })}>
          {(Object.keys(TYPE_LABEL) as Array<SurveyQuestion["type"]>).map((type) =>
            <option key={type} value={type}>{TYPE_LABEL[type]}</option>)}
        </select>
        <label className="survey-required">
          <input type="checkbox" checked={question.required} disabled={disabled}
            onChange={(event) => onUpdate(index, { required: event.target.checked })} />
          필수
        </label>
        <div className="survey-edit-tools">
          <button type="button" onClick={() => onMove(index, -1)} disabled={disabled || index === 0} aria-label="위로">↑</button>
          <button type="button" onClick={() => onMove(index, 1)} disabled={disabled || index === questions.length - 1} aria-label="아래로">↓</button>
          <button type="button" className="row-delete" disabled={disabled} onClick={() => onRemove(index)}>삭제</button>
        </div>
      </div>
      <textarea rows={2} value={question.text} disabled={disabled} placeholder="문항을 적어 주세요"
        onChange={(event) => onUpdate(index, { text: event.target.value })} />
      {question.type === "choice" && <input value={question.options.join(", ")} disabled={disabled}
        placeholder="보기를 쉼표로 구분해 적어 주세요"
        onChange={(event) => onUpdate(index, { options: event.target.value.split(",").map((option) => option.trim()).filter(Boolean) })} />}
      {question.type === "scale" && <p className="survey-hint">{SCALE_LABELS.map((label, score) => `${score + 1} ${label}`).join("  ·  ")}</p>}
    </article>)}
  </div>;
}

/** 문항 편집·초안 생성·PDF·발송·지표가 한 화면에 있다. 설문지는 이 네 가지 말고 할 일이 없다. */
function SurveyEditor({ surveyId, onBack }: { surveyId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [questions, setQuestions] = useState<SurveyQuestion[]>([]);
  const [title, setTitle] = useState("");
  const [intro, setIntro] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { ask, confirmDialog } = useConfirm();

  const load = () => fetch(`/api/surveys/${surveyId}`)
    .then(async (response) => {
      const result = await response.json() as Detail & { error?: string };
      if (!response.ok) throw new Error(result.error || "설문지를 불러오지 못했습니다.");
      setDetail(result);
      setQuestions(result.survey.questions);
      setTitle(result.survey.title);
      setIntro(result.survey.intro);
      setDirty(false);
    })
    .catch((caught) => setFeedback({ message: caught instanceof Error ? caught.message : "설문지를 불러오지 못했습니다.", error: true }));

  // load 는 surveyId 만 참조한다. 의존성에 넣으면 렌더마다 새로 만들어져 계속 다시 읽는다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [surveyId]);

  const patch = async (body: Record<string, unknown>, label: string) => {
    setBusy(label); setFeedback(null);
    try {
      const response = await fetch(`/api/surveys/${surveyId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "저장하지 못했습니다.");
      await load();
      setFeedback({ message: "저장했습니다.", error: false });
    } catch (caught) {
      setFeedback({ message: caught instanceof Error ? caught.message : "저장하지 못했습니다.", error: true });
    } finally { setBusy(""); }
  };

  const draft = async (file?: File) => {
    if (fileInputRef.current) fileInputRef.current.value = "";
    setBusy("draft"); setFeedback(null);
    try {
      const response = await fetch(`/api/surveys/${surveyId}/draft`, {
        method: "POST",
        ...(file ? { body: (() => { const form = new FormData(); form.append("file", file); return form; })() } : {}),
      });
      const result = await response.json() as { questions?: SurveyQuestion[]; title?: string; intro?: string; error?: string; fromExisting?: boolean };
      if (!response.ok || !result.questions) throw new Error(result.error || "초안을 만들지 못했습니다.");
      setQuestions(result.questions);
      if (result.title) setTitle(result.title);
      if (result.intro) setIntro(result.intro);
      setDirty(true);
      setFeedback({
        message: `${result.fromExisting ? "올려 주신 설문지를 반영해 " : ""}초안 ${result.questions.length}개 문항을 만들었습니다. 확인 후 저장해 주세요.`,
        error: false,
      });
    } catch (caught) {
      setFeedback({ message: caught instanceof Error ? caught.message : "초안을 만들지 못했습니다.", error: true });
    } finally { setBusy(""); }
  };

  const send = async (resend: boolean) => {
    const target = detail?.summary.invited || 0;
    const agreed = await ask({
      title: resend ? "이미 보낸 사람에게도 다시 보낼까요?" : "배정된 수강생에게 설문 링크를 보낼까요?",
      message: !resend && target ? `이미 ${target}명에게 보냈습니다.` : undefined,
      confirmLabel: "보내기",
    });
    if (!agreed) return;

    setBusy("send"); setFeedback(null);
    try {
      const response = await fetch(`/api/surveys/${surveyId}/send`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resend }),
      });
      const result = await response.json() as {
        sent?: number; skipped?: number; withoutEmail?: number; stoppedEarly?: number;
        failures?: Array<{ name: string; reason: string }>; error?: string;
      };
      if (!response.ok) throw new Error(result.error || "보내지 못했습니다.");
      const notes = [
        `${result.sent || 0}명에게 보냈습니다`,
        result.skipped ? `이미 보낸 ${result.skipped}명 제외` : "",
        result.withoutEmail ? `이메일 없는 ${result.withoutEmail}명 제외` : "",
        result.stoppedEarly ? `시간이 부족해 ${result.stoppedEarly}명 남음 — 다시 눌러 주세요` : "",
        result.failures?.length ? `실패 ${result.failures.length}명 (${result.failures[0].reason})` : "",
      ].filter(Boolean);
      await load();
      setFeedback({ message: notes.join(" · "), error: Boolean(result.failures?.length) });
    } catch (caught) {
      setFeedback({ message: caught instanceof Error ? caught.message : "보내지 못했습니다.", error: true });
    } finally { setBusy(""); }
  };

  const update = (index: number, patchValue: Partial<SurveyQuestion>) => {
    setQuestions((current) => current.map((question, position) => position === index ? { ...question, ...patchValue } : question));
    setDirty(true);
  };
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= questions.length) return;
    setQuestions((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setDirty(true);
  };
  // 여기서 더하는 문항은 이 과정 전용이다. 표준 문항은 질문지에서만 늘어난다 —
  // 한 과정에서 표준 축을 늘리면 다른 과정과 견줄 수 없는 문항이 축인 척하게 된다.
  const addQuestion = () => {
    setQuestions((current) => [...current, {
      id: `q_${Date.now().toString(36)}`, type: "scale", text: "", options: [], required: true,
      source: "custom",
    }]);
    setDirty(true);
  };

  if (!detail) return <section className="workspace-panel"><p className="body-text">불러오는 중</p></section>;

  const { summary, invites } = detail;
  const status = detail.survey.status;

  return <section className="workspace-panel survey-editor">
    {confirmDialog}
    <button type="button" className="backbar" onClick={onBack}>← 만족도 목록</button>

    <div className="content-title">
      <div>
        <h2>{title || "만족도 설문지"}</h2>
      </div>
      <div className="title-actions">
        <button type="button" className="upload-chip" onClick={() => void draft()} disabled={Boolean(busy)}>
          <Icon name="spark" size={15} /> {busy === "draft" ? "만드는 중" : "AI 초안"}
        </button>
        <label className="upload-chip">
          <input ref={fileInputRef} className="pdf-file-input" type="file" accept="application/pdf" disabled={Boolean(busy)}
            onChange={(event) => { const file = event.target.files?.[0]; if (file) void draft(file); }} />
          <Icon name="upload" size={15} /> 쓰던 설문지 PDF
        </label>
        <a className="upload-chip" href={`/api/surveys/${surveyId}/pdf`} target="_blank" rel="noreferrer">
          <Icon name="download" size={15} /> PDF 내려받기
        </a>
      </div>
    </div>

    <Feedback value={feedback} onClose={() => setFeedback(null)} />

    <div className="survey-metrics">
      <div><dt>상태</dt><dd>{SURVEY_STATUS_LABEL[status]}</dd></div>
      <div><dt>발송</dt><dd>{summary.invited}명</dd></div>
      <div><dt>응답</dt><dd>{summary.responded}명 · {summary.responseRate}%</dd></div>
      <div><dt>평균</dt><dd>{summary.overall === null ? "—" : `${summary.overall} / 5`}</dd></div>
    </div>

    <div className="survey-actions">
      <button type="button" className="primary-small" onClick={() => void send(false)} disabled={Boolean(busy)}>
        {busy === "send" ? "보내는 중" : "수강생에게 발송"}
      </button>
      {summary.invited > 0 && <button type="button" onClick={() => void send(true)} disabled={Boolean(busy)}>다시 보내기</button>}
      {status !== "open"
        ? <button type="button" onClick={() => void patch({ status: "open" }, "status")} disabled={Boolean(busy)}>응답 열기</button>
        : <button type="button" onClick={() => void patch({ status: "closed" }, "status")} disabled={Boolean(busy)}>마감</button>}
    </div>

    <div className="survey-fields">
      <label>설문 제목
        <input value={title} disabled={Boolean(busy)}
          onChange={(event) => { setTitle(event.target.value); setDirty(true); }} />
      </label>
      <label>안내 문구
        <textarea rows={2} value={intro} disabled={Boolean(busy)} placeholder="수강생이 처음 보는 안내"
          onChange={(event) => { setIntro(event.target.value); setDirty(true); }} />
      </label>
    </div>

    <QuestionRows questions={questions} disabled={Boolean(busy)} showSource
      onUpdate={update} onMove={move}
      onRemove={(index) => { setQuestions((current) => current.filter((_, position) => position !== index)); setDirty(true); }} />

    <div className="savebar">
      <button type="button" className="upload-chip" onClick={addQuestion} disabled={Boolean(busy)}><Icon name="plus" size={15} /> 문항 추가</button>
      <span>{dirty ? "저장하지 않은 변경이 있습니다" : "저장됨"}</span>
      <button type="button" className="primary-small" disabled={Boolean(busy) || !dirty || !questions.length}
        onClick={() => void patch({ title, intro, questions }, "save")}>
        {busy === "save" ? "저장 중" : "설문지 저장"}
      </button>
    </div>

    {summary.responded > 0 && <div className="survey-results">
      <h3>응답 결과</h3>
      {summary.scales.map((scale) => <div key={scale.id} className="survey-result-row">
        <div className="survey-result-head">
          <b>{scale.text}</b>
          <span>{scale.count ? `${scale.average} / 5` : "응답 없음"}</span>
        </div>
        <div className="survey-bar" aria-hidden="true">
          <i style={{ width: `${scale.count ? (scale.average / 5) * 100 : 0}%` }} />
        </div>
        <p className="survey-hint">
          {scale.distribution.map((count, position) => `${position + 1}점 ${count}명`).join(" · ")}
        </p>
      </div>)}
      {summary.texts.filter((text) => text.answers.length > 0).map((text) => <div key={text.id} className="survey-result-row">
        <div className="survey-result-head"><b>{text.text}</b><span>{text.answers.length}건</span></div>
        <ul className="survey-answers">{text.answers.map((answer, index) => <li key={index}>{answer}</li>)}</ul>
      </div>)}
    </div>}

    {invites.length > 0 && <div className="survey-results">
      <h3>발송 현황</h3>
      <div className="learner-table"><table>
        <thead><tr><th>수강생</th><th>이메일</th><th>발송</th><th>응답</th></tr></thead>
        <tbody>
          {invites.map((invite) => <tr key={invite.id}>
            <td><b>{invite.learnerName}</b></td>
            <td>{invite.learnerEmail}</td>
            <td>{invite.sentAt ? formatDate(invite.sentAt) : <span className="muted">{invite.sendError ? "실패" : "대기"}</span>}</td>
            <td>{invite.respondedAt ? <span className="attend">완료</span> : <span className="muted">미응답</span>}</td>
          </tr>)}
        </tbody>
      </table></div>
    </div>}
  </section>;
}
