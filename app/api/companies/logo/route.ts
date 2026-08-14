import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import sharp from "sharp";

export const runtime = "nodejs";
export const maxDuration = 30;

const HTML_LIMIT = 2 * 1024 * 1024;
const IMAGE_LIMIT = 5 * 1024 * 1024;

function normalizeWebsite(input: string) {
  const value = input.trim();
  return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
}

function isPrivateAddress(address: string) {
  if (address === "::1" || address === "::" || address.startsWith("fe80:") || address.startsWith("fc") || address.startsWith("fd")) return true;
  const mapped = address.startsWith("::ffff:") ? address.slice(7) : address;
  if (isIP(mapped) !== 4) return false;
  const [a, b] = mapped.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

async function assertPublicUrl(url: URL) {
  if (!(["http:", "https:"] as string[]).includes(url.protocol)) throw new Error("HTTP 또는 HTTPS 주소만 사용할 수 있습니다.");
  if (url.username || url.password) throw new Error("인증 정보가 포함된 주소는 사용할 수 없습니다.");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("외부에 공개된 홈페이지 주소를 입력해 주세요.");
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error("안전하게 확인할 수 없는 홈페이지 주소입니다.");
}

async function fetchPublic(url: URL, accept: string, limit: number) {
  let current = url;
  for (let redirects = 0; redirects < 5; redirects += 1) {
    await assertPublicUrl(current);
    const response = await fetch(current, {
      redirect: "manual",
      headers: { Accept: accept, "User-Agent": "KNU-UICF-EducationBot/1.0 (+logo-research)" },
      signal: AbortSignal.timeout(10_000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("홈페이지 이동 주소를 확인할 수 없습니다.");
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) throw new Error(`홈페이지 응답 오류 (${response.status})`);
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > limit) throw new Error("가져올 파일의 용량이 너무 큽니다.");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > limit) throw new Error("가져올 파일의 용량이 너무 큽니다.");
    return { response, buffer, finalUrl: current };
  }
  throw new Error("홈페이지 이동 횟수가 너무 많습니다.");
}

function attr(tag: string, name: string) {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1]?.trim();
}

function unescapeHtml(value: string) {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function pageMetadata(html: string, base: URL) {
  const candidates: string[] = [];
  const socialImages: string[] = [];
  let companyName = "";
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = (attr(tag, "property") || attr(tag, "name") || "").toLowerCase();
    const content = attr(tag, "content");
    if (!content) continue;
    if (key === "og:site_name") companyName = unescapeHtml(content);
    if (["og:logo", "twitter:logo"].includes(key)) candidates.push(content);
    if (key === "og:image") socialImages.push(content);
  }
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const rel = (attr(tag, "rel") || "").toLowerCase();
    const href = attr(tag, "href");
    if (href && /(icon|apple-touch-icon)/.test(rel)) candidates.push(href);
  }
  const images = html.match(/<img\b[^>]*>/gi) || [];
  for (const tag of images) {
    const source = attr(tag, "src") || attr(tag, "data-src") || attr(tag, "data-lazy-src");
    const identity = [attr(tag, "alt"), attr(tag, "class"), attr(tag, "id")].filter(Boolean).join(" ");
    if (source && /logo|brand|symbol/i.test(identity) && !/customers?|clients?|partners?|portfolio|testimonial/i.test(source)) candidates.unshift(source);
  }
  for (const match of html.matchAll(/["']([^"']*(?:logo|brand|symbol)[^"']*\.(?:png|jpe?g|webp|gif|svg)(?:\?[^"']*)?)["']/gi)) {
    if (!/customers?|clients?|partners?|portfolio|testimonial/i.test(match[1])) candidates.unshift(match[1]);
  }
  for (const match of html.matchAll(/["']logo["']\s*:\s*["']([^"']+)["']/gi)) candidates.unshift(match[1]);
  if (!companyName) companyName = unescapeHtml(html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.split(/[|·–—-]/)[0]?.trim() || "");
  const urls = [...candidates, ...socialImages].flatMap((source) => {
    try { return [new URL(unescapeHtml(source), base)]; } catch { return []; }
  });
  return { companyName, candidates: [...new Map(urls.map((url) => [url.href, url])).values()].slice(0, 10) };
}

async function removeEdgeBackground(input: Buffer) {
  const decoded = await sharp(input, { animated: false }).rotate().resize(512, 512, { fit: "inside", withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = decoded.info;
  const pixels = decoded.data;
  const cornerIndexes = [0, width - 1, (height - 1) * width, height * width - 1];
  const cornerColors = cornerIndexes.map((index) => [pixels[index * channels], pixels[index * channels + 1], pixels[index * channels + 2]]);
  const visited = new Uint8Array(width * height);
  const background = new Uint8Array(width * height);
  const queue: number[] = [];
  const enqueue = (index: number) => { if (!visited[index]) { visited[index] = 1; queue.push(index); } };
  for (let x = 0; x < width; x += 1) { enqueue(x); enqueue((height - 1) * width + x); }
  for (let y = 0; y < height; y += 1) { enqueue(y * width); enqueue(y * width + width - 1); }
  const colorDistance = (left: number, right: number) => {
    const a = left * channels, b = right * channels;
    const dr = pixels[a] - pixels[b], dg = pixels[a + 1] - pixels[b + 1], db = pixels[a + 2] - pixels[b + 2];
    return dr * dr + dg * dg + db * db;
  };
  const matchesBackground = (index: number) => {
    const offset = index * channels;
    if (pixels[offset + 3] < 16) return true;
    if (cornerColors.some(([r, g, b]) => {
      const dr = pixels[offset] - r, dg = pixels[offset + 1] - g, db = pixels[offset + 2] - b;
      return dr * dr + dg * dg + db * db <= 34 * 34;
    })) return true;
    const x = index % width, y = Math.floor(index / width);
    const neighbors = [x > 0 ? index - 1 : -1, x + 1 < width ? index + 1 : -1, y > 0 ? index - width : -1, y + 1 < height ? index + width : -1];
    return neighbors.some((neighbor) => neighbor >= 0 && background[neighbor] && colorDistance(index, neighbor) <= 14 * 14);
  };
  let removed = 0;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor];
    if (!matchesBackground(index)) continue;
    background[index] = 1;
    pixels[index * channels + 3] = 0;
    removed += 1;
    const x = index % width, y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1); if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width); if (y + 1 < height) enqueue(index + width);
  }
  const transparentRatio = removed / (width * height);
  const normalized = sharp(pixels, { raw: { width, height, channels } });
  const png = await (transparentRatio > 0.03 && transparentRatio < 0.94 ? normalized.trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } }) : normalized)
    .extend({ top: 12, bottom: 12, left: 12, right: 12, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 9 }).toBuffer();
  const metadata = await sharp(png).metadata();
  return { png, width: metadata.width, height: metadata.height };
}

async function normalizeLogo(input: Buffer) {
  try {
    return await removeEdgeBackground(input);
  } catch {
    const png = await sharp(input, { animated: false }).rotate().resize(512, 512, { fit: "inside", withoutEnlargement: true }).ensureAlpha()
      .extend({ top: 12, bottom: 12, left: 12, right: 12, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 9 }).toBuffer();
    const metadata = await sharp(png).metadata();
    return { png, width: metadata.width, height: metadata.height };
  }
}

export async function POST(request: Request) {
  try {
    const { websiteUrl } = await request.json() as { websiteUrl?: string };
    if (!websiteUrl) return Response.json({ error: "회사 홈페이지 주소를 입력해 주세요." }, { status: 400 });
    const homepage = normalizeWebsite(websiteUrl);
    const page = await fetchPublic(homepage, "text/html,application/xhtml+xml", HTML_LIMIT);
    const contentType = page.response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) throw new Error("홈페이지 HTML을 확인할 수 없습니다.");
    const html = page.buffer.toString("utf8");
    const metadata = pageMetadata(html, page.finalUrl);
    const failures: string[] = [];
    for (const candidate of metadata.candidates) {
      try {
        const image = await fetchPublic(candidate, "image/*", IMAGE_LIMIT);
        const imageType = image.response.headers.get("content-type") || "";
        if (!imageType.startsWith("image/") && !/\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(candidate.href)) continue;
        const result = await normalizeLogo(image.buffer);
        return Response.json({ companyName: metadata.companyName, websiteUrl: page.finalUrl.href, sourceUrl: image.finalUrl.href, logoDataUrl: `data:image/png;base64,${result.png.toString("base64")}`, width: result.width, height: result.height });
      } catch (candidateError) { failures.push(`${candidate.href}: ${candidateError instanceof Error ? candidateError.message : "처리 실패"}`); }
    }
    return Response.json({ companyName: metadata.companyName, websiteUrl: page.finalUrl.href, logoDataUrl: null, warning: "홈페이지에서 사용할 수 있는 로고를 찾지 못했습니다.", ...(process.env.NODE_ENV === "development" ? { debug: { candidates: metadata.candidates.map(url => url.href), failures } } : {}) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "회사 로고를 가져오지 못했습니다.";
    return Response.json({ error: message }, { status: 422 });
  }
}
