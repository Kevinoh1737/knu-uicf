import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";

/**
 * PDF 한 장을 위에서 아래로 쓰는 도구. 설문지(빈 종이)와 결과 보고서가 같은 여백·같은 서체·
 * 같은 줄바꿈을 쓰도록 한 곳에 둔다 — 두 벌로 두면 한쪽만 고쳐져 인쇄물이 서로 달라진다.
 */
export const PAGE = { width: 595.28, height: 841.89 };
export const MARGIN = 56;
export const INK = rgb(0.09, 0.13, 0.11);
export const MUTED = rgb(0.47, 0.5, 0.48);
export const LINE = rgb(0.86, 0.89, 0.92);
export const BAR = rgb(0.35, 0.51, 0.45);
export const BAR_BG = rgb(0.91, 0.93, 0.92);

/** pdf-lib 은 줄바꿈을 해주지 않는다. 폭에 맞춰 직접 자른다 — 계약서 PDF 와 같은 방식이다. */
export function wrap(text: string, font: PDFFont, size: number, maxWidth: number) {
  const lines: string[] = [];
  let current = "";
  for (const character of text) {
    if (character === "\n") { lines.push(current); current = ""; continue; }
    const next = current + character;
    if (font.widthOfTextAtSize(next, size) > maxWidth && current) { lines.push(current); current = character; }
    else current = next;
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * 글자를 하나씩, 우리가 잰 폭만큼 밀어 가며 놓는다.
 *
 * pdf-lib 에 통째로 넘기면 몇몇 글자(`:` `~` 등)가 제 폭이 아니라 한 칸(1em) 을 먹어서
 * "10:00~14:00" 이 "10:  00~ 14:  00" 으로 벌어진다 — 실측으로 확인했다(계산 폭 112pt,
 * 그려진 폭 151pt). 폰트의 폭 값 자체는 옳으므로(`:` 5.08pt), 그 값으로 자리를 직접
 * 잡으면 화면에서 보던 간격이 그대로 나온다.
 */
export function drawRun(page: PDFPage, text: string, options: {
  x: number; y: number; size: number; font: PDFFont; color?: ReturnType<typeof rgb>;
}) {
  let x = options.x;
  for (const character of text) {
    if (character !== " ") {
      page.drawText(character, { x, y: options.y, size: options.size, font: options.font, color: options.color ?? INK });
    }
    x += options.font.widthOfTextAtSize(character, options.size);
  }
}

export type Writer = { pdf: PDFDocument; page: PDFPage; y: number };

export function ensureRoom(writer: Writer, needed: number) {
  if (writer.y - needed > MARGIN) return;
  writer.page = writer.pdf.addPage([PAGE.width, PAGE.height]);
  writer.y = PAGE.height - MARGIN;
}

export function line(writer: Writer, text: string, font: PDFFont, size: number, gap = 6, color = INK, indent = 0) {
  for (const row of wrap(text, font, size, PAGE.width - MARGIN * 2 - indent)) {
    ensureRoom(writer, size + gap);
    drawRun(writer.page, row, { x: MARGIN + indent, y: writer.y, size, font, color });
    writer.y -= size + gap;
  }
}

export function rule(writer: Writer, gap = 18) {
  ensureRoom(writer, gap + 6);
  writer.y -= 6;
  writer.page.drawLine({
    start: { x: MARGIN, y: writer.y }, end: { x: PAGE.width - MARGIN, y: writer.y },
    thickness: 1, color: LINE,
  });
  writer.y -= gap;
}

/** 문서를 열고 Pretendard 를 심는다. 한글이 들어가므로 내장 폰트로는 한 글자도 못 쓴다. */
export async function createDocument() {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const [regularBytes, boldBytes] = await Promise.all([
    readFile(path.join(process.cwd(), "public/fonts/Pretendard-Regular.ttf")),
    readFile(path.join(process.cwd(), "public/fonts/Pretendard-Bold.ttf")),
  ]);
  const regular = await pdf.embedFont(regularBytes);
  const bold = await pdf.embedFont(boldBytes);
  const writer: Writer = { pdf, page: pdf.addPage([PAGE.width, PAGE.height]), y: PAGE.height - MARGIN };
  return { pdf, regular, bold, writer };
}

export function pdfResponse(bytes: Uint8Array, filename: string) {
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
