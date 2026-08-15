import * as cheerio from "cheerio";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { requireTeamSession } from "@/lib/auth/guard";
import { generateWithGemini } from "@/lib/ai/gemini";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

/** A 50MB company PDF goes to Gemini inline, so the extraction call needs room without outliving the route. */
const PDF_EXTRACTION_CALL_MS = 90_000;
const PDF_EXTRACTION_BUDGET_MS = 200_000;

const PDF_BUCKET = "company-source-documents";
const PDF_PATH = /^company-intake\/[0-9a-f-]{36}\.pdf$/i;
const MAX_PDF_SIZE = 50 * 1024 * 1024;

type Candidate = { name: string; url: string; hostname: string; description: string; recommended?: boolean };
type SearchCandidate = Candidate & { rank: number; score: number };

const blockedHosts = ["naver.com", "pstatic.net", "naver.net", "youtube.com", "facebook.com", "instagram.com", "linkedin.com", "jobkorea.co.kr", "jobplanet.co.kr", "saramin.co.kr", "incruit.com", "wanted.co.kr", "catch.co.kr", "rocketpunch.com", "thevc.kr", "bizno.net", "nicebizinfo.com", "blog.naver.com", "smartstore.naver.com", "linkonbiz.com", "scourt.go.kr"];

function blocked(hostname: string) {
  return blockedHosts.some(host => hostname === host || hostname.endsWith(`.${host}`));
}

function canonicalHostname(hostname: string) {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function normalizeWebsiteUrl(value: string) {
  const trimmed = value.trim()
    .replace(/^[<({]+/, "")
    .replace(/^\[+/, "")
    .replace(/[>)}.,;:。]+$/, "")
    .replace(/\]+$/, "");
  if (!trimmed || /\s/.test(trimmed)) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname.includes(".")) return null;
    return `${url.protocol}//${url.host}/`;
  } catch {
    return null;
  }
}

function normalizeCompanyName(value: string) {
  return value.toLowerCase().replace(/주식회사|유한회사|㈜|\(주\)|\[주\]/g, "").replace(/[^0-9a-z가-힣]/g, "");
}

function editDistance(left: string, right: string) {
  const rows = Array.from({ length: left.length + 1 }, (_, row) => Array(right.length + 1).fill(0));
  for (let row = 0; row <= left.length; row += 1) rows[row][0] = row;
  for (let column = 0; column <= right.length; column += 1) rows[0][column] = column;
  for (let row = 1; row <= left.length; row += 1) for (let column = 1; column <= right.length; column += 1) {
    rows[row][column] = Math.min(rows[row - 1][column] + 1, rows[row][column - 1] + 1, rows[row - 1][column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1));
  }
  return rows[left.length][right.length];
}

function nameSimilarity(query: string, candidate: string) {
  const left = normalizeCompanyName(query);
  const right = normalizeCompanyName(candidate);
  if (!left || !right) return 0;
  if (left.includes(right) || right.includes(left)) return Math.min(left.length, right.length) / Math.max(left.length, right.length) + 0.2;
  return 1 - editDistance(left, right) / Math.max(left.length, right.length);
}

function cleanSearchText(value: string, hostname = "") {
  const hostPattern = hostname ? new RegExp(hostname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig") : null;
  return value.replace(/새\s*창\s*열림|바로가기|공식\s*홈페이지/gi, " ").replace(hostPattern || /$^/, " ").replace(/\s+/g, " ").trim();
}

function shortDescription(value: string) {
  const cleaned = value.replace(/\s+/g, " ").replace(/^(홈페이지|메인)\s*[-|:]?\s*/i, "").trim();
  if (!cleaned) return "홈페이지에서 회사 정보를 확인할 수 있음";
  return cleaned.length > 90 ? `${cleaned.slice(0, 87).trim()}…` : cleaned;
}

function privateAddress(address: string) {
  if (address === "::1" || address === "::" || address.startsWith("fe80:") || address.startsWith("fc") || address.startsWith("fd")) return true;
  const value = address.startsWith("::ffff:") ? address.slice(7) : address;
  if (isIP(value) !== 4) return false;
  const [a, b] = value.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

async function assertPublic(url: URL) {
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("공개 홈페이지가 아님");
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => privateAddress(item.address))) throw new Error("공개 홈페이지가 아님");
}

async function profileCandidate(candidate: SearchCandidate, companyName: string): Promise<SearchCandidate> {
  let target = new URL(candidate.url);
  for (let redirect = 0; redirect < 4; redirect += 1) {
    if (blocked(target.hostname)) throw new Error("공식 홈페이지 후보가 아님");
    await assertPublic(target);
    const response = await fetch(target, { redirect: "manual", signal: AbortSignal.timeout(7_000), headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "KNU-UICF-EducationResearch/1.0" } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) break;
      target = new URL(location, target);
      continue;
    }
    if (!response.ok || !(response.headers.get("content-type") || "").includes("text/html")) break;
    const html = (await response.text()).slice(0, 1_500_000);
    const $ = cheerio.load(html);
    const siteName = cleanSearchText($("meta[property='og:site_name']").attr("content") || "", target.hostname);
    const pageTitle = cleanSearchText($("meta[property='og:title']").attr("content") || $("title").first().text(), target.hostname).split(/[|｜·–—]/)[0].trim();
    const heading = cleanSearchText($("h1").first().text(), target.hostname);
    const officialNames = [siteName, pageTitle, heading].filter(Boolean);
    const officialSimilarity = Math.max(0, ...officialNames.map(value => nameSimilarity(companyName, value)));
    const name = officialNames.sort((left, right) => nameSimilarity(companyName, right) - nameSimilarity(companyName, left))[0] || candidate.name;
    const metaDescription = $("meta[property='og:description']").attr("content") || $("meta[name='description']").attr("content") || "";
    const paragraph = $("main p, article p, .content p, p").toArray().map(element => cleanSearchText($(element).text())).find(text => text.length >= 20 && text.length <= 240) || "";
    const score = officialSimilarity * 100 + nameSimilarity(companyName, candidate.name) * 12 + Math.max(0, 8 - candidate.rank);
    return { ...candidate, name, url: `${target.protocol}//${target.host}/`, hostname: target.hostname, description: shortDescription(metaDescription || paragraph || candidate.description), score };
  }
  return { ...candidate, score: nameSimilarity(companyName, candidate.name) * 100 + Math.max(0, 8 - candidate.rank) };
}

async function naverCandidates(companyName: string): Promise<Candidate[]> {
  const searchUrl = `https://search.naver.com/search.naver?where=nexearch&query=${encodeURIComponent(companyName)}`;
  const response = await fetch(searchUrl, { signal: AbortSignal.timeout(15_000), headers: { "User-Agent": "Mozilla/5.0 (compatible; KNU-UICF-EducationResearch/1.0)", "Accept-Language": "ko-KR,ko;q=0.9" } });
  if (!response.ok) throw new Error(`네이버 검색 응답 오류 (${response.status})`);
  const $ = cheerio.load(await response.text());
  const found = new Map<string, SearchCandidate>();
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href?.startsWith("http")) return;
    try {
      const url = new URL(href);
      if (blocked(url.hostname) || url.hostname.includes("ader.naver.com")) return;
      const root = `${url.protocol}//${url.host}/`;
      const canonicalHost = canonicalHostname(url.hostname);
      if (found.has(canonicalHost)) return;
      const container = $(element).closest("li.bx, li, article, .fds-web-root, .total_wrap");
      const title = cleanSearchText($(element).attr("aria-label") || $(element).text() || container.find("a").first().text(), url.hostname);
      const description = cleanSearchText(container.find(".desc, .dsc_txt, .api_txt_lines, p").first().text());
      if (!title && !description) return;
      const rank = found.size;
      const name = title.slice(0, 80) || companyName;
      found.set(canonicalHost, { name, url: root, hostname: url.hostname, description: shortDescription(description), rank, score: nameSimilarity(companyName, name) * 100 + Math.max(0, 8 - rank) });
    } catch { /* 검색 추적 링크와 잘못된 URL은 제외합니다. */ }
  });
  const rawCandidates = [...found.values()].slice(0, 8);
  const profiled = await Promise.all(rawCandidates.map(candidate => profileCandidate(candidate, companyName).catch(() => candidate)));
  const uniqueCandidates = new Map<string, SearchCandidate>();
  for (const candidate of profiled) {
    const key = canonicalHostname(candidate.hostname);
    const current = uniqueCandidates.get(key);
    if (!current || candidate.score > current.score) uniqueCandidates.set(key, candidate);
  }
  const ranked = [...uniqueCandidates.values()].filter(candidate => candidate.score >= 52).sort((left, right) => right.score - left.score).slice(0, 3);
  return ranked.map((candidate, index) => ({ name: candidate.name, url: candidate.url, hostname: candidate.hostname, description: shortDescription(candidate.description), recommended: index === 0 }));
}

const pdfSchema = {
  type: "OBJECT",
  properties: { companyName: { type: "STRING" }, websiteUrls: { type: "ARRAY", items: { type: "STRING" } }, summary: { type: "STRING" } },
  required: ["companyName", "websiteUrls", "summary"],
};

export async function POST(request: Request) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  let storagePath = "";
  try {
    const body = await request.json() as { companyName?: string; storagePath?: string };
    const enteredName = String(body.companyName || "").trim();
    storagePath = String(body.storagePath || "").trim();
    let companyName = enteredName;
    if (storagePath) {
      if (!PDF_PATH.test(storagePath)) return Response.json({ error: "올바르지 않은 파일 경로입니다." }, { status: 400 });
      const { data: file, error: downloadError } = await createSupabaseAdmin().storage.from(PDF_BUCKET).download(storagePath);
      if (downloadError || !file) throw new Error(downloadError?.message || "PDF 파일을 불러오지 못했습니다.");
      if (file.type !== "application/pdf") return Response.json({ error: "PDF 파일만 업로드할 수 있습니다." }, { status: 400 });
      if (file.size > MAX_PDF_SIZE) return Response.json({ error: "PDF는 최대 50MB까지 업로드할 수 있습니다." }, { status: 400 });
      const generated = await generateWithGemini({
        role: "documentExtraction",
        prompt: "첨부된 회사소개 PDF 전체를 확인해 정확한 법인명과 공식 홈페이지를 추출하세요. https://가 없는 도메인도 websiteUrls에 누락 없이 담으세요. summary에는 PDF에 명시된 주요 사업, 제품·서비스, 대표, 설립일, 연락처, 인증, 연혁, 기술·인력 특징과 교육 수요 판단에 유용한 사실을 충실히 정리하세요. PDF에 없는 정보나 URL은 추정하지 마세요.",
        media: [{ inlineData: { mimeType: "application/pdf", data: Buffer.from(await file.arrayBuffer()).toString("base64") } }],
        responseSchema: pdfSchema,
        temperature: 0,
        timeoutMs: PDF_EXTRACTION_CALL_MS,
        budgetMs: PDF_EXTRACTION_BUDGET_MS,
      });
      const extracted = JSON.parse(generated.text) as { companyName: string; websiteUrls: string[]; summary: string };
      companyName = extracted.companyName || companyName;
      const website = extracted.websiteUrls.map(normalizeWebsiteUrl).find((value): value is string => Boolean(value));
      if (!companyName) return Response.json({ error: "PDF에서 회사 이름을 확인하지 못했습니다." }, { status: 422 });
      if (!website) return Response.json({ error: "PDF에서 회사 홈페이지 주소를 확인하지 못했습니다." }, { status: 422 });
      return Response.json({ companyName, websiteUrl: website, documentSummary: extracted.summary, direct: true });
    }
    if (!companyName) return Response.json({ error: "회사 이름 또는 회사소개 PDF가 필요합니다." }, { status: 400 });
    const searched = await naverCandidates(companyName);
    const candidates = searched.filter((item, index, all) => all.findIndex(candidate => canonicalHostname(candidate.hostname) === canonicalHostname(item.hostname)) === index);
    if (!candidates.length) return Response.json({ error: "공식 홈페이지 후보를 찾지 못했습니다. 홈페이지 URL을 직접 입력해 주세요." }, { status: 404 });
    if (candidates.length === 1) {
      const [candidate] = candidates;
      return Response.json({ companyName: candidate.name || companyName, websiteUrl: candidate.url, direct: true });
    }
    return Response.json({ companyName, candidates });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "기업 후보 검색에 실패했습니다." }, { status: 422 });
  } finally {
    if (storagePath && PDF_PATH.test(storagePath)) {
      await createSupabaseAdmin().storage.from(PDF_BUCKET).remove([storagePath]).catch(() => undefined);
    }
  }
}
