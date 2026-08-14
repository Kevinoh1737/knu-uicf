import * as cheerio from "cheerio";

const IT_TERMS = ["개발", "개발자", "프론트엔드", "백엔드", "풀스택", "데이터", "AI", "인공지능", "머신러닝", "클라우드", "인프라", "네트워크", "정보보안", "전산", "IT", "ERP", "MES", "DevOps", "서버", "시스템 운영"];

async function fetchPage(url: string, encoding: "utf-8" | "euc-kr" = "utf-8") {
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { "User-Agent": "Mozilla/5.0 (compatible; KNU-UICF-EducationResearch/1.0)", Accept: "text/html,application/xhtml+xml", "Accept-Language": "ko-KR,ko;q=0.9" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return new TextDecoder(encoding).decode(buffer);
}

type Posting = { source: string; title: string; company: string; jobAreas: string[]; url: string; itSignal: boolean };

async function searchSaramin(companyName: string): Promise<Posting[]> {
  const url = `https://www.saramin.co.kr/zf_user/search/recruit?searchType=search&searchword=${encodeURIComponent(companyName)}&recruitPage=1&recruitSort=relation&recruitPageCount=40`;
  const $ = cheerio.load(await fetchPage(url));
  const postings: Posting[] = [];
  $(".item_recruit").each((_, element) => {
    const item = $(element), company = item.find(".area_corp .corp_name").text().trim();
    if (!company.includes(companyName.replace(/\(주\)|㈜|주식회사/g, "").trim())) return;
    const link = item.find(".job_tit a").first();
    const title = link.text().trim();
    const jobAreas = item.find(".job_sector a").map((__, node) => $(node).text().trim()).get().filter(Boolean);
    const text = `${title} ${jobAreas.join(" ")}`;
    postings.push({ source: "사람인", title, company, jobAreas, url: new URL(link.attr("href") || "/", "https://www.saramin.co.kr").href, itSignal: IT_TERMS.some(term => text.toLowerCase().includes(term.toLowerCase())) });
  });
  return postings.slice(0, 20);
}

async function searchIncruit(companyName: string): Promise<Posting[]> {
  const url = `https://search.incruit.com/list/search.asp?col=job&kw=${encodeURIComponent(companyName)}&startno=0`;
  const $ = cheerio.load(await fetchPage(url, "euc-kr"));
  const postings: Posting[] = [];
  $("a.cpname").each((_, element) => {
    const company = $(element).text().trim();
    if (!company.includes(companyName.replace(/\(주\)|㈜|주식회사/g, "").trim())) return;
    const container = $(element).closest("li, tr, .cBbslist_contenst, .jobpost");
    const jobLink = container.find('a[href*="jobdb_info"], a[href*="jobpost"], a.tit').first();
    const title = jobLink.text().replace(/\s+/g, " ").trim();
    if (!title) return;
    const text = container.text().replace(/\s+/g, " ");
    postings.push({ source: "인크루트", title, company, jobAreas: [], url: new URL(jobLink.attr("href") || $(element).attr("href") || "/", "https://www.incruit.com").href, itSignal: IT_TERMS.some(term => text.toLowerCase().includes(term.toLowerCase())) });
  });
  return postings.slice(0, 20);
}

export async function researchRecruiting(companyName: string) {
  const results = await Promise.allSettled([searchSaramin(companyName), searchIncruit(companyName)]);
  const postings = results.flatMap(result => result.status === "fulfilled" ? result.value : []);
  const itPostings = postings.filter(item => item.itSignal);
  const jobAreas = [...new Set(postings.flatMap(item => item.jobAreas))].slice(0, 30);
  return { postings, postingCount: postings.length, itPostingCount: itPostings.length, hasInternalItSignal: itPostings.length > 0, itRoles: [...new Set(itPostings.map(item => item.title))].slice(0, 12), jobAreas, sources: ["사람인 공개 검색", "인크루트 공개 검색"], caveat: "현재 공개 검색 결과 기준이며 과거 공고 전체를 보장하지 않습니다." };
}
