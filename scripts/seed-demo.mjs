/**
 * 시연용 데이터 한 벌.
 *
 * 시연은 두 갈래로 간다:
 *   1) 한주케미칼 — 시연 자리에서 처음부터 만든다(조사 → 면담 → 교육과정 → 만족도).
 *      그래서 이 스크립트는 한주케미칼을 만들지 않는다.
 *   2) 글로벌이엔피 — 모든 단계가 이미 끝난 회사. 조사·질문지·담당자·상담 요약·
 *      교육과정 3건(구성/자료/계약)·수강생·만족도까지 채워 둔다.
 * 신티아·톤28·에이원비앤에이치는 배경이다. 화면이 한 회사짜리로 보이지 않게 하고,
 * 무엇보다 강사별 비교가 성립하게 한다 — 비교 화면은 두 번 이상 진행한 강사만 고를 수
 * 있어서, 한 사람이 여러 회사에 걸쳐 강의한 이력이 있어야 뜻이 있다.
 *
 * 실행:  node --env-file=.env.local scripts/seed-demo.mjs
 * 지우기: node --env-file=.env.local scripts/seed-demo.mjs --clean
 * 답 갱신: node --env-file=.env.local scripts/seed-demo.mjs --refresh
 *
 * 두 번 돌려도 늘어나지 않는다(회사 이름·교육 제목으로 이미 있는 것을 찾아 쓴다).
 *
 * 이메일과 홈페이지 주소는 전부 example 도메인이다. 지어낸 회사에 실재하는 주소를 붙이면
 * 남의 사이트로 링크가 걸리고, 실습 중 눌린 발송 버튼이 남의 메일함으로 간다.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다. --env-file=.env.local 로 실행하세요.");
  process.exit(1);
}

const HEADERS = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

async function rest(path, init = {}) {
  const response = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...HEADERS, ...(init.headers || {}) } });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${init.method || "GET"} ${path} → ${response.status} ${text}`);
  return body;
}

const get = (path) => rest(path);
const insert = (table, rows) =>
  rest(table, { method: "POST", body: JSON.stringify(rows), headers: { Prefer: "return=representation" } });
const patch = (path, body) => rest(path, { method: "PATCH", body: JSON.stringify(body) });

/** 시연은 매번 같은 그림이어야 한다. 난수를 쓰면 어제 본 숫자와 오늘 숫자가 달라진다. */
function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** 평균 주변으로 흩어진 1~5 점수 하나. 사람은 평균을 답하지 않고 그 언저리를 답한다. */
function scoreAround(mean, random) {
  const spread = (random() + random() + random() - 1.5) * 1.15;
  return Math.min(5, Math.max(1, Math.round(mean + spread)));
}

const AX_QUESTIONS = [
  "회사의 주요 부서와 각 부서의 역할은 무엇이며, 제품·서비스와 매출을 만드는 데 가장 핵심적인 부서는 어디인가요?",
  "회사 전체에서 매일·매주·매월 반복되는 업무 중 사람의 시간과 수작업이 가장 많이 드는 업무는 무엇인가요?",
  "그 반복 업무는 현재 어느 부서에서 어떤 절차와 도구로 처리하고 있나요?",
  "이번 AI 교육을 통해 가장 먼저 개선하려는 업무나 현장 문제는 무엇인가요?",
  "현재 사내에서 사용 중이거나 시험해 본 AI 도구와 활용 사례가 있나요?",
  "4시간 교육을 마친 뒤 참가자가 실제로 완성하거나 수행할 수 있어야 하는 결과물은 무엇인가요?",
  "필요한 교육 수준은 AI 이해, 기초 활용, 현업 실습, 업무 자동화 중 어디에 가장 가깝나요?",
  "4시간 과정 한 번으로 충분한가요, 아니면 주제별로 여러 과정을 운영해야 하나요?",
  "교육 참석 예정 인원과 최소·최대 예상 인원은 몇 명인가요?",
  "참석자의 부서, 담당 업무, 직급은 어떻게 구성되며 관리자와 실무자의 비율은 어느 정도인가요?",
  "참석자의 대략적인 연령대와 성비는 어떻게 구성되나요?",
  "참석자들의 AI 도구 사용 경험과 컴퓨터·데이터 활용 수준은 어느 정도인가요?",
  "실습에 사용할 개인별 PC, 인터넷, AI 서비스 계정과 필요한 프로그램을 준비할 수 있나요?",
  "사내 자료 반출, 개인정보, 보안망, 외부 AI 서비스 사용과 관련된 제한이 있나요?",
  "강사에게 필요한 산업 경험, 업무 전문성, AI 기술 수준과 선호하는 강의 방식은 무엇인가요?",
  "강사가 실습을 준비할 수 있도록 제공 가능한 업무 문서, 양식, 데이터 예시, 화면 또는 작업 절차가 있나요?",
  "가능한 교육 일정, 장소, 진행 방식과 현장에서 지원할 담당자는 어떻게 되나요?",
  "교육 후 1~3개월 안에 어떤 업무 변화나 성과가 나타나면 교육이 성공했다고 볼 수 있나요?",
];

// ─── 회사 ────────────────────────────────────────────────────────────────────

const GLOBAL_ENP_RESEARCH = {
  companyName: "글로벌이엔피주식회사",
  industry: "산업용 플랜트 배관·기계설비 설계 및 시공",
  headline: "발전소와 석유화학 플랜트의 배관·기계설비를 설계하고 현장에 세우는 회사",
  summary:
    "발전소, 석유화학, 반도체 공장처럼 고온·고압 유체를 다루는 설비의 배관과 기계설비를 설계하고 시공한다. 도면을 그리는 일과 현장에서 세우는 일을 한 회사가 함께 맡는 것이 특징이며, 그래서 설계 부서와 현장 부서 사이를 오가는 문서가 많다. 수주는 대부분 원청 EPC 업체의 입찰과 지명 견적으로 이루어진다.",
  keywords: ["플랜트 배관", "기계설비 시공", "배관 자재 산출", "시방서 검토", "현장 안전관리"],
  comparisonTags: ["제조업", "건설·시공", "B2B 수주", "현장 인력 운영"],
  business: {
    whatTheyDo:
      "고객사가 준 기본 설계와 시방서를 읽고 상세 배관 도면을 그린 뒤, 필요한 자재를 뽑아 구매하고, 현장에 인력을 보내 설치와 시험까지 마친다.",
    offerings: [
      "플랜트 배관 상세설계 및 3D 모델링",
      "기계설비 제작·설치 시공",
      "배관 자재 산출(BOM)과 구매 대행",
      "시운전 지원 및 준공 도서 작성",
    ],
    customers: "국내 EPC 원청사, 발전 공기업, 석유화학 플랜트 운영사, 반도체 공장 설비 부문",
    workFlow:
      "입찰 공고·지명 견적 접수 → 시방서와 도면 검토 → 물량 산출과 견적 → 수주 → 상세설계 → 자재 발주 → 현장 시공 → 시운전 → 준공 도서 제출",
  },
  evidence: [
    { claim: "발전 및 석유화학 플랜트 배관 상세설계와 시공을 함께 수행한다", url: "https://globalenp.example.com/business" },
    { claim: "현장 인력은 프로젝트 단위로 편성되며 상시 인력과 협력사 인력이 섞인다", url: "https://globalenp.example.com/company" },
    { claim: "수주 대부분이 원청 EPC 업체의 입찰과 지명 견적으로 이루어진다", url: "https://globalenp.example.com/project" },
    { claim: "품질·안전 인증을 갖추고 정기 안전점검을 운영한다", url: "https://globalenp.example.com/quality" },
  ],
  glossary: [
    { term: "BOM (자재 산출서)", meaning: "도면에 그려진 배관과 부속품을 종류·규격별로 세어 정리한 목록. 견적과 구매의 근거가 된다." },
    { term: "시방서", meaning: "고객사가 요구하는 자재 규격, 시공 방법, 검사 기준을 적은 문서. 도면보다 먼저 읽어야 하는 조건표다." },
    { term: "아이소메트릭 도면", meaning: "배관 한 줄을 입체로 펼쳐 그린 시공용 도면. 현장에서 이 도면 한 장으로 배관을 만든다." },
    { term: "TBM (작업 전 회의)", meaning: "현장에서 작업 시작 전 위험 요소를 공유하는 짧은 회의. 매일 기록을 남겨야 한다." },
  ],
  opportunities: [
    {
      title: "시방서에서 우리 조건과 다른 항목만 골라내기",
      detail:
        "프로젝트마다 수백 쪽짜리 시방서를 처음부터 읽는데, 실제로 중요한 것은 표준과 다른 몇 개 항목이다. 이 대조를 사람이 눈으로 하고 있어 놓치면 그대로 손실이 된다.",
      outcome: "시방서 비교용 프롬프트와 확인 항목 체크리스트",
      audience: "설계팀 · 견적 담당",
    },
    {
      title: "작업일보와 안전점검 기록 초안 자동 작성",
      detail:
        "현장 소장이 하루를 마치고 손으로 쓰는 작업일보와 TBM 기록이 매일 40분씩 든다. 사진과 짧은 메모에서 문장을 만들어 내는 것이 가장 빠른 효과를 낸다.",
      outcome: "현장 사진·메모 → 일보 초안 생성 절차",
      audience: "현장 소장 · 공무 담당",
    },
    {
      title: "입찰 공고문에서 자격 요건과 기한 뽑아내기",
      detail:
        "나라장터와 원청 포털의 공고를 매일 확인하는데, 조건을 잘못 읽어 준비하다 포기한 건이 있었다. 자격 요건·제출 서류·기한을 표로 정리하는 일이 반복된다.",
      outcome: "공고문 요약 표와 자격 요건 대조 결과",
      audience: "영업팀 · 견적 담당",
    },
  ],
  educationContext: {
    currentWork: "시방서 검토와 물량 산출, 상세설계, 현장 작업일보와 안전 기록 작성",
    startingPoint: "긴 문서에서 조건을 찾아내는 일과 반복되는 보고서 초안 작성",
    likelyLearners: ["배관 설계 엔지니어", "견적·공무 담당자", "현장 소장 및 안전 담당"],
    caution:
      "설계 수치와 자재 규격은 AI 가 그럴듯하게 틀린 값을 내놓기 쉽다. 도면과 계산은 반드시 사람이 확인하는 것을 전제로 다뤄야 한다.",
  },
  questions: AX_QUESTIONS,
};

const COMPANIES = [
  {
    key: "글로벌이엔피",
    name: "글로벌이엔피",
    industry: "산업용 플랜트 배관·기계설비 설계 및 시공",
    website: "https://globalenp.example.com",
    stage: "training_complete",
    research: GLOBAL_ENP_RESEARCH,
    contact: {
      name: "정해린", position: "팀장", department: "기술기획팀",
      email: "haerin.jung@globalenp.example.com", phone: "031-486-2270",
    },
  },
  {
    key: "신티아",
    name: "신티아",
    industry: "AI 소프트웨어 개발 및 기술 컨설팅",
    website: "https://cyntia.example.com",
    stage: "training_complete",
    research: {
      companyName: "주식회사 신티아",
      industry: "AI 소프트웨어 개발 및 기술 컨설팅",
      headline: "기업 업무에 AI 를 붙이는 소프트웨어를 만들고 그 도입을 돕는 회사",
      summary:
        "기업 내부 문서와 업무 흐름에 맞춘 AI 도구를 개발하고, 도입 과정을 함께 설계한다. 개발 인력이 다수이지만 영업·운영 부서는 AI 활용 편차가 커서 사내 교육 수요가 있다.",
      keywords: ["AI 소프트웨어", "업무 자동화", "기술 컨설팅", "사내 도구", "문서 처리"],
      comparisonTags: ["IT·소프트웨어", "B2B", "지식 노동", "AI 활용"],
      business: {
        whatTheyDo: "고객사의 업무 흐름을 분석해 AI 기능을 붙인 사내 도구를 만들고 운영을 돕는다.",
        offerings: ["업무용 AI 도구 개발", "AI 도입 컨설팅", "사내 데이터 정리와 연동"],
        customers: "중견 제조사, 금융·보험사 백오피스 부서, 공공기관",
        workFlow: "업무 진단 → 기능 설계 → 개발 → 사내 시범 운영 → 확산 교육",
      },
      evidence: [], glossary: [], opportunities: [],
      educationContext: {
        currentWork: "제안서 작성, 고객 문의 대응, 회의록 정리",
        startingPoint: "비개발 부서의 문서 업무",
        likelyLearners: ["영업·마케팅", "경영지원", "고객 지원"],
        caution: "개발 부서와 비개발 부서의 출발점이 크게 다르다.",
      },
      questions: AX_QUESTIONS,
    },
    contact: { name: "서지훈", position: "이사", department: "경영지원", email: "jihoon.seo@cyntia.example.com", phone: "02-6959-3140" },
  },
  {
    key: "톤28",
    name: "톤28",
    industry: "화장품 제조 및 브랜드 운영",
    website: "https://toun.example.com",
    stage: "training_complete",
    research: {
      companyName: "톤28",
      industry: "화장품 제조 및 브랜드 운영",
      headline: "피부와 계절에 맞춰 나눠 만드는 화장품 브랜드",
      summary:
        "자체 브랜드 화장품을 기획·제조하고 온라인 중심으로 판매한다. 콘텐츠 제작 빈도가 높아 마케팅 부서의 반복 작업이 많다.",
      keywords: ["화장품", "브랜드", "이커머스", "콘텐츠 제작", "상세페이지"],
      comparisonTags: ["소비재", "유통·이커머스", "B2C", "콘텐츠"],
      business: {
        whatTheyDo: "화장품을 기획해 제조하고 자사몰과 온라인 채널에서 판매한다.",
        offerings: ["자체 브랜드 스킨케어", "정기 구독 상품", "기획 세트"],
        customers: "20~40대 개인 소비자, 온라인 편집숍",
        workFlow: "제품 기획 → 제조 → 콘텐츠 제작 → 채널 등록 → 판매·CS",
      },
      evidence: [], glossary: [], opportunities: [],
      educationContext: {
        currentWork: "상세페이지 카피, SNS 콘텐츠, 고객 문의 응대",
        startingPoint: "브랜드 말투를 지키면서 초안을 빠르게 만드는 일",
        likelyLearners: ["마케팅 실무자", "MD", "고객 응대"],
        caution: "브랜드 말투가 흐트러지면 쓰지 않게 된다.",
      },
      questions: AX_QUESTIONS,
    },
    contact: { name: "노아름", position: "실장", department: "마케팅", email: "areum.noh@toun.example.com", phone: "02-3144-7708" },
  },
  {
    key: "에이원비앤에이치",
    name: "에이원비앤에이치",
    industry: "건강기능식품 제조 및 온라인 유통",
    website: "https://aonebnh.example.com",
    stage: "training_complete",
    research: {
      companyName: "에이원비앤에이치주식회사",
      industry: "건강기능식품 제조 및 온라인 유통",
      headline: "건강기능식품을 만들어 온라인 채널로 파는 회사",
      summary:
        "건강기능식품을 위탁 제조해 자사몰과 오픈마켓에서 판매한다. 표시·광고 규정이 엄격해 문구를 다루는 일에 검수 부담이 크다.",
      keywords: ["건강기능식품", "온라인 유통", "상세페이지", "표시광고", "오픈마켓"],
      comparisonTags: ["소비재", "유통·이커머스", "B2C", "규제 산업"],
      business: {
        whatTheyDo: "제품을 기획해 위탁 제조하고 온라인 채널에서 판매한다.",
        offerings: ["비타민·미네랄 제품군", "체중 관리 제품군", "선물 세트"],
        customers: "30~60대 개인 소비자, 오픈마켓 채널",
        workFlow: "제품 기획 → 위탁 제조 → 표시·광고 검토 → 채널 등록 → 판매·CS",
      },
      evidence: [], glossary: [], opportunities: [],
      educationContext: {
        currentWork: "상세페이지 제작, 표시·광고 문구 검토, 채널별 등록",
        startingPoint: "규정을 지키면서 상세페이지 초안을 빠르게 만드는 일",
        likelyLearners: ["온라인 마케팅", "MD", "품질·인허가"],
        caution: "표시·광고 규정을 벗어난 문구는 그대로 쓰면 안 된다. 검수 단계를 반드시 남긴다.",
      },
      questions: AX_QUESTIONS,
    },
    contact: { name: "구본휘", position: "팀장", department: "온라인사업부", email: "bonhwi.koo@aonebnh.example.com", phone: "031-905-6612" },
  },
];

// ─── 상담(면담) 기록 — 글로벌이엔피 ──────────────────────────────────────────

const CONSULTATION_TURNS = [
  ["김주희", "팀장님, 안녕하세요. 강원대학교 산학협력단 교육사업팀 김주희입니다. 오늘 시간 내 주셔서 감사합니다."],
  ["정해린", "네, 안녕하세요. 저희가 교육을 받아 본 적이 거의 없어서 뭘 물어보실지 궁금했습니다."],
  ["김주희", "정답을 확인하는 자리가 아니라 지금 어떻게 일하고 계신지 듣는 자리입니다. 먼저 부서 구성부터 여쭐게요."],
  ["정해린", "설계팀이 열두 명, 견적·공무가 다섯 명, 현장은 프로젝트마다 편성되는데 상시로는 여덟 명 정도입니다. 관리는 네 명이고요."],
  ["김주희", "그 중에서 매출을 만드는 데 가장 핵심적인 부서는 어디라고 보십니까?"],
  ["정해린", "설계팀입니다. 도면이 늦으면 현장이 통째로 밀리니까요. 그런데 정작 시간을 제일 많이 잡아먹는 건 설계 앞단이에요."],
  ["김주희", "앞단이라면 어떤 일인가요?"],
  ["정해린", "시방서 검토입니다. 프로젝트 하나에 시방서가 삼백 쪽씩 옵니다. 그걸 처음부터 끝까지 읽어야 하는데, 사실 중요한 건 우리 표준과 다른 몇 개 항목이거든요."],
  ["김주희", "그 몇 개를 찾으려고 삼백 쪽을 읽으시는 거군요."],
  ["정해린", "그렇죠. 한 프로젝트에 이틀은 잡습니다. 그런데 작년에 한 번, 배관 재질 등급이 우리 표준과 다른 걸 놓쳐서 자재를 다시 산 적이 있습니다. 금액으로는 천만 원 넘게 나갔고요."],
  ["김주희", "그 다음으로 시간이 많이 드는 일은요?"],
  ["정해린", "현장 작업일보하고 TBM 기록입니다. 소장님들이 하루 끝나고 손으로 쓰시는데 매일 사십 분씩 걸립니다. 사진은 찍어 두시는데 그걸 문장으로 옮기는 게 일이에요."],
  ["정해린", "솔직히 말씀드리면 소장님들이 제일 싫어하시는 일입니다. 몸 쓰는 일 하고 와서 앉아서 글 쓰는 거라."],
  ["김주희", "물량 산출은 어떻습니까? BOM 이라고 하셨던."],
  ["정해린", "그건 캐드에서 뽑아내니까 자동에 가깝습니다. 다만 뽑은 걸 견적 양식에 옮기면서 담당자마다 정리하는 방식이 달라서, 나중에 원가를 비교하려고 하면 못 합니다."],
  ["김주희", "입찰 쪽은 어떠세요?"],
  ["정해린", "매일 아침에 나라장터하고 원청 포털을 봅니다. 한 시간 정도요. 작년에 자격 요건을 잘못 읽고 준비하다가 중간에 포기한 건이 있어서, 지금은 두 사람이 겹쳐서 봅니다."],
  ["김주희", "지금 사내에서 쓰고 계신 AI 도구가 있으신가요?"],
  ["정해린", "설계팀 젊은 친구 두세 명이 개인적으로 챗지피티를 씁니다. 회사 차원에서는 없습니다. 나머지 분들은 계정도 없으세요."],
  ["김주희", "교육이 끝났을 때 참석자가 손에 들고 나가야 하는 결과물은 무엇이면 좋을까요?"],
  ["정해린", "본인 업무에서 실제로 쓴 것 하나였으면 합니다. 설계 쪽은 시방서 비교표, 현장 쪽은 작업일보 초안 이런 식으로요."],
  ["김주희", "참석 인원과 구성은 어떻게 예상하십니까?"],
  ["정해린", "열네 명 정도요. 설계 여섯, 견적·공무 넷, 현장 셋, 관리 하나. 연령은 삼십대가 다섯, 사십대가 여섯, 오십대가 셋입니다."],
  ["김주희", "컴퓨터나 데이터를 다루는 수준은 어느 정도인가요?"],
  ["정해린", "캐드는 다들 잘 씁니다. 엑셀도 기본은 하시고요. 다만 함수를 넘어가면 사람마다 편차가 큽니다."],
  ["김주희", "실습용 PC 와 계정은 준비가 가능하실까요?"],
  ["정해린", "노트북은 각자 가져올 수 있습니다. 공장 교육장에 유선 인터넷이 있고요. 계정은 무료로 만들면 될 것 같은데, 회사 메일로 가입하는 건 좀 걸립니다."],
  ["김주희", "자료 반출이나 보안 쪽 제한은 어떻습니까?"],
  ["정해린", "고객사 도면은 절대 못 나갑니다. 계약서에 비밀유지가 걸려 있어서요. 시방서도 마찬가지고요."],
  ["정해린", "그래서 실습을 어떻게 하실지가 저희 쪽 걱정입니다. 진짜 문서를 못 쓰는데 연습이 되겠나 싶어서요."],
  ["김주희", "그 부분은 고객사명과 수치를 지운 가공 문서로 진행합니다. 양식과 문장 구조는 그대로 두니까 연습은 됩니다."],
  ["정해린", "그러면 저희가 지난 프로젝트 시방서에서 회사명 지운 걸 드릴 수 있습니다."],
  ["김주희", "강사에게 바라시는 점이 있으실까요?"],
  ["정해린", "현장을 아는 분이면 좋겠습니다. 예전에 다른 교육에서 강사님이 플랜트를 전혀 모르셔서, 질문을 해도 답이 안 돌아왔거든요. 그때 분위기가 식었습니다."],
  ["김주희", "일정과 장소는 어떻게 잡으면 좋을까요?"],
  ["정해린", "현장이 바쁘지 않은 6월이나 8월 초 목요일이 낫습니다. 장소는 공장 교육장이 있고 스무 명까지 들어갑니다."],
  ["김주희", "마지막으로, 교육 후 한두 달 안에 무엇이 달라지면 성공이라고 보시겠습니까?"],
  ["정해린", "시방서 검토가 이틀에서 하루로 줄면 성공입니다. 작업일보는 사십 분에서 이십 분만 돼도 소장님들이 좋아하실 거고요."],
  ["김주희", "잘 들었습니다. 말씀 주신 걸로 과정을 설계해서 다시 연락드리겠습니다."],
  ["정해린", "네, 감사합니다. 기대하겠습니다."],
];

const GLOBAL_ENP_CONSULTATION = {
  fileName: "면담녹취_글로벌이엔피_20260521.mp3",
  transcript: {
    language: "ko",
    segments: CONSULTATION_TURNS.map(([speaker, text], index) => ({
      speaker, text,
      timestamp: `${String(Math.floor((index * 47) / 60)).padStart(2, "0")}:${String((index * 47) % 60).padStart(2, "0")}`,
    })),
  },
  summary: {
    overview:
      "글로벌이엔피(플랜트 배관 설계·시공)의 설계 앞단 문서 업무를 줄이기 위한 맞춤 교육. 시방서 검토와 현장 작업일보 작성이 가장 큰 시간 소모이며, 고객사 도면 반출 금지라는 제약 안에서 실습을 설계해야 한다.",
    audience: {
      headline: "총 14명 참석 예정 (설계 6·견적 공무 4·현장 3·관리 1), 40대 이상이 과반이며 CAD 는 능숙하나 AI 는 미경험",
      detail:
        "연령대는 30대 5명, 40대 6명, 50대 3명. CAD 는 전원 능숙하고 엑셀도 기본 사용이 가능하나 함수를 넘어가면 편차가 크다. AI 도구는 설계팀 2~3명이 개인적으로 ChatGPT 를 쓰는 정도이며 나머지는 계정이 없다.",
    },
    keyNeeds: [
      {
        title: "시방서에서 표준과 다른 항목만 찾아내기",
        detail:
          "프로젝트당 300쪽 시방서를 처음부터 읽어 이틀이 소요된다. 작년 배관 재질 등급 오독으로 자재 재구매 1천만원 이상 손실이 발생했다. 우리 표준과 다른 항목만 대조해 뽑아내는 실습이 필요하다.",
      },
      {
        title: "현장 작업일보와 TBM 기록 초안 작성",
        detail:
          "현장 소장이 매일 40분씩 손으로 작성한다. 사진은 이미 찍고 있으므로, 사진과 짧은 메모에서 보고서 문장을 만들어 내는 실습이 효과가 크다. 현장에서 가장 기피하는 업무이기도 하다.",
      },
      {
        title: "입찰 공고문 자격 요건 대조",
        detail:
          "매일 아침 1시간씩 나라장터와 원청 포털을 확인한다. 작년 자격 요건 오독으로 준비 중 포기한 건이 있어 현재는 두 사람이 겹쳐 확인하고 있다.",
      },
    ],
    constraints: [
      "보안: 고객사 도면과 시방서는 비밀유지 계약으로 반출 금지 — 실습은 회사명·수치를 지운 가공본으로만 진행",
      "계정: 회사 메일로 외부 서비스 가입하는 것에 부담이 있어 개인 메일 기반 무료 계정으로 진행",
      "장소·일정: 공장 교육장(20인 수용, 유선 인터넷 보유), 현장이 한가한 6월 또는 8월 초 목요일 선호",
      "장비: 노트북은 참석자가 각자 지참 가능",
    ],
    decisions: [
      "교육 목표: 시방서 검토 2일 → 1일, 작업일보 작성 40분 → 20분",
      "실습 결과물: 참석자가 본인 업무에서 실제로 쓴 산출물 1건 (설계는 시방서 비교표, 현장은 작업일보 초안)",
      "실습 자료: 회사가 지난 프로젝트 시방서에서 고객사명과 수치를 지운 가공본을 교육 전 제공",
      "과정 구성: 데이터 읽기 기초를 먼저 하고, 반응을 보아 심화 과정을 이어서 편성",
      "강사 요건: 플랜트·제조 현장을 아는 강사 — 과거 교육에서 현장을 모르는 강사로 분위기가 식은 경험이 있음",
    ],
    instructorNotes: [
      "플랜트 용어(시방서, BOM, 아이소메트릭, TBM)를 알고 들어갈 것. 질문에 답이 돌아오지 않으면 그 자리에서 신뢰를 잃는다.",
      "CAD 숙련도는 높으나 AI 는 처음이다. 도구가 낯설 뿐 학습 능력이 낮은 집단이 아니라는 전제로 진행할 것.",
      "설계 수치와 자재 규격은 AI 가 그럴듯하게 틀린다는 점을 초반에 실물로 보여 줄 것. 이 집단은 틀린 수치의 대가를 이미 겪었다.",
      "현장 소장 3명은 문서 작업 자체를 기피한다. 이분들에게는 '글을 쓰는 법'이 아니라 '글을 안 써도 되게 하는 법'으로 접근할 것.",
    ],
    followUpQuestions: [
      "가공본 시방서를 언제까지 받을 수 있는지 (실습 자료 제작에 최소 1주 필요)",
      "현장 소장 3명이 교육 당일 현장을 비울 수 있는지",
      "심화 과정을 연다면 예산이 별도로 잡히는지",
    ],
  },
};

// ─── 강사 ────────────────────────────────────────────────────────────────────

const INSTRUCTORS = {
  "오진환": {
    job_title: "프리랜서 강사", email: "ojh.lecture@example.com", phone: "010-2481-3390",
    expertise: { industries: ["제조(화학·설비)", "건설·시공", "공공 조달"], topics: ["생성형 AI 업무 적용", "문서 자동화"], tools: ["ChatGPT", "Claude", "Excel"], audienceLevels: ["AI 입문 실무자", "중간관리자"] },
    preferred_style: "설명은 짧게 하고 실습에서 돌아다니며 개별로 봅니다.",
  },
  "윤세라": {
    job_title: "프리랜서 강사", email: "sera.yoon@example.com", phone: "010-3372-5518",
    expertise: { industries: ["제조", "물류"], topics: ["생산 데이터 분석", "지표 설계", "엑셀 자동화"], tools: ["Excel", "Power Query", "Python"], audienceLevels: ["현장 관리자", "공정 담당자"] },
    preferred_style: "회사가 실제로 쌓고 있는 데이터를 먼저 보고 실습 과제를 만듭니다.",
  },
  "배도현": {
    job_title: "프리랜서 강사", email: "dh.bae@example.com", phone: "010-6640-2273",
    expertise: { industries: ["소비재", "유통·이커머스"], topics: ["AI 콘텐츠 제작", "브랜드 카피"], tools: ["ChatGPT", "Midjourney", "Canva"], audienceLevels: ["마케팅 실무자"] },
    preferred_style: "각자 자기 브랜드 소재로 결과물을 만들어 나가게 합니다.",
  },
};

// ─── 교육과정 ────────────────────────────────────────────────────────────────

/** 글로벌이엔피의 세 과정만 구성·자료·계약까지 채운다. 나머지는 배경이라 만족도만 있으면 된다. */
const DEMO = [
  {
    company: "글로벌이엔피", full: true,
    title: "생산 데이터 읽기 기초", instructor: "윤세라",
    heldOn: "2026-06-18", startTime: "13:30", durationHours: 4, headcount: 14,
    location: "공장 교육장", invited: 14, responded: 12, seed: 101,
    // 1차는 업무 관련성이 낮게 나온다. 2차에서 이것이 올라가는 것이 이 회사 데이터의 이야기다.
    means: { content_useful: 3.9, level_fit: 3.6, delivery: 4.1, relevance: 3.2, duration: 3.8, recommend: 3.7 },
    best: [
      "엑셀 실습이 유익했습니다", "그래프 읽는 법을 배운 것이 도움이 됐습니다",
      "용어를 쉽게 풀어 주셨습니다", "기초 개념 정리가 잘 되었습니다",
      "숫자를 보는 순서를 알게 됐습니다",
    ],
    improve: [
      "우리 공정 데이터로 실습했으면 합니다", "예제가 현장과 거리가 있었습니다",
      "설비 데이터를 다루는 내용이 있으면 좋겠습니다", "실제 불량 데이터로 해 봤으면 합니다",
      "시방서나 도면 쪽 예시가 없어 아쉬웠습니다",
    ],
    outline: {
      objective: "현장에서 쌓이는 생산 데이터를 엑셀로 정리하고, 그래프로 바꿔 문제가 있는 구간을 스스로 찾아낼 수 있게 되는 것",
      modules: [
        { title: "1교시 · 우리가 이미 갖고 있는 데이터 찾기", minutes: 45, mode: "강의", tools: ["Excel"], outcome: "회사에 쌓이는 데이터가 어디에 어떤 형태로 있는지 목록으로 적는다" },
        { title: "2교시 · 흩어진 표를 하나로 모으기", minutes: 60, mode: "실습", tools: ["Excel", "Power Query"], outcome: "여러 시트에 나뉜 기록을 한 표로 합친다" },
        { title: "3교시 · 그래프로 바꿔 이상한 구간 찾기", minutes: 60, mode: "실습", tools: ["Excel"], outcome: "시간에 따른 변화를 그래프로 그리고 튀는 구간을 짚는다" },
        { title: "4교시 · 매주 볼 표 한 장 만들기", minutes: 35, mode: "토의", tools: [], outcome: "우리 팀이 매주 확인할 지표 세 가지를 정한다" },
      ],
      prerequisites: ["참석자 노트북 (회사 지급 장비)", "Excel 2016 이상", "공장 교육장 유선 인터넷", "실습용 생산 기록 엑셀 (가공본)"],
      deliverables: ["한 표로 합친 생산 기록 파일", "이상 구간을 표시한 그래프", "우리 팀 주간 지표 3가지 목록"],
    },
    materials: {
      toolsUsed: ["Excel", "Power Query"],
      practiceTasks: ["여러 시트의 생산 기록 합치기", "날짜별 추이 그래프 그리기", "이상 구간 표시하기", "주간 지표 표 만들기"],
      caseExamples: [
        { title: "일반 제조업 생산량 추이 예제", tailored: false },
        { title: "설비 가동률 엑셀 샘플", tailored: false },
        { title: "불량률 월별 비교 예제", tailored: false },
        { title: "플랜트 배관 시공 물량 기록", tailored: true },
      ],
      practiceRatio: 55, slideCount: 42,
    },
    contract: { fee: 800_000, feeNote: "4시간 기준", specialTerms: ["실습 자료는 고객사가 제공한 가공본만 사용한다"] },
  },
  {
    company: "글로벌이엔피", full: true,
    title: "생산 데이터 분석 심화", instructor: "윤세라",
    heldOn: "2026-08-06", startTime: "13:30", durationHours: 6, headcount: 14,
    location: "공장 교육장", invited: 14, responded: 12, seed: 102,
    // 1차의 지적("우리 데이터로 하고 싶다")을 반영한 회차. 업무 관련성이 3.2 → 4.4 로 올라간다.
    means: { content_useful: 4.4, level_fit: 4.1, delivery: 4.3, relevance: 4.4, duration: 4.0, recommend: 4.4 },
    best: [
      "우리 공정 데이터를 그대로 써서 좋았습니다", "그래프로 보니 문제가 눈에 보였습니다",
      "엑셀만으로도 되는 게 많다는 걸 알았습니다", "1차에서 아쉬웠던 부분이 채워졌습니다",
      "실제 물량 기록으로 해서 바로 써먹을 수 있었습니다",
    ],
    improve: ["다음엔 불량 데이터도 다뤄 주세요", "시간이 조금 부족했습니다", "자동화까지 이어지는 과정이 있으면 합니다"],
    outline: {
      objective: "우리 회사 실제 기록으로 문제 구간을 찾아내고, 그 결과를 매주 반복해서 볼 수 있는 형태로 만들어 두는 것",
      modules: [
        { title: "1교시 · 1차에서 만든 표 다시 보기", minutes: 40, mode: "강의", tools: ["Excel"], outcome: "지난 과정에서 만든 표의 문제점을 짚는다" },
        { title: "2교시 · 우리 물량 기록으로 실습", minutes: 80, mode: "실습", tools: ["Excel", "Power Query"], outcome: "실제 시공 물량 기록을 정리해 프로젝트별로 비교한다" },
        { title: "3교시 · 반복되는 정리를 한 번에", minutes: 80, mode: "실습", tools: ["Power Query"], outcome: "매달 하던 정리 과정을 눌러서 갱신되게 만든다" },
        { title: "4교시 · 숫자로 설명하기", minutes: 55, mode: "토의", tools: [], outcome: "찾아낸 문제를 한 장으로 정리해 설명한다" },
      ],
      prerequisites: ["참석자 노트북", "1차 과정에서 만든 실습 파일", "회사 시공 물량 기록 (가공본, 교육 1주 전 제공)"],
      deliverables: ["프로젝트별 물량 비교표", "눌러서 갱신되는 정리 파일", "문제 구간 요약 1장"],
    },
    materials: {
      toolsUsed: ["Excel", "Power Query"],
      practiceTasks: ["시공 물량 기록 정리", "프로젝트별 비교표 만들기", "갱신 자동화 설정", "요약 한 장 작성"],
      caseExamples: [
        { title: "글로벌이엔피 2025년 배관 시공 물량 기록", tailored: true },
        { title: "프로젝트별 자재 손실률 비교", tailored: true },
        { title: "협력사별 투입 인원 추이", tailored: true },
        { title: "일반 제조업 월별 추이 예제", tailored: false },
      ],
      practiceRatio: 70, slideCount: 38,
    },
    contract: { fee: 1_200_000, feeNote: "6시간 기준", specialTerms: ["교육 1주 전까지 고객사가 가공본 데이터를 제공한다"] },
  },
  {
    company: "글로벌이엔피", full: true,
    title: "생성형 AI 업무 활용 실무", instructor: "오진환",
    heldOn: "2026-08-13", startTime: "10:00", durationHours: 4, headcount: 12,
    location: "본사 회의실", invited: 12, responded: 10, seed: 103,
    means: { content_useful: 4.5, level_fit: 4.3, delivery: 4.6, relevance: 4.2, duration: 3.9, recommend: 4.5 },
    best: [
      "시방서 비교를 그 자리에서 해 본 게 좋았습니다", "작업일보 초안이 실제로 나와서 놀랐습니다",
      "AI 가 틀리는 지점을 먼저 보여 주신 게 인상적이었습니다", "현장을 아시는 분이라 말이 통했습니다",
      "가공 데이터로도 연습이 되는 걸 알았습니다",
    ],
    improve: ["시간이 짧았습니다", "도면 쪽도 다뤄 주세요", "후속 과정이 있으면 좋겠습니다"],
    outline: {
      objective: "긴 시방서에서 우리 표준과 다른 항목을 뽑아내고, 현장 사진과 메모로 작업일보 초안을 만들어 낼 수 있게 되는 것",
      modules: [
        { title: "1교시 · 맡길 수 있는 일과 맡기면 안 되는 일", minutes: 40, mode: "강의", tools: ["ChatGPT", "Claude"], outcome: "AI 에 넘겨도 되는 업무와 사람이 반드시 확인해야 하는 업무를 구분한다" },
        { title: "2교시 · 시방서에서 다른 항목만 골라내기", minutes: 65, mode: "실습", tools: ["ChatGPT", "시방서 가공본"], outcome: "300쪽 문서에서 우리 표준과 어긋나는 항목을 표로 뽑는다" },
        { title: "3교시 · 사진과 메모로 작업일보 초안 만들기", minutes: 55, mode: "실습", tools: ["ChatGPT", "현장 사진"], outcome: "현장 사진과 한 줄 메모에서 제출용 일보 초안을 만든다" },
        { title: "4교시 · 내 업무에 붙일 자리 정하기", minutes: 25, mode: "토의", tools: [], outcome: "각자 업무에서 AI 를 적용할 후보를 고르고 우선순위를 정한다" },
      ],
      prerequisites: ["참석자 노트북", "ChatGPT 무료 계정 (개인 메일로 사전 가입)", "고객사명과 수치를 지운 시방서 가공본", "본사 회의실 빔프로젝터"],
      deliverables: ["시방서 비교표 1건", "작업일보 초안 1건", "우리 업무 AI 적용 후보 3가지 목록"],
    },
    materials: {
      toolsUsed: ["ChatGPT", "Claude"],
      practiceTasks: ["시방서 대조표 만들기", "작업일보 초안 생성", "TBM 기록 정리", "AI 오답 찾아내기"],
      caseExamples: [
        { title: "글로벌이엔피 배관 시방서 가공본 대조", tailored: true },
        { title: "현장 작업일보 초안 만들기 (플랜트 배관)", tailored: true },
        { title: "배관 재질 등급을 AI 가 틀리게 답한 화면", tailored: true },
        { title: "나라장터 공고문 자격 요건 정리", tailored: true },
        { title: "일반 사무 문서 요약 예제", tailored: false },
      ],
      practiceRatio: 65, slideCount: 51,
    },
    contract: { fee: 900_000, feeNote: "4시간 기준 · 사전 현장 방문 포함", specialTerms: ["강사는 교육 전 반나절 현장을 사전 방문한다", "고객사 원본 도면과 시방서는 반출하지 않는다"] },
  },

  // ── 배경 회사들 ──
  {
    company: "신티아",
    title: "생성형 AI 업무 활용 1차", instructor: "오진환",
    heldOn: "2026-06-12", startTime: "10:00", durationHours: 4, headcount: 18,
    location: "본사 대회의실", invited: 18, responded: 14, seed: 11,
    means: { content_useful: 4.1, level_fit: 3.3, delivery: 4.3, relevance: 3.9, duration: 3.4, recommend: 4.0 },
    best: [
      "실습 위주라 바로 써먹을 수 있었습니다", "프롬프트 예시가 구체적이어서 좋았습니다",
      "강사님 설명이 쉬웠습니다", "회의록 정리에 바로 적용해 봤습니다",
      "모르는 걸 물어보기 편한 분위기였습니다", "따라 하기만 해도 결과물이 나와서 좋았습니다",
    ],
    improve: [
      "진도가 조금 빨랐습니다", "실습 시간이 더 있었으면 합니다", "기초반과 심화반을 나눠 주세요",
      "자리마다 진도가 달라 뒤에서는 따라가기 어려웠습니다", "교재를 미리 받아 보고 싶습니다",
    ],
  },
  {
    company: "신티아",
    title: "생성형 AI 업무 활용 2차", instructor: "오진환",
    heldOn: "2026-07-10", startTime: "10:00", durationHours: 6, headcount: 18,
    location: "본사 대회의실", invited: 18, responded: 15, seed: 22,
    means: { content_useful: 4.5, level_fit: 4.2, delivery: 4.6, relevance: 4.3, duration: 4.1, recommend: 4.4 },
    best: [
      "1차보다 실습 시간이 늘어 좋았습니다", "우리 업무 사례로 진행해서 이해가 빨랐습니다",
      "속도가 알맞았습니다", "1차에서 못 따라간 부분을 다시 짚어 주셨습니다",
      "부서별 예시가 있어서 바로 써 볼 수 있었습니다",
    ],
    improve: [
      "사후 자료를 더 주시면 좋겠습니다", "고급 과정도 열어 주세요",
      "실습 파일을 미리 받고 싶습니다", "분기마다 한 번씩 있으면 좋겠습니다",
    ],
  },
  {
    company: "톤28",
    title: "AI 마케팅 콘텐츠 실무", instructor: "배도현",
    heldOn: "2026-07-24", startTime: "14:00", durationHours: 3, headcount: 12,
    location: "성수 오피스", invited: 12, responded: 10, seed: 44,
    means: { content_useful: 4.6, level_fit: 4.4, delivery: 4.7, relevance: 4.5, duration: 4.2, recommend: 4.6 },
    best: [
      "바로 콘텐츠를 만들어 본 것이 좋았습니다", "브랜드 톤에 맞춘 사례가 인상적이었습니다",
      "카피 초안을 뽑는 방법이 유용했습니다", "실무에 그대로 쓸 수 있는 형태였습니다",
    ],
    improve: ["시간이 짧아 아쉬웠습니다", "영상 제작도 다뤄 주세요", "이미지 생성 부분을 더 길게 했으면 합니다"],
  },
  {
    company: "에이원비앤에이치",
    title: "AI 상세페이지 제작 실무", instructor: "배도현",
    heldOn: "2026-08-12", startTime: "10:00", durationHours: 4, headcount: 11,
    location: "본사 세미나실", invited: 11, responded: 9, seed: 66,
    means: { content_useful: 4.4, level_fit: 4.2, delivery: 4.5, relevance: 4.3, duration: 3.8, recommend: 4.4 },
    best: ["상세페이지 초안을 그 자리에서 만들었습니다", "브랜드 말투를 잡는 방법이 유용했습니다", "이미지까지 뽑아 본 게 좋았습니다"],
    improve: ["시간이 짧았습니다", "촬영 없이 되는 범위를 더 알고 싶습니다", "실습 파일을 미리 받고 싶습니다"],
  },
];

const LEARNER_NAMES = [
  "김서연", "이준호", "박지민", "최유진", "정하늘", "강민석", "윤채원", "임도현", "한소영", "오세훈",
  "신예린", "배준영", "송민지", "권태윤", "홍지우", "문가영", "조현우", "안수빈",
];
const DEPARTMENTS = ["설계", "견적·공무", "현장", "경영지원", "영업", "품질관리"];
const TITLES = ["사원", "주임", "대리", "과장", "차장"];

const SLUG = { 글로벌이엔피: "global", 신티아: "cyntia", 톤28: "toun", 에이원비앤에이치: "aone" };

// ─── 만들기 ──────────────────────────────────────────────────────────────────

async function ensureCompany(spec) {
  const rows = await get(`company_research?select=id,name&name=eq.${encodeURIComponent(spec.name)}`);
  const record = {
    name: spec.name, website_url: spec.website, industry: spec.industry, stage: spec.stage,
    research: spec.research, questions: spec.research.questions, contact: spec.contact,
    updated_at: new Date().toISOString(),
  };
  if (rows[0]) {
    await patch(`company_research?id=eq.${rows[0].id}`, record);
    return rows[0];
  }
  const created = (await insert("company_research", record))[0];
  console.log(`기업 생성: ${spec.name}`);
  return created;
}

async function ensureInstructor(name) {
  const found = (await get(`instructors?select=id,name&name=eq.${encodeURIComponent(name)}&order=created_at`))[0];
  if (found) return found;
  return (await insert("instructors", { name, status: "active", ...INSTRUCTORS[name] }))[0];
}

async function ensureConsultation(company) {
  const existing = await get(`company_consultations?select=id&company_id=eq.${company.id}`);
  if (existing.length) return existing[0];
  const created = (await insert("company_consultations", {
    company_id: company.id,
    file_name: GLOBAL_ENP_CONSULTATION.fileName,
    // 음성 파일은 따로 올린다(demo-samples/make-audio.mjs 로 만들어 저장소에 넣고 이 행의
    // storage_path 를 채운다 — demo-samples/README.md 참고). 비워 두어도 화면은 깨지지 않고
    // 재생기만 감춰진 채 원고와 요약을 보여 준다.
    storage_path: "", mime_type: "audio/mpeg", file_size: 0,
    status: "completed",
    transcript: GLOBAL_ENP_CONSULTATION.transcript,
    summary: GLOBAL_ENP_CONSULTATION.summary,
  }))[0];
  console.log("  상담 기록 생성");
  return created;
}

async function ensureLearners(company, count) {
  const existing = await get(`learners?select=id,name,email&company_id=eq.${company.id}&order=created_at`);
  if (existing.length >= count) return existing.slice(0, count);
  const rows = [];
  for (let index = existing.length; index < count; index += 1) {
    rows.push({
      company_id: company.id,
      name: LEARNER_NAMES[index % LEARNER_NAMES.length],
      department: DEPARTMENTS[index % DEPARTMENTS.length],
      job_title: TITLES[index % TITLES.length],
      // 실제 주소로 메일이 나가면 안 된다. 지울 때 구분하는 표식이기도 하다.
      email: `demo-${SLUG[company.key] || "demo"}-${index + 1}@example.invalid`,
    });
  }
  const created = await insert("learners", rows);
  return [...existing, ...created].slice(0, count);
}

async function ensureContract(session, instructor, item) {
  const existing = await get(`contracts?select=id&course_session_id=eq.${session.id}`);
  if (existing.length) return existing[0];
  // 스칼라를 돌려주는 함수라 PostgREST 는 값 하나를 그대로 준다. 배열로 오는 배포도 있어 둘 다 받는다.
  const raw = await rest("rpc/next_contract_no", { method: "POST", body: "{}" });
  const contractNo = typeof raw === "string" ? raw
    : Array.isArray(raw) ? (raw[0]?.next_contract_no ?? raw[0])
    : raw?.next_contract_no;
  if (typeof contractNo !== "string") throw new Error(`계약번호를 받지 못했습니다: ${JSON.stringify(raw)}`);
  const signedAt = new Date(`${item.heldOn}T09:00:00+09:00`);
  const sentAt = new Date(signedAt.getTime() - 12 * 24 * 3600 * 1000);
  const viewedAt = new Date(signedAt.getTime() - 11 * 24 * 3600 * 1000);
  const created = (await insert("contracts", {
    course_session_id: session.id, instructor_id: instructor.id, contract_no: contractNo,
    status: "signed",
    terms: {
      fee: item.contract.fee, feeNote: item.contract.feeNote,
      paymentTerms: "강의 종료 후 산학협력단 지급 절차에 따라 지급",
      specialTerms: item.contract.specialTerms,
      reuseAggregate: true, reuseShareOriginal: false,
    },
    sent_to: INSTRUCTORS[item.instructor].email,
    sent_at: sentAt.toISOString(), viewed_at: viewedAt.toISOString(), signed_at: signedAt.toISOString(),
  }))[0];
  console.log(`  계약 ${contractNo} (서명 완료)`);
  return created;
}

async function seed() {
  const template = (await get("survey_templates?select=id,name,intro,questions&is_default=eq.true&archived=eq.false"))[0];
  if (!template) throw new Error("기본 질문지가 없습니다. 표준 질문지를 먼저 만들어 주세요.");
  const axis = (template.questions || []).filter((question) => question.type === "scale");

  const companies = {};
  for (const spec of COMPANIES) {
    const row = await ensureCompany(spec);
    companies[spec.key] = { ...row, key: spec.key };
  }
  await ensureConsultation(companies["글로벌이엔피"]);

  for (const item of DEMO) {
    const company = companies[item.company];
    const random = makeRandom(item.seed);
    const instructor = await ensureInstructor(item.instructor);

    let session = (await get(
      `course_sessions?select=id,title,instructor_id&company_id=eq.${company.id}&title=eq.${encodeURIComponent(item.title)}`,
    ))[0];
    const sessionRecord = {
      company_id: company.id, instructor_id: instructor.id, title: item.title,
      held_on: item.heldOn, start_time: item.startTime, duration_hours: item.durationHours,
      headcount: item.headcount, location: item.location, status: "delivered",
      ...(item.full ? { outline: item.outline, materials: item.materials } : {}),
    };
    if (session) {
      await patch(`course_sessions?id=eq.${session.id}`, sessionRecord);
    } else {
      session = (await insert("course_sessions", sessionRecord))[0];
    }

    if (item.full) await ensureContract(session, instructor, item);

    const learners = await ensureLearners(company, item.invited);
    const enrolled = await get(`session_learners?select=learner_id&course_session_id=eq.${session.id}`);
    const already = new Set(enrolled.map((row) => row.learner_id));
    const toEnroll = learners.filter((learner) => !already.has(learner.id));
    if (toEnroll.length) {
      await insert("session_learners", toEnroll.map((learner) => ({
        course_session_id: session.id, learner_id: learner.id, status: "attended",
      })));
    }

    let survey = (await get(`surveys?select=id,status&course_session_id=eq.${session.id}`))[0];
    if (!survey) {
      survey = (await insert("surveys", {
        course_session_id: session.id, template_id: template.id,
        title: "교육 만족도 조사", intro: template.intro || "",
        questions: template.questions, status: "closed",
      }))[0];
    }

    const invites = await get(`survey_invites?select=id,learner_id&survey_id=eq.${survey.id}`);
    const invited = new Set(invites.map((invite) => invite.learner_id));
    const newInvites = learners.filter((learner) => !invited.has(learner.id));
    const created = newInvites.length
      ? await insert("survey_invites", newInvites.map((learner, index) => ({
          survey_id: survey.id, learner_id: learner.id,
          token: `demo-${survey.id.slice(0, 8)}-${index}-${Math.random().toString(36).slice(2, 10)}`,
          sent_at: new Date(`${item.heldOn}T09:00:00+09:00`).toISOString(),
        })))
      : [];
    const allInvites = [...invites, ...created];

    const answered = await get(`survey_responses?select=id,invite_id&survey_id=eq.${survey.id}`);

    // --refresh: 이미 심어 둔 답을 다시 만든다. 문구를 손본 뒤 화면에 반영하려면 지우고 다시
    // 심는 수밖에 없는데, 지우지 않고 답만 갈아 끼우면 초대·발송 기록이 그대로 남는다.
    if (refresh && answered.length) {
      for (let index = 0; index < answered.length; index += 1) {
        const answers = {};
        axis.forEach((question) => { answers[question.id] = scoreAround(item.means[question.id] ?? 4, random); });
        if (index % 3 !== 2) answers.best_part = item.best[index % item.best.length];
        if (index % 3 !== 1) answers.improve = item.improve[index % item.improve.length];
        await patch(`survey_responses?id=eq.${answered[index].id}`, { answers });
      }
    }

    const done = new Set(answered.map((row) => row.invite_id));
    const pending = allInvites.filter((invite) => !done.has(invite.id)).slice(0, Math.max(0, item.responded - done.size));

    if (pending.length) {
      const rows = pending.map((invite, index) => {
        const answers = {};
        axis.forEach((question) => { answers[question.id] = scoreAround(item.means[question.id] ?? 4, random); });
        // 서술형은 전원이 적지 않는다. 셋 중 둘 정도가 현실이다.
        if (index % 3 !== 2) answers.best_part = item.best[index % item.best.length];
        if (index % 3 !== 1) answers.improve = item.improve[index % item.improve.length];
        return {
          survey_id: survey.id, invite_id: invite.id, answers,
          submitted_at: new Date(`${item.heldOn}T${17 + (index % 5)}:${10 + index}:00+09:00`).toISOString(),
        };
      });
      await insert("survey_responses", rows);
      for (const invite of pending) {
        await patch(`survey_invites?id=eq.${invite.id}`, {
          responded_at: new Date(`${item.heldOn}T18:00:00+09:00`).toISOString(),
        });
      }
    }

    console.log(`${item.company} · ${item.title} — 수강생 ${learners.length}명 · 발송 ${allInvites.length}명 · 응답 ${done.size + pending.length}명`);
  }
}

async function clean() {
  for (const spec of COMPANIES) {
    const company = (await get(`company_research?select=id,name&name=eq.${encodeURIComponent(spec.name)}`))[0];
    if (!company) continue;
    // 교육과정을 지우면 설문지·초대·응답·수강 등록·계약이 on delete cascade 로 함께 사라진다.
    const sessions = await get(`course_sessions?select=id&company_id=eq.${company.id}`);
    for (const session of sessions) await rest(`course_sessions?id=eq.${session.id}`, { method: "DELETE" });
    // 상담 행을 지우기 전에 올려 둔 음성부터 치운다. 행이 사라지면 경로를 찾을 길이 없다.
    const records = await get(`company_consultations?select=id,storage_path&company_id=eq.${company.id}`);
    const paths = records.map((row) => row.storage_path).filter(Boolean);
    if (paths.length) {
      await fetch(`${url}/storage/v1/object/consultation-audio`, {
        method: "DELETE", headers: HEADERS, body: JSON.stringify({ prefixes: paths }),
      }).catch(() => undefined);
    }
    await rest(`company_consultations?company_id=eq.${company.id}`, { method: "DELETE" });
    // 심어 둔 수강생만 지운다(demo- 로 시작하는 메일). 손으로 넣은 명단은 건드리지 않는다.
    const learners = await get(`learners?select=id&company_id=eq.${company.id}&email=like.demo-*`);
    for (const learner of learners) await rest(`learners?id=eq.${learner.id}`, { method: "DELETE" });
    await rest(`company_research?id=eq.${company.id}`, { method: "DELETE" });
    console.log(`지움: ${spec.name} (교육 ${sessions.length}건 · 수강생 ${learners.length}명)`);
  }
}

const refresh = process.argv.includes("--refresh");
const mode = process.argv.includes("--clean") ? clean : seed;
mode().then(() => console.log("완료")).catch((error) => { console.error(error.message); process.exit(1); });
