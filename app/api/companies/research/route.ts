import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { generateWithGemini } from "@/lib/ai/gemini";
import { researchDart } from "@/lib/company-intelligence/dart";
import { researchRecruiting } from "@/lib/company-intelligence/recruiting";

export const runtime = "nodejs";
export const maxDuration = 60;

const PAGE_LIMIT = 12;
const TEXT_LIMIT = 50_000;

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
    keywords: { type: "ARRAY", items: { type: "STRING" } },
    opportunities: { type: "ARRAY", items: { type: "OBJECT", properties: { title: { type: "STRING" }, detail: { type: "STRING" } }, required: ["title", "detail"] } },
    competitors: { type: "ARRAY", items: { type: "OBJECT", properties: { name: { type: "STRING" }, reason: { type: "STRING" }, verificationNote: { type: "STRING" } }, required: ["name", "reason", "verificationNote"] } },
    questions: { type: "ARRAY", items: { type: "STRING" } },
    evidence: { type: "ARRAY", items: { type: "OBJECT", properties: { claim: { type: "STRING" }, url: { type: "STRING" } }, required: ["claim", "url"] } },
  },
  required: ["companyName", "industry", "headline", "summary", "keywords", "opportunities", "competitors", "questions", "evidence"],
};

export async function POST(request: Request) {
  try {
    const { websiteUrl, companyName } = await request.json() as { websiteUrl?: string; companyName?: string };
    if (!websiteUrl) return Response.json({ error: "홈페이지 주소가 필요합니다." }, { status: 400 });
    const start = normalizeUrl(websiteUrl);
    const first = await fetchHtml(start);
    const origin = first.url.origin;
    const queue: URL[] = [first.url];
    const visited = new Set<string>();
    const documents: Array<{ url: string; text: string }> = [];
    const attachmentSet = new Set<string>();
    let totalText = 0;
    while (queue.length && documents.length < PAGE_LIMIT && totalText < TEXT_LIMIT) {
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
    const [dart, recruiting] = await Promise.all([researchDart(inferredName).catch(error => ({ available: false, reason: String(error) })), researchRecruiting(inferredName).catch(error => ({ available: false, reason: String(error) }))]);
    const sources = documents.map((doc, index) => `\n[SOURCE ${index + 1}] ${doc.url}\n${doc.text}`).join("\n");
    const attachments = [...attachmentSet].slice(0, 20);
    const prompt = `당신은 강원대학교 산학협력단 교육사업팀의 B2B AI 교육 컨설턴트입니다. 아래는 공식 홈페이지, OpenDART, 공개 채용검색에서 방금 수집한 자료입니다.\n\n규칙:\n1. 기업 사실은 제공된 자료에서만 단정하고 evidence에 정확한 URL을 연결하세요. DART 수치는 OpenDART 출처로 표시하세요.\n2. 채용정보에서 내부 IT 개발·데이터·인프라 인력 신호, 모집 부서와 직무를 해석해 교육 난이도와 교육 기회를 제안하세요. IT 채용 신호가 없다는 것을 IT 인력이 없다는 확정 사실로 표현하지 마세요.\n3. 교육 기회는 기업 업무와 AI 교육 설계 관점에서 구체적으로 작성하세요.\n4. competitors는 동일 산업 후보 3곳을 제안하되 근거가 없으면 verificationNote에 '외부 검증 필요'라고 명시하세요.\n5. questions는 향후 4시간 단위 AI 교육과정을 설계하기 위해 담당자에게 물을 질문 10개를 작성하세요.\n6. 한국어로 간결하고 사실적으로 답하세요.\n\nOpenDART 자료:\n${JSON.stringify(dart)}\n\n공개 채용정보:\n${JSON.stringify(recruiting)}\n\n발견된 첨부파일 URL:\n${attachments.join("\n") || "없음"}\n\n수집 원문:${sources}`;
    const generated = await generateWithGemini({ role: "companyResearch", prompt, responseSchema, temperature: 0.15 });
    const report = JSON.parse(generated.text);
    return Response.json({ report, intelligence: { dart, recruiting }, crawl: { pageCount: documents.length, attachmentCount: attachments.length, pages: documents.map(doc => doc.url), attachments }, ai: { model: generated.model, usage: generated.usage } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "기업 조사에 실패했습니다." }, { status: 422 });
  }
}
