import * as cheerio from "cheerio";
import { generateWithGemini } from "@/lib/ai/gemini";

export const runtime = "nodejs";
export const maxDuration = 60;

type Candidate = { name: string; url: string; hostname: string; description: string; source: "네이버 검색" | "PDF 소개자료" };

const blockedHosts = ["naver.com", "pstatic.net", "naver.net", "youtube.com", "facebook.com", "instagram.com", "linkedin.com", "jobkorea.co.kr", "saramin.co.kr", "incruit.com", "wanted.co.kr", "catch.co.kr", "blog.naver.com", "smartstore.naver.com"];

function blocked(hostname: string) {
  return blockedHosts.some(host => hostname === host || hostname.endsWith(`.${host}`));
}

async function naverCandidates(companyName: string): Promise<Candidate[]> {
  const searchUrl = `https://search.naver.com/search.naver?where=web&query=${encodeURIComponent(`${companyName} 공식 홈페이지 회사`)}`;
  const response = await fetch(searchUrl, { signal: AbortSignal.timeout(15_000), headers: { "User-Agent": "Mozilla/5.0 (compatible; KNU-UICF-EducationResearch/1.0)", "Accept-Language": "ko-KR,ko;q=0.9" } });
  if (!response.ok) throw new Error(`네이버 검색 응답 오류 (${response.status})`);
  const $ = cheerio.load(await response.text());
  const found = new Map<string, Candidate>();
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href?.startsWith("http")) return;
    try {
      const url = new URL(href);
      if (blocked(url.hostname) || url.hostname.includes("ader.naver.com")) return;
      const root = `${url.protocol}//${url.hostname}/`;
      if (found.has(url.hostname)) return;
      const container = $(element).closest("li, article, .api_subject_bx, .total_wrap");
      const title = $(element).text().replace(/\s+/g, " ").trim() || container.find("a").first().text().replace(/\s+/g, " ").trim();
      const description = container.find(".desc, .dsc_txt, p").first().text().replace(/\s+/g, " ").trim();
      if (!title && !description) return;
      found.set(url.hostname, { name: title.slice(0, 80) || companyName, url: root, hostname: url.hostname, description: description.slice(0, 180), source: "네이버 검색" });
    } catch { /* 검색 추적 링크와 잘못된 URL은 제외합니다. */ }
  });
  return [...found.values()].slice(0, 5);
}

const pdfSchema = {
  type: "OBJECT",
  properties: { companyName: { type: "STRING" }, websiteUrls: { type: "ARRAY", items: { type: "STRING" } }, summary: { type: "STRING" } },
  required: ["companyName", "websiteUrls", "summary"],
};

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const enteredName = String(form.get("companyName") || "").trim();
    const file = form.get("file");
    let companyName = enteredName;
    let pdfCandidate: Candidate | null = null;
    if (file instanceof File && file.size > 0) {
      if (file.type !== "application/pdf") return Response.json({ error: "PDF 파일만 업로드할 수 있습니다." }, { status: 400 });
      if (file.size > 15 * 1024 * 1024) return Response.json({ error: "PDF는 최대 15MB까지 업로드할 수 있습니다." }, { status: 400 });
      const generated = await generateWithGemini({ role: "documentExtraction", prompt: "첨부된 회사소개 PDF에서 정확한 법인명, 공식 홈페이지 URL, 핵심 사업 요약을 추출하세요. 확인되지 않는 URL은 만들지 마세요.", media: [{ inlineData: { mimeType: "application/pdf", data: Buffer.from(await file.arrayBuffer()).toString("base64") } }], responseSchema: pdfSchema, temperature: 0 });
      const extracted = JSON.parse(generated.text) as { companyName: string; websiteUrls: string[]; summary: string };
      companyName = extracted.companyName || companyName;
      const website = extracted.websiteUrls.find(value => { try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; } });
      if (website) { const url = new URL(website); pdfCandidate = { name: companyName, url: `${url.protocol}//${url.host}/`, hostname: url.hostname, description: extracted.summary, source: "PDF 소개자료" }; }
    }
    if (!companyName) return Response.json({ error: "회사 이름 또는 회사소개 PDF가 필요합니다." }, { status: 400 });
    const searched = await naverCandidates(companyName);
    const candidates = [pdfCandidate, ...searched].filter((item): item is Candidate => Boolean(item)).filter((item, index, all) => all.findIndex(candidate => candidate.hostname === item.hostname) === index);
    if (!candidates.length) return Response.json({ error: "공식 홈페이지 후보를 찾지 못했습니다. 홈페이지 URL을 직접 입력해 주세요." }, { status: 404 });
    return Response.json({ companyName, candidates });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "기업 후보 검색에 실패했습니다." }, { status: 422 });
  }
}
