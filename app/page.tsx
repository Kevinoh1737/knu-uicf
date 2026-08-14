"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

const instructors: Array<{ name: string; initials: string; role: string; score: string; sessions: number; state: string; tone: string }> = [];

type View = "companies" | "company";

type ResearchReport = {
  companyName: string; industry: string; headline: string; summary: string; keywords: string[];
  opportunities: Array<{ title: string; detail: string }>;
  competitors: Array<{ name: string; reason: string; verificationNote: string }>;
  questions: string[];
  evidence: Array<{ claim: string; url: string }>;
};

type CompanyIntelligence = {
  dart?: {
    available: boolean; reason?: string; corpCode?: string; stockCode?: string | null;
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
  owner: string;
  progress: number;
  date: string;
  color: string;
  websiteUrl?: string;
  research?: ResearchReport;
  intelligence?: CompanyIntelligence;
  crawl?: { pageCount: number; attachmentCount: number; pages: string[]; attachments: string[] };
  researchError?: string;
};

type IconName = "home" | "building" | "person" | "survey" | "spark" | "settings" | "search" | "bell" | "plus" | "document" | "audio" | "calendar" | "chart" | "clock" | "upload";

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    home: <><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10M9 20v-6h6v6"/></>,
    building: <><path d="M4 21V5a2 2 0 0 1 2-2h9v18M15 9h5v12M8 7h3M8 11h3M8 15h3M3 21h19"/></>,
    person: <><circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></>,
    survey: <><circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.2 2.2 4.8-5"/></>,
    spark: <><path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3Z"/><path d="m18 16 .7 2.3L21 19l-2.3.7L18 22l-.7-2.3L15 19l2.3-.7L18 16Z"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    document: <><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 12h6M9 16h6"/></>,
    audio: <><path d="M9 18V6l10-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
    chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    upload: <><path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 14v6h14v-6"/></>,
  };
  return <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

const nav = [
  { id: "companies" as View, icon: "building" as IconName, label: "기업 조사" },
];

function CompanyLogo({ company, size = "" }: { company: CompanyItem; size?: "large" | "xl" | "" }) {
  return <span className={`company-logo ${size} ${company.color}`} aria-hidden="true">{company.name.slice(0, 1)}</span>;
}

function Brand() {
  return <div className="brand"><Image className="official-logo" src="/knu-uicf-logo.png" width={96} height={103} priority alt="강원대학교 산학협력단 UICF" /><span className="team-name">교육사업팀</span></div>;
}

function SideNav({ view, setView }: { view: View; setView: (v: View) => void }) {
  return <aside className="sidebar">
    <Brand />
    <nav aria-label="주 메뉴">
      <p className="nav-label">WORKSPACE</p>
      {nav.map((item) => <button key={item.id} className={view === item.id || (view === "company" && item.id === "companies") ? "nav-item active" : "nav-item"} onClick={() => setView(item.id)}><span><Icon name={item.icon} /></span>{item.label}</button>)}
    </nav>
    <div className="profile"><span>김</span><div><b>김서윤</b><small>교육사업팀 · 관리자</small></div><button aria-label="프로필 메뉴">•••</button></div>
  </aside>;
}

function Header({ view, onNew, selectedCompany }: { view: View; onNew: () => void; selectedCompany: CompanyItem }) {
  const titles: Record<View, [string, string]> = {
    companies: ["기업 조사", "홈페이지를 입력해 기업 정보와 교육 니즈를 조사합니다."],
    company: [selectedCompany.name, "기업 조사와 교육 설계를 한곳에서 이어가세요."],
  };
  return <header className="topbar"><div><h1>{titles[view][0]}</h1><p>{titles[view][1]}</p></div><div className="header-actions"><button className="primary" onClick={onNew}><span><Icon name="plus" size={16}/></span>새 기업 조사</button></div></header>;
}

function Companies({ companyItems, onSelectCompany }: { companyItems: CompanyItem[]; onSelectCompany: (company: CompanyItem) => void }) {
  return <section className="workspace-panel">{companyItems.length === 0 ? <div className="company-empty"><span><Icon name="building" size={26}/></span><h2>아직 조사한 기업이 없습니다</h2><p>오른쪽 위의 <b>새 기업 조사</b>에서 홈페이지를 입력하면<br/>웹사이트·OpenDART·공개 채용정보를 함께 분석합니다.</p></div> : <><div className="toolbar"><div className="searchbox"><Icon name="search" size={17}/><input aria-label="기업 검색" placeholder="기업명 또는 산업으로 검색" /></div></div><div className="company-cards">{companyItems.map((c) => <article key={c.name} onClick={() => onSelectCompany(c)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") onSelectCompany(c); }} tabIndex={0}><div className="card-top"><CompanyLogo company={c} size="large"/><span className="stage">{c.stage}</span></div><h3>{c.name}</h3><p>{c.field}</p><button>조사 결과 열기 <span>→</span></button></article>)}</div></>}
  </section>;
}

function CompanyDetail({ company }: { company: CompanyItem }) {
  const [tab, setTab] = useState("research");
  const [questions, setQuestions] = useState(company.research?.questions?.length ? company.research.questions : [
    "현재 구성원들이 반복적으로 많은 시간을 쓰는 업무는 무엇인가요?",
    "생성형 AI 도입을 검토하거나 시범 적용한 사례가 있나요?",
    "교육 후 3개월 안에 확인하고 싶은 구체적인 업무 변화는 무엇인가요?",
  ]);
  const addQuestion = () => setQuestions([...questions, "새 질문을 입력해 주세요."]);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveQuestions = async () => {
    if (!company.id) return;
    setSaveState("saving");
    const response = await fetch(`/api/companies/${company.id}/questions`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ questions }) });
    setSaveState(response.ok ? "saved" : "error");
  };
  return <section className="company-detail">
    <div className="company-hero"><div className="company-identity"><CompanyLogo company={company} size="xl"/><div><div className="title-line"><h2>{company.name}</h2><span>{company.stage}</span></div><p>{company.field}{company.websiteUrl && <><i>·</i>{new URL(company.websiteUrl).hostname}</>}</p></div></div></div>
    <div className="detail-tabs">{[["research","기업 조사"],["questions","니즈 질문지"]].map(([id,label]) => <button className={tab===id?"active":""} onClick={()=>setTab(id)} key={id}>{label}{id === "questions" && <em>{questions.length}</em>}</button>)}</div>
    {tab === "research" && <ResearchTab company={company} />}
    {tab === "questions" && <section className="tab-content questions"><div className="content-title"><div><span className="ai-tag">✦ GEMINI 초안</span><h2>교육 니즈 진단 질문지</h2><p>기업 조사 결과를 바탕으로 교육과정 설계에 필요한 질문을 구성했습니다.</p></div><button onClick={addQuestion}>＋ 질문 추가</button></div>{questions.map((q,i)=><article key={i}><span>{String(i+1).padStart(2,"0")}</span><textarea aria-label={`${i+1}번 질문`} value={q} onChange={(e)=>{setQuestions(questions.map((x,j)=>j===i?e.target.value:x));setSaveState("idle");}}/><button onClick={()=>{setQuestions(questions.filter((_,j)=>j!==i));setSaveState("idle");}}>×</button></article>)}<div className="savebar"><span className={saveState === "error" ? "save-error" : ""}>{saveState === "saving" ? "Supabase에 저장 중…" : saveState === "saved" ? "저장 완료" : saveState === "error" ? "저장하지 못했습니다. 다시 시도해 주세요." : "수정 후 저장해 주세요."}</span><button onClick={saveQuestions} disabled={!company.id || saveState === "saving"}>{saveState === "saving" ? "저장 중…" : "질문지 저장"}</button></div></section>}
  </section>;
}

function ResearchTab({ company }: { company: CompanyItem }) {
  if (!company.research) return <section className="tab-content research"><div className="research-empty"><span>!</span><h2>조사 결과가 없습니다</h2><p>{company.researchError || "이 기업은 실제 조사 기능 연결 전에 등록되었습니다. 새 기업 등록에서 홈페이지를 다시 입력해 주세요."}</p></div></section>;
  const report = company.research;
  const dart = company.intelligence?.dart;
  const recruiting = company.intelligence?.recruiting;
  const won = (value?: number | null) => value == null ? "확인되지 않음" : `${new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 }).format(value)}원`;
  const date = (value?: string) => value?.length === 8 ? `${value.slice(0, 4)}.${value.slice(4, 6)}.${value.slice(6, 8)}` : value || "확인되지 않음";
  return <section className="tab-content research"><div className="content-title"><div><span className="ai-tag">✦ 실제 웹 수집 · GEMINI 분석 완료</span><h2>기업 인텔리전스 리포트</h2><p>홈페이지 {company.crawl?.pageCount || 0}개 페이지와 첨부파일 링크 {company.crawl?.attachmentCount || 0}개를 확인했습니다.</p></div></div>{company.intelligence && <div className="intelligence-grid"><article><div className="intel-head"><div><small>OPEN DART</small><h3>공시 기반 기업 정보</h3></div><span className={dart?.available ? "verified" : "unavailable"}>{dart?.available ? "공식 확인" : "자료 없음"}</span></div>{dart?.available ? <><dl><div><dt>대표이사</dt><dd>{dart.profile?.representative || "확인되지 않음"}</dd></div><div><dt>설립일</dt><dd>{date(dart.profile?.establishedDate)}</dd></div><div><dt>본점 주소</dt><dd>{dart.profile?.address || "확인되지 않음"}</dd></div><div><dt>업종 코드</dt><dd>{dart.profile?.industryCode || "확인되지 않음"}</dd></div></dl><div className="finance-row"><span><small>{dart.financialYear || "-"} 매출</small><b>{won(dart.financials?.revenue)}</b></span><span><small>영업이익</small><b>{won(dart.financials?.operatingProfit)}</b></span><span><small>자산</small><b>{won(dart.financials?.assets)}</b></span></div></> : <p className="intel-empty">{dart?.reason || "DART에서 일치하는 기업을 찾지 못했습니다."}</p>}</article><article><div className="intel-head"><div><small>RECRUITING SIGNAL</small><h3>조직·IT 인력 신호</h3></div><span className={recruiting?.hasInternalItSignal ? "verified" : "unavailable"}>{recruiting?.hasInternalItSignal ? "IT 채용 신호 있음" : "확인 필요"}</span></div><div className="recruit-summary"><span><b>{recruiting?.postingCount || 0}</b><small>현재 공개 공고</small></span><span><b>{recruiting?.itPostingCount || 0}</b><small>IT 관련 공고</small></span></div>{recruiting?.itRoles?.length ? <div className="role-list">{recruiting.itRoles.map(role => <span key={role}>{role}</span>)}</div> : <p className="intel-empty">현재 공개검색에서 IT 직무 공고를 확인하지 못했습니다. 내부 인력 부재를 의미하지는 않습니다.</p>}<p className="intel-caveat">{recruiting?.caveat}</p></article></div>}<div className="research-grid"><article><small>기업 한눈에 보기</small><h3>{report.headline}</h3><p>{report.summary}</p><div className="chips">{report.keywords.map(keyword => <span key={keyword}>{keyword}</span>)}</div></article><article><small>AI 교육 기회</small><ul>{report.opportunities.map(item => <li key={item.title}><b>{item.title}</b><span>{item.detail}</span></li>)}</ul></article><article className="competitor"><small>동종업계 후보</small><h3>경쟁사 검토 대상</h3>{report.competitors.map((item, index) => <div key={item.name}><span>{index + 1}</span><b>{item.name}</b><em>{item.reason} · {item.verificationNote}</em></div>)}</article></div><div className="evidence-list"><b>근거 출처</b>{report.evidence.map((item, index) => <a href={item.url} target="_blank" rel="noreferrer" key={`${item.url}-${index}`}>{item.claim}<span>{new URL(item.url).hostname} ↗</span></a>)}</div></section>;
}

function ConsultingTab(){const [uploaded,setUploaded]=useState(false);return <section className="tab-content consulting"><div className="content-title"><div><span className="ai-tag">✦ 상담 분석</span><h2>상담 기록과 녹취</h2><p>전체 대화를 보존하고 교육 니즈, 제약조건, 과정 제안을 추출합니다.</p></div><button>상담 메모 추가</button></div>{!uploaded?<div className="upload-zone" onClick={()=>setUploaded(true)}><span>↑</span><h3>녹취파일을 놓거나 선택하세요</h3><p>MP3, M4A, WAV · 최대 2GB · 업로드 후 Gemini가 자동으로 전사합니다.</p><button>파일 선택</button></div>:<div className="transcript"><div className="audio-bar"><button>▶</button><div><b>더존비즈온_니즈상담_0812.m4a</b><small>42:18 · 전사 및 화자 분리 완료</small></div><span>분석 완료</span></div><div className="insight-row"><article><small>핵심 니즈</small><b>문서 생산성 향상</b><p>반복 보고서와 제안서 작성 시간을 줄이는 실습 요구</p></article><article><small>교육 대상</small><b>실무자 24명</b><p>기획·영업·지원 직군 혼합, AI 경험은 초급</p></article><article><small>운영 제약</small><b>보안 환경 실습</b><p>개인정보·사내 데이터 입력 금지 원칙 포함 필요</p></article></div><div className="dialogue"><p><b>정예린 책임</b><span>보고서 초안을 만드는 데 팀별로 시간이 꽤 많이 들어요. 단순 이론보다 실제 문서를 가지고 연습했으면 합니다.</span><time>12:42</time></p><p><b>김서윤</b><span>교육 이후 바로 사용할 수 있는 템플릿까지 결과물로 가져가도록 설계해 보겠습니다.</span><time>13:08</time></p></div></div>}</section>}

function CoursesTab(){return <section className="tab-content courses"><div className="content-title"><div><span className="ai-tag">✦ 상담 기반 추천</span><h2>교육과정 설계</h2><p>모든 과정은 기본 4시간 특강 단위이며 필요에 따라 묶어 운영합니다.</p></div><button>＋ 과정 추가</button></div>{["생성형 AI 업무 적용의 시작","문서·보고서 작성 자동화","사내 데이터 기반 AI 활용"].map((x,i)=><article key={x}><div className="course-number">0{i+1}</div><div className="course-body"><div><span>{i===0?"FOUNDATION":i===1?"PRACTICE":"ADVANCED"}</span><h3>{x}</h3><p>{["생성형 AI의 원리와 안전한 프롬프트 작성법을 익힙니다.","보고서, 제안서, 회의록을 실제 업무 템플릿으로 자동화합니다.","보안 원칙 안에서 사내 데이터를 분석하고 인사이트를 도출합니다."][i]}</p></div><dl><div><dt>시간</dt><dd>4시간</dd></div><div><dt>형태</dt><dd>이론 30% · 실습 70%</dd></div><div><dt>강사</dt><dd>{i===0?"한지우 강사":"배정 필요"}</dd></div></dl></div><button>편집</button></article>)}</section>}

function StudentsTab(){return <section className="tab-content students"><div className="content-title"><div><h2>수강생 관리</h2><p>직접 등록하거나 엑셀·PDF·한글 명단에서 정보를 추출합니다.</p></div><div><button>파일로 가져오기</button><button className="primary-small">＋ 수강생 추가</button></div></div><div className="student-summary"><span><b>24</b>신청</span><span><b>21</b>참석 예정</span><span><b>3</b>확인 필요</span></div><table><thead><tr><th>이름</th><th>부서 · 직급</th><th>이메일</th><th>참석 상태</th></tr></thead><tbody>{[["박지훈","AX전략팀 · 과장","jh.park@douzone.com","참석"],["윤하늘","서비스기획팀 · 대리","hn.yoon@douzone.com","참석"],["송민재","영업지원팀 · 책임","mj.song@douzone.com","확인 필요"]].map(x=><tr key={x[0]}><td><b>{x[0]}</b></td><td>{x[1]}</td><td>{x[2]}</td><td><span className={x[3]==="참석"?"attend":"check"}>{x[3]}</span></td></tr>)}</tbody></table></section>}

function Instructors(){return <section className="workspace-panel"><div className="instructor-summary"><div><span>등록 강사</span><b>32명</b></div><div><span>이번 달 진행</span><b>11명</b></div><div><span>평균 평가</span><b>4.76</b></div><div className="expertise"><span>주요 전문분야</span><p><i>생성형 AI</i><i>데이터 분석</i><i>업무자동화</i></p></div></div><div className="toolbar"><div className="searchbox">⌕ <input placeholder="강사명 또는 전문분야 검색" aria-label="강사 검색" /></div><button className="filter">진행 가능⌄</button></div><div className="instructor-list">{instructors.map((x)=><article key={x.name}><span className={`avatar ${x.tone}`}>{x.initials}</span><div className="instructor-name"><h3>{x.name}</h3><p>{x.role}</p></div><div className="rating"><span>★</span><b>{x.score}</b><small>완료 {x.sessions}회</small></div><span className={x.state==="진행 가능"?"available":"pending"}>{x.state}</span><button>프로필 보기 →</button></article>)}</div><div className="import-callout"><span>↥</span><div><b>기존 강사 명단을 한 번에 가져오세요</b><p>엑셀 또는 강사 프로필 파일을 올리면 AI가 개인정보와 경력을 자동 분류합니다.</p></div><button>파일 가져오기</button></div></section>}

function Surveys(){return <section className="workspace-panel surveys-page"><div className="survey-hero"><div><span>✦ AI 설문 설계</span><h2>수업 내용에 맞춘 질문을<br/>미리 준비했습니다.</h2><p>관리자가 검토·승인하면 예약한 시간에 수강생에게 자동 발송됩니다.</p></div><div className="donut"><b>78%</b><span>평균 응답률</span></div></div><div className="survey-columns"><div><div className="section-title"><h3>검토 대기</h3><span>3</span></div>{["더존비즈온 · 생성형 AI 업무 적용","휴젤 · 의료 데이터 AI 활용","바디텍메드 · 보고서 자동화"].map((x,i)=><article key={x}><span className="survey-icon">◎</span><div><b>{x}</b><p>맞춤 문항 {12+i}개 · 필수 문항 8개</p><small>{["08. 27 교육","08. 30 교육","09. 03 교육"][i]}</small></div><button>검토 →</button></article>)}</div><div><div className="section-title"><h3>발송 예정</h3><span>2</span></div>{["강원랜드 · 현장 실무 AI","한국수자원공사 · 데이터 분석"].map((x,i)=><article key={x}><span className="survey-icon approved">✓</span><div><b>{x}</b><p>승인 완료 · 수강생 {[24,18][i]}명</p><small>{["08. 21 17:00 발송","08. 25 16:30 발송"][i]}</small></div><button>일정 →</button></article>)}</div></div></section>}

function Modal({ onClose, onCompanyCreated }: { onClose: () => void; onCompanyCreated: (company: CompanyItem) => void }) {
  type Candidate = { name: string; url: string; hostname: string; description: string; source: string };
  const [inputMode, setInputMode] = useState<"url" | "name" | "pdf">("url");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const researchCompany = async (urlValue: string, resolvedName?: string) => {
    const normalized = new URL(/^https?:\/\//i.test(urlValue) ? urlValue : `https://${urlValue}`);
    const researchResponse = await fetch("/api/companies/research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ websiteUrl: normalized.href, companyName: resolvedName }) });
    const researchResult = await researchResponse.json() as { error?: string; report?: ResearchReport; crawl?: CompanyItem["crawl"]; intelligence?: CompanyIntelligence };
    if (!researchResponse.ok || !researchResult.report) throw new Error(researchResult.error || "Gemini 기업 조사에 실패했습니다.");
    const fallbackName = normalized.hostname.replace(/^www\./, "").split(".")[0];
    const draft = { name: researchResult.report.companyName || resolvedName || fallbackName, websiteUrl: normalized.href, industry: researchResult.report.industry, research: researchResult.report, intelligence: researchResult.intelligence, crawl: researchResult.crawl, questions: researchResult.report.questions };
    const saveResponse = await fetch("/api/companies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
    const saved = await saveResponse.json() as { error?: string; company?: { id: string } };
    if (!saveResponse.ok || !saved.company) throw new Error(saved.error || "조사 결과 저장에 실패했습니다.");
    onCompanyCreated({ id: saved.company.id, name: draft.name, field: draft.industry, stage: "조사 완료", owner: "김서윤", progress: 25, date: "조사 완료", color: "blue", websiteUrl: draft.websiteUrl, research: draft.research, intelligence: draft.intelligence, crawl: draft.crawl });
    onClose();
  };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true); setError("");
    try {
      if (candidates.length) return;
      if (inputMode === "url") await researchCompany(websiteUrl);
      else {
        const form = new FormData();
        if (companyName) form.set("companyName", companyName);
        if (pdfFile) form.set("file", pdfFile);
        const response = await fetch("/api/companies/discover", { method: "POST", body: form });
        const result = await response.json() as { error?: string; companyName?: string; candidates?: Candidate[] };
        if (!response.ok || !result.candidates?.length) throw new Error(result.error || "공식 홈페이지 후보를 찾지 못했습니다.");
        setCompanyName(result.companyName || companyName); setCandidates(result.candidates);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "회사 정보를 가져오지 못했습니다.");
    } finally { setLoading(false); }
  };
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal company-discovery" onMouseDown={event => event.stopPropagation()} onSubmit={submit}><div className="modal-head"><div><span>NEW COMPANY RESEARCH</span><h2>{candidates.length ? "공식 홈페이지를 선택하세요" : "새 기업 조사"}</h2><p>{candidates.length ? `‘${companyName}’과 관련된 후보입니다. 실제 조사할 회사를 확인해 주세요.` : "URL, 회사명 또는 회사소개 PDF 중 편한 방법으로 시작하세요."}</p></div><button type="button" onClick={onClose} aria-label="닫기">×</button></div>{candidates.length ? <div className="candidate-list">{candidates.map(candidate => <button type="button" key={candidate.hostname} onClick={async()=>{setLoading(true);setError("");try{await researchCompany(candidate.url, companyName);}catch(caught){setError(caught instanceof Error?caught.message:"기업 조사에 실패했습니다.");setLoading(false);}}} disabled={loading}><span>{candidate.source}</span><b>{candidate.name || candidate.hostname}</b><small>{candidate.hostname}</small>{candidate.description && <p>{candidate.description}</p>}<em>이 회사 조사하기 →</em></button>)}</div> : <><div className="input-tabs" role="tablist">{[["url","홈페이지 URL"],["name","회사 이름"],["pdf","회사소개 PDF"]].map(([id,label])=><button type="button" role="tab" aria-selected={inputMode===id} className={inputMode===id?"active":""} onClick={()=>{setInputMode(id as "url"|"name"|"pdf");setError("");}} key={id}>{label}</button>)}</div>{inputMode === "url" && <label>회사 홈페이지 URL<input autoFocus type="text" inputMode="url" value={websiteUrl} onChange={event=>setWebsiteUrl(event.target.value)} placeholder="예: https://company.co.kr" required disabled={loading}/></label>}{inputMode === "name" && <label>회사 이름<input autoFocus value={companyName} onChange={event=>setCompanyName(event.target.value)} placeholder="예: 한주케미칼" required disabled={loading}/><small className="field-help">네이버에서 공식 홈페이지 후보를 찾습니다.</small></label>}{inputMode === "pdf" && <label>회사소개 PDF<input type="file" accept="application/pdf,.pdf" onChange={event=>setPdfFile(event.target.files?.[0]||null)} required disabled={loading}/><small className="field-help">최대 15MB · Gemini가 회사명과 홈페이지 정보를 추출합니다.</small></label>}<div className={`auto-preview ${loading?"is-loading":""}`}><span>{loading?<i className="spinner"/>:"✦"}</span><div><b>{loading?(inputMode==="url"?"기업 자료를 수집하고 분석하는 중":"공식 홈페이지 후보를 찾는 중"):"조사 범위"}</b><p>{loading?"잠시만 기다려 주세요.":"기업 개요 · 공시 및 재무 · 채용과 IT 인력 신호 · AI 교육 기회 · 경쟁사 · 니즈 질문지"}</p></div></div></>}{error&&<p className="modal-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" onClick={candidates.length?()=>setCandidates([]):onClose} disabled={loading}>{candidates.length?"다시 입력":"취소"}</button>{!candidates.length&&<button className="primary-small" disabled={loading}>{loading?"처리 중…":inputMode==="url"?"기업 조사 시작":"후보 찾기"}</button>}</div></form></div>;
}

export default function Home() {
  const [view, setView] = useState<View>("companies");
  const [modal, setModal] = useState(false);
  const [companyItems, setCompanyItems] = useState<CompanyItem[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [selectedCompany, setSelectedCompany] = useState<CompanyItem | null>(null);
  const selectCompany = (company: CompanyItem) => { setSelectedCompany(company); setView("company"); };
  const addCompany = (company: CompanyItem) => { setCompanyItems(current => [company, ...current]); setView("companies"); };
  useEffect(() => {
    fetch("/api/companies").then(async response => {
      const result = await response.json() as { companies?: Array<{ id: string; name: string; website_url: string; industry: string; research: ResearchReport; intelligence: CompanyIntelligence; crawl: CompanyItem["crawl"]; questions: string[] }> };
      if (!response.ok) throw new Error("기업 목록 조회 실패");
      setCompanyItems((result.companies || []).map(item => ({ id: item.id, name: item.name, field: item.industry, stage: "조사 완료", owner: "김서윤", progress: 25, date: "저장됨", color: "blue", websiteUrl: item.website_url, research: { ...item.research, questions: item.questions }, intelligence: item.intelligence, crawl: item.crawl })));
    }).catch(() => setCompanyItems([])).finally(() => setLoadingCompanies(false));
  }, []);
  const visibleCompany = selectedCompany || companyItems[0] || { name: "기업 조사", field: "", stage: "", owner: "", progress: 0, date: "", color: "blue" };
  const content = loadingCompanies ? <section className="workspace-panel"><div className="company-empty"><i className="spinner"/><h2>저장된 기업을 불러오는 중입니다</h2></div></section> : view === "company" && selectedCompany ? <CompanyDetail key={selectedCompany.id || selectedCompany.name} company={selectedCompany}/> : <Companies companyItems={companyItems} onSelectCompany={selectCompany}/>;
  return <div className="app-shell"><a className="skip" href="#main">본문 바로가기</a><SideNav view={view} setView={setView}/><main id="main" tabIndex={-1}><Header view={view} onNew={() => setModal(true)} selectedCompany={visibleCompany}/><div className="content">{content}</div></main><nav className="mobile-nav" aria-label="모바일 메뉴">{nav.map(item => <button key={item.id} className="active" onClick={() => setView(item.id)}><span><Icon name={item.icon}/></span>{item.label}</button>)}</nav>{modal && <Modal onClose={() => setModal(false)} onCompanyCreated={addCompany}/>}</div>;
}
