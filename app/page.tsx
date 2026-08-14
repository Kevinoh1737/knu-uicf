"use client";

import { useMemo, useState } from "react";

type View = "overview" | "companies" | "company" | "instructors" | "surveys";

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
  { id: "overview" as View, icon: "home" as IconName, label: "오늘의 운영" },
  { id: "companies" as View, icon: "building" as IconName, label: "기업 · 교육" },
  { id: "instructors" as View, icon: "person" as IconName, label: "강사 풀" },
  { id: "surveys" as View, icon: "survey" as IconName, label: "만족도 조사" },
];

const companies = [
  { name: "더존비즈온", field: "ICT · 기업용 소프트웨어", stage: "과정 설계", owner: "김서윤", progress: 72, date: "08. 19", color: "coral" },
  { name: "휴젤", field: "바이오 · 의료기기", stage: "니즈 진단", owner: "박정민", progress: 46, date: "08. 22", color: "blue" },
  { name: "바디텍메드", field: "의료 · 진단기기", stage: "강사 배정", owner: "이수현", progress: 88, date: "08. 27", color: "green" },
  { name: "일동후디스", field: "식품 · 제조", stage: "기업 조사", owner: "김서윤", progress: 24, date: "09. 03", color: "amber" },
];

const instructors = [
  { name: "한지우", initials: "HJ", role: "생성형 AI · 업무자동화", score: "4.86", sessions: 18, state: "진행 가능", tone: "mint" },
  { name: "문태경", initials: "MT", role: "AI 전략 · 데이터 분석", score: "4.72", sessions: 12, state: "일정 확인", tone: "sky" },
  { name: "최은채", initials: "CE", role: "마케팅 AI · 콘텐츠", score: "4.91", sessions: 24, state: "진행 가능", tone: "sand" },
];

function Brand() {
  return <div className="brand"><span className="brand-mark">K</span><div><strong>KNU 교육사업팀</strong><small>AI PROGRAM OPS</small></div></div>;
}

function SideNav({ view, setView }: { view: View; setView: (v: View) => void }) {
  return <aside className="sidebar">
    <Brand />
    <nav aria-label="주 메뉴">
      <p className="nav-label">WORKSPACE</p>
      {nav.map((item) => <button key={item.id} className={view === item.id || (view === "company" && item.id === "companies") ? "nav-item active" : "nav-item"} onClick={() => setView(item.id)}><span><Icon name={item.icon} /></span>{item.label}{item.id === "surveys" && <em>3</em>}</button>)}
      <p className="nav-label second">SYSTEM</p>
      <button className="nav-item"><span><Icon name="spark" /></span>AI 작업 센터</button>
      <button className="nav-item"><span><Icon name="settings" /></span>설정</button>
    </nav>
    <div className="ai-credit"><span className="spark"><Icon name="spark" size={17}/></span><div><b>AI 자동화 준비됨</b><small>Gemini 연결 후 활성화</small></div><i>→</i></div>
    <div className="profile"><span>김</span><div><b>김서윤</b><small>교육사업팀 · 관리자</small></div><button aria-label="프로필 메뉴">•••</button></div>
  </aside>;
}

function Header({ view, onNew }: { view: View; onNew: () => void }) {
  const titles: Record<View, [string, string]> = {
    overview: ["좋은 오후예요, 서윤님", "교육 운영에서 지금 필요한 일만 모았습니다."],
    companies: ["기업과 교육 프로그램", "문의부터 교육 종료까지 한 흐름으로 관리합니다."],
    company: ["더존비즈온", "기업 조사와 교육 설계를 한곳에서 이어가세요."],
    instructors: ["강사 풀", "전문분야, 일정, 평가를 기반으로 적합한 강사를 관리합니다."],
    surveys: ["만족도 조사", "수업별 맞춤 문항을 준비하고 응답을 분석합니다."],
  };
  return <header className="topbar"><div><h1>{titles[view][0]}</h1><p>{titles[view][1]}</p></div><div className="header-actions"><button className="icon-button" aria-label="검색"><Icon name="search" /></button><button className="icon-button notification" aria-label="알림"><Icon name="bell" /><i /></button><button className="primary" onClick={onNew}><span><Icon name="plus" size={16}/></span>{view === "instructors" ? "강사 등록" : "새 기업 등록"}</button></div></header>;
}

function Overview({ setView }: { setView: (v: View) => void }) {
  return <>
    <section className="focus-banner">
      <div className="focus-copy"><span className="eyebrow">TODAY’S FOCUS</span><h2>기업 2곳의 다음 단계를<br />오늘 마무리해 보세요.</h2><p>AI가 준비한 조사 결과와 질문지를 검토하면<br />교육 설계까지 더 빠르게 이어갈 수 있습니다.</p><button onClick={() => setView("companies")}>업무 이어가기 <span>→</span></button></div>
      <div className="focus-work">
        <article><div className="task-icon coral">▤</div><div><small>질문지 검토</small><strong>휴젤 니즈 진단 질문 14개</strong><p>AI 초안이 준비되었습니다</p></div><button onClick={() => setView("company")}>검토</button></article>
        <article><div className="task-icon mint">⌁</div><div><small>녹취 분석 완료</small><strong>더존비즈온 상담 · 42분</strong><p>추천 교육안 3개가 생성되었습니다</p></div><button onClick={() => setView("company")}>열기</button></article>
      </div>
    </section>

    <section className="metric-row" aria-label="운영 현황">
      <article><span className="metric-icon"><Icon name="building" /></span><div><small>진행 중인 기업</small><strong>8</strong><em>이번 달 +3</em></div></article>
      <article><span className="metric-icon"><Icon name="calendar" /></span><div><small>예정된 수업</small><strong>12</strong><em>7일 내 4건</em></div></article>
      <article><span className="metric-icon"><Icon name="person" /></span><div><small>배정 가능 강사</small><strong>26</strong><em>전문분야 11개</em></div></article>
      <article><span className="metric-icon"><Icon name="chart" /></span><div><small>평균 만족도</small><strong>4.78</strong><em className="up">상승 0.12</em></div></article>
    </section>

    <section className="dashboard-grid">
      <div className="panel pipeline"><div className="panel-head"><div><h3>교육 진행 현황</h3><p>기업별 다음 일정과 준비 상태</p></div><button onClick={() => setView("companies")}>전체 보기 →</button></div>
        <div className="company-list">{companies.map((c) => <button className="company-row" key={c.name} onClick={() => setView("company")}><span className={`company-logo ${c.color}`}>{c.name[0]}</span><div className="company-name"><b>{c.name}</b><small>{c.field}</small></div><span className="stage">{c.stage}</span><div className="progress"><i style={{ width: `${c.progress}%` }} /></div><div className="date"><small>다음 일정</small><b>{c.date}</b></div><span className="arrow">›</span></button>)}</div>
      </div>
      <div className="panel schedule"><div className="panel-head"><div><h3>다가오는 일정</h3><p>이번 주 · 8월 14–20일</p></div><button>＋</button></div>
        <div className="calendar-strip"><span><small>목</small><b>14</b></span><span className="selected"><small>금</small><b>15</b><i /></span><span><small>토</small><b>16</b></span><span><small>일</small><b>17</b></span><span><small>월</small><b>18</b></span></div>
        <div className="timeline"><article><time>10:00</time><i className="line coral-line"/><div><small>기업 상담</small><b>휴젤 니즈 진단 미팅</b><p>박정민 · Zoom</p></div></article><article><time>14:00</time><i className="line green-line"/><div><small>교육</small><b>더존비즈온 · 생성형 AI 실무</b><p>한지우 강사 · 24명</p></div></article><article><time>16:30</time><i className="line gray-line"/><div><small>내부 업무</small><b>8월 강사 배정 검토</b><p>교육사업팀 회의실</p></div></article></div>
      </div>
    </section>
  </>;
}

function Companies({ setView }: { setView: (v: View) => void }) {
  return <section className="workspace-panel"><div className="toolbar"><div className="searchbox">⌕ <input aria-label="기업 검색" placeholder="기업명, 산업, 담당자로 검색" /></div><div><button className="filter">진행 상태⌄</button><button className="filter">담당자⌄</button></div></div>
    <div className="company-cards">{companies.concat([{ name: "강원랜드", field: "관광 · 서비스", stage: "교육 완료", owner: "이수현", progress: 100, date: "완료", color: "violet" }]).map((c) => <article key={c.name} onClick={() => setView("company")} tabIndex={0}><div className="card-top"><span className={`company-logo large ${c.color}`}>{c.name[0]}</span><span className="stage">{c.stage}</span></div><h3>{c.name}</h3><p>{c.field}</p><div className="card-progress"><span><i style={{width:`${c.progress}%`}} /></span><small>{c.progress}%</small></div><dl><div><dt>담당자</dt><dd>{c.owner}</dd></div><div><dt>다음 일정</dt><dd>{c.date}</dd></div></dl><button>기업 파일 열기 <span>→</span></button></article>)}</div>
  </section>;
}

function CompanyDetail() {
  const [tab, setTab] = useState("overview");
  const [questions, setQuestions] = useState([
    "현재 구성원들이 반복적으로 많은 시간을 쓰는 업무는 무엇인가요?",
    "생성형 AI 도입을 검토하거나 시범 적용한 사례가 있나요?",
    "교육 후 3개월 안에 확인하고 싶은 구체적인 업무 변화는 무엇인가요?",
  ]);
  const addQuestion = () => setQuestions([...questions, "새 질문을 입력해 주세요."]);
  return <section className="company-detail">
    <div className="company-hero"><div className="company-identity"><span className="company-logo xl blue">더</span><div><div className="title-line"><h2>더존비즈온</h2><span>과정 설계</span></div><p>ICT · 기업용 소프트웨어 <i>·</i> www.douzone.com</p></div></div><div className="hero-actions"><button>공유</button><button className="primary-small">＋ 교육 추가</button></div></div>
    <div className="detail-tabs">{[["overview","개요"],["research","기업 조사"],["questions","니즈 질문지"],["consulting","상담 기록"],["courses","교육 과정"],["students","수강생"]].map(([id,label]) => <button className={tab===id?"active":""} onClick={()=>setTab(id)} key={id}>{label}{id === "questions" && <em>14</em>}</button>)}</div>
    {tab === "overview" && <div className="detail-grid"><div className="detail-main">
      <article className="next-action"><span>✦</span><div><small>AI가 제안하는 다음 단계</small><h3>상담 녹취 분석 결과를 검토해 주세요</h3><p>핵심 니즈 5개와 4시간 특강 3개를 구성했습니다.</p></div><button onClick={()=>setTab("consulting")}>결과 검토 →</button></article>
      <article className="process"><div className="panel-head"><div><h3>진행 여정</h3><p>문의부터 교육 운영까지의 준비 상태</p></div></div><div className="steps">{[["01","기업 조사","완료"],["02","니즈 진단","완료"],["03","과정 설계","진행 중"],["04","강사 배정","대기"],["05","교육 운영","대기"]].map((s,i)=><div className={i<2?"done":i===2?"current":""} key={s[0]}><span>{i<2?"✓":s[0]}</span><b>{s[1]}</b><small>{s[2]}</small></div>)}</div></article>
      <article className="course-preview"><div className="panel-head"><div><h3>제안 교육 구성</h3><p>상담 분석을 기반으로 생성한 4시간 단위 특강</p></div><button onClick={()=>setTab("courses")}>과정 편집 →</button></div>{["생성형 AI 업무 적용의 시작","문서·보고서 작성 자동화","사내 데이터 기반 AI 활용"].map((x,i)=><div className="course-line" key={x}><span>0{i+1}</span><div><b>{x}</b><small>4시간 · 실습 중심</small></div><em>{i===0?"강사 배정됨":"강사 필요"}</em></div>)}</article>
    </div><aside className="info-panel"><h3>기업 정보</h3><dl><div><dt>담당자</dt><dd>정예린 책임</dd></div><div><dt>연락처</dt><dd>033-250-7814</dd></div><div><dt>이메일</dt><dd>yerin.j@douzone.com</dd></div><div><dt>예상 인원</dt><dd>24명</dd></div><div><dt>교육 희망일</dt><dd>2026. 08. 27</dd></div></dl><button>정보 수정</button><hr/><h3>첨부 파일</h3><div className="file"><span>PDF</span><div><b>회사소개서_2026.pdf</b><small>AI 분석 완료 · 8.2MB</small></div></div><div className="file"><span>DOC</span><div><b>교육문의_요청사항.docx</b><small>정보 추출 완료 · 142KB</small></div></div></aside></div>}
    {tab === "research" && <ResearchTab />}
    {tab === "questions" && <section className="tab-content questions"><div className="content-title"><div><span className="ai-tag">✦ GEMINI 초안</span><h2>교육 니즈 진단 질문지</h2><p>기업 조사 결과를 바탕으로 교육과정 설계에 필요한 질문을 구성했습니다.</p></div><button onClick={addQuestion}>＋ 질문 추가</button></div>{questions.map((q,i)=><article key={i}><span>{String(i+1).padStart(2,"0")}</span><textarea aria-label={`${i+1}번 질문`} value={q} onChange={(e)=>setQuestions(questions.map((x,j)=>j===i?e.target.value:x))}/><button onClick={()=>setQuestions(questions.filter((_,j)=>j!==i))}>×</button></article>)}<div className="savebar"><span>마지막 자동 저장 · 방금 전</span><button>질문지 확정</button></div></section>}
    {tab === "consulting" && <ConsultingTab />}
    {tab === "courses" && <CoursesTab />}
    {tab === "students" && <StudentsTab />}
  </section>;
}

function ResearchTab(){return <section className="tab-content research"><div className="content-title"><div><span className="ai-tag">✦ 웹 · 첨부파일 분석 완료</span><h2>기업 인텔리전스 리포트</h2><p>홈페이지 38개 페이지와 첨부파일 3개, 동종업계 5개사를 분석했습니다.</p></div><button>다시 조사</button></div><div className="research-grid"><article><small>기업 한눈에 보기</small><h3>ERP 시장을 이끄는<br/>AI 전환 추진 기업</h3><p>기업용 소프트웨어와 클라우드 플랫폼을 기반으로 중소·중견기업의 디지털 전환을 지원합니다. 최근 AI 기반 업무 자동화 제품군을 확대하고 있습니다.</p><div className="chips"><span>ERP</span><span>클라우드</span><span>AI 자동화</span></div></article><article><small>AI 교육 기회</small><ul><li><b>부서별 활용 편차</b><span>실무 공통 활용법과 직무별 사례 필요</span></li><li><b>데이터 보안 우려</b><span>사내 정보 취급 원칙을 포함한 교육 필요</span></li><li><b>도입 성과 측정</b><span>교육 전후 생산성 지표 정의 필요</span></li></ul></article><article className="competitor"><small>동종업계 벤치마크</small><h3>경쟁사 AI 활용 신호</h3>{["영림원소프트랩","SAP Korea","한글과컴퓨터"].map((x,i)=><div key={x}><span>{i+1}</span><b>{x}</b><em>{["업무 AI 어시스턴트","기업용 AI 플랫폼","문서 생산성 AI"][i]}</em></div>)}</article></div><div className="source-note">출처와 원문 링크는 각 분석 문장에 연결됩니다. 관리자가 사실 여부를 검토한 뒤 질문지에 반영할 수 있습니다.</div></section>}

function ConsultingTab(){const [uploaded,setUploaded]=useState(false);return <section className="tab-content consulting"><div className="content-title"><div><span className="ai-tag">✦ 상담 분석</span><h2>상담 기록과 녹취</h2><p>전체 대화를 보존하고 교육 니즈, 제약조건, 과정 제안을 추출합니다.</p></div><button>상담 메모 추가</button></div>{!uploaded?<div className="upload-zone" onClick={()=>setUploaded(true)}><span>↑</span><h3>녹취파일을 놓거나 선택하세요</h3><p>MP3, M4A, WAV · 최대 2GB · 업로드 후 Gemini가 자동으로 전사합니다.</p><button>파일 선택</button></div>:<div className="transcript"><div className="audio-bar"><button>▶</button><div><b>더존비즈온_니즈상담_0812.m4a</b><small>42:18 · 전사 및 화자 분리 완료</small></div><span>분석 완료</span></div><div className="insight-row"><article><small>핵심 니즈</small><b>문서 생산성 향상</b><p>반복 보고서와 제안서 작성 시간을 줄이는 실습 요구</p></article><article><small>교육 대상</small><b>실무자 24명</b><p>기획·영업·지원 직군 혼합, AI 경험은 초급</p></article><article><small>운영 제약</small><b>보안 환경 실습</b><p>개인정보·사내 데이터 입력 금지 원칙 포함 필요</p></article></div><div className="dialogue"><p><b>정예린 책임</b><span>보고서 초안을 만드는 데 팀별로 시간이 꽤 많이 들어요. 단순 이론보다 실제 문서를 가지고 연습했으면 합니다.</span><time>12:42</time></p><p><b>김서윤</b><span>교육 이후 바로 사용할 수 있는 템플릿까지 결과물로 가져가도록 설계해 보겠습니다.</span><time>13:08</time></p></div></div>}</section>}

function CoursesTab(){return <section className="tab-content courses"><div className="content-title"><div><span className="ai-tag">✦ 상담 기반 추천</span><h2>교육과정 설계</h2><p>모든 과정은 기본 4시간 특강 단위이며 필요에 따라 묶어 운영합니다.</p></div><button>＋ 과정 추가</button></div>{["생성형 AI 업무 적용의 시작","문서·보고서 작성 자동화","사내 데이터 기반 AI 활용"].map((x,i)=><article key={x}><div className="course-number">0{i+1}</div><div className="course-body"><div><span>{i===0?"FOUNDATION":i===1?"PRACTICE":"ADVANCED"}</span><h3>{x}</h3><p>{["생성형 AI의 원리와 안전한 프롬프트 작성법을 익힙니다.","보고서, 제안서, 회의록을 실제 업무 템플릿으로 자동화합니다.","보안 원칙 안에서 사내 데이터를 분석하고 인사이트를 도출합니다."][i]}</p></div><dl><div><dt>시간</dt><dd>4시간</dd></div><div><dt>형태</dt><dd>이론 30% · 실습 70%</dd></div><div><dt>강사</dt><dd>{i===0?"한지우 강사":"배정 필요"}</dd></div></dl></div><button>편집</button></article>)}</section>}

function StudentsTab(){return <section className="tab-content students"><div className="content-title"><div><h2>수강생 관리</h2><p>직접 등록하거나 엑셀·PDF·한글 명단에서 정보를 추출합니다.</p></div><div><button>파일로 가져오기</button><button className="primary-small">＋ 수강생 추가</button></div></div><div className="student-summary"><span><b>24</b>신청</span><span><b>21</b>참석 예정</span><span><b>3</b>확인 필요</span></div><table><thead><tr><th>이름</th><th>부서 · 직급</th><th>이메일</th><th>참석 상태</th></tr></thead><tbody>{[["박지훈","AX전략팀 · 과장","jh.park@douzone.com","참석"],["윤하늘","서비스기획팀 · 대리","hn.yoon@douzone.com","참석"],["송민재","영업지원팀 · 책임","mj.song@douzone.com","확인 필요"]].map(x=><tr key={x[0]}><td><b>{x[0]}</b></td><td>{x[1]}</td><td>{x[2]}</td><td><span className={x[3]==="참석"?"attend":"check"}>{x[3]}</span></td></tr>)}</tbody></table></section>}

function Instructors(){return <section className="workspace-panel"><div className="instructor-summary"><div><span>등록 강사</span><b>32명</b></div><div><span>이번 달 진행</span><b>11명</b></div><div><span>평균 평가</span><b>4.76</b></div><div className="expertise"><span>주요 전문분야</span><p><i>생성형 AI</i><i>데이터 분석</i><i>업무자동화</i></p></div></div><div className="toolbar"><div className="searchbox">⌕ <input placeholder="강사명 또는 전문분야 검색" aria-label="강사 검색" /></div><button className="filter">진행 가능⌄</button></div><div className="instructor-list">{instructors.map((x)=><article key={x.name}><span className={`avatar ${x.tone}`}>{x.initials}</span><div className="instructor-name"><h3>{x.name}</h3><p>{x.role}</p></div><div className="rating"><span>★</span><b>{x.score}</b><small>완료 {x.sessions}회</small></div><span className={x.state==="진행 가능"?"available":"pending"}>{x.state}</span><button>프로필 보기 →</button></article>)}</div><div className="import-callout"><span>↥</span><div><b>기존 강사 명단을 한 번에 가져오세요</b><p>엑셀 또는 강사 프로필 파일을 올리면 AI가 개인정보와 경력을 자동 분류합니다.</p></div><button>파일 가져오기</button></div></section>}

function Surveys(){return <section className="workspace-panel surveys-page"><div className="survey-hero"><div><span>✦ AI 설문 설계</span><h2>수업 내용에 맞춘 질문을<br/>미리 준비했습니다.</h2><p>관리자가 검토·승인하면 예약한 시간에 수강생에게 자동 발송됩니다.</p></div><div className="donut"><b>78%</b><span>평균 응답률</span></div></div><div className="survey-columns"><div><div className="section-title"><h3>검토 대기</h3><span>3</span></div>{["더존비즈온 · 생성형 AI 업무 적용","휴젤 · 의료 데이터 AI 활용","바디텍메드 · 보고서 자동화"].map((x,i)=><article key={x}><span className="survey-icon">◎</span><div><b>{x}</b><p>맞춤 문항 {12+i}개 · 필수 문항 8개</p><small>{["08. 27 교육","08. 30 교육","09. 03 교육"][i]}</small></div><button>검토 →</button></article>)}</div><div><div className="section-title"><h3>발송 예정</h3><span>2</span></div>{["강원랜드 · 현장 실무 AI","한국수자원공사 · 데이터 분석"].map((x,i)=><article key={x}><span className="survey-icon approved">✓</span><div><b>{x}</b><p>승인 완료 · 수강생 {[24,18][i]}명</p><small>{["08. 21 17:00 발송","08. 25 16:30 발송"][i]}</small></div><button>일정 →</button></article>)}</div></div></section>}

function Modal({ type, onClose }: { type: "company"|"instructor"; onClose:()=>void }){return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal" onMouseDown={e=>e.stopPropagation()} onSubmit={e=>{e.preventDefault();onClose();}}><div className="modal-head"><div><span>{type==="company"?"NEW COMPANY":"NEW INSTRUCTOR"}</span><h2>{type==="company"?"새 기업 등록":"새 강사 등록"}</h2><p>{type==="company"?"이름이나 URL 하나만 입력하면 나머지는 AI가 채웁니다.":"프로필 파일을 올리면 경력과 전문분야를 자동으로 정리합니다."}</p></div><button type="button" onClick={onClose}>×</button></div>{type==="company"?<><label>기업명 또는 홈페이지 URL<input autoFocus placeholder="예: https://company.co.kr" required/></label><div className="auto-preview"><span>✦</span><div><b>자동으로 준비할 정보</b><p>사업자 정보 · 산업 분류 · 담당 연락처 · 회사 소개 · 첨부 브로슈어 · 경쟁사 후보</p></div></div></>:<><label>강사 이름<input autoFocus placeholder="이름을 입력하세요" required/></label><div className="drop-mini">프로필 파일을 여기에 놓으세요 <small>PDF, DOCX, HWP, XLSX</small></div></>}<div className="modal-actions"><button type="button" onClick={onClose}>취소</button><button className="primary-small">{type==="company"?"기업 조사 시작":"강사 등록"}</button></div></form></div>}

export default function Home(){const [view,setView]=useState<View>("overview");const [modal,setModal]=useState<null|"company"|"instructor">(null);const content=useMemo(()=>({overview:<Overview setView={setView}/>,companies:<Companies setView={setView}/>,company:<CompanyDetail/>,instructors:<Instructors/>,surveys:<Surveys/>})[view],[view]);return <div className="app-shell"><a className="skip" href="#main">본문 바로가기</a><SideNav view={view} setView={setView}/><main id="main" tabIndex={-1}><Header view={view} onNew={()=>setModal(view==="instructors"?"instructor":"company")}/><div className="content">{content}</div></main><nav className="mobile-nav" aria-label="모바일 메뉴">{nav.map(x=><button key={x.id} className={view===x.id||view==="company"&&x.id==="companies"?"active":""} onClick={()=>setView(x.id)}><span><Icon name={x.icon}/></span>{x.label.split(" ")[0]}</button>)}</nav>{modal&&<Modal type={modal} onClose={()=>setModal(null)}/>}</div>}
