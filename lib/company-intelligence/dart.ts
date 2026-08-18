import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";

const BASE = "https://opendart.fss.or.kr/api";
type CorpRow = { corpCode: string; corpName: string; stockCode: string };
let corpMapPromise: Promise<CorpRow[]> | null = null;

/**
 * 상호 비교용 정규화. 법인 표기(주식회사·㈜)와 공백을 걷어내고, 괄호 안의 영문 병기도 뗀다 —
 * DART 는 "톤28(TOUN 28 Inc.)" 처럼 한 칸에 두 이름을 적어 두어서, 그대로 견주면 같은 회사가
 * 다른 회사로 보인다.
 */
function normalizeName(name: string) {
  return name
    .replace(/\(주\)|㈜|주식회사/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

async function dartJson(endpoint: string, params: Record<string, string>) {
  const key = process.env.OPENDART_API_KEY;
  if (!key) return null;
  const url = new URL(`${BASE}/${endpoint}`);
  url.searchParams.set("crtfc_key", key);
  Object.entries(params).forEach(([name, value]) => url.searchParams.set(name, value));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (response.ok) return response.json();
    if (response.status < 500 && response.status !== 429) break;
    await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
  }
  return null;
}

async function corpMap() {
  if (corpMapPromise) return corpMapPromise;
  corpMapPromise = (async () => {
    const key = process.env.OPENDART_API_KEY;
    if (!key) return [];
    const response = await fetch(`${BASE}/corpCode.xml?crtfc_key=${key}`, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return [];
    const zip = new AdmZip(Buffer.from(await response.arrayBuffer()));
    const entry = zip.getEntries().find(item => item.entryName.toLowerCase().endsWith(".xml"));
    if (!entry) return [];
    const parsed = new XMLParser().parse(entry.getData().toString("utf8")) as { result?: { list?: Array<Record<string, string>> | Record<string, string> } };
    const rows = parsed.result?.list ? (Array.isArray(parsed.result.list) ? parsed.result.list : [parsed.result.list]) : [];
    return rows.map(row => ({ corpCode: String(row.corp_code || "").padStart(8, "0"), corpName: String(row.corp_name || ""), stockCode: String(row.stock_code || "") }));
  })();
  return corpMapPromise;
}

function numberValue(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Bounds the year x consolidation search, which is otherwise eight sequential retrying calls. */
const FINANCIALS_DEADLINE_MS = 25_000;

/**
 * 이름으로 공시 기업을 고른다.
 *
 * 예전에는 '한쪽이 다른 쪽을 포함하면 같은 회사'로 봤다. 그래서 홈페이지 og:site_name 이
 * "Samsung sec" 인 삼성전자를 조사했을 때 "samsun(gs)ec" 안의 두 글자가 걸려 (주)GS 의
 * 재무제표가 붙었다(실제 사고). 두 글자짜리 상호와 "자" 같은 한 글자 상호가 DART 에
 * 실재하므로, 포함 관계만으로는 언제든 엉뚱한 회사가 걸린다.
 *
 * 그래서 포함은 '거의 같은 이름'일 때만 인정한다 — 짧은 쪽이 세 글자 이상이고, 길이 차이가
 * 크지 않을 때. 애매하면 붙이지 않는다. 없는 것보다 남의 회사 매출을 보여 주는 쪽이 나쁘다.
 */
const MIN_PARTIAL_LENGTH = 3;
const MIN_LENGTH_RATIO = 0.6;

function pickCorp(rows: CorpRow[], companyName: string) {
  const target = normalizeName(companyName);
  if (!target) return null;
  const exact = rows.filter(row => normalizeName(row.corpName) === target);
  // 같은 이름이 여럿이면 상장사를 먼저 본다 — 공시가 실제로 쌓여 있는 쪽이다.
  if (exact.length) return exact.find(row => row.stockCode?.trim()) || exact[0];
  if (target.length < MIN_PARTIAL_LENGTH) return null;

  const near = rows.filter(row => {
    const name = normalizeName(row.corpName);
    if (name.length < MIN_PARTIAL_LENGTH) return false;
    if (!name.includes(target) && !target.includes(name)) return false;
    return Math.min(name.length, target.length) / Math.max(name.length, target.length) >= MIN_LENGTH_RATIO;
  });
  if (!near.length) return null;
  // 가장 비슷한 이름(길이 차가 작은 것) 하나, 같은 조건이면 상장사.
  return near.sort((left, right) => {
    const distance = Math.abs(normalizeName(left.corpName).length - target.length) - Math.abs(normalizeName(right.corpName).length - target.length);
    if (distance !== 0) return distance;
    return Number(Boolean(right.stockCode?.trim())) - Number(Boolean(left.stockCode?.trim()));
  })[0];
}

export async function researchDart(companyName: string) {
  if (!process.env.OPENDART_API_KEY) return { available: false, reason: "OPENDART_API_KEY 미설정" };
  const rows = await corpMap();
  const match = pickCorp(rows, companyName);
  if (!match) return { available: false, reason: `‘${companyName}’ 이름으로 DART 등록 기업을 찾지 못함` };
  const profile = await dartJson("company.json", { corp_code: match.corpCode }) as Record<string, string> | null;
  let financials: Record<string, unknown>[] = [];
  let financialYear: number | null = null;
  const currentYear = new Date().getFullYear();
  const financialsDeadline = Date.now() + FINANCIALS_DEADLINE_MS;
  for (let year = currentYear; year >= currentYear - 3 && Date.now() < financialsDeadline; year -= 1) {
    for (const fsDiv of ["CFS", "OFS"]) {
      if (Date.now() >= financialsDeadline) break;
      const body = await dartJson("fnlttSinglAcntAll.json", { corp_code: match.corpCode, bsns_year: String(year), reprt_code: "11011", fs_div: fsDiv }) as { status?: string; list?: Record<string, unknown>[] } | null;
      if (body?.status === "000" && body.list?.length) { financials = body.list; financialYear = year; break; }
    }
    if (financials.length) break;
  }
  const pick = (names: string[]) => {
    const item = financials.find(row => names.includes(String(row.account_nm)) || names.includes(String(row.account_id)));
    return item ? numberValue(item.thstrm_amount) : null;
  };
  // 상호는 찾았는데 사업보고서가 없는 경우가 흔하다(비상장·외부감사 대상). 재무가 비어 있는
  // 이유를 적어 두지 않으면 화면에서는 '자료 없음'과 구분되지 않는다.
  const reason = financials.length ? "" : (match.stockCode?.trim()
    ? "최근 사업보고서에서 재무 수치를 찾지 못함"
    : "비상장 기업이라 사업보고서 재무 수치 없음 (기본 정보만 제공)");

  return {
    available: true, corpCode: match.corpCode, stockCode: match.stockCode || null,
    matchedName: match.corpName, reason,
    profile: { companyName: profile?.corp_name, representative: profile?.ceo_nm, legalName: profile?.corp_name, address: profile?.adres, homepage: profile?.hm_url, phone: profile?.phn_no, industryCode: profile?.induty_code, establishedDate: profile?.est_dt, fiscalMonth: profile?.acc_mt, corporationClass: profile?.corp_cls },
    financialYear,
    financials: { revenue: pick(["매출액", "수익(매출액)", "영업수익", "ifrs-full_Revenue"]), operatingProfit: pick(["영업이익", "영업이익(손실)", "ifrs-full_ProfitLossFromOperatingActivities"]), netIncome: pick(["당기순이익", "당기순이익(손실)", "ifrs-full_ProfitLoss"]), assets: pick(["자산총계", "ifrs-full_Assets"]), liabilities: pick(["부채총계", "ifrs-full_Liabilities"]) },
    source: "OpenDART",
  };
}
