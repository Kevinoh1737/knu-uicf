/**
 * 시연용 만족도 데이터.
 *
 * 질문지별 비교 화면은 '같은 질문지로 물은 교육이 여럿'일 때만 뜻이 있다 — 하나뿐이면
 * 표가 아니라 목록이다. 그래서 교육 넷을 서로 다른 성격으로 심는다:
 *   1차 → 2차 로 개선된 회사, 업무 관련성이 낮게 나온 회사, 전반적으로 높은 회사.
 * 시연에서 "왜 비교가 필요한가"를 말로 설명하지 않아도 표가 스스로 보여 주게 하려는 것이다.
 *
 * 실행:  node --env-file=.env.local scripts/seed-satisfaction-demo.mjs
 * 지우기: node --env-file=.env.local scripts/seed-satisfaction-demo.mjs --clean
 * 답 갱신: node --env-file=.env.local scripts/seed-satisfaction-demo.mjs --refresh
 *
 * 두 번 돌려도 늘어나지 않는다(제목·이메일로 이미 있는 것을 찾아 쓴다).
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


/**
 * 강사 셋. 한 사람이 두 과정씩 맡는다 — 비교 화면은 두 번 이상 진행한 강사만 고를 수
 * 있게 해 두었기 때문이다(한 번뿐이면 한 칸짜리 표가 된다).
 */
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

async function ensureInstructor(name) {
  const found = (await get(`instructors?select=id,name&name=eq.${encodeURIComponent(name)}`))[0];
  if (found) return found;
  return (await insert("instructors", { name, status: "active", ...INSTRUCTORS[name] }))[0];
}

const COMPANY_KEYS = ["신티아", "한주케미칼", "톤28", "글로벌이앤피", "에이원비앤에이치"];

const DEMO = [
  {
    company: "신티아",
    title: "생성형 AI 업무 활용 1차", instructor: "오진환",
    heldOn: "2026-06-12", startTime: "10:00", durationHours: 4, headcount: 18,
    location: "본사 대회의실", invited: 18, responded: 14, seed: 11,
    // 1차는 난이도·분량에서 낮게 나온다. 2차에서 이것이 올라가는 것이 이 데이터의 이야기다.
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
    company: "한주케미칼",
    title: "제조 데이터 분석 기초", instructor: "윤세라",
    heldOn: "2026-07-03", startTime: "13:00", durationHours: 4, headcount: 16,
    location: "교육장 2층", invited: 16, responded: 11, seed: 33,
    // 업무 관련성이 낮게 나오는 회사. "왜 낮은가"를 문항 줄에서 찾게 하는 것이 비교 화면의 쓸모다.
    means: { content_useful: 3.8, level_fit: 3.5, delivery: 4.0, relevance: 3.1, duration: 3.9, recommend: 3.6 },
    best: [
      "엑셀 실습이 유익했습니다", "기초 개념 정리가 잘 되었습니다",
      "그래프 읽는 법을 배운 것이 도움이 됐습니다", "용어를 쉽게 풀어 주셨습니다",
    ],
    improve: [
      "우리 공정 데이터로 실습했으면 합니다", "예제가 제조 현장과 거리가 있었습니다",
      "현장 사례를 더 넣어 주세요", "설비 데이터를 다루는 내용이 있으면 좋겠습니다",
      "실제 불량 데이터로 해 봤으면 합니다",
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
    improve: [
      "시간이 짧아 아쉬웠습니다", "영상 제작도 다뤄 주세요",
      "이미지 생성 부분을 더 길게 했으면 합니다",
    ],
  },
  {
    company: "글로벌이앤피",
    title: "생산 데이터 읽기 기초", instructor: "윤세라",
    heldOn: "2026-08-07", startTime: "13:30", durationHours: 4, headcount: 14,
    location: "공장 교육장", invited: 14, responded: 10, seed: 55,
    // 같은 강사의 두 번째 과정. 제조 데이터 분석 기초보다 전반적으로 높다 —
    // '이 강사의 지난 수업 대비 이번이 어땠나'를 화면에서 읽게 하려는 배치다.
    means: { content_useful: 4.3, level_fit: 4.0, delivery: 4.2, relevance: 4.1, duration: 4.0, recommend: 4.2 },
    best: ["우리 공정 데이터를 그대로 써서 좋았습니다", "그래프로 보니 문제가 눈에 보였습니다", "엑셀만으로도 되는 게 많다는 걸 알았습니다"],
    improve: ["다음엔 불량 데이터도 다뤄 주세요", "시간이 조금 부족했습니다"],
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
const DEPARTMENTS = ["경영지원", "영업", "생산", "연구개발", "마케팅", "품질관리"];
const TITLES = ["사원", "주임", "대리", "과장", "차장"];

function slug(company) {
  // 회사 이름이 아니라 회사 행의 name 이 들어온다(주식회사가 붙어 있을 수 있다).
  const table = { 신티아: "cyntia", 한주케미칼: "hanjoo", 톤28: "toun", 글로벌이앤피: "global", 에이원비앤에이치: "aone" };
  const hit = Object.keys(table).find((keyword) => company.includes(keyword));
  return hit ? table[hit] : "demo";
}

async function findCompanies() {
  const rows = await get("company_research?select=id,name");
  const found = {};
  COMPANY_KEYS.forEach((keyword) => {
    const match = rows.find((row) => (row.name || "").includes(keyword));
    if (match) found[keyword] = match;
  });
  const missing = COMPANY_KEYS.filter((keyword) => !found[keyword]);
  if (missing.length) throw new Error(`기업을 찾지 못했습니다: ${missing.join(", ")}`);
  return found;
}

async function clean() {
  const companies = await findCompanies();
  const ids = Object.values(companies).map((company) => company.id);
  const sessions = await get(`course_sessions?select=id,title&company_id=in.(${ids.join(",")})`);
  const titles = new Set(DEMO.map((item) => item.title));
  const targets = sessions.filter((session) => titles.has(session.title));
  for (const session of targets) {
    // 설문지·초대·응답·수강 등록은 on delete cascade 로 함께 사라진다.
    await rest(`course_sessions?id=eq.${session.id}`, { method: "DELETE" });
    console.log("지움:", session.title);
  }
  // 심어 둔 수강생은 이메일 규칙(demo-*@)으로만 지운다. 실제 명단은 건드리지 않는다.
  const learners = await get(`learners?select=id,name,email&company_id=in.(${ids.join(",")})&email=like.demo-*`);
  for (const learner of learners) {
    await rest(`learners?id=eq.${learner.id}`, { method: "DELETE" });
  }
  console.log(`수강생 ${learners.length}명 지움`);
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
      email: `demo-${slug(company.name)}-${index + 1}@example.invalid`,
    });
  }
  const created = await insert("learners", rows);
  return [...existing, ...created].slice(0, count);
}

async function seed() {
  const companies = await findCompanies();

  const template = (await get("survey_templates?select=id,name,intro,questions&is_default=eq.true&archived=eq.false"))[0];
  if (!template) throw new Error("기본 질문지가 없습니다. 표준 질문지를 먼저 만들어 주세요.");
  const axis = (template.questions || []).filter((question) => question.type === "scale");

  for (const item of DEMO) {
    const company = companies[item.company];
    const random = makeRandom(item.seed);
    const instructor = await ensureInstructor(item.instructor);

    let session = (await get(
      `course_sessions?select=id,title,instructor_id&company_id=eq.${company.id}&title=eq.${encodeURIComponent(item.title)}`,
    ))[0];
    if (!session) {
      session = (await insert("course_sessions", {
        company_id: company.id,
        instructor_id: instructor.id,
        title: item.title,
        held_on: item.heldOn,
        start_time: item.startTime,
        duration_hours: item.durationHours,
        headcount: item.headcount,
        location: item.location,
        status: "delivered",
      }))[0];
    }

    // 이미 있는 교육이라도 강사는 맞춰 준다 — 강사별 비교가 성립하려면 한 사람이
    // 두 과정 이상을 맡아야 하는데, 처음 심을 때는 한 명에게 몰려 있었다.
    if (session.instructor_id && session.instructor_id !== instructor.id) {
      await rest(`course_sessions?id=eq.${session.id}`, {
        method: "PATCH", body: JSON.stringify({ instructor_id: instructor.id }),
      });
      console.log(`  강사 변경: ${item.title} → ${item.instructor}`);
    }

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
        course_session_id: session.id,
        template_id: template.id,
        title: "교육 만족도 조사",
        intro: template.intro || "",
        questions: template.questions,
        status: "closed",
      }))[0];
    }

    const invites = await get(`survey_invites?select=id,learner_id&survey_id=eq.${survey.id}`);
    const invited = new Set(invites.map((invite) => invite.learner_id));
    const newInvites = learners.filter((learner) => !invited.has(learner.id));
    const created = newInvites.length
      ? await insert("survey_invites", newInvites.map((learner, index) => ({
          survey_id: survey.id,
          learner_id: learner.id,
          token: `demo-${survey.id.slice(0, 8)}-${index}-${Math.random().toString(36).slice(2, 10)}`,
          sent_at: new Date(`${item.heldOn}T09:00:00+09:00`).toISOString(),
        })))
      : [];
    const allInvites = [...invites, ...created];

    const answered = await get(`survey_responses?select=id,invite_id&survey_id=eq.${survey.id}`);

    // --refresh: 이미 심어 둔 답을 다시 만든다. 문구를 손본 뒤 시연 화면에 반영하려면
    // 지우고 다시 심는 수밖에 없는데, 지우지 않고 답만 갈아 끼우면 초대·발송 기록이 남는다.
    if (refresh && answered.length) {
      for (let index = 0; index < answered.length; index += 1) {
        const answers = {};
        axis.forEach((question) => { answers[question.id] = scoreAround(item.means[question.id] ?? 4, random); });
        if (index % 3 !== 2) answers.best_part = item.best[index % item.best.length];
        if (index % 3 !== 1) answers.improve = item.improve[index % item.improve.length];
        await rest(`survey_responses?id=eq.${answered[index].id}`, { method: "PATCH", body: JSON.stringify({ answers }) });
      }
    }

    const done = new Set(answered.map((row) => row.invite_id));
    const pending = allInvites.filter((invite) => !done.has(invite.id)).slice(0, Math.max(0, item.responded - done.size));

    if (pending.length) {
      const rows = pending.map((invite, index) => {
        const answers = {};
        axis.forEach((question) => {
          answers[question.id] = scoreAround(item.means[question.id] ?? 4, random);
        });
        // 서술형은 전원이 적지 않는다. 셋 중 둘 정도가 현실이다.
        if (index % 3 !== 2) answers.best_part = item.best[index % item.best.length];
        if (index % 3 !== 1) answers.improve = item.improve[index % item.improve.length];
        return {
          survey_id: survey.id,
          invite_id: invite.id,
          answers,
          submitted_at: new Date(`${item.heldOn}T${17 + (index % 5)}:${10 + index}:00+09:00`).toISOString(),
        };
      });
      await insert("survey_responses", rows);
      for (const invite of pending) {
        await rest(`survey_invites?id=eq.${invite.id}`, {
          method: "PATCH",
          body: JSON.stringify({ responded_at: new Date(`${item.heldOn}T18:00:00+09:00`).toISOString() }),
        });
      }
    }

    console.log(`${item.title} — 수강생 ${learners.length}명 · 발송 ${allInvites.length}명 · 응답 ${done.size + pending.length}명`);
  }
}

const refresh = process.argv.includes("--refresh");
const mode = process.argv.includes("--clean") ? clean : seed;
mode().then(() => console.log("완료")).catch((error) => { console.error(error.message); process.exit(1); });
