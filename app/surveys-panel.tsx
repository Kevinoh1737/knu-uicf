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
import { Feedback, Icon, useConfirm, useEscapeClose } from "./ui";
import { SurveyImportModal } from "./survey-import";
import { displayCompanyName } from "@/lib/company-name";

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
  /** 무슨 교육의 설문지인가. 이것 없이는 제목만 보고 남의 교육을 열게 된다. */
  course: {
    id: string; title: string; heldOn: string | null; startTime: string | null; durationHours: number | null;
    companyName: string; instructorName: string;
  };
  /** 어느 질문지에서 왔는가. 과정끼리 견주는 축이라 화면에 이름이 보여야 한다. */
  template: { id: string; name: string } | null;
  invites: Array<{ id: string; sentAt: string | null; sendError: string | null; respondedAt: string | null; learnerName: string; learnerEmail: string }>;
  summary: SurveySummary;
};

type CompareCourse = {
  surveyId: string; sessionId: string; title: string; heldOn: string | null;
  companyId: string; companyName: string; instructorId: string; instructorName: string;
  invited: number; responded: number; responseRate: number; overall: number | null;
  scores: Record<string, { average: number; count: number }>;
};

type Comparison = {
  template: { id: string; name: string };
  axis: Array<{ id: string; text: string }>;
  courses: CompareCourse[];
};

const TYPE_LABEL: Record<SurveyQuestion["type"], string> = {
  scale: "5점 척도", choice: "보기 선택", text: "서술형",
};

function formatDate(value: string | null, startTime?: string | null, durationHours?: number | null) {
  return formatHeldOn(value, startTime, durationHours) || "미정";
}

/**
 * 화면 셋의 순서가 일의 순서다.
 *
 * 만족도 메뉴가 하는 일은 둘이다 — 질문지를 만들고(표준 질문지), 들어온 답을 보는 것(과정별·
 * 질문지 비교). 만든 질문지를 골라 수강생에게 보내는 일은 교육과정 화면에 있다: 보낼 사람이
 * 그 과정에 매달려 있고, 발송은 '이 교육을 진행한다'의 마지막 단계이기 때문이다.
 */
const VIEWS = [["courses", "과정별"], ["compare", "질문지 비교"], ["templates", "표준 질문지"]] as const;
type View = (typeof VIEWS)[number][0];

export function SurveysPanel() {
  const [items, setItems] = useState<SurveyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>("");
  const [view, setView] = useState<View>("courses");
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);

  const reload = () => fetch("/api/surveys")
    .then(async (response) => {
      const result = await response.json() as { items?: SurveyItem[]; error?: string };
      if (!response.ok) throw new Error(result.error || "목록을 불러오지 못했습니다.");
      setItems(result.items || []);
    })
    .catch((caught) => setFeedback({ message: caught instanceof Error ? caught.message : "목록을 불러오지 못했습니다.", error: true }));

  useEffect(() => { void reload().finally(() => setLoading(false)); }, []);

  if (selected) {
    return <SurveyResult surveyId={selected} onBack={() => { setSelected(""); void reload(); }} />;
  }

  // 제목은 상단 머리말이 이미 달고 있다. 여기서 한 번 더 쓰면 같은 글자가 두 번 나온다.
  return <section className="workspace-panel">
    <div className="content-title">
      <div>
        <p>질문지를 만들어 두고, 교육과정에서 골라 보내고, 돌아온 답을 여기에서 봅니다.</p>
      </div>
      <div className="title-actions">
        <div className="range-switch" role="group" aria-label="만족도 보기">
          {VIEWS.map(([value, label]) =>
            <button type="button" key={value} className={view === value ? "active" : ""} aria-pressed={view === value}
              onClick={() => setView(value)}>{label}</button>)}
        </div>
      </div>
    </div>

    <Feedback value={feedback} onClose={() => setFeedback(null)} />

    {view === "templates" ? <SurveyTemplates onChanged={() => void reload()} />
      : view === "compare" ? <SurveyCompare />
      : loading ? <p className="body-text">불러오는 중</p>
        : items.length === 0
          ? <div className="company-empty"><span><Icon name="survey" size={26}/></span>
              <h2>교육과정이 아직 없습니다</h2>
              <p>기업 화면에서 교육과정을 만들면<br/>여기에 만족도 결과가 쌓입니다.</p></div>
          : <div className="survey-list">
              {items.map((item) => <article key={item.sessionId} className="survey-row">
                <div className="survey-row-main">
                  <div className="survey-row-head">
                    <h3>{item.title}</h3>
                    {item.survey && <span className={`stage ${item.survey.status === "open" ? "progress" : item.survey.status === "closed" ? "done" : "neutral"}`}>
                      {SURVEY_STATUS_LABEL[item.survey.status]}
                    </span>}
                  </div>
                  <p className="survey-row-meta">
                    {[displayCompanyName(item.companyName), formatDate(item.heldOn, item.startTime, item.durationHours), item.instructorName ? `${item.instructorName} 강사` : ""].filter(Boolean).join(" · ")}
                  </p>
                  <p className="survey-row-meta">
                    {item.survey
                      ? `문항 ${item.survey.questionCount}개 · 발송 ${item.survey.sentCount}명 · 응답 ${item.survey.responseCount}명`
                      // 설문지를 만들고 보내는 일은 교육과정 화면에 있다. 여기서 또 만들 수 있으면
                      // 같은 일이 두 군데가 되고, 보낼 수강생은 그쪽에만 있다.
                      : "만족도 조사 없음 — 기업 화면의 교육과정에서 질문지를 골라 보냅니다"}
                  </p>
                </div>
                <div className="survey-row-actions">
                  {item.survey
                    ? <button type="button" className="primary-small" onClick={() => setSelected(item.survey!.id)}>결과 보기</button>
                    : <span className="muted">—</span>}
                </div>
              </article>)}
            </div>}
  </section>;
}

/**
 * 표준 질문지. 만족도 조사는 과정마다 새로 쓰지 않고 이 몇 장을 계속 돌려 쓴다 — 같은 문항
 * id 로 물어야 과정끼리 견줄 수 있기 때문이다.
 *
 * 아직 아무 교육도 쓰지 않은 질문지는 고칠 수 있다 — 만든 직후의 오탈자까지 막을 이유는
 * 없다. 다만 한 번이라도 교육에 쓰이면 잠근다: 이미 그 질문지로 답을 받았는데 문항을 바꾸면
 * 같은 이름 아래 서로 다른 것을 물은 결과가 섞이고, 비교표가 조용히 거짓이 된다.
 * (지난 응답 자체는 안전하다 — 조사를 만들 때 문항을 복사해 두므로 나중에 바뀌지 않는다.)
 */
function SurveyTemplates({ onChanged }: { onChanged: () => void }) {
  const [templates, setTemplates] = useState<SurveyTemplate[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SurveyTemplate | null>(null);
  const [viewing, setViewing] = useState<SurveyTemplate | null>(null);
  const [draft, setDraft] = useState<{ name: string; intro: string; questions: SurveyQuestion[] }>({ name: "", intro: "", questions: [] });
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  /** 아직 아무도 쓰지 않은 질문지만 고친다. 서버도 같은 판단을 한 번 더 한다. */
  const startEdit = (template: SurveyTemplate) => {
    setViewing(null);
    setEditing(template);
    setDraft({ name: template.name, intro: template.intro, questions: template.questions });
    setOpen(true);
  };

  /**
   * 쓰던 질문지를 그대로 옮겨 온다. 이미 몇 년째 쓰던 종이 설문지가 있는 팀에게는 이것이
   * 첫 질문지를 만드는 가장 빠른 길이고, 문항 id 가 한 벌로 잡히면 그 뒤 교육은 전부 견줄 수 있다.
   */
  const fromPdf = async (file?: File) => {
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (draft.questions.length) {
      const agreed = await ask({
        title: "지금 적어 둔 문항을 올린 질문지로 바꿀까요?",
        message: `문항 ${draft.questions.length}개가 PDF 에서 읽은 것으로 바뀝니다.`,
        confirmLabel: "바꾸기",
      });
      if (!agreed) return;
    }
    setBusy("draft"); setFeedback(null);
    setOpen(true);
    try {
      const response = await fetch("/api/survey-templates/draft", {
        method: "POST",
        ...(file ? { body: (() => { const form = new FormData(); form.append("file", file); return form; })() } : {}),
      });
      const result = await response.json() as { name?: string; intro?: string; questions?: SurveyQuestion[]; error?: string; fromExisting?: boolean };
      if (!response.ok || !result.questions) throw new Error(result.error || "초안을 만들지 못했습니다.");
      setDraft((current) => ({
        name: current.name || result.name || "",
        intro: result.intro || current.intro,
        questions: result.questions || [],
      }));
      setFeedback({
        message: `${result.fromExisting ? "올려 주신 질문지를 읽어 " : ""}문항 ${result.questions.length}개를 만들었습니다. 확인하고 저장해 주세요.`,
        error: false,
      });
    } catch (caught) {
      setFeedback({ message: caught instanceof Error ? caught.message : "초안을 만들지 못했습니다.", error: true });
    } finally { setBusy(""); }
  };

  const save = async () => {
    setBusy("save"); setFeedback(null);
    try {
      const response = await fetch(editing ? `/api/survey-templates/${editing.id}` : "/api/survey-templates", {
        method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft.name, intro: draft.intro, ...(draft.questions.length ? { questions: draft.questions } : {}) }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "질문지를 저장하지 못했습니다.");
      await load();
      onChanged();
      setOpen(false);
      setFeedback({
        message: editing ? "질문지를 고쳤습니다." : "질문지를 만들었습니다. 교육과정에서 골라 쓰면 됩니다.",
        error: false,
      });
    } catch (caught) {
      setFeedback({ message: caught instanceof Error ? caught.message : "질문지를 저장하지 못했습니다.", error: true });
    } finally { setBusy(""); }
  };

  const archive = async (template: SurveyTemplate) => {
    const agreed = await ask({
      title: `‘${template.name}’ 질문지를 목록에서 치울까요?`,
      message: [
        template.usedCount
          ? `이미 ${template.usedCount}개 교육이 이 질문지로 만들어졌습니다. 그 조사와 응답은 그대로 남습니다.`
          : "새 교육에서 고를 수 없게 됩니다.",
        // 기본이 사라지면 남은 것 중 하나가 그 자리를 잇는다(서버가 정한다). 미리 알려 준다.
        template.is_default ? "가장 최근에 만든 질문지가 기본이 됩니다." : "",
      ].filter(Boolean).join(" "),
      confirmLabel: "치우기", danger: true,
    });
    if (!agreed) return;
    setBusy("archive"); setFeedback(null);
    try {
      const response = await fetch(`/api/survey-templates/${template.id}`, { method: "DELETE" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "질문지를 치우지 못했습니다.");
      await load();
      setFeedback({ message: "질문지를 목록에서 치웠습니다.", error: false });
    } catch (caught) {
      setFeedback({ message: caught instanceof Error ? caught.message : "질문지를 치우지 못했습니다.", error: true });
    } finally { setBusy(""); }
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
      <div className="template-head-actions">
        <button type="button" className="upload-chip" onClick={startNew} disabled={Boolean(busy) || !ready}>
          <Icon name="plus" size={15} /> 새 질문지
        </button>
        <label className="upload-chip">
          <input ref={fileInputRef} className="pdf-file-input" type="file" accept="application/pdf" disabled={Boolean(busy) || !ready}
            onChange={(event) => { const file = event.target.files?.[0]; if (file) void fromPdf(file); }} />
          <Icon name="upload" size={15} /> {busy === "draft" ? "읽는 중" : "쓰던 질문지 PDF"}
        </label>
      </div>
    </div>
    <p className="action-hint">여기서 만든 질문지를 교육과정에서 골라 수강생에게 보냅니다. 한번 만든 질문지는 고치지 않습니다 — 이미 그 질문지로 받은 답과 섞이기 때문입니다.</p>

    <Feedback value={feedback} onClose={() => setFeedback(null)} />

    {!ready
      ? <p className="body-text">질문지 보관함이 아직 준비되지 않았습니다(데이터베이스 준비 필요).</p>
      : templates.length === 0
      ? <p className="body-text">아직 질문지가 없습니다. 새로 만들거나, 쓰던 질문지 PDF 를 올리면 그대로 옮겨 옵니다.</p>
      : <div className="template-list">
          {/* 카드를 누르면 질문지가 창으로 열린다. 누를 곳을 따로 두면 정작 카드는 눌러도
              아무 일이 없는 죽은 면이 된다. 휴지통은 버튼 안에 버튼을 둘 수 없어 바깥으로
              뺐다 — 기업 카드와 같은 짜임이다. */}
          {templates.map((template) => <article key={template.id} className="template-card">
            <button type="button" className="template-card-open" onClick={() => setViewing(template)}>
              <span className="template-card-name">
                <b>{template.name}</b>
                {template.is_default && <span className="question-tag standard">기본</span>}
                <small>문항 {template.questions.length}개 · 사용 {template.usedCount}개 교육</small>
              </span>
              <span className="template-chevron"><Icon name="chevron" size={18} /></span>
            </button>
            <button type="button" className="template-delete" disabled={Boolean(busy)}
              onClick={() => void archive(template)}
              aria-label={`${template.name} 치우기`} title="치우기">
              <Icon name="trash" size={18} />
            </button>
          </article>)}
        </div>}

    {/* 카드를 누르면 질문지가 창으로 열린다. 여덟에서 열두 문항을 카드 안에서 접었다 폈다
        하면 목록이 출렁이고, 정작 문항은 좁은 칸에 눌려 읽기 어렵다. */}
    {viewing && <TemplateViewer template={viewing} onClose={() => setViewing(null)}
      onEdit={viewing.usedCount === 0 ? () => startEdit(viewing) : undefined} />}

    {open && <div className="template-editor">
      <div className="survey-fields">
        <label>질문지 이름
          <input value={draft.name} disabled={Boolean(busy)} placeholder="표준 교육 만족도"
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
        </label>
        <label>안내 문구
          <textarea rows={2} value={draft.intro} disabled={Boolean(busy)} placeholder="수강생이 처음 보는 안내"
            onChange={(event) => setDraft((current) => ({ ...current, intro: event.target.value }))} />
        </label>
      </div>
      {draft.questions.length === 0
        ? <p className="body-text">저장하면 표준 문항 8개로 시작합니다. 쓰던 질문지가 있으면 위의 <b>쓰던 질문지 PDF</b> 로 그대로 옮겨 올 수 있습니다.</p>
        : <QuestionRows questions={draft.questions} disabled={Boolean(busy)} onUpdate={update} onMove={move}
            onRemove={(index) => setDraft((current) => ({ ...current, questions: current.questions.filter((_, position) => position !== index) }))} />}
      <div className="savebar">
        <button type="button" className="upload-chip" disabled={Boolean(busy)}
          onClick={() => setDraft((current) => ({ ...current, questions: [...current.questions, {
            id: `q_${Date.now().toString(36)}`, type: "scale", text: "", options: [], required: true, source: "standard",
          }] }))}>
          <Icon name="plus" size={15} /> 문항 추가
        </button>
        <span />
        <button type="button" onClick={() => setOpen(false)} disabled={Boolean(busy)}>취소</button>
        <button type="button" className="primary-small" disabled={Boolean(busy) || !draft.name.trim()} onClick={() => void save()}>
          {busy === "save" ? "저장 중" : "질문지 저장"}
        </button>
      </div>
    </div>}
  </div>;
}

/**
 * 질문지를 펼쳐 읽는 창. 수강생이 받게 될 문항을 그대로 보여 준다 — 고르기 전에 무엇을
 * 묻는지 확인하는 자리이고, 아직 아무도 쓰지 않았다면 여기서 고치러 들어간다.
 */
function TemplateViewer({ template, onClose, onEdit }: {
  template: SurveyTemplate; onClose: () => void; onEdit?: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  useEscapeClose(true, onClose);

  // 바깥을 눌러 닫는 길은 두지 않는다 — 이 앱의 다른 창들과 같게, Esc 와 닫기 버튼으로 닫는다.
  return <div className="modal-backdrop">
    <div className="modal template-modal" role="dialog" aria-modal="true" aria-label={`${template.name} 질문지`}>
      <div className="modal-head">
        <div>
          <h2>{template.name}</h2>
          <p>문항 {template.questions.length}개 · 사용 {template.usedCount}개 교육{template.is_default ? " · 기본 질문지" : ""}</p>
        </div>
        <button type="button" ref={closeRef} onClick={onClose} aria-label="닫기">×</button>
      </div>

      {template.intro && <p className="template-modal-intro">{template.intro}</p>}

      <ol className="template-questions">
        {template.questions.map((question) => <li key={question.id}>
          {question.text} <small>{TYPE_LABEL[question.type]}{question.required ? "" : " · 선택"}</small>
          {question.type === "choice" && question.options.length > 0
            && <small className="template-options">{question.options.join(" · ")}</small>}
        </li>)}
      </ol>

      <div className="modal-actions">
        {/* 고칠 수 없는 이유는 화면에서 말해 준다 — 버튼만 없으면 고장으로 읽힌다. */}
        {!onEdit && <span className="template-locked">
          이미 {template.usedCount}개 교육이 이 질문지로 물었습니다. 문항을 바꾸면 그 교육들과 견줄 수 없어 잠겨 있습니다.
        </span>}
        <button type="button" onClick={onClose}>닫기</button>
        {onEdit && <button type="button" className="primary-small" onClick={onEdit}>문항 고치기</button>}
      </div>
    </div>
  </div>;
}

/** 한 문항에서 이 교육이 '다른 교육들'과 얼마나 벌어졌는가. 0.4점을 눈에 띄는 차이로 본다. */
const GAP = 0.4;

/**
 * 색은 자기가 낀 평균이 아니라 '나를 뺀 나머지'와 견준다.
 *
 * 두 교육만 놓고 보면 자기가 기준선의 절반이라 벌어짐이 반으로 접힌다 — 1차 3.36, 2차
 * 4.07 로 0.71 차이인데 둘 다 기준선에서 0.35 밖에 안 떨어진 것으로 보인다. 묶음이
 * 작을수록 아무 색도 안 뜨는 이 현상은 기준을 바꿔야 사라진다.
 */
function gapFromOthers(courses: CompareCourse[], self: CompareCourse, questionId: string) {
  let total = 0;
  let count = 0;
  courses.forEach((course) => {
    if (course.surveyId === self.surveyId) return;
    const score = course.scores[questionId];
    if (!score?.count) return;
    total += score.average * score.count;
    count += score.count;
  });
  const mine = self.scores[questionId];
  if (!count || !mine?.count) return 0;
  return mine.average - total / count;
}

/**
 * 무엇끼리 견줄 것인가.
 *
 * 뜻이 있는 묶음은 지금까지 둘이다 — 한 강사의 지난 수업들, 한 회사의 지난 과정들.
 * 둘 다 묻는 것은 같다: "이번이 평소보다 나은가?" 강사 대 강사, 회사 대 회사는 아직
 * 넣지 않았다. 교육과정이 얼마나 다양해질지 모르는 채로 그런 표를 만들면, 강사가 다른
 * 것인지 교육이 다른 것인지 알 수 없는 숫자를 나란히 놓게 된다.
 */
const SCOPES = [["all", "전체"], ["instructor", "강사별"], ["company", "회사별"]] as const;
type Scope = (typeof SCOPES)[number][0];

/**
 * 질문지별 비교. 표준 질문지를 돌려 쓰기로 한 이유가 이 화면이다 — 과정마다 문항을 새로
 * 쓰면 숫자는 남아도 견줄 수가 없다.
 *
 * 세로가 문항, 가로가 교육이다. 사람이 찾는 것은 '어느 교육이 낮은가'가 아니라 '어느
 * 문항에서 낮은가'이고, 그 답은 한 줄을 옆으로 훑을 때 보인다.
 */
function SurveyCompare() {
  const [templates, setTemplates] = useState<SurveyTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [data, setData] = useState<Comparison | null>(null);
  const [scope, setScope] = useState<Scope>("all");
  const [scopeId, setScopeId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetch("/api/survey-templates")
      .then(async (response) => {
        const result = await response.json() as { templates?: SurveyTemplate[]; error?: string };
        if (!response.ok) throw new Error(result.error || "질문지를 불러오지 못했습니다.");
        const list = result.templates || [];
        setTemplates(list);
        // 처음 열었을 때 빈 표를 보여 주지 않는다 — 실제로 쓰인 질문지를 먼저 고른다.
        const first = list.find((template) => template.usedCount > 0) || list.find((template) => template.is_default) || list[0];
        setTemplateId(first?.id || "");
        if (!first) setLoading(false);
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "질문지를 불러오지 못했습니다.");
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!templateId) return;
    const load = async () => {
      setLoading(true); setError("");
      try {
        const response = await fetch(`/api/survey-templates/${templateId}/compare`);
        const result = await response.json() as Comparison & { error?: string };
        if (!response.ok) throw new Error(result.error || "비교를 불러오지 못했습니다.");
        setData(result);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "비교를 불러오지 못했습니다.");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [templateId]);

  if (loading && !data) return <p className="body-text">불러오는 중</p>;
  if (error) return <p className="body-text">{error}</p>;
  if (!templates.length) {
    return <div className="company-empty"><span><Icon name="survey" size={26} /></span>
      <h2>질문지가 아직 없습니다</h2>
      <p>표준 질문지를 만들고 교육과정에서 골라 쓰면<br />여기에서 교육끼리 견줄 수 있습니다.</p></div>;
  }

  const all = data?.courses || [];

  // 고를 수 있는 것은 '실제로 이 질문지를 쓴' 강사·회사뿐이다. 목록에 없는 이름을 띄우면
  // 눌러 봐야 빈 표가 나온다.
  const groups = (key: "instructor" | "company") => {
    const seen = new Map<string, { id: string; name: string; count: number }>();
    all.forEach((course) => {
      const id = key === "instructor" ? course.instructorId : course.companyId;
      const name = key === "instructor" ? course.instructorName : displayCompanyName(course.companyName);
      if (!id || !name) return;
      const current = seen.get(id) || { id, name, count: 0 };
      current.count += 1;
      seen.set(id, current);
    });
    // 한 번뿐인 강사·회사는 견줄 상대가 없다. 고를 수 있게 두면 한 칸짜리 표가 나온다.
    return [...seen.values()].filter((group) => group.count > 1).sort((left, right) => right.count - left.count);
  };
  const options = scope === "all" ? [] : groups(scope);
  const picked = options.find((group) => group.id === scopeId) || options[0] || null;
  const courses = scope === "all" || !picked
    ? all
    : all.filter((course) => (scope === "instructor" ? course.instructorId : course.companyId) === picked.id);

  /**
   * 기준선은 '지금 보고 있는 것'의 평균이다. 강사를 골랐으면 그 강사의 평균이어야
   * "이번이 평소보다 나은가"에 답이 된다 — 전체 평균을 그대로 두면 강사끼리 견주는
   * 표가 되어 버린다.
   */
  const baseline: Record<string, { average: number; count: number }> = {};
  (data?.axis || []).forEach((question) => {
    let total = 0;
    let count = 0;
    courses.forEach((course) => {
      const score = course.scores[question.id];
      if (!score?.count) return;
      total += score.average * score.count;
      count += score.count;
    });
    baseline[question.id] = { average: count ? Number((total / count).toFixed(2)) : 0, count };
  });
  const scored = courses.filter((course) => course.overall !== null);
  const baselineOverall = scored.length
    ? Number((scored.reduce((sum, course) => sum + (course.overall || 0), 0) / scored.length).toFixed(2))
    : null;
  const baselineLabel = scope === "all" || !picked ? "전체 평균"
    : scope === "instructor" ? `${picked.name} 평균` : `${picked.name} 평균`;

  const answered = courses.filter((course) => course.responded > 0);

  /**
   * 고를 것이 실제로 있을 때만 고르게 한다.
   *
   * 아직 아무 교육도 쓰지 않은 질문지는 눌러 봐야 빈 표다. 쓰인 질문지가 하나뿐이면
   * 고르는 행위 자체가 없다 — 그 한 장이 곧 이 화면이다.
   */
  const usedTemplates = templates.filter((template) => template.usedCount > 0);

  return <div className="compare-block">
    {usedTemplates.length > 1 && <div className="compare-picker" role="group" aria-label="질문지 고르기">
      {usedTemplates.map((template) => <button type="button" key={template.id}
        className={`upload-chip${template.id === templateId ? " lead" : ""}`}
        aria-pressed={template.id === templateId}
        onClick={() => setTemplateId(template.id)}>
        {template.name} <small>{template.usedCount}개 교육</small>
      </button>)}
    </div>}

    {all.length > 0 && <div className="compare-scope">
      <div className="range-switch" role="group" aria-label="비교 기준">
        {SCOPES.map(([value, label]) =>
          <button type="button" key={value} className={scope === value ? "active" : ""} aria-pressed={scope === value}
            onClick={() => { setScope(value); setScopeId(""); }}>{label}</button>)}
      </div>
      {scope !== "all" && (options.length > 0
        ? <label className="compare-scope-pick">
            <span className="sr-only">{scope === "instructor" ? "강사 고르기" : "회사 고르기"}</span>
            <select value={picked?.id || ""} onChange={(event) => setScopeId(event.target.value)}>
              {options.map((group) => <option key={group.id} value={group.id}>
                {group.name} · 교육 {group.count}개
              </option>)}
            </select>
          </label>
        : <span className="action-hint">
            {scope === "instructor" ? "이 질문지로 두 번 이상 진행한 강사가 아직 없습니다." : "이 질문지로 두 번 이상 교육한 회사가 아직 없습니다."}
          </span>)}
    </div>}

    {!data || data.courses.length === 0
      ? <div className="company-empty"><span><Icon name="survey" size={26} /></span>
          <h2>이 질문지를 쓴 교육이 아직 없습니다</h2>
          <p>교육과정에서 이 질문지로 만족도 조사를 만들면<br />여기에 나란히 놓입니다.</p></div>
      : <>
          <div className="survey-metrics">
            <div><dt>교육</dt><dd>{courses.length}개</dd></div>
            <div><dt>응답</dt><dd>{courses.reduce((sum, course) => sum + course.responded, 0)}명</dd></div>
            <div><dt>{baselineLabel}</dt><dd>{baselineOverall === null ? "—" : `${baselineOverall} / 5`}</dd></div>
            <div><dt>문항</dt><dd>{data.axis.length}개</dd></div>
          </div>

          {answered.length === 0
            ? <p className="action-hint">아직 응답이 없습니다. 응답이 들어오면 문항별로 나란히 견줄 수 있습니다.</p>
            : <p className="action-hint">
                같은 줄의 <b>다른 교육들</b>과 {GAP}점 넘게 벌어진 칸을 색으로 표시합니다.
                {baselineLabel} 칸은 지금 보고 있는 교육들의 평균입니다.
              </p>}

          <div className="compare-table">
            <table>
              <thead>
                <tr>
                  <th scope="col">문항</th>
                  <th scope="col" className="compare-overall">{baselineLabel}</th>
                  {courses.map((course) => <th scope="col" key={course.surveyId}>
                    <b>{course.title}</b>
                    <small>{[displayCompanyName(course.companyName), formatDate(course.heldOn)].filter(Boolean).join(" · ")}</small>
                    <small>응답 {course.responded}명{course.invited ? ` / ${course.invited}명` : ""}</small>
                  </th>)}
                </tr>
              </thead>
              <tbody>
                {data.axis.map((question) => {
                  const overall = baseline[question.id];
                  return <tr key={question.id}>
                    <th scope="row">{question.text}</th>
                    <td className="compare-overall">{overall?.count ? overall.average.toFixed(2) : "—"}</td>
                    {courses.map((course) => {
                      const score = course.scores[question.id];
                      if (!score?.count) return <td key={course.surveyId} className="muted">—</td>;
                      const gap = gapFromOthers(courses, course, question.id);
                      return <td key={course.surveyId}
                        className={gap >= GAP ? "compare-better" : gap <= -GAP ? "compare-worse" : ""}>
                        {score.average.toFixed(2)}
                        <i style={{ width: `${(score.average / 5) * 100}%` }} aria-hidden="true" />
                      </td>;
                    })}
                  </tr>;
                })}
                <tr className="compare-foot">
                  <th scope="row">교육 평균</th>
                  <td className="compare-overall">{baselineOverall === null ? "—" : baselineOverall.toFixed(2)}</td>
                  {courses.map((course) => <td key={course.surveyId}>
                    {course.overall === null ? "—" : course.overall.toFixed(2)}
                  </td>)}
                </tr>
              </tbody>
            </table>
          </div>
        </>}
  </div>;
}

/**
 * 문항 줄. 질문지를 처음 만들 때만 쓴다 — PDF 에서 읽어 온 문항이 늘 맞지는 않아서, 저장
 * 전에 한 번은 사람 눈을 거쳐야 한다. 저장한 뒤로는 고치는 자리가 없다.
 */
function QuestionRows({ questions, disabled, onUpdate, onMove, onRemove }: {
  questions: SurveyQuestion[];
  disabled: boolean;
  onUpdate: (index: number, patch: Partial<SurveyQuestion>) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (index: number) => void;
}) {
  // 척도 안내는 문항마다 같은 문장이다. 목록 위에 한 번만 둔다.
  const hasScale = questions.some((question) => question.type === "scale");
  return <div className="survey-questions">
    {hasScale && <p className="survey-hint scale-legend">
      5점 척도 — {SCALE_LABELS.map((label, score) => `${score + 1} ${label}`).join(" · ")}
    </p>}
    {questions.map((question, index) => <article key={question.id} className="survey-edit-row">
      <div className="survey-edit-head">
        <span className="survey-number">{String(index + 1).padStart(2, "0")}</span>
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
    </article>)}
  </div>;
}

/**
 * 한 교육의 만족도 결과. 보는 화면이다 — 문항을 고치거나 다시 보내는 일은 여기 없다
 * (질문지는 만족도 · 표준 질문지에서, 발송은 그 교육과정 화면에서).
 */
function SurveyResult({ surveyId, onBack }: { surveyId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const { ask, confirmDialog } = useConfirm();

  const load = () => fetch(`/api/surveys/${surveyId}`)
    .then(async (response) => {
      const result = await response.json() as Detail & { error?: string };
      if (!response.ok) throw new Error(result.error || "결과를 불러오지 못했습니다.");
      setDetail(result);
    })
    .catch((caught) => setFeedback({ message: caught instanceof Error ? caught.message : "결과를 불러오지 못했습니다.", error: true }));

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

  // 잘못 만든 설문지를 지울 길이 없으면 목록에 영영 남는다. 응답이 들어온 뒤에는 서버가 막는다.
  const remove = async () => {
    const agreed = await ask({
      title: "이 만족도 조사를 지울까요?",
      message: "문항과 발송 기록이 함께 사라집니다. 교육과정에서 다시 만들 수 있습니다.",
      confirmLabel: "지우기", danger: true,
    });
    if (!agreed) return;
    setBusy("remove"); setFeedback(null);
    try {
      const response = await fetch(`/api/surveys/${surveyId}`, { method: "DELETE" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "만족도 조사를 지우지 못했습니다.");
      onBack();
    } catch (caught) {
      setFeedback({ message: caught instanceof Error ? caught.message : "만족도 조사를 지우지 못했습니다.", error: true });
      setBusy("");
    }
  };

  if (!detail) return <section className="workspace-panel">
    <button type="button" className="backbar" onClick={onBack}>← 만족도 목록</button>
    <Feedback value={feedback} onClose={() => setFeedback(null)} />
    <p className="body-text">불러오는 중</p>
  </section>;

  const { summary, invites, course } = detail;
  const status = detail.survey.status;

  return <section className="workspace-panel survey-editor">
    {confirmDialog}
    {importing && <SurveyImportModal
      surveyId={surveyId}
      onClose={() => setImporting(false)}
      onImported={(result) => {
        setImporting(false);
        void load();
        // 몇 칸을 못 읽었는지 조용히 넘기지 않는다 — 평균이 왜 그런지 나중에 물어볼 때 답이 된다.
        const notes = [
          `응답 ${result.imported}명을 들여왔습니다.`,
          result.named ? `이름 ${result.named}명 확인` : "이름 없이 들어왔습니다(익명 조사)",
          result.unreadable ? `못 알아본 칸 ${result.unreadable}개는 건너뛰었습니다` : "",
        ].filter(Boolean);
        setFeedback({ message: notes.join(" · "), error: false });
      }}
    />}
    <button type="button" className="backbar" onClick={onBack}>← 만족도 목록</button>

    <div className="content-title">
      <div>
        <h2>{course.title || detail.survey.title || "만족도 결과"}</h2>
        <p>{[
          displayCompanyName(course.companyName),
          formatDate(course.heldOn, course.startTime, course.durationHours),
          course.instructorName ? `${course.instructorName} 강사` : "",
        ].filter(Boolean).join(" · ")}</p>
        <p className="survey-source">
          {detail.template
            ? <>질문지 <b>{detail.template.name}</b> · 같은 질문지를 쓴 교육과 견줄 수 있습니다</>
            : <>질문지 없이 만든 조사 — 다른 교육과 견주려면 질문지를 골라 다시 만들어 주세요</>}
        </p>
      </div>
      {/* 여기는 답을 보는 자리다. 빈 질문지(종이로 돌리는 것)는 교육과정 화면에 있다 —
          아직 안 보낸 교육에서 인쇄하는 것이지, 결과를 보며 받을 것이 아니다. */}
      <div className="title-actions">
        {/* 현장에서는 구글폼으로 받는다. 그 결과지를 여기서 들여와야 비교·PDF 가 성립한다. */}
        <button type="button" className="upload-chip" onClick={() => setImporting(true)} disabled={Boolean(busy)}>
          <Icon name="upload" size={15} /> 결과지 올리기
        </button>
        <a className="upload-chip lead" href={`/api/surveys/${surveyId}/report`} target="_blank" rel="noreferrer">
          <Icon name="download" size={15} /> 결과 PDF
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
      {status !== "open"
        ? <button type="button" onClick={() => void patch({ status: "open" }, "status")} disabled={Boolean(busy)}>응답 다시 받기</button>
        : <button type="button" onClick={() => void patch({ status: "closed" }, "status")} disabled={Boolean(busy)}>응답 마감</button>}
      {summary.responded === 0 && <button type="button" className="upload-chip danger survey-remove"
        onClick={() => void remove()} disabled={Boolean(busy)}>
        {busy === "remove" ? "지우는 중" : "만족도 조사 지우기"}
      </button>}
    </div>

    {summary.responded === 0
      ? <p className="action-hint">아직 들어온 응답이 없습니다. 현장에서 받은 구글폼 결과지를 올리면 여기에 정리됩니다.</p>
      : <div className="survey-results">
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
