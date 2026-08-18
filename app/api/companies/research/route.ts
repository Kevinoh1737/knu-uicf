import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { requireTeamSession } from "@/lib/auth/guard";
import { generateWithGemini } from "@/lib/ai/gemini";
import { AX_FOUNDATION_QUESTIONS } from "@/lib/ai/ax-questionnaire";
import { researchDart } from "@/lib/company-intelligence/dart";
import { researchRecruiting } from "@/lib/company-intelligence/recruiting";

export const runtime = "nodejs";
export const maxDuration = 300;

const PAGE_LIMIT = 12;
const TEXT_LIMIT = 50_000;

/**
 * Crawling, OpenDART, and three Gemini calls can each stall, and their worst cases together far
 * exceed `maxDuration`. Every phase draws from one shared budget that stays under the platform
 * limit, so the route returns a real answer or a real error instead of being killed mid-flight.
 */
const ROUTE_BUDGET_MS = 285_000;
const CRAWL_BUDGET_MS = 70_000;
const INTELLIGENCE_BUDGET_MS = 35_000;
const RESEARCH_CALL_MS = 90_000;
const QUESTIONNAIRE_CALL_MS = 60_000;
const REVIEW_CALL_MS = 45_000;

/** Keeps a best-effort source from spending the whole budget; callers already tolerate a null result. */
function withTimeout<T>(work: Promise<T>, limitMs: number, onTimeout: () => T): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((resolve) => setTimeout(() => resolve(onTimeout()), limitMs)),
  ]);
}

/** 상호 비교용. 표기 차이(주식회사·공백·대소문자)만 걷어낸다 — dart.ts 와 같은 규칙이다. */
function normalizeName(value: string) {
  return value.replace(/\(주\)|㈜|주식회사|\s+/g, "").toLowerCase();
}

function normalizeUrl(value: string) {
  return new URL(/^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`);
}

function privateAddress(address: string) {
  if (address === "::1" || address === "::" || address.startsWith("fe80:") || address.startsWith("fc") || address.startsWith("fd")) return true;
  const value = address.startsWith("::ffff:") ? address.slice(7) : address;
  if (isIP(value) !== 4) return false;
  const [a, b] = value.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

async function assertPublic(url: URL) {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error("공개 HTTP(S) 홈페이지만 조사할 수 있습니다.");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("외부 홈페이지 주소를 입력해 주세요.");
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => privateAddress(item.address))) throw new Error("안전하게 접근할 수 없는 홈페이지입니다.");
}

async function fetchHtml(input: URL) {
  let url = input;
  for (let i = 0; i < 4; i += 1) {
    await assertPublic(url);
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(8_000), headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "KNU-UICF-EducationResearch/1.0" } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("이동 주소를 확인할 수 없습니다.");
      url = new URL(location, url); continue;
    }
    if (!response.ok) throw new Error(`홈페이지 응답 오류 (${response.status})`);
    const type = response.headers.get("content-type") || "";
    if (!type.includes("text/html") && !type.includes("application/xhtml")) throw new Error("HTML 페이지가 아닙니다.");
    const text = await response.text();
    if (text.length > 2_000_000) throw new Error("페이지가 너무 큽니다.");
    return { html: text, url };
  }
  throw new Error("홈페이지 이동 횟수가 너무 많습니다.");
}

function cleanText(html: string) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&#39;/gi, "'").replace(/&quot;/gi, '"').replace(/\s+/g, " ").trim();
}

function extractLinks(html: string, base: URL) {
  const pages: URL[] = [], attachments: string[] = [];
  const linkedValues = [
    ...[...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["']/gi)].map(match => match[1]),
    ...[...html.matchAll(/<iframe\b[^>]*src\s*=\s*["']([^"'#]+)["']/gi)].map(match => match[1]),
  ];
  for (const linkedValue of linkedValues) {
    try {
      const url = new URL(linkedValue.replace(/&amp;/g, "&"), base);
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      if (/\.(pdf|hwp|hwpx|docx?|pptx?|xlsx?)(\?|$)/i.test(url.href)) attachments.push(url.href);
      else if (url.hostname === base.hostname && !/\.(jpg|jpeg|png|gif|webp|svg|zip|mp4|mp3)(\?|$)/i.test(url.href)) { url.hash = ""; pages.push(url); }
    } catch { /* 잘못된 링크는 제외합니다. */ }
  }
  return { pages, attachments };
}

const responseSchema = {
  type: "OBJECT",
  properties: {
    companyName: { type: "STRING" }, industry: { type: "STRING" }, headline: { type: "STRING" }, summary: { type: "STRING" },
    business: { type: "OBJECT", properties: {
      whatTheyDo: { type: "STRING" }, offerings: { type: "ARRAY", items: { type: "STRING" } }, customers: { type: "STRING" }, workFlow: { type: "STRING" },
    }, required: ["whatTheyDo", "offerings", "customers", "workFlow"] },
    glossary: { type: "ARRAY", items: { type: "OBJECT", properties: { term: { type: "STRING" }, meaning: { type: "STRING" } }, required: ["term", "meaning"] } },
    educationContext: { type: "OBJECT", properties: {
      likelyLearners: { type: "ARRAY", items: { type: "STRING" } }, currentWork: { type: "STRING" }, startingPoint: { type: "STRING" }, caution: { type: "STRING" },
    }, required: ["likelyLearners", "currentWork", "startingPoint", "caution"] },
    keywords: { type: "ARRAY", items: { type: "STRING" } }, comparisonTags: { type: "ARRAY", items: { type: "STRING" } },
    opportunities: { type: "ARRAY", items: { type: "OBJECT", properties: { title: { type: "STRING" }, detail: { type: "STRING" }, audience: { type: "STRING" }, outcome: { type: "STRING" } }, required: ["title", "detail", "audience", "outcome"] } },
    evidence: { type: "ARRAY", items: { type: "OBJECT", properties: { claim: { type: "STRING" }, url: { type: "STRING" } }, required: ["claim", "url"] } },
  },
  required: ["companyName", "industry", "headline", "summary", "business", "glossary", "educationContext", "keywords", "comparisonTags", "opportunities", "evidence"],
};

const questionnaireSchema = {
  type: "OBJECT",
  properties: { tailoredQuestions: { type: "ARRAY", items: { type: "STRING" } } },
  required: ["tailoredQuestions"],
};

const questionnaireReviewSchema = {
  type: "OBJECT",
  properties: { approvedQuestions: { type: "ARRAY", items: { type: "STRING" } } },
  required: ["approvedQuestions"],
};

function validTailoredQuestions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string").map(item => item.trim()).filter(item => item.length > 8))].slice(0, 3);
}

function fallbackTailoredQuestions(report: { opportunities?: Array<{ title?: string }> }) {
  return (report.opportunities || []).slice(0, 3).map(item =>
    `조사에서 확인된 ‘${item.title || "주요 업무"}’를 AI 실습 주제로 다룬다면, 실제 업무의 어떤 사례와 자료를 기준으로 준비하면 좋을까요?`,
  );
}

export async function POST(request: Request) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  const remainingMs = () => ROUTE_BUDGET_MS - elapsed();
  try {
    const { websiteUrl, companyName, documentSummary } = await request.json() as { websiteUrl?: string; companyName?: string; documentSummary?: string };
    if (!websiteUrl) return Response.json({ error: "홈페이지 주소가 필요합니다." }, { status: 400 });
    const start = normalizeUrl(websiteUrl);
    const first = await fetchHtml(start);
    const origin = first.url.origin;
    const queue: URL[] = [first.url];
    const visited = new Set<string>();
    const documents: Array<{ url: string; text: string }> = [];
    const attachmentSet = new Set<string>();
    let totalText = 0;
    while (queue.length && documents.length < PAGE_LIMIT && totalText < TEXT_LIMIT && elapsed() < CRAWL_BUDGET_MS) {
      const target = queue.shift()!;
      const key = target.href.replace(/\/$/, "");
      if (visited.has(key) || target.origin !== origin) continue;
      visited.add(key);
      try {
        const page = key === first.url.href.replace(/\/$/, "") ? first : await fetchHtml(target);
        const text = cleanText(page.html).slice(0, 8_000);
        if (text.length > 80) { documents.push({ url: page.url.href, text }); totalText += text.length; }
        const links = extractLinks(page.html, page.url);
        links.attachments.forEach(link => attachmentSet.add(link));
        for (const link of links.pages) if (!visited.has(link.href.replace(/\/$/, "")) && queue.length < 60) queue.push(link);
      } catch { /* 일부 페이지 실패가 전체 조사를 중단하지 않게 합니다. */ }
    }
    if (!documents.length) throw new Error("분석할 홈페이지 본문을 찾지 못했습니다.");
    const inferredName = companyName || first.html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i)?.[1] || first.html.match(/<title[^>]*>([^<]+)/i)?.[1]?.split(/[|·–—-]/)[0]?.trim() || start.hostname.replace(/^www\./, "").split(".")[0];
    const lookupIntelligence = (name: string) => Promise.all([
      withTimeout(researchDart(name).catch(error => ({ available: false, reason: String(error) })), INTELLIGENCE_BUDGET_MS, () => ({ available: false, reason: "공시 조회 시간 초과" })),
      withTimeout(researchRecruiting(name).catch(error => ({ available: false, reason: String(error) })), INTELLIGENCE_BUDGET_MS, () => ({ available: false, reason: "채용정보 조회 시간 초과" })),
    ]);
    let [dart, recruiting] = await lookupIntelligence(inferredName);
    const sources = documents.map((doc, index) => `\n[SOURCE ${index + 1}] ${doc.url}\n${doc.text}`).join("\n");
    const attachments = [...attachmentSet].slice(0, 20);
    const prompt = `당신은 강원대학교 산학협력단 교육사업팀의 기업 이해 및 교육기획 담당자입니다. 사용자는 AI와 조사 대상 산업에 익숙하지 않은 교육프로그램 운영 관리자입니다. 아래 자료를 대신 읽고, 회사를 처음 접한 사람도 업무 모습을 그릴 수 있게 정리하세요.\n\n규칙:\n1. 기업 사실은 제공된 자료에서만 단정하고 evidence에 정확한 URL을 연결하세요. 공시 수치는 OpenDART 자료에 한정하세요.\n2. headline과 summary는 업종명이 아니라 '누구에게 무엇을 제공하는 회사인지' 일상적인 표현으로 설명하세요.\n3. business.whatTheyDo는 중학생도 이해할 표현으로 작성하고, offerings는 핵심 제품·서비스 3~5개, customers는 주요 고객 유형, workFlow는 제품이나 서비스가 만들어져 고객에게 전달되는 흐름을 설명하세요.\n4. 생소한 산업 용어는 glossary에 최대 4개만 넣고, 전문용어를 다시 사용하지 말고 쉬운 뜻으로 설명하세요.\n5. 채용정보에서 모집 부서·직무와 내부 IT 개발·데이터·인프라 인력 신호를 읽으세요. IT 채용이 보이지 않아도 IT 인력이 없다고 단정하지 마세요.\n6. educationContext는 예상 교육 대상, 현재 업무 방식, 쉬운 교육 시작점, 상담에서 반드시 확인할 불확실성을 구분하세요. 근거가 부족하면 '상담에서 확인 필요'로 표시하세요.\n7. opportunities는 제조업을 포함한 레거시 산업의 AX 관점에서, 기술명이 아니라 실제 업무 문제를 중심으로 작성하세요. 모든 교육 제안은 AI 활용과 직접 연결하고, 각 항목에 추천 대상과 4시간 교육 후 가능한 결과물을 포함하세요.\n8. 사실, 자료를 바탕으로 한 해석, 확인이 필요한 내용을 섞지 마세요. 한국어로 짧고 구체적으로 답하세요.\n\n회사소개 자료에서 추출한 핵심 정보:\n${documentSummary?.trim() || "없음"}\n\nOpenDART 자료:\n${JSON.stringify(dart)}\n\n공개 채용정보:\n${JSON.stringify(recruiting)}\n\n발견된 첨부파일 URL:\n${attachments.join("\n") || "없음"}\n\n수집 원문:${sources}`;
    const generated = await generateWithGemini({ role: "companyResearch", prompt: `${prompt}\n\n출력 문체: 화면에 바로 표시할 짧은 명사형·구문 중심으로 작성하세요. '~합니다', '~습니다', '~됩니다', '~한다', '~된다', '~이다'로 끝나는 서술형 문장은 피하고, 중복 설명은 제외하세요. comparisonTags는 업종, 제품 유형, 고객 유형, 업무 방식 기준의 표준화된 짧은 태그 4~6개로 작성하세요.`, responseSchema, temperature: 0.15, timeoutMs: RESEARCH_CALL_MS, budgetMs: Math.min(RESEARCH_CALL_MS * 2, remainingMs()) });
    const report = JSON.parse(generated.text) as { companyName?: string; industry?: string; business?: unknown; educationContext?: unknown; opportunities?: Array<{ title?: string; detail?: string; audience?: string; outcome?: string }>; questions?: string[] };

    /**
     * 홈페이지만 받은 경우 처음 쓸 수 있는 이름은 og:site_name 뿐인데, 그것은 상호가 아니다
     * ("Samsung sec"). 조사가 끝나면 본문에서 읽은 진짜 상호가 생기므로 그 이름으로 공시를
     * 다시 찾는다 — 기업목록은 이미 메모리에 있어 한 번 더 찾는 값이 싸다.
     */
    const reportName = (report.companyName || "").trim();
    if (reportName && normalizeName(reportName) !== normalizeName(inferredName)) {
      const [retryDart, retryRecruiting] = await lookupIntelligence(reportName);
      // 이름을 바꿔 찾아 실제로 찾아냈을 때만 갈아 끼운다. 첫 조회가 맞았을 수도 있다.
      // 채용 조회는 성공했을 때 available 필드 자체가 없다(공고 목록을 돌려준다).
      const found = (value: unknown) => Boolean(value) && (value as { available?: boolean }).available !== false;
      if (found(retryDart)) dart = retryDart;
      if (!found(recruiting) && found(retryRecruiting)) recruiting = retryRecruiting;
    }
    const questionnairePrompt = `당신은 강원대학교 산학협력단 교육사업팀의 기업 대상 AI·AX 교육 니즈 인터뷰 설계자입니다. 교육 신청 기업은 제조업을 포함한 레거시 산업이 많고, 제공하는 모든 교육은 반드시 AI 활용과 직접 연결되어야 합니다. 아래 기업 조사 결과를 읽고 공통 질문만으로는 알 수 없는 회사 맞춤 질문 3개를 작성하세요.\n\n목적:\n- 어떤 AI·AX 주제로 4시간 과정을 설계할지 결정\n- 과정 난이도와 실습 수준 결정\n- 적합한 강사의 산업·업무·AI 전문성 판단\n- 강사가 수업을 준비할 때 필요한 실제 업무 사례와 자료 확보\n\n작성 규칙:\n1. 아래 공통 질문에서 이미 묻는 내용은 반복하지 마세요.\n2. 조사에서 확인된 제품, 생산·품질·설비·영업·사무 업무, 채용 신호, 디지털 환경 또는 불확실성 중 이 회사에만 의미 있는 내용을 선택하세요.\n3. 조사 결과에 이미 답이 있는 사실을 다시 묻지 말고, 실제 업무 방식·문제·예외·자료 형태를 확인하세요.\n4. 질문 하나에는 판단 목적 하나만 담고, 비전문가도 바로 이해할 짧은 한국어로 작성하세요.\n5. 일반 경영교육이나 직무교육이 아닌 AI 활용 교육으로 연결되는 질문만 작성하세요.\n6. 확인할 회사 특성이 부족해도 내용을 지어내지 말고, 조사 결과에 표시된 불확실성을 구체적으로 확인하세요.\n7. 조사 자료에 없는 챗봇, 시스템 연동, 예측 모델 같은 기술 해법을 먼저 정하지 말고 업무 문제와 사용 가능한 자료부터 확인하세요.\n8. 전문용어나 약어는 조사 자료에 등장하더라도 담당자가 바로 이해할 수 있는 표현과 함께 사용하세요.\n\n항상 사용하는 공통 질문:\n${AX_FOUNDATION_QUESTIONS.map((question, index) => `${index + 1}. ${question}`).join("\n")}\n\n기업 조사 결과:\n${JSON.stringify({ report, dart, recruiting })}`;
    let draftTailoredQuestions: string[] = [];
    try {
      const questionnaire = await generateWithGemini({ role: "questionnaireDesign", prompt: questionnairePrompt, responseSchema: questionnaireSchema, temperature: 0.15, timeoutMs: QUESTIONNAIRE_CALL_MS, budgetMs: Math.min(QUESTIONNAIRE_CALL_MS * 2, remainingMs() - REVIEW_CALL_MS) });
      const parsed = JSON.parse(questionnaire.text) as { tailoredQuestions?: unknown };
      draftTailoredQuestions = validTailoredQuestions(parsed.tailoredQuestions);
    } catch { /* 기업 조사 결과는 보존하고 맞춤 질문만 안전한 기본값으로 대체합니다. */ }
    if (!draftTailoredQuestions.length) draftTailoredQuestions = fallbackTailoredQuestions(report);

    let tailoredQuestions = draftTailoredQuestions;
    let questionnaireReviewCompleted = false;
    /** The review only trims questions, so skipping it when time runs short still returns a usable questionnaire. */
    const reviewAffordable = draftTailoredQuestions.length > 0 && remainingMs() > REVIEW_CALL_MS + 5_000;
    if (reviewAffordable) try {
      const questionnaireReviewPrompt = `당신은 기업 AI 교육과정의 최종 질문지 검토자입니다. 아래에서 1차 생성된 회사 맞춤 질문 각각에 대해 반드시 이 질문을 먼저 던지세요.

"이 질문의 답이 4시간 AI 교육과정의 주제, 난이도, 실습, 강사 전문성 또는 준비 자료 중 하나를 실제로 바꾸는가? 그래서 상담에서 꼭 물어봐야 하는가?"

검토 규칙:
1. 답이 교육 설계 결정을 바꾸지 않는 질문은 삭제하세요. 흥미롭거나 유용한 정도로는 부족합니다.
2. 공통 질문으로 이미 답을 얻을 수 있거나 같은 내용을 더 구체적으로 반복한 질문은 삭제하세요.
3. 조사 자료에 근거하지 않은 업무·기술·결과물을 전제로 하거나 특정 AI 해법을 유도하는 질문은 삭제하거나 중립적으로 고치세요.
4. 회사의 실제 우선 업무인지 먼저 확인하지 않은 채 PDF, HWP, 챗봇, 자동화, 번역, 예측 등 특정 수단을 고르게 하는 질문은 승인하지 마세요.
5. 안전·법규·보안처럼 교육 구성에 중요한 회사 특성은 남길 수 있지만, 강의에서 다룰 업무와 검토 기준을 확인하는 짧은 질문으로 고치세요.
6. 한 질문에는 한 가지 판단만 담으세요. 비전문가가 전화 상담에서 바로 읽을 수 있는 쉬운 한국어를 사용하세요.
7. 엄격하게 검토해 꼭 필요한 질문만 0~3개 남기세요. 필수 질문이 없으면 빈 배열을 반환하세요. 개수를 맞추기 위해 질문을 만들지 마세요.

항상 사용하는 공통 질문:
${AX_FOUNDATION_QUESTIONS.map((question, index) => `${index + 1}. ${question}`).join("\n")}

회사 조사 결과:
${JSON.stringify({ report, dart, recruiting })}

1차 생성 회사 맞춤 질문:
${draftTailoredQuestions.map((question, index) => `${index + 1}. ${question}`).join("\n")}`;
      const review = await generateWithGemini({ role: "questionnaireDesign", prompt: questionnaireReviewPrompt, responseSchema: questionnaireReviewSchema, temperature: 0.05, timeoutMs: REVIEW_CALL_MS, budgetMs: Math.min(REVIEW_CALL_MS * 2, remainingMs()) });
      const parsedReview = JSON.parse(review.text) as { approvedQuestions?: unknown };
      tailoredQuestions = validTailoredQuestions(parsedReview.approvedQuestions);
      questionnaireReviewCompleted = true;
    } catch { /* 재검토 실패 시 1차 질문을 유지해 전체 기업 조사가 중단되지 않게 합니다. */ }
    report.questions = [...AX_FOUNDATION_QUESTIONS, ...tailoredQuestions];
    return Response.json({ report, intelligence: { dart, recruiting }, crawl: { pageCount: documents.length, attachmentCount: attachments.length, pages: documents.map(doc => doc.url), attachments }, ai: { model: generated.model, usage: generated.usage, questionnaireReview: { completed: questionnaireReviewCompleted, skippedForTime: !reviewAffordable, drafted: draftTailoredQuestions.length, approved: tailoredQuestions.length }, elapsedMs: elapsed() } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "기업 조사에 실패했습니다." }, { status: 422 });
  }
}
