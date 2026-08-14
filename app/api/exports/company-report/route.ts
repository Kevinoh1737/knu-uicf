import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type ReportPayload = {
  company?: {
    name?: string;
    field?: string;
    websiteUrl?: string;
    research?: {
      headline?: string;
      summary?: string;
      keywords?: string[];
      business?: { whatTheyDo?: string; offerings?: string[]; customers?: string; workFlow?: string };
      glossary?: Array<{ term?: string; meaning?: string }>;
      educationContext?: { likelyLearners?: string[]; currentWork?: string; startingPoint?: string; caution?: string };
      opportunities?: Array<{ title?: string; detail?: string; audience?: string; outcome?: string }>;
      evidence?: Array<{ claim?: string; url?: string }>;
    };
    intelligence?: {
      dart?: { available?: boolean; financialYear?: number | null; reason?: string; profile?: { representative?: string; address?: string; establishedDate?: string; industryCode?: string }; financials?: { revenue?: number | null; operatingProfit?: number | null; netIncome?: number | null; assets?: number | null } };
      recruiting?: { available?: boolean; postingCount?: number; itPostingCount?: number; hasInternalItSignal?: boolean; itRoles?: string[]; jobAreas?: string[]; caveat?: string };
    };
  };
  similarCompanies?: Array<{ name?: string; reason?: string; headline?: string }>;
};

const A4 = { width: 595.28, height: 841.89 };
const colors = {
  navy: rgb(23 / 255, 52 / 255, 82 / 255),
  blue: rgb(37 / 255, 99 / 255, 235 / 255),
  green: rgb(49 / 255, 95 / 255, 80 / 255),
  ink: rgb(23 / 255, 37 / 255, 54 / 255),
  body: rgb(76 / 255, 94 / 255, 112 / 255),
  muted: rgb(112 / 255, 128 / 255, 145 / 255),
  line: rgb(220 / 255, 227 / 255, 236 / 255),
  pale: rgb(246 / 255, 248 / 255, 251 / 255),
  white: rgb(1, 1, 1),
};

function text(value: unknown, fallback = "확인 필요") {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 4000) || fallback;
}

function list(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(0, 100).map(item => item.replace(/\s+/g, " ").trim().slice(0, 1000)) : [];
}

function wrap(value: string, font: PDFFont, size: number, maxWidth: number) {
  const paragraphs = value.replace(/\r/g, "").split("\n");
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    if (!paragraph) { lines.push(""); continue; }
    let current = "";
    for (const character of paragraph) {
      const candidate = current + character;
      if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        lines.push(current.trimEnd());
        current = character.trimStart();
      } else current = candidate;
    }
    if (current) lines.push(current.trimEnd());
  }
  return lines;
}

async function createPdf(payload: ReportPayload) {
  const company = payload.company!;
  const report = company.research!;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const [regularBytes, boldBytes] = await Promise.all([
    readFile(path.join(process.cwd(), "public/fonts/Pretendard-Regular.ttf")),
    readFile(path.join(process.cwd(), "public/fonts/Pretendard-Bold.ttf")),
  ]);
  // Full embedding avoids broken composite glyph maps in Korean PDF viewers.
  const regular = await pdf.embedFont(regularBytes);
  const bold = await pdf.embedFont(boldBytes);
  pdf.setTitle(`${text(company.name, "기업")} 기업 조사`);
  pdf.setAuthor("KNU UICF 교육사업팀");
  pdf.setCreator("KNU UICF 교육사업팀");
  pdf.setCreationDate(new Date());

  const margin = 48;
  const contentWidth = A4.width - margin * 2;
  let page!: PDFPage;
  let y = 0;

  const addPage = (continued = true) => {
    page = pdf.addPage([A4.width, A4.height]);
    y = A4.height - margin;
    if (continued) {
      page.drawText("KNU UICF 교육사업팀", { x: margin, y, font: bold, size: 8.5, color: colors.muted });
      page.drawText(text(company.name, "기업 조사"), { x: A4.width - margin - regular.widthOfTextAtSize(text(company.name, "기업 조사"), 8.5), y, font: regular, size: 8.5, color: colors.muted });
      y -= 17;
      page.drawLine({ start: { x: margin, y }, end: { x: A4.width - margin, y }, thickness: 0.7, color: colors.line });
      y -= 23;
    }
  };
  const ensure = (height: number) => { if (y - height < 45) addPage(true); };
  const paragraph = (value: unknown, options: { size?: number; color?: ReturnType<typeof rgb>; font?: PDFFont; indent?: number; gap?: number; lineHeight?: number } = {}) => {
    const font = options.font || regular;
    const size = options.size || 10.5;
    const indent = options.indent || 0;
    const lineHeight = options.lineHeight || size * 1.62;
    const lines = wrap(text(value), font, size, contentWidth - indent);
    for (const line of lines) {
      ensure(lineHeight + 2);
      page.drawText(line, { x: margin + indent, y, font, size, color: options.color || colors.body });
      y -= lineHeight;
    }
    y -= options.gap ?? 6;
  };
  const section = (number: string, title: string, description?: string) => {
    ensure(description ? 58 : 40);
    page.drawRectangle({ x: margin, y: y - 21, width: 25, height: 25, color: colors.navy });
    page.drawText(number, { x: margin + 6, y: y - 13.5, font: bold, size: 8.5, color: colors.white });
    page.drawText(title, { x: margin + 37, y: y - 12, font: bold, size: 16, color: colors.ink });
    y -= 31;
    if (description) paragraph(description, { size: 8.8, color: colors.muted, indent: 37, lineHeight: 13, gap: 12 });
    else y -= 10;
  };
  const label = (title: string, value: unknown) => {
    ensure(46);
    page.drawText(title, { x: margin, y, font: bold, size: 9, color: colors.green });
    y -= 17;
    if (typeof value === "string" && value.trim()) paragraph(value, { size: 10.3, gap: 11 });
    else y -= 7;
  };
  const bullets = (items: string[]) => {
    for (const item of items) {
      ensure(28);
      page.drawCircle({ x: margin + 3, y: y + 3, size: 2.1, color: colors.green });
      paragraph(item, { indent: 13, size: 10, gap: 3 });
    }
    y -= 5;
  };

  addPage(false);
  page.drawRectangle({ x: 0, y: A4.height - 212, width: A4.width, height: 212, color: colors.navy });
  page.drawText("KNU UICF 교육사업팀", { x: margin, y: A4.height - 57, font: bold, size: 10, color: rgb(194 / 255, 212 / 255, 227 / 255) });
  page.drawText("기업 조사 보고서", { x: margin, y: A4.height - 112, font: bold, size: 28, color: colors.white });
  page.drawText(text(company.name, "기업"), { x: margin, y: A4.height - 159, font: bold, size: 21, color: colors.white });
  const meta = [text(company.field, "업종 확인 필요"), text(company.websiteUrl, "웹사이트 확인 필요")];
  page.drawText(meta.join("  ·  "), { x: margin, y: A4.height - 187, font: regular, size: 9.5, color: rgb(194 / 255, 212 / 255, 227 / 255) });
  y = A4.height - 258;
  page.drawText("한눈에 이해하기", { x: margin, y, font: bold, size: 10, color: colors.blue });
  y -= 28;
  paragraph(report.headline, { font: bold, size: 20, color: colors.ink, lineHeight: 30, gap: 12 });
  paragraph(report.summary, { size: 11.5, lineHeight: 19, gap: 16 });
  const keywords = list(report.keywords);
  if (keywords.length) {
    page.drawText(keywords.map(item => `#${item}`).join("   "), { x: margin, y, font: bold, size: 9.5, color: colors.green });
    y -= 30;
  }
  page.drawLine({ start: { x: margin, y }, end: { x: A4.width - margin, y }, thickness: 0.8, color: colors.line });
  y -= 24;
  paragraph(`작성일  ${new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "long" }).format(new Date())}`, { size: 8.5, color: colors.muted });

  addPage(true);
  section("01", "무엇을 하는 회사인가요?", "제품, 고객, 업무 흐름을 쉬운 말로 정리");
  label("하는 일", report.business?.whatTheyDo || report.headline);
  label("제품·서비스", list(report.business?.offerings).join(" · ") || list(report.keywords).join(" · "));
  label("주요 고객", report.business?.customers);
  label("업무 흐름", report.business?.workFlow);
  if (report.glossary?.length) {
    label("알아두면 좋은 용어", "");
    for (const item of report.glossary) paragraph(`${text(item.term)}  —  ${text(item.meaning)}`, { size: 9.7, gap: 5 });
  }

  section("02", "교육을 준비할 때 볼 점", "업무와 인력 정보를 교육 관점으로 정리");
  const education = report.educationContext;
  if (education) {
    label("예상 교육 대상", list(education.likelyLearners).join(" · "));
    label("현재 업무 환경", education.currentWork);
    label("권장 시작점", education.startingPoint);
    label("상담에서 확인", education.caution);
  }
  const opportunities = Array.isArray(report.opportunities) ? report.opportunities : [];
  if (opportunities.length) {
    label("AI 교육 기회", "");
    opportunities.forEach((item, index) => {
      ensure(66);
      page.drawText(String(index + 1).padStart(2, "0"), { x: margin, y, font: bold, size: 9, color: colors.muted });
      page.drawText(text(item.title), { x: margin + 27, y, font: bold, size: 11.5, color: colors.ink });
      y -= 19;
      paragraph(item.detail, { indent: 27, size: 9.7, gap: 3 });
      const note = [item.audience ? `대상 · ${text(item.audience)}` : "", item.outcome ? `교육 후 · ${text(item.outcome)}` : ""].filter(Boolean).join("  |  ");
      if (note) paragraph(note, { indent: 27, size: 8.5, color: colors.green, gap: 8 });
    });
  }

  const similar = Array.isArray(payload.similarCompanies) ? payload.similarCompanies.slice(0, 5) : [];
  if (similar.length) {
    section("03", "기존 조사 기업과 비교", "시스템 안의 비슷한 기업을 함께 참고");
    similar.forEach(item => {
      ensure(45);
      page.drawText(text(item.name), { x: margin, y, font: bold, size: 10.5, color: colors.ink });
      y -= 16;
      paragraph(`${text(item.reason, "유사 업종")} · ${text(item.headline, "조사 결과 참고")}`, { size: 9, gap: 8 });
    });
  }

  section("+", "추가 기업 정보", "공시·채용·출처 자료");
  const dart = company.intelligence?.dart;
  if (dart?.available) {
    label("공시자료", "");
    const profile = dart.profile;
    bullets([
      `대표이사 · ${text(profile?.representative)}`,
      `설립일 · ${text(profile?.establishedDate)}`,
      `본점 주소 · ${text(profile?.address)}`,
      `업종 코드 · ${text(profile?.industryCode)}`,
    ]);
    const won = (value?: number | null) => value == null ? "확인 필요" : `${new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 }).format(value)}원`;
    bullets([`매출 · ${won(dart.financials?.revenue)}`, `영업이익 · ${won(dart.financials?.operatingProfit)}`, `자산 · ${won(dart.financials?.assets)}`]);
  } else label("공시자료", dart?.reason || "일치 자료 없음");
  const recruiting = company.intelligence?.recruiting;
  if (recruiting) {
    label("공개 채용정보", `공개 공고 ${recruiting.postingCount || 0}건 · IT 공고 ${recruiting.itPostingCount || 0}건 · 내부 IT 인력 신호 ${recruiting.hasInternalItSignal ? "확인" : "확인 필요"}`);
    const roles = [...list(recruiting.itRoles), ...list(recruiting.jobAreas)];
    if (roles.length) bullets(roles);
    if (recruiting.caveat) paragraph(recruiting.caveat, { size: 8.7, color: colors.muted });
  }
  const evidence = Array.isArray(report.evidence) ? report.evidence.slice(0, 30) : [];
  if (evidence.length) {
    label("확인한 출처", "");
    evidence.forEach(item => paragraph(`${text(item.claim)} · ${text(item.url)}`, { size: 8.2, lineHeight: 12, gap: 6 }));
  }

  const pages = pdf.getPages();
  pages.forEach((currentPage, index) => {
    const pageNumber = `${index + 1} / ${pages.length}`;
    currentPage.drawLine({ start: { x: margin, y: 39 }, end: { x: A4.width - margin, y: 39 }, thickness: 0.6, color: colors.line });
    currentPage.drawText("KNU UICF 교육사업팀", { x: margin, y: 24, font: regular, size: 7.5, color: colors.muted });
    currentPage.drawText(pageNumber, { x: A4.width - margin - regular.widthOfTextAtSize(pageNumber, 7.5), y: 24, font: regular, size: 7.5, color: colors.muted });
  });
  return pdf.save();
}

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 2_000_000) return NextResponse.json({ error: "기업 조사 내용이 너무 큽니다." }, { status: 413 });
    const payload = await request.json() as ReportPayload;
    if (!payload.company?.name || !payload.company.research) return NextResponse.json({ error: "내보낼 기업 조사 결과가 없습니다." }, { status: 400 });
    const bytes = await createPdf(payload);
    return new Response(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename=company-research.pdf", "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[company-report]", error);
    return NextResponse.json({ error: "PDF 파일을 만들지 못했습니다." }, { status: 500 });
  }
}
