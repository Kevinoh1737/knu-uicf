"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { AX_FOUNDATION_QUESTIONS } from "@/lib/ai/ax-questionnaire";
import {
  CONSULTATION_AUDIO_ACCEPT,
  CONSULTATION_FORMAT_LABEL,
  ConsultationBriefing,
  ConsultationRecord,
  MAX_CONSULTATION_AUDIO_SIZE,
  MAX_CONSULTATION_MINUTES,
  MAX_CONSULTATION_SECONDS,
  MAX_CONSULTATION_SOURCE_SIZE,
  resolveConsultationAudio,
} from "@/lib/consultations";
import { COMPRESSED_MIME_TYPE, compressConsultationAudio, needsCompression, readAudioDuration } from "@/lib/audio/compress";
import { InstructorDetail, InstructorItem, InstructorsPanel } from "./instructors-panel";
import { CompanySessionsTab } from "./company-sessions";
import { LearnersPanel } from "./learners-panel";
import { SurveysPanel } from "./surveys-panel";
import { ProgramDashboard } from "./program-dashboard";
import { displayCompanyName } from "@/lib/company-name";
import { CompanyContactPanel } from "./company-contact";
import { CompanyLearnersTab } from "./company-learners";
import { CompanyContact } from "@/lib/contacts";
import { STAGE_TONE, STALE_AFTER_DAYS, daysSince, heldOnLabel, nextAction, resolveStage, stageLabel } from "@/lib/company-stage";
import { Icon, IconName, formatFileSize, useConfirm, useEscapeClose } from "./ui";

type View = "program" | "companies" | "company" | "instructors" | "instructor" | "learners" | "surveys";

type ResearchReport = {
  companyName: string; industry: string; headline: string; summary: string; keywords: string[]; comparisonTags?: string[];
  business?: { whatTheyDo: string; offerings: string[]; customers: string; workFlow: string };
  glossary?: Array<{ term: string; meaning: string }>;
  educationContext?: { likelyLearners: string[]; currentWork: string; startingPoint: string; caution: string };
  opportunities: Array<{ title: string; detail: string; audience?: string; outcome?: string }>;
  questions: string[];
  evidence: Array<{ claim: string; url: string }>;
};

type CompanyIntelligence = {
  dart?: {
    available: boolean; reason?: string; corpCode?: string; stockCode?: string | null; matchedName?: string; financialSource?: string;
    profile?: { representative?: string; address?: string; industryCode?: string; establishedDate?: string; corporationClass?: string };
    financialYear?: number | null;
    financials?: { revenue?: number | null; operatingProfit?: number | null; netIncome?: number | null; assets?: number | null; liabilities?: number | null };
  };
  recruiting?: {
    available?: boolean; reason?: string; postingCount?: number; itPostingCount?: number; hasInternalItSignal?: boolean;
    itRoles?: string[]; jobAreas?: string[]; caveat?: string;
    postings?: Array<{ source: string; title: string; company: string; jobAreas: string[]; url: string; itSignal: boolean }>;
  };
};

type CompanyItem = {
  id?: string;
  name: string;
  field: string;
  stage: string;
  storedStage?: string;
  sessionCount?: number;
  assignedCount?: number;
  learnerCount?: number;
  consultationCount?: number;
  pastSessionCount?: number;
  deliveredCount?: number;
  cancelledCount?: number;
  nextSession?: { heldOn: string; instructorName: string } | null;
  updatedAt?: string;
  contact?: CompanyContact;
  progress: number;
  date: string;
  color: string;
  websiteUrl?: string;
  research?: ResearchReport;
  intelligence?: CompanyIntelligence;
  crawl?: { pageCount: number; attachmentCount: number; pages: string[]; attachments: string[] };
  researchError?: string;
};

function formatDuration(seconds: number) {
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);
  if (hours && minutes) return `${hours}시간 ${minutes}분`;
  if (hours) return `${hours}시간`;
  return `${Math.max(1, minutes)}분`;
}

function parsePublicWebsite(value?: string) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname.includes(".")) return null;
    return url;
  } catch {
    return null;
  }
}

function compactCopy(value?: string) {
  return (value || "")
    .replace(/하고 있습니다\./g, " 중")
    .replace(/되고 있습니다\./g, " 중")
    .replace(/중입니다\./g, " 중")
    .replace(/하지는 않습니다\./g, "하지 않음")
    .replace(/하지 않습니다\./g, "하지 않음")
    .replace(/지 못했습니다\./g, "지 못함")
    .replace(/했습니다\./g, "")
    .replace(/되었습니다\./g, "")
    .replace(/없습니다\./g, "없음")
    .replace(/있습니다\./g, "있음")
    .replace(/높습니다\./g, "높음")
    .replace(/낮습니다\./g, "낮음")
    .replace(/많습니다\./g, "많음")
    .replace(/적습니다\./g, "적음")
    .replace(/좋습니다\./g, "좋음")
    .replace(/같습니다\./g, "같음")
    .replace(/어렵습니다\./g, "어려움")
    .replace(/쉽습니다\./g, "쉬움")
    .replace(/큽니다\./g, "큼")
    .replace(/작습니다\./g, "작음")
    .replace(/합니다\./g, "")
    .replace(/됩니다\./g, "")
    .replace(/입니다\./g, "")
    .replace(/하였다\./g, "")
    .replace(/했다\./g, "")
    .replace(/한다\./g, "")
    .replace(/된다\./g, "")
    .replace(/이다\./g, "")
    .replace(/있다\./g, "있음")
    .replace(/없다\./g, "없음")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function sanitizeResearchReport(report: ResearchReport): ResearchReport {
  return {
    ...report,
    headline: compactCopy(report.headline),
    summary: compactCopy(report.summary),
    business: report.business ? {
      ...report.business,
      whatTheyDo: compactCopy(report.business.whatTheyDo),
      customers: compactCopy(report.business.customers),
      workFlow: compactCopy(report.business.workFlow),
    } : undefined,
    glossary: (report.glossary || []).map(item => ({ ...item, meaning: compactCopy(item.meaning) })),
    educationContext: report.educationContext ? {
      ...report.educationContext,
      currentWork: compactCopy(report.educationContext.currentWork),
      startingPoint: compactCopy(report.educationContext.startingPoint),
      caution: compactCopy(report.educationContext.caution),
    } : undefined,
    opportunities: (report.opportunities || []).map(item => ({ ...item, detail: compactCopy(item.detail), outcome: compactCopy(item.outcome) })),
    evidence: (report.evidence || []).filter(item => Boolean(parsePublicWebsite(item.url))).map(item => ({ ...item, claim: compactCopy(item.claim) })),
  };
}

function sanitizeCompanyIntelligence(intelligence?: CompanyIntelligence): CompanyIntelligence | undefined {
  if (!intelligence) return undefined;
  return {
    ...intelligence,
    dart: intelligence.dart ? { ...intelligence.dart, reason: compactCopy(intelligence.dart.reason) } : undefined,
    recruiting: intelligence.recruiting ? { ...intelligence.recruiting, reason: compactCopy(intelligence.recruiting.reason), caveat: compactCopy(intelligence.recruiting.caveat) } : undefined,
  };
}

function findSimilarCompanies(company: CompanyItem, companies: CompanyItem[] = []) {
  const currentIndustry = (company.research?.industry || company.field || "").toLowerCase();
  const currentKeywords = new Set((company.research?.comparisonTags || company.research?.keywords || []).map(value => value.toLowerCase()));
  return (companies || [])
    .filter(candidate => candidate.research && (candidate.id || candidate.name) !== (company.id || company.name))
    .map(candidate => {
      const candidateIndustry = (candidate.research?.industry || candidate.field || "").toLowerCase();
      const sharedKeywords = (candidate.research?.comparisonTags || candidate.research?.keywords || []).filter(value => currentKeywords.has(value.toLowerCase()));
      const sameIndustry = Boolean(currentIndustry && candidateIndustry && (currentIndustry.includes(candidateIndustry) || candidateIndustry.includes(currentIndustry)));
      return {
        company: candidate,
        score: (sameIndustry ? 4 : 0) + sharedKeywords.length,
        reason: sharedKeywords.length ? `공통 분야 · ${sharedKeywords.slice(0, 2).join(", ")}` : sameIndustry ? `${candidate.field} 분야` : "",
      };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

const nav = [
  { id: "companies" as View, icon: "building" as IconName, label: "기업" },
  { id: "instructors" as View, icon: "person" as IconName, label: "강사" },
  { id: "learners" as View, icon: "survey" as IconName, label: "수강생" },
  { id: "surveys" as View, icon: "chart" as IconName, label: "만족도" },
];

/** 아직 만들지 않은 사업. 시연에서 "무엇이 예정인지"를 보여 주는 용도다. */
const UPCOMING_NAV: Array<{ icon: IconName; label: string }> = [
  { icon: "building", label: "참여기업" },
  { icon: "person", label: "참여청년" },
  { icon: "calendar", label: "프로젝트" },
];

function Brand() {
  return <div className="brand"><Image className="official-logo" src="/knu-uicf-logo.png" width={96} height={103} priority alt="강원대학교 산학협력단 UICF" /><span className="team-name">교육사업팀</span></div>;
}

function SignOutButton() {
  const [signingOut, setSigningOut] = useState(false);
  const signOut = async () => {
    setSigningOut(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.replace("/login");
  };
  return <button type="button" className="signout" onClick={signOut} disabled={signingOut}>{signingOut ? "종료 중" : "로그아웃"}</button>;
}

function SideNav({ view, setView }: { view: View; setView: (v: View) => void }) {
  return <aside className="sidebar">
    <Brand />
    <nav aria-label="주 메뉴">
      {/* 사업 단위로 묶는다. 지금 만든 것은 전부 K-하이테크 플랫폼 사업이고,
          미래내일 일경험 사업은 프로그램 구조가 달라 따로 만든다 — 자리만 보여 준다. */}
      {/* 사업 이름 자체가 그 사업의 대시보드다 — 아래 메뉴가 '무엇을 관리하나'라면,
          여기는 '지금 무엇이 돌아가나'다. */}
      <button type="button" className={view === "program" ? "nav-label program active" : "nav-label program"}
        onClick={() => setView("program")}>K-하이테크 플랫폼 사업</button>
      {nav.map((item) => <button key={item.id} className={view === item.id || (view === "company" && item.id === "companies") || (view === "instructor" && item.id === "instructors") ? "nav-item active" : "nav-item"} onClick={() => setView(item.id)}><span><Icon name={item.icon} /></span>{item.label}</button>)}
      <p className="nav-label program second">미래내일 일경험 사업<em>준비 중</em></p>
      {/* 자리만 잡아 둔다. 확인된 구성(참여기업이 과제를 내고, 청년이 지원·선발되고,
          8주 프로젝트가 돌아간다)에 맞춰 이름만 박아 둔 것이고 화면은 아직 없다. */}
      {UPCOMING_NAV.map((item) => <button type="button" key={item.label} className="nav-item upcoming" disabled aria-disabled="true">
        <span><Icon name={item.icon} /></span>{item.label}
      </button>)}
    </nav>
    <div className="profile"><small>Powered by Synthya</small><SignOutButton /></div>
  </aside>;
}

function Header({ view, onNew, selectedCompany, selectedInstructorName, contactSignal, onContactSaved }: { view: View; onNew: () => void; selectedCompany: CompanyItem; selectedInstructorName: string; contactSignal?: number; onContactSaved?: (companyId: string, contact: CompanyContact) => void }) {
  const titles: Record<View, [string, string]> = {
    program: ["K-하이테크 플랫폼 사업", "월·주 단위 교육 일정과 진행 현황"],
    companies: ["기업", "기업 조사와 교육 진행 상황"],
    company: [displayCompanyName(selectedCompany.name), [selectedCompany.field, parsePublicWebsite(selectedCompany.websiteUrl)?.host].filter(Boolean).join(" · ")],
    instructors: ["강사", "강사 프로필과 강의 이력"],
    instructor: [selectedInstructorName || "강사", "강사 프로필과 강의 이력"],
    learners: ["수강생", "참석자 명단과 수강 이력"],
    surveys: ["만족도", "교육과정별 만족도 조사와 결과"],
  };
  // 새 기업 조사는 목록에서 하는 일이다. 특정 기업 안에 들어와 있을 때는 맥락이 어긋난다.
  const showNew = view === "companies";
  return <header className="topbar"><div><h1>{titles[view][0]}{view === "company" && selectedCompany.stage && <span className={`stage ${STAGE_TONE[resolveStage(selectedCompany.storedStage, selectedCompany.sessionCount || 0, selectedCompany.assignedCount || 0)]}`}>{selectedCompany.stage}</span>}</h1>{titles[view][1] && <p>{titles[view][1]}</p>}</div><div className="header-actions">{view === "company" && selectedCompany.id && <CompanyContactPanel key={`${selectedCompany.id}-${contactSignal || 0}`} companyId={selectedCompany.id} initial={selectedCompany.contact} openSignal={contactSignal} onSaved={(contact) => onContactSaved?.(selectedCompany.id!, contact)} />}{showNew && <button className="primary" onClick={onNew}><span><Icon name="plus" size={16}/></span>새 기업 조사</button>}</div></header>;
}

/**
 * 목록 카드. 이름과 상태만으로는 '어느 회사를 먼저 열어야 하나'에 답하지 못한다 — 조사만
 * 끝난 회사가 여럿이면 배지가 전부 같기 때문이다. 그래서 두 줄을 더 둔다:
 * 다음에 할 일(또는 잡힌 교육일)과, 규모·담당자.
 *
 * 두 줄 모두 한 줄로 잘라 낸다. 글자 수에 따라 카드 높이가 달라지면 배지와 휴지통 위치가
 * 카드마다 어긋나 보인다 — 이미 한 번 겪은 문제다.
 */
function CompanyCard({ company, onOpen, onDelete, deleting }: { company: CompanyItem; onOpen: (company: CompanyItem, intent?: "contact") => void; onDelete: (company: CompanyItem) => void; deleting: boolean }) {
  const sessionCount = company.sessionCount || 0;
  const assignedCount = company.assignedCount || 0;
  const delivered = company.deliveredCount || 0;
  const cancelled = company.cancelledCount || 0;
  const stage = resolveStage(company.storedStage, sessionCount, assignedCount, delivered, cancelled);
  const name = displayCompanyName(company.name);

  // 교육이 잡혀 있으면 날짜가 가장 급한 정보다. 없으면 다음에 할 일을 보여 준다.
  const upcoming = company.nextSession?.heldOn ? heldOnLabel(company.nextSession.heldOn) : "";
  const primary = upcoming
    ? [upcoming, company.nextSession?.instructorName ? `${company.nextSession.instructorName} 강사` : ""].filter(Boolean).join(" · ")
    : nextAction(company.storedStage, {
        questionCount: company.research?.questions?.length || 0,
        consultationCount: company.consultationCount || 0,
        pastSessionCount: company.pastSessionCount || 0,
        sessionCount, assignedCount,
      });

  // 정체 표시는 아직 할 일이 남은 회사에만 의미가 있다. 끝났거나 취소된 건, 그리고 이미
  // 일정이 잡힌 건은 조용한 것이 정상이다.
  const idleDays = daysSince(company.updatedAt);
  const stale = !upcoming && stage !== "training_complete" && stage !== "cancelled"
    && idleDays !== null && idleDays >= STALE_AFTER_DAYS;

  const contactName = [company.contact?.name, company.contact?.position].filter(Boolean).join(" ");
  const counts = [
    sessionCount > 0 ? `과정 ${sessionCount}` : "",
    (company.learnerCount || 0) > 0 ? `수강생 ${company.learnerCount}` : "",
  ].filter(Boolean).join(" · ");

  // 담당자 칸은 읽는 곳이 아니라 누르는 곳이다. 비어 있으면 등록하러, 채워져 있으면 고치러
  // 간다. 버튼 안에 버튼을 둘 수 없어 카드 본문(열기 버튼) 밖으로 뺐다.
  return <article className="company-card">
    <button type="button" className="company-card-open" onClick={() => onOpen(company)} aria-label={`${name} 조사 결과 열기`}>
      <div className="company-card-heading">
        <h3>{name}</h3>
        <span className={`stage ${STAGE_TONE[stage]}`}>{stageLabel(company.storedStage, sessionCount, assignedCount, delivered, cancelled)}</span>
      </div>
      <p>{company.field}</p>
      <p className="company-card-next">
        <b>{primary}</b>
        {stale && <span className="stale">{idleDays}일째 멈춤</span>}
      </p>
    </button>
    {/* 휴지통도 이 줄에 둔다. 따로 띄워 놓으면 담당자 줄과 높이가 어긋나고, 그 어긋남을
        맞추려 카드에 여백을 더하게 된다. */}
    <div className="company-card-meta">
      {counts && <span className="counts">{counts}</span>}
      <button type="button" className={`contact-chip${contactName ? "" : " empty"}`} onClick={() => onOpen(company, "contact")}
        aria-label={contactName ? `${name} 담당자 ${contactName} 수정` : `${name} 담당자 등록`}>
        {contactName || "담당자 등록"}
      </button>
      <button type="button" className="company-card-delete" onClick={() => onDelete(company)} aria-label={`${name} 삭제`} title="삭제" disabled={!company.id || deleting}>
        {deleting ? <i className="spinner" aria-hidden="true"/> : <Icon name="trash" size={18}/>}
      </button>
    </div>
  </article>;
}

function Companies({ companyItems, onSelectCompany, onCompanyDeleted }: { companyItems: CompanyItem[]; onSelectCompany: (company: CompanyItem, intent?: "contact") => void; onCompanyDeleted: (id: string) => void }) {
  const [deletingId, setDeletingId] = useState("");
  const [deleteFeedback, setDeleteFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const { ask, confirmDialog } = useConfirm();
  const deleteCompany = async (company: CompanyItem) => {
    if (!company.id) return;
    const agreed = await ask({
      title: `‘${displayCompanyName(company.name)}’ 기업을 삭제할까요?`,
      message: "저장된 조사 결과도 함께 사라집니다.",
      confirmLabel: "삭제", danger: true,
    });
    if (!agreed) return;
    setDeletingId(company.id); setDeleteFeedback(null);
    try {
      const response = await fetch(`/api/companies/${encodeURIComponent(company.id)}`, { method: "DELETE" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "기업을 삭제하지 못했습니다.");
      onCompanyDeleted(company.id);
      setDeleteFeedback({ message: `${displayCompanyName(company.name)} 삭제 완료`, error: false });
      window.setTimeout(() => setDeleteFeedback(null), 2400);
    } catch (error) {
      setDeleteFeedback({ message: error instanceof Error ? error.message : "기업을 삭제하지 못했습니다.", error: true });
    } finally {
      setDeletingId("");
    }
  };
  return <section className="workspace-panel">{confirmDialog}{deleteFeedback&&<span className={`company-action-message${deleteFeedback.error?" error":""}`} role={deleteFeedback.error?"alert":"status"}>{deleteFeedback.message}</span>}{companyItems.length === 0 ? <div className="company-empty"><span><Icon name="building" size={26}/></span><h2>아직 조사한 기업이 없습니다</h2><p>오른쪽 위 <b>새 기업 조사</b>에서 홈페이지를 넣으면<br/>웹사이트·공시·채용정보를 함께 읽습니다.</p></div> : <><div className="toolbar"><div className="searchbox"><Icon name="search" size={17}/><input aria-label="기업 검색" placeholder="기업명 또는 산업으로 검색" /></div></div><div className="company-cards">{companyItems.map((c) => <CompanyCard key={c.id || c.name} company={c} onOpen={onSelectCompany} onDelete={deleteCompany} deleting={deletingId === c.id}/>)}</div></>}
  </section>;
}

function CompanyDetail({ company, companies, onSelectCompany, onDataChanged }: { company: CompanyItem; companies: CompanyItem[]; onSelectCompany: (company: CompanyItem) => void; onDataChanged?: () => void }) {
  const [tab, setTab] = useState("research");
  // 탭 표시에 쓰는 숫자. 탭을 열기 전에도 보여야 해서 상세 진입 시 한 번 읽는다.
  const [summary, setSummary] = useState({ consultations: 0, sessions: 0, learners: 0 });
  // 탭 안에서 자료가 바뀌면 배지도 따라와야 한다. 탭 전환만으로 다시 읽으면
  // 방금 올린 명단이 숫자에 반영되지 않는다.
  const [dataVersion, setDataVersion] = useState(0);
  useEffect(() => {
    if (!company.id) return;
    let alive = true;
    void Promise.all([
      fetch(`/api/companies/${company.id}/sessions`).then(response => response.ok ? response.json() : null).catch(() => null),
      fetch(`/api/learners?companyId=${company.id}`).then(response => response.ok ? response.json() : null).catch(() => null),
    ]).then(([sessionsResult, learnersResult]) => {
      if (!alive) return;
      setSummary({
        consultations: sessionsResult?.progress?.consultationCount || 0,
        sessions: (sessionsResult?.sessions || []).filter((item: { status?: string }) => item.status !== "cancelled").length,
        learners: (learnersResult?.learners || []).length,
      });
    });
    return () => { alive = false; };
    // 탭 전환은 숫자를 바꾸지 않는다. 바뀌는 것은 자료를 손댔을 때뿐이고 그것은 dataVersion
    // 이 잡는다 — tab 을 넣어 두면 탭을 오갈 때마다 같은 두 요청이 다시 나간다.
  }, [company.id, dataVersion]);
  const [questions, setQuestions] = useState(company.research?.questions?.length ? company.research.questions : [...AX_FOUNDATION_QUESTIONS]);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [exportState, setExportState] = useState<"idle" | "pdf" | "xlsx" | "error">("idle");
  const [exportMessage, setExportMessage] = useState("");
  const [draggingQuestion, setDraggingQuestion] = useState<number | null>(null);
  const [dragInsertAt, setDragInsertAt] = useState<number | null>(null);
  const [reorderMessage, setReorderMessage] = useState("");
  const dragFromRef = useRef<number | null>(null);
  const dragInsertRef = useRef<number | null>(null);
  const addQuestion = () => {
    setQuestions([...questions, "새 질문"]);
    setSaveState("idle");
  };
  const reorderQuestion = (from: number, to: number, focusMovedQuestion = false) => {
    if (from === to || from < 0 || to < 0 || from >= questions.length || to >= questions.length) return;
    setQuestions((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setSaveState("idle");
    setReorderMessage(`${from + 1}번 질문을 ${to + 1}번 위치로 이동했습니다.`);
    if (focusMovedQuestion) requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-question-index="${to}"] .question-grip`)?.focus());
  };
  const questionInsertionAtPoint = (y: number) => {
    const items = Array.from(document.querySelectorAll<HTMLElement>(".questions > article[data-question-index]"));
    if (!items.length) return null;
    for (const item of items) {
      const index = Number(item.dataset.questionIndex);
      const bounds = item.getBoundingClientRect();
      if (Number.isInteger(index) && y < bounds.top + bounds.height / 2) return index;
    }
    return items.length;
  };
  const dropQuestionAt = (from: number, insertion: number) => {
    const to = insertion > from ? insertion - 1 : insertion;
    reorderQuestion(from, to);
  };
  const startQuestionDrag = (event: React.PointerEvent<HTMLButtonElement>, index: number) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragFromRef.current = index;
    dragInsertRef.current = null;
    setDraggingQuestion(index);
    setDragInsertAt(null);
  };
  const moveQuestionDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (dragFromRef.current === null) return;
    event.preventDefault();
    const insertion = questionInsertionAtPoint(event.clientY);
    if (insertion === null || insertion === dragInsertRef.current) return;
    dragInsertRef.current = insertion;
    setDragInsertAt(insertion);
  };
  const endQuestionDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const from = dragFromRef.current;
    const insertionAtRelease = questionInsertionAtPoint(event.clientY);
    const insertion = insertionAtRelease ?? dragInsertRef.current;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragFromRef.current = null;
    dragInsertRef.current = null;
    setDraggingQuestion(null);
    setDragInsertAt(null);
    if (from !== null && insertion !== null) dropQuestionAt(from, insertion);
  };
  const cancelQuestionDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragFromRef.current = null;
    dragInsertRef.current = null;
    setDraggingQuestion(null);
    setDragInsertAt(null);
  };
  const saveQuestions = async () => {
    if (!company.id) return;
    setSaveState("saving");
    const response = await fetch(`/api/companies/${company.id}/questions`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ questions }) });
    setSaveState(response.ok ? "saved" : "error");
    if (response.ok) onDataChanged?.();
  };
  const downloadExport = async (kind: "pdf" | "xlsx") => {
    setExportState(kind);
    setExportMessage("");
    try {
      const similarCompanies = findSimilarCompanies(company, companies).map(item => ({
        name: displayCompanyName(item.company.name),
        reason: item.reason,
        headline: item.company.research?.headline || "",
      }));
      const response = await fetch(kind === "pdf" ? "/api/exports/company-report" : "/api/exports/questionnaire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kind === "pdf"
          ? { company: { ...company, name: displayCompanyName(company.name) }, similarCompanies }
          : { companyName: displayCompanyName(company.name), questions }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(error?.error || "파일을 만들지 못했습니다.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${displayCompanyName(company.name)}_${kind === "pdf" ? "기업조사" : "니즈질문지"}.${kind === "pdf" ? "pdf" : "xlsx"}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportState("idle");
      setExportMessage(`${kind === "pdf" ? "PDF" : "Excel"} 다운로드 완료`);
    } catch (error) {
      setExportState("error");
      setExportMessage(error instanceof Error ? error.message : "파일을 만들지 못했습니다.");
    }
  };
  return <section className="company-detail">
    {/* 어떤 단계가 끝났는지 탭에서 바로 보인다. 개수가 의미 있는 곳(교육과정·수강생)만 숫자를 쓴다. */}
    <div className="detail-tabs">{([
      ["research", "기업 조사", Boolean(company.research), ""],
      ["questions", "니즈 질문지", questions.length > 0, ""],
      ["consultation", "상담 기록", summary.consultations > 0, ""],
      ["sessions", "교육 진행", summary.sessions > 0, summary.sessions ? String(summary.sessions) : ""],
      ["learners", "수강생", summary.learners > 0, summary.learners ? String(summary.learners) : ""],
    ] as Array<[string, string, boolean, string]>).map(([id, label, done, count]) =>
      <button className={tab === id ? "active" : ""} onClick={() => setTab(id)} key={id}>
        {done && <i className="tab-done" aria-hidden="true">✓</i>}{label}{count && <em>{count}</em>}
      </button>)}</div>
    {tab === "research" && <ResearchTab company={company} companies={companies} onSelectCompany={onSelectCompany}
      exportSlot={company.research ? <ExportButton label="조사 결과 PDF" busy={exportState === "pdf"} message={exportState === "pdf" || exportState === "error" ? exportMessage : ""} error={exportState === "error"} onClick={() => downloadExport("pdf")} /> : null} />}
    {tab === "questions" && <section className="tab-content questions"><div className="content-title"><div><h2>니즈 질문지</h2><p>상담에서 물어볼 질문</p></div><div className="title-actions"><ExportButton label="질문지 Excel" busy={exportState === "xlsx"} disabled={!questions.length} message={exportState === "xlsx" || exportState === "error" ? exportMessage : ""} error={exportState === "error"} onClick={() => downloadExport("xlsx")} /><button onClick={addQuestion}>＋ 질문 추가</button></div></div>{questions.map((q,i)=><article key={i} data-question-index={i} className={[draggingQuestion === i && "dragging",draggingQuestion !== null && dragInsertAt === i && "drop-before",draggingQuestion !== null && dragInsertAt === questions.length && i === questions.length-1 && "drop-after"].filter(Boolean).join(" ")}><button type="button" className="question-grip" aria-label={`${i+1}번 질문 순서 이동`} title="드래그하여 순서 변경" onPointerDown={(event)=>startQuestionDrag(event,i)} onPointerMove={moveQuestionDrag} onPointerUp={endQuestionDrag} onPointerCancel={cancelQuestionDrag} onKeyDown={(event)=>{if(event.key === "ArrowUp" && i > 0){event.preventDefault();reorderQuestion(i,i-1,true);}else if(event.key === "ArrowDown" && i < questions.length-1){event.preventDefault();reorderQuestion(i,i+1,true);}}}><Icon name="grip" size={20}/></button><span>{String(i+1).padStart(2,"0")}</span><textarea rows={1} aria-label={`${i+1}번 질문`} value={q} onChange={(e)=>{setQuestions(questions.map((x,j)=>j===i?e.target.value:x));setSaveState("idle");}}/><button type="button" className="question-delete" aria-label={`${i+1}번 질문 삭제`} onClick={()=>{setQuestions(questions.filter((_,j)=>j!==i));setSaveState("idle");}}>×</button></article>)}<span className="sr-only" role="status" aria-live="polite">{reorderMessage}</span><div className="savebar"><span className={saveState === "error" ? "save-error" : ""}>{saveState === "saving" ? "저장 중…" : saveState === "saved" ? "저장 완료" : saveState === "error" ? "저장 실패 · 다시 시도" : "수정 후 저장"}</span><button onClick={saveQuestions} disabled={!company.id || saveState === "saving"}>{saveState === "saving" ? "저장 중…" : "질문지 저장"}</button></div></section>}
    {tab === "consultation" && <ConsultingTab company={company} onDataChanged={() => { setDataVersion(current => current + 1); onDataChanged?.(); }} />}
    {/* 탭 배지(이 화면)와 목록 카드(바깥)가 같은 사건을 보고 함께 움직인다 — 교육과정을
        만들거나 수강생을 넣으면 카드의 단계와 '다음 할 일'도 달라진다. */}
    {tab === "sessions" && company.id && <CompanySessionsTab companyId={company.id} onDataChanged={() => { setDataVersion(current => current + 1); onDataChanged?.(); }} />}
    {tab === "learners" && company.id && <CompanyLearnersTab companyId={company.id} companyName={displayCompanyName(company.name)} onDataChanged={() => { setDataVersion(current => current + 1); onDataChanged?.(); }} />}
  </section>;
}

/**
 * 내보내기는 탭 안에 둔다. 히어로에 두면 탭과 무관하게 떠 있는데 내용은 탭마다 달라서,
 * 교육 진행 탭에서 누르면 니즈 질문지 엑셀이 내려오는 일이 생겼다.
 */
function ExportButton({ label, busy, disabled, message, error, onClick }: {
  label: string; busy: boolean; disabled?: boolean; message?: string; error?: boolean; onClick: () => void;
}) {
  return <div className="hero-export">
    <button type="button" className="export-button" onClick={onClick} disabled={busy || disabled}>
      {busy ? <i className="spinner" aria-hidden="true"/> : <Icon name="download" size={17}/>}
      <span>{busy ? "파일 준비 중" : label}</span>
    </button>
    {message && <small className={error ? "error" : ""} role={error ? "alert" : "status"}>{message}</small>}
  </div>;
}

function ResearchTab({ company, companies, onSelectCompany, exportSlot }: { company: CompanyItem; companies: CompanyItem[]; onSelectCompany: (company: CompanyItem) => void; exportSlot?: React.ReactNode }) {
  if (!company.research) return <section className="tab-content research"><div className="research-empty"><span>!</span><h2>조사 결과 없음</h2><p>{company.researchError || "홈페이지 재입력 필요"}</p></div></section>;
  const report = company.research;
  const business = report.business;
  const education = report.educationContext;
  const similarCompanies = findSimilarCompanies(company, companies);
  const dart = company.intelligence?.dart;
  const recruiting = company.intelligence?.recruiting;
  const won = (value?: number | null) => value == null ? "확인되지 않음" : `${new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 }).format(value)}원`;
  const date = (value?: string) => value?.length === 8 ? `${value.slice(0, 4)}.${value.slice(4, 6)}.${value.slice(6, 8)}` : value || "확인되지 않음";
  return <section className="tab-content research research-understanding">
    <article className="company-brief">
      {/* 내보내기를 별도 줄로 두면 빈 띠가 하나 더 생긴다. 이미 있는 머리 줄에 얹는다. */}
      <div className="brief-head"><small>한눈에 이해하기</small>{exportSlot}</div>
      <h2>{report.headline}</h2>
      <p>{report.summary}</p>
      <div className="chips">{report.keywords.map(keyword => <span key={keyword}>{keyword}</span>)}</div>
    </article>

    <section className="research-section">
      <div className="research-section-title"><span>01</span><div><h2>무엇을 하는 회사인가요?</h2><p>제품, 고객, 업무 흐름을 쉬운 말로 정리</p></div></div>
      <div className="business-explainer" style={{ gridTemplateColumns: "repeat(2,minmax(0,1fr))" }}>
        <article><small>하는 일</small><h3>{business?.whatTheyDo || report.headline}</h3></article>
        <article><small>제품·서비스</small>{business?.offerings?.length ? <ul>{business.offerings.map(item => <li key={item}>{item}</li>)}</ul> : <p>{report.keywords.join(" · ") || "확인 필요"}</p>}</article>
        <article><small>주요 고객</small><p>{business?.customers || "공개 자료에서 확인 필요"}</p></article>
        <article><small>업무 흐름</small><p>{business?.workFlow || "상담에서 확인 필요"}</p></article>
      </div>
      {!!report.glossary?.length && <div className="plain-glossary"><b>알아두면 좋은 용어</b>{report.glossary.map(item => <div key={item.term}><span>{item.term}</span><p>{item.meaning}</p></div>)}</div>}
    </section>

    <section className="research-section">
      <div className="research-section-title"><span>02</span><div><h2>교육을 준비할 때 볼 점</h2><p>업무와 인력 정보를 교육 관점으로 정리</p></div></div>
      {education && <div className="education-context">
        <article><small>예상 교육 대상</small><div className="role-list">{education.likelyLearners.map(item => <span key={item}>{item}</span>)}</div></article>
        <article><small>현재 업무 환경</small><p>{education.currentWork}</p></article>
        <article><small>권장 시작점</small><p>{education.startingPoint}</p></article>
        <article><small>상담에서 확인</small><p>{education.caution}</p></article>
      </div>}
      <div className="education-opportunities">{report.opportunities.map((item, index) => <article key={item.title}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{item.title}</h3><p>{item.detail}</p>{(item.audience || item.outcome) && <small>{item.audience && `대상 · ${item.audience}`}{item.audience && item.outcome && "  |  "}{item.outcome && `교육 후 · ${item.outcome}`}</small>}</div></article>)}</div>
    </section>

    {similarCompanies.length > 0 && <section className="research-section">
      <div className="research-section-title"><span>03</span><div><h2>기존 조사 기업과 비교</h2><p>비슷한 기업의 조사 결과를 함께 참고</p></div></div>
      <div className="similar-company-list">{similarCompanies.map(item => <button type="button" key={item.company.id || item.company.name} onClick={() => onSelectCompany(item.company)}><b>{displayCompanyName(item.company.name)}</b><span>{item.reason}</span><small>{item.company.research?.headline}</small></button>)}</div>
    </section>}

    <details className="research-additional">
      <summary><div><b>추가 기업 정보</b><span>공시·채용·출처 자료</span></div><i aria-hidden="true">＋</i></summary>
      <div className="additional-body">
        {company.intelligence && <div className="intelligence-grid">
          <article>
            <div className="intel-head"><div><small>공시자료</small><h3>회사 기본·재무 정보</h3></div><span className={dart?.available ? "verified" : "unavailable"}>{dart?.available ? "확인" : "자료 없음"}</span></div>
            {dart?.available ? <><dl><div><dt>대표이사</dt><dd>{dart.profile?.representative || "확인 필요"}</dd></div><div><dt>설립일</dt><dd>{date(dart.profile?.establishedDate)}</dd></div><div><dt>본점 주소</dt><dd>{dart.profile?.address || "확인 필요"}</dd></div><div><dt>업종 코드</dt><dd>{dart.profile?.industryCode || "확인 필요"}</dd></div></dl>{dart.financialYear ? <div className="finance-row"><span><small>{dart.financialYear} 매출</small><b>{won(dart.financials?.revenue)}</b></span><span><small>영업이익</small><b>{won(dart.financials?.operatingProfit)}</b></span><span><small>자산</small><b>{won(dart.financials?.assets)}</b></span></div> : <p className="intel-empty">{dart.reason || "공시 재무 수치 없음"}</p>}{(dart.matchedName || dart.financialSource) && <p className="intel-note">{[dart.matchedName && `공시 상호 ${dart.matchedName}`, dart.financialSource && `재무 출처 ${dart.financialSource}`].filter(Boolean).join(" · ")}</p>}</> : <p className="intel-empty">{dart?.reason || "일치 기업 없음"}</p>}
          </article>
          <article>
            <div className="intel-head"><div><small>공개 채용정보</small><h3>조직·IT 인력 단서</h3></div><span className={recruiting?.hasInternalItSignal ? "verified" : "unavailable"}>{recruiting?.hasInternalItSignal ? "IT 채용 확인" : "확인 필요"}</span></div>
            <div className="recruit-summary"><span><b>{recruiting?.postingCount || 0}</b><small>공개 공고</small></span><span><b>{recruiting?.itPostingCount || 0}</b><small>IT 공고</small></span></div>
            {recruiting?.itRoles?.length ? <div className="role-list">{recruiting.itRoles.map(role => <span key={role}>{role}</span>)}</div> : <p className="intel-empty">공개 IT 채용 공고 없음 · 내부 인력은 확인 필요</p>}
            {recruiting?.caveat && <p className="intel-caveat">{recruiting.caveat}</p>}
          </article>
        </div>}
        <div className="evidence-list"><b>확인한 출처</b>{report.evidence.map((item, index) => <a href={item.url} target="_blank" rel="noreferrer" key={`${item.url}-${index}`}>{item.claim}<span>{new URL(item.url).hostname} ↗</span></a>)}</div>
      </div>
    </details>
  </section>;
}

/**
 * What no single consultation can show: how the picture moved between sessions. `changes` leads
 * because a headcount or schedule that shifted since the first call is what silently breaks a plan.
 */
function BriefingPanel({ briefing, building, sessionCount }: { briefing: ConsultationBriefing | null; building: boolean; sessionCount: number }) {
  if (building && !briefing) return <section className="briefing building" role="status" aria-live="polite"><i className="spinner" aria-hidden="true"/><span>상담 {sessionCount}건을 합쳐 정리하는 중</span></section>;
  if (!briefing) return null;
  return <section className={`briefing${building ? " building" : ""}`}>
    <div className="briefing-head">
      <div><small>통합 브리핑</small><h3>상담 {briefing.sourceIds.length}건을 합친 결과</h3></div>
      {building && <span className="briefing-refresh"><i className="spinner" aria-hidden="true"/>갱신 중</span>}
    </div>
    {briefing.overview && <p className="briefing-overview">{briefing.overview}</p>}
    {briefing.changes.length > 0 && <div className="briefing-changes"><b>상담 사이에 달라진 점</b><ul>{briefing.changes.map((item) => <li key={item}>{item}</li>)}</ul></div>}
    <NeedList title="핵심 니즈" needs={briefing.keyNeeds} />
    <div className="insight-row two">
      <article><small>교육 대상</small><b>{briefing.audience.headline}</b><p>{briefing.audience.detail}</p></article>
      <article><small>운영 제약</small><b>{briefing.constraints[0] || "확인 필요"}</b><p>{briefing.constraints.slice(1).join(" · ") || "추가 제약 없음"}</p></article>
    </div>
    <div className="consultation-details">
      <article><h3>회차별 요점</h3>{briefing.sessions.length ? <ul>{briefing.sessions.map((item) => <li key={item.label}><b>{item.label}</b> {item.gist}</li>)}</ul> : <p>회차별 요점 없음</p>}</article>
      <article><h3>합의사항</h3>{briefing.decisions.length ? <ul>{briefing.decisions.map((item) => <li key={item}>{item}</li>)}</ul> : <p>확인된 합의사항 없음</p>}</article>
      <article><h3>다음 상담에서 확인</h3>{briefing.openQuestions.length ? <ul>{briefing.openQuestions.map((item) => <li key={item}>{item}</li>)}</ul> : <p>추가 질문 없음</p>}</article>
    </div>
  </section>;
}

/** Every need, not just the first: the analysis routinely returns three and only one used to be shown. */
function NeedList({ title, needs }: { title: string; needs?: Array<{ title: string; detail: string }> }) {
  if (!needs?.length) return <article className="need-list empty"><small>{title}</small><p>상담 내용에서 확인되지 않음</p></article>;
  return <article className="need-list">
    <small>{title}</small>
    <ol>{needs.map((need, index) => <li key={`${need.title}-${index}`}><b>{need.title}</b><p>{need.detail}</p></li>)}</ol>
  </article>;
}

function ConsultingTab({ company, onDataChanged }: { company: CompanyItem; onDataChanged?: () => void }) {
  type ProcessState = "idle" | "compressing" | "uploading" | "transcribing";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [records, setRecords] = useState<ConsultationRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [processState, setProcessState] = useState<ProcessState>("idle");
  const [compressRatio, setCompressRatio] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [error, setError] = useState("");
  const [briefing, setBriefing] = useState<ConsultationBriefing | null>(null);
  const [briefingState, setBriefingState] = useState<"idle" | "building">("idle");
  const [deletingId, setDeletingId] = useState("");
  const { ask, confirmDialog } = useConfirm();

  useEffect(() => {
    if (!company.id) return;
    const controller = new AbortController();
    fetch(`/api/companies/${company.id}/consultations`, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as { consultations?: ConsultationRecord[]; briefing?: ConsultationBriefing | null; error?: string };
        if (!response.ok) throw new Error(result.error || "상담 기록을 불러오지 못했습니다.");
        const next = result.consultations || [];
        setRecords(next);
        setBriefing(result.briefing || null);
        setSelectedId((current) => current || next[0]?.id || "");
      })
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "상담 기록을 불러오지 못했습니다.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [company.id]);

  const processFile = async (file?: File) => {
    if (!file || !company.id || processState !== "idle") return;
    // Release the input before anything can fail. A file input fires no change event when the same
    // file is picked again, so a selection left behind by a failed attempt makes the next attempt on
    // that file do nothing at all — no request, no error, no sign that the click registered.
    if (fileInputRef.current) fileInputRef.current.value = "";
    const audio = resolveConsultationAudio(file.name, file.type);
    if (!audio) { setError(`${CONSULTATION_FORMAT_LABEL} 파일을 선택해 주세요.`); return; }
    if (file.size > MAX_CONSULTATION_SOURCE_SIZE) { setError("녹취파일은 최대 300MB까지 올릴 수 있습니다. 녹음 앱에서 음질을 낮춰 저장한 뒤 다시 시도해 주세요."); return; }
    // Checked for every file, not just the ones that get converted: a small but very long recording
    // still has to be transcribed inside the route's time budget.
    const seconds = await readAudioDuration(file);
    if (seconds > MAX_CONSULTATION_SECONDS) {
      setError(`녹취가 ${formatDuration(seconds)}입니다. 한 번에 올릴 수 있는 길이는 ${MAX_CONSULTATION_MINUTES}분까지이니 나눠서 올려 주세요.`);
      return;
    }
    setDurationSeconds(seconds);
    setError("");
    try {
      // Gemini downsamples to 16 Kbps mono anyway, so a long recording is converted here instead of
      // being pushed through the 50MB storage cap at a bitrate nothing downstream can use.
      let payload: Blob = file;
      let payloadName = file.name;
      let payloadMime = audio.mimeType;
      if (needsCompression(file, MAX_CONSULTATION_AUDIO_SIZE)) {
        setProcessState("compressing");
        setCompressRatio(0);
        const compressed = await compressConsultationAudio(file, setCompressRatio);
        payload = compressed.blob;
        payloadName = compressed.fileName;
        payloadMime = COMPRESSED_MIME_TYPE;
      }
      if (payload.size > MAX_CONSULTATION_AUDIO_SIZE) {
        throw new Error("변환 후에도 파일이 너무 큽니다. 녹취를 나눠서 올려 주세요.");
      }

      setProcessState("uploading");
      const tokenResponse = await fetch("/api/uploads/consultation-audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: company.id, fileName: payloadName, fileSize: payload.size, mimeType: payloadMime }),
      });
      const tokenResult = await tokenResponse.json() as { error?: string; bucket?: string; path?: string; token?: string; mimeType?: string };
      if (!tokenResponse.ok || !tokenResult.bucket || !tokenResult.path || !tokenResult.token) throw new Error(tokenResult.error || "파일 업로드를 준비하지 못했습니다.");
      /**
       * 브라우저가 파일에 붙인 형식을 그대로 올리면 버킷 허용 목록에 걸린다.
       *
       * macOS·iOS 는 `.m4a` 에 `audio/x-m4a` 를 붙이는데 버킷은 `audio/mp4` 만 받는다 —
       * 실제로 "mime type audio/x-m4a is not supported" 로 거절당했다. contentType 인자를
       * 줘도 폼 전송에서는 Blob 자신의 형식이 따라가므로, 우리가 정한 형식으로 다시 감싼다.
       * 아이폰 음성 메모가 정확히 이 경우라 그냥 두면 상담 녹취를 못 올리는 사람이 생긴다.
       */
      const contentType = tokenResult.mimeType || payloadMime;
      const body = payload.type === contentType ? payload : new Blob([payload], { type: contentType });
      const { error: uploadError } = await createSupabaseBrowser().storage
        .from(tokenResult.bucket)
        .uploadToSignedUrl(tokenResult.path, tokenResult.token, body, { contentType });
      if (uploadError) throw new Error(uploadError.message || "녹취파일을 업로드하지 못했습니다.");

      setProcessState("transcribing");
      const processResponse = await fetch(`/api/companies/${company.id}/consultations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storagePath: tokenResult.path, fileName: payloadName, fileSize: payload.size, mimeType: payloadMime }),
      });
      const processResult = await processResponse.json() as { consultation?: ConsultationRecord; error?: string };
      if (!processResponse.ok || !processResult.consultation) throw new Error(processResult.error || "녹취를 처리하지 못했습니다.");
      const saved = processResult.consultation;
      const next = [saved, ...records.filter((item) => item.id !== saved.id)];
      setRecords(next);
      setSelectedId(saved.id);
      setProcessState("idle");
      onDataChanged?.();
      await refreshBriefing(next.filter((item) => item.status === "completed").map((item) => item.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "녹취를 처리하지 못했습니다.");
    } finally {
      setProcessState("idle");
      setCompressRatio(0);
      setDurationSeconds(0);
    }
  };

  const completedIds = records.filter((record) => record.status === "completed").map((record) => record.id);

  /** Rebuilt whenever the set of completed recordings changes, so it can never quietly go out of date. */
  const refreshBriefing = async (ids: string[]) => {
    if (!company.id) return;
    // Called even when fewer than two remain, so the server can clear a briefing that outlived its
    // sources rather than leaving it to reappear on the next load.
    if (ids.length < 2) setBriefing(null);
    setBriefingState("building");
    try {
      const response = await fetch(`/api/companies/${company.id}/consultation-briefing`, { method: "POST" });
      const result = await response.json() as { briefing?: ConsultationBriefing | null; error?: string };
      if (!response.ok) throw new Error(result.error || "통합 브리핑을 만들지 못했습니다.");
      setBriefing(result.briefing || null);
      if (result.error) setError(result.error);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "통합 브리핑을 만들지 못했습니다.");
    } finally {
      setBriefingState("idle");
    }
  };

  const deleteRecord = async (record: ConsultationRecord) => {
    if (!company.id) return;
    const agreed = await ask({
      title: `‘${record.file_name}’ 녹취를 삭제할까요?`,
      message: "정리된 내용도 함께 사라집니다.",
      confirmLabel: "삭제", danger: true,
    });
    if (!agreed) return;
    setDeletingId(record.id);
    setError("");
    try {
      const response = await fetch(`/api/companies/${company.id}/consultations/${record.id}`, { method: "DELETE" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "상담 기록을 삭제하지 못했습니다.");
      const remaining = records.filter((item) => item.id !== record.id);
      setRecords(remaining);
      onDataChanged?.();
      if (selectedId === record.id) setSelectedId(remaining[0]?.id || "");
      await refreshBriefing(remaining.filter((item) => item.status === "completed").map((item) => item.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "상담 기록을 삭제하지 못했습니다.");
    } finally {
      setDeletingId("");
    }
  };

  const selected = records.find((item) => item.id === selectedId) || records[0];
  const summary = selected?.summary;
  const firstConstraint = summary?.constraints?.[0];
  const processLabel = processState === "compressing" ? `녹취파일 준비 중 ${Math.round(compressRatio * 100)}%`
    : processState === "uploading" ? "녹취파일 업로드 중"
    : "대화 내용을 옮겨 적고 정리하는 중";
  // Measured: 3.8s of processing per minute of audio, plus about a minute for upload and analysis.
  const estimatedMinutes = Math.max(1, Math.round((durationSeconds * 3.8 / 60 + 60) / 60));
  const processHint = [
    durationSeconds > 0 ? `녹취 ${formatDuration(durationSeconds)}` : "",
    processState === "compressing" ? "업로드 전에 크기를 줄이는 중"
      : processState === "transcribing" && durationSeconds > 0 ? `약 ${estimatedMinutes}분 예상 · 창을 닫지 마세요`
      : "잠시만 기다려 주세요.",
  ].filter(Boolean).join(" · ");
  const createdDate = (value: string) => new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

  return <section className="tab-content consulting">
    {confirmDialog}
    <div className="content-title"><div><h2>상담 기록과 녹취</h2><p>녹취를 올리면 전사와 요약을 만듭니다</p></div>{records.length > 0 && <button type="button" onClick={() => fileInputRef.current?.click()} disabled={processState !== "idle"}>＋ 녹취 추가</button>}</div>
    <input ref={fileInputRef} className="sr-only" type="file" accept={CONSULTATION_AUDIO_ACCEPT} onChange={(event) => processFile(event.target.files?.[0])} />
    {processState !== "idle" && <div className="consultation-processing" role="status" aria-live="polite"><i aria-hidden="true"/><div><b>{processLabel}</b><span>{processHint}</span></div><em aria-hidden="true" className={processState === "compressing" ? "determinate" : ""}><span style={processState === "compressing" ? { width: `${Math.max(2, Math.round(compressRatio * 100))}%` } : undefined}/></em></div>}
    {error && <p className="consultation-error" role="alert">{error}</p>}
    {!selected && !loading && processState === "idle" && <div className={`upload-zone${dragging ? " dragging" : ""}`} onDragEnter={(event)=>{event.preventDefault();setDragging(true);}} onDragOver={(event)=>event.preventDefault()} onDragLeave={(event)=>{if(!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);}} onDrop={(event)=>{event.preventDefault();setDragging(false);processFile(event.dataTransfer.files?.[0]);}}>
      <span><Icon name="upload" size={22}/></span><h3>녹취파일을 놓거나 선택하세요</h3><p>한 번에 최대 {MAX_CONSULTATION_MINUTES}분 · 더 긴 상담은 나눠서 올려 주세요<br/>{CONSULTATION_FORMAT_LABEL} · 용량은 신경 쓰지 않아도 됩니다</p><button type="button" onClick={() => fileInputRef.current?.click()}>파일 선택</button>
    </div>}
    {loading && <div className="consultation-loading"><i className="spinner" aria-hidden="true"/><span>상담 기록 불러오는 중</span></div>}
    {(briefing || briefingState === "building") && <BriefingPanel briefing={briefing} building={briefingState === "building"} sessionCount={completedIds.length} />}
    {selected && <div className="transcript">
      {records.length > 1 && <div className="consultation-history" aria-label="상담 기록 목록">{records.map((record) => <button type="button" className={record.id === selected.id ? "active" : ""} key={record.id} onClick={() => setSelectedId(record.id)}><b>{record.file_name}</b><span>{createdDate(record.created_at)}</span></button>)}</div>}
      <div className="audio-bar">{/* eslint-disable-next-line jsx-a11y/media-has-caption -- The complete transcript is displayed directly below. */}<audio controls preload="metadata" src={selected.audio_url}/><div><b>{selected.file_name}</b><small>{formatFileSize(selected.file_size)} · {createdDate(selected.created_at)}</small></div><span>{selected.status === "completed" ? "정리 완료" : selected.status === "failed" ? "처리 실패" : "처리 중"}</span><button type="button" className="record-delete" onClick={() => deleteRecord(selected)} disabled={deletingId === selected.id} aria-label={`${selected.file_name} 삭제`} title="이 녹취 삭제">{deletingId === selected.id ? <i className="spinner" aria-hidden="true"/> : <Icon name="trash" size={17}/>}</button></div>
      {summary?.overview && <article className="consultation-overview"><small>상담 요약</small><p>{summary.overview}</p></article>}
      <NeedList title="핵심 니즈" needs={summary?.keyNeeds} />
      <div className="insight-row two"><article><small>교육 대상</small><b>{summary?.audience?.headline || "확인 필요"}</b><p>{summary?.audience?.detail || "상담 내용에서 확인되지 않음"}</p></article><article><small>운영 제약</small><b>{firstConstraint || "확인 필요"}</b><p>{summary?.constraints?.slice(1).join(" · ") || "추가 제약 없음"}</p></article></div>
      {summary && <div className="consultation-details"><article><h3>합의사항</h3>{summary.decisions?.length ? <ul>{summary.decisions.map((item)=><li key={item}>{item}</li>)}</ul> : <p>확인된 합의사항 없음</p>}</article><article><h3>강사 전달사항</h3>{summary.instructorNotes?.length ? <ul>{summary.instructorNotes.map((item)=><li key={item}>{item}</li>)}</ul> : <p>추가 전달사항 없음</p>}</article><article><h3>추가 확인</h3>{summary.followUpQuestions?.length ? <ul>{summary.followUpQuestions.map((item)=><li key={item}>{item}</li>)}</ul> : <p>추가 질문 없음</p>}</article></div>}
      <div className="dialogue-head"><div><h3>전체 대화</h3><span>{selected.transcript?.segments?.length || 0}개 발화</span></div></div>
      <div className="dialogue">{selected.transcript?.segments?.map((segment,index)=><p key={`${segment.timestamp}-${index}`}><b>{segment.speaker}</b><span>{segment.text}</span><time>{segment.timestamp}</time></p>)}</div>
    </div>}
  </section>;
}

function CoursesTab(){return <section className="tab-content courses"><div className="content-title"><div><span className="ai-tag">✦ 상담 기반 추천</span><h2>교육과정 설계</h2><p>모든 과정은 기본 4시간 특강 단위이며 필요에 따라 묶어 운영합니다.</p></div><button>＋ 과정 추가</button></div>{["생성형 AI 업무 적용의 시작","문서·보고서 작성 자동화","사내 데이터 기반 AI 활용"].map((x,i)=><article key={x}><div className="course-number">0{i+1}</div><div className="course-body"><div><span>{i===0?"FOUNDATION":i===1?"PRACTICE":"ADVANCED"}</span><h3>{x}</h3><p>{["생성형 AI의 원리와 안전한 프롬프트 작성법을 익힙니다.","보고서, 제안서, 회의록을 실제 업무 템플릿으로 자동화합니다.","보안 원칙 안에서 사내 데이터를 분석하고 인사이트를 도출합니다."][i]}</p></div><dl><div><dt>시간</dt><dd>4시간</dd></div><div><dt>형태</dt><dd>이론 30% · 실습 70%</dd></div><div><dt>강사</dt><dd>{i===0?"한지우 강사":"배정 필요"}</dd></div></dl></div><button>편집</button></article>)}</section>}

function StudentsTab(){return <section className="tab-content students"><div className="content-title"><div><h2>수강생 관리</h2><p>직접 등록하거나 엑셀·PDF·한글 명단에서 정보를 추출합니다.</p></div><div><button>파일로 가져오기</button><button className="primary-small">＋ 수강생 추가</button></div></div><div className="student-summary"><span><b>24</b>신청</span><span><b>21</b>참석 예정</span><span><b>3</b>확인 필요</span></div><table><thead><tr><th>이름</th><th>부서 · 직급</th><th>이메일</th><th>참석 상태</th></tr></thead><tbody>{[["박지훈","AX전략팀 · 과장","jh.park@douzone.com","참석"],["윤하늘","서비스기획팀 · 대리","hn.yoon@douzone.com","참석"],["송민재","영업지원팀 · 책임","mj.song@douzone.com","확인 필요"]].map(x=><tr key={x[0]}><td><b>{x[0]}</b></td><td>{x[1]}</td><td>{x[2]}</td><td><span className={x[3]==="참석"?"attend":"check"}>{x[3]}</span></td></tr>)}</tbody></table></section>}

function Surveys(){return <section className="workspace-panel surveys-page"><div className="survey-hero"><div><span>✦ AI 질문지 설계</span><h2>수업 내용에 맞춘 질문을<br/>미리 준비했습니다.</h2><p>관리자가 검토·승인하면 예약한 시간에 수강생에게 자동 발송됩니다.</p></div><div className="donut"><b>78%</b><span>평균 응답률</span></div></div><div className="survey-columns"><div><div className="section-title"><h3>검토 대기</h3><span>3</span></div>{["더존비즈온 · 생성형 AI 업무 적용","휴젤 · 의료 데이터 AI 활용","바디텍메드 · 보고서 자동화"].map((x,i)=><article key={x}><span className="survey-icon">◎</span><div><b>{x}</b><p>맞춤 문항 {12+i}개 · 필수 문항 8개</p><small>{["08. 27 교육","08. 30 교육","09. 03 교육"][i]}</small></div><button>검토 →</button></article>)}</div><div><div className="section-title"><h3>발송 예정</h3><span>2</span></div>{["강원랜드 · 현장 실무 AI","한국수자원공사 · 데이터 분석"].map((x,i)=><article key={x}><span className="survey-icon approved">✓</span><div><b>{x}</b><p>승인 완료 · 수강생 {[24,18][i]}명</p><small>{["08. 21 17:00 발송","08. 25 16:30 발송"][i]}</small></div><button>일정 →</button></article>)}</div></div></section>}

function Modal({ onClose, onCompanyCreated }: { onClose: () => void; onCompanyCreated: (company: CompanyItem) => void }) {
  type Candidate = { name: string; url: string; hostname: string; description: string; recommended?: boolean };
  const [inputMode, setInputMode] = useState<"url" | "name" | "pdf">("url");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEscapeClose(!loading, onClose);
  const researchCompany = async (urlValue: string, resolvedName?: string, documentSummary?: string) => {
    const normalized = new URL(/^https?:\/\//i.test(urlValue) ? urlValue : `https://${urlValue}`);
    const researchResponse = await fetch("/api/companies/research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ websiteUrl: normalized.href, companyName: resolvedName, documentSummary }) });
    const researchResult = await researchResponse.json() as { error?: string; report?: ResearchReport; crawl?: CompanyItem["crawl"]; intelligence?: CompanyIntelligence };
    if (!researchResponse.ok || !researchResult.report) throw new Error(researchResult.error || "기업 조사에 실패했습니다.");
    const report = sanitizeResearchReport(researchResult.report);
    const fallbackName = normalized.hostname.replace(/^www\./, "").split(".")[0];
    const draft = { name: displayCompanyName(report.companyName || resolvedName || fallbackName), websiteUrl: normalized.href, industry: report.industry, research: report, intelligence: sanitizeCompanyIntelligence(researchResult.intelligence), crawl: researchResult.crawl, questions: report.questions };
    const saveResponse = await fetch("/api/companies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
    const saved = await saveResponse.json() as { error?: string; company?: { id: string } };
    if (!saveResponse.ok || !saved.company) throw new Error(saved.error || "조사 결과 저장에 실패했습니다.");
    onCompanyCreated({ id: saved.company.id, name: draft.name, field: draft.industry, stage: stageLabel("research_complete", 0, 0), storedStage: "research_complete", sessionCount: 0, assignedCount: 0, learnerCount: 0, consultationCount: 0, nextSession: null, updatedAt: new Date().toISOString(), progress: 25, date: "조사 완료", color: "blue", websiteUrl: draft.websiteUrl, research: draft.research, intelligence: draft.intelligence, crawl: draft.crawl });
    onClose();
  };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true); setError("");
    try {
      if (candidates.length) return;
      if (inputMode === "url") await researchCompany(websiteUrl);
      else {
        let storagePath = "";
        if (pdfFile) {
          if (pdfFile.type !== "application/pdf" || !pdfFile.name.toLowerCase().endsWith(".pdf")) throw new Error("PDF 파일만 업로드할 수 있습니다.");
          if (pdfFile.size > 50 * 1024 * 1024) throw new Error("PDF는 최대 50MB까지 업로드할 수 있습니다.");
          const tokenResponse = await fetch("/api/uploads/company-pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: pdfFile.name, fileSize: pdfFile.size, mimeType: pdfFile.type }) });
          const tokenResult = await tokenResponse.json() as { error?: string; bucket?: string; path?: string; token?: string };
          if (!tokenResponse.ok || !tokenResult.bucket || !tokenResult.path || !tokenResult.token) throw new Error(tokenResult.error || "파일 업로드를 준비하지 못했습니다.");
          const { error: uploadError } = await createSupabaseBrowser().storage.from(tokenResult.bucket).uploadToSignedUrl(tokenResult.path, tokenResult.token, pdfFile, { contentType: "application/pdf" });
          if (uploadError) throw new Error(uploadError.message || "PDF 파일을 업로드하지 못했습니다.");
          storagePath = tokenResult.path;
        }
        const response = await fetch("/api/companies/discover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyName: displayCompanyName(companyName), storagePath }) });
        const result = await response.json() as { error?: string; companyName?: string; websiteUrl?: string; documentSummary?: string; direct?: boolean; candidates?: Candidate[] };
        if (!response.ok) throw new Error(result.error || "회사 정보를 확인하지 못했습니다.");
        if (inputMode === "pdf") {
          if (!result.direct || !result.websiteUrl) throw new Error(result.error || "PDF에서 회사 홈페이지를 확인하지 못했습니다.");
          await researchCompany(result.websiteUrl, result.companyName, result.documentSummary);
        } else {
          if (result.direct && result.websiteUrl) {
            await researchCompany(result.websiteUrl, result.companyName || companyName);
            return;
          }
          if (!result.candidates?.length) throw new Error(result.error || "공식 홈페이지 후보를 찾지 못했습니다.");
          setCompanyName(displayCompanyName(result.companyName || companyName)); setCandidates(result.candidates);
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "회사 정보를 가져오지 못했습니다.");
    } finally { setLoading(false); }
  };
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal company-discovery" onMouseDown={event => event.stopPropagation()} onSubmit={submit} aria-busy={loading}><div className="modal-head"><div><span>NEW COMPANY RESEARCH</span><h2>{candidates.length ? "조사할 회사를 선택하세요" : "새 기업 조사"}</h2><p>{candidates.length ? `‘${displayCompanyName(companyName)}’ 검색 결과` : "URL, 회사명 또는 회사소개 PDF 중 편한 방법으로 시작하세요."}</p></div><button className="modal-close" type="button" onClick={onClose} aria-label="닫기"><Icon name="plus" size={20}/></button></div>{candidates.length ? <div className="candidate-list">{candidates.map(candidate => <button type="button" className={candidate.recommended ? "recommended" : ""} key={candidate.hostname} onClick={async()=>{setLoading(true);setError("");try{await researchCompany(candidate.url, candidate.name || companyName);}catch(caught){setError(caught instanceof Error?caught.message:"기업 조사에 실패했습니다.");setLoading(false);}}} disabled={loading}><span className="candidate-title"><b>{displayCompanyName(candidate.name || candidate.hostname)}</b>{candidate.recommended && <i>추천</i>}</span><small>{candidate.url}</small>{candidate.description && <p>{candidate.description}</p>}<em>선택</em></button>)}</div> : <><div className="input-tabs" role="tablist" aria-label="기업 정보 입력 방법">{[["url","01","홈페이지 URL"],["name","02","회사 이름"],["pdf","03","회사소개 PDF"]].map(([id,number,label])=><button type="button" role="tab" aria-selected={inputMode===id} className={inputMode===id?"active":""} onClick={()=>{setInputMode(id as "url"|"name"|"pdf");setError("");}} key={id}><span>{number}</span>{label}</button>)}</div><div className="input-panel" role="tabpanel">{inputMode === "url" && <label>회사 홈페이지 URL<input autoFocus type="text" inputMode="url" value={websiteUrl} onChange={event=>setWebsiteUrl(event.target.value)} placeholder="https://company.co.kr" required disabled={loading}/></label>}{inputMode === "name" && <label>회사 이름<input autoFocus value={companyName} onChange={event=>setCompanyName(event.target.value)} placeholder="예: 한주케미칼" required disabled={loading}/></label>}{inputMode === "pdf" && <div className="pdf-field"><div className="pdf-label-line"><span>회사소개 PDF</span><small className="pdf-limit">최대 50MB</small></div><label className="pdf-upload-label"><input className="pdf-file-input" type="file" accept="application/pdf,.pdf" onChange={event=>setPdfFile(event.target.files?.[0]||null)} required disabled={loading}/><span className="pdf-upload-control"><Icon name="upload" size={20}/><span className="pdf-upload-copy"><b>{pdfFile?.name || "PDF 파일 선택"}</b>{pdfFile&&<small>{formatFileSize(pdfFile.size)}</small>}</span></span></label></div>}</div></>}{loading&&<div className="modal-processing" role="status" aria-live="polite"><i aria-hidden="true"/><span>{candidates.length?"선택한 회사를 확인하는 중":"기업 정보를 확인하는 중"}</span></div>}{error&&<p className="modal-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" onClick={candidates.length?()=>setCandidates([]):onClose} disabled={loading}>{candidates.length?"다시 입력":"취소"}</button>{!candidates.length&&<button className="primary-small" disabled={loading}>{loading?"처리 중…":"기업 조사 시작"}</button>}</div></form></div>;
}

export default function Home() {
  const [view, setView] = useState<View>("companies");
  const [modal, setModal] = useState(false);
  const [companyItems, setCompanyItems] = useState<CompanyItem[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [selectedCompany, setSelectedCompany] = useState<CompanyItem | null>(null);
  const [selectedInstructor, setSelectedInstructor] = useState<InstructorItem | null>(null);
  // 카드에서 '담당자 등록'을 누르면 기업 화면을 열면서 담당자 입력까지 바로 띄운다. 값은
  // 매번 새로 찍는 신호다 — 담당자 의도 없이 다른 기업을 열 때 0으로 되돌려 놓지 않으면,
  // 패널이 다시 마운트되면서 지난 신호로 창이 또 열린다.
  const [contactSignal, setContactSignal] = useState(0);
  const selectCompany = (company: CompanyItem, intent?: "contact") => {
    setSelectedCompany(company);
    setView("company");
    setContactSignal(intent === "contact" ? Date.now() : 0);
  };
  const selectInstructor = (instructor: InstructorItem) => { setSelectedInstructor(instructor); setView("instructor"); };
  /**
   * 담당자를 저장하면 목록 카드도 그 자리에서 바뀐다. 예전에는 상세 화면만 알고 목록은
   * 몰라서, 뒤로 나가면 여전히 '담당자 미등록'이었고 새로고침해야 반영됐다.
   */
  const applyContact = (companyId: string, contact: CompanyContact) => {
    setCompanyItems(current => current.map(company => company.id === companyId ? { ...company, contact } : company));
    setSelectedCompany(current => current && current.id === companyId ? { ...current, contact } : current);
  };
  /**
   * 조사가 끝나면 목록 맨 앞에 놓는다. 같은 홈페이지를 다시 조사하면 서버는 같은 행을
   * 갱신하므로(website_url upsert), 목록에도 같은 기업이 두 장 생기지 않게 먼저 걷어낸다.
   */
  const addCompany = (company: CompanyItem) => {
    setCompanyItems(current => [company, ...current.filter(item => !(item.id && item.id === company.id))]);
    setView("companies");
  };
  const removeCompany = (id: string) => { setCompanyItems(current => current.filter(company => company.id !== id)); if (selectedCompany?.id === id) { setSelectedCompany(null); setView("companies"); } };
  /**
   * 목록을 서버에서 다시 읽는다. 상세 화면에서 교육과정·수강생·상담이 바뀌면 카드의 단계
   * 배지와 '다음 할 일'도 함께 달라지는데, 예전에는 그 사실이 목록까지 오지 않아 새로고침
   * 전까지 옛 상태가 남아 있었다(담당자와 같은 계열의 문제였다).
   */
  const loadCompanies = useCallback(async () => {
    try {
      const response = await fetch("/api/companies");
      const result = await response.json() as { companies?: Array<{ id: string; name: string; website_url: string; industry: string; stage: string; sessionCount: number; assignedCount: number; deliveredCount: number; cancelledCount: number; learnerCount: number; consultationCount: number; pastSessionCount: number; nextSession: CompanyItem["nextSession"]; updated_at: string; contact: CompanyContact; research: ResearchReport; intelligence: CompanyIntelligence; crawl: CompanyItem["crawl"]; questions: string[] }> };
      if (!response.ok) throw new Error("목록을 불러오지 못했습니다.");
      const mapped = (result.companies || []).map(item => ({ id: item.id, name: item.name, field: item.industry, stage: stageLabel(item.stage, item.sessionCount || 0, item.assignedCount || 0, item.deliveredCount || 0, item.cancelledCount || 0), storedStage: item.stage, sessionCount: item.sessionCount || 0, assignedCount: item.assignedCount || 0, deliveredCount: item.deliveredCount || 0, cancelledCount: item.cancelledCount || 0, learnerCount: item.learnerCount || 0, consultationCount: item.consultationCount || 0, pastSessionCount: item.pastSessionCount || 0, nextSession: item.nextSession || null, updatedAt: item.updated_at, contact: item.contact, progress: 25, date: "저장됨", color: "blue", websiteUrl: item.website_url, research: sanitizeResearchReport({ ...item.research, questions: item.questions }), intelligence: sanitizeCompanyIntelligence(item.intelligence), crawl: item.crawl }));
      setCompanyItems(mapped);
      setSelectedCompany(current => current && (mapped.find(item => item.id === current.id) || current));
    } catch {
      setCompanyItems([]);
    }
  }, []);

  useEffect(() => { void loadCompanies().finally(() => setLoadingCompanies(false)); }, [loadCompanies]);
  const visibleCompany = selectedCompany || companyItems[0] || { name: "기업 조사", field: "", stage: "", progress: 0, date: "", color: "blue" };
  const content = view === "program"
    ? <ProgramDashboard onOpenCompany={(companyId) => {
        const target = companyItems.find(item => item.id === companyId);
        if (target) selectCompany(target);
      }}/>
    : view === "surveys"
    ? <SurveysPanel/>
    : view === "learners"
    ? <LearnersPanel/>
    : view === "instructor" && selectedInstructor
    ? <InstructorDetail key={selectedInstructor.id} instructor={selectedInstructor} onBack={() => setView("instructors")}/>
    : view === "instructors"
      ? <InstructorsPanel onSelect={selectInstructor}/>
      : loadingCompanies ? <section className="workspace-panel"><div className="company-empty"><i className="spinner"/><h2>저장된 기업 불러오는 중</h2></div></section> : view === "company" && selectedCompany ? <CompanyDetail key={selectedCompany.id || selectedCompany.name} company={selectedCompany} companies={companyItems} onSelectCompany={selectCompany} onDataChanged={() => void loadCompanies()}/> : <Companies companyItems={companyItems} onSelectCompany={selectCompany} onCompanyDeleted={removeCompany}/>;
  return <div className="app-shell"><a className="skip" href="#main">본문 바로가기</a><SideNav view={view} setView={setView}/><main id="main" tabIndex={-1}><Header view={view} onNew={() => setModal(true)} selectedCompany={visibleCompany} selectedInstructorName={selectedInstructor?.name || ""} contactSignal={contactSignal} onContactSaved={applyContact}/><div className="content">{content}</div></main><nav className="mobile-nav" aria-label="모바일 메뉴"><button className={view === "program" ? "active" : ""} onClick={() => setView("program")}><span><Icon name="calendar"/></span>사업</button>{nav.map(item => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><span><Icon name={item.icon}/></span>{item.label}</button>)}</nav>{modal && <Modal onClose={() => setModal(false)} onCompanyCreated={addCompany}/>}</div>;
}
