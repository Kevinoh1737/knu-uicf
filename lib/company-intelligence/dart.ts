import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";

const BASE = "https://opendart.fss.or.kr/api";
type CorpRow = { corpCode: string; corpName: string; stockCode: string };
let corpMapPromise: Promise<CorpRow[]> | null = null;

function normalizeName(name: string) {
  return name.replace(/\(주\)|㈜|주식회사|\s+/g, "").toLowerCase();
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

export async function researchDart(companyName: string) {
  if (!process.env.OPENDART_API_KEY) return { available: false, reason: "OPENDART_API_KEY 미설정" };
  const target = normalizeName(companyName);
  const rows = await corpMap();
  const match = rows.find(row => normalizeName(row.corpName) === target) || rows.find(row => normalizeName(row.corpName).includes(target) || target.includes(normalizeName(row.corpName)));
  if (!match) return { available: false, reason: "DART 등록 기업과 일치하지 않음" };
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
  return {
    available: true, corpCode: match.corpCode, stockCode: match.stockCode || null,
    profile: { companyName: profile?.corp_name, representative: profile?.ceo_nm, legalName: profile?.corp_name, address: profile?.adres, homepage: profile?.hm_url, phone: profile?.phn_no, industryCode: profile?.induty_code, establishedDate: profile?.est_dt, fiscalMonth: profile?.acc_mt, corporationClass: profile?.corp_cls },
    financialYear,
    financials: { revenue: pick(["매출액", "수익(매출액)", "영업수익", "ifrs-full_Revenue"]), operatingProfit: pick(["영업이익", "영업이익(손실)", "ifrs-full_ProfitLossFromOperatingActivities"]), netIncome: pick(["당기순이익", "당기순이익(손실)", "ifrs-full_ProfitLoss"]), assets: pick(["자산총계", "ifrs-full_Assets"]), liabilities: pick(["부채총계", "ifrs-full_Liabilities"]) },
    source: "OpenDART",
  };
}
