type GeminiFile = {
  name: string;
  uri: string;
  mimeType: string;
  state?: string;
  error?: { message?: string };
};

const FILES_API = "https://generativelanguage.googleapis.com/v1beta";
const FILES_UPLOAD_API = "https://generativelanguage.googleapis.com/upload/v1beta/files";

function apiKey() {
  const value = process.env.GEMINI_API_KEY;
  if (!value) throw new Error("GEMINI_API_KEY is not configured");
  return value;
}

const DEFAULT_UPLOAD_BUDGET_MS = 150_000;

export async function uploadGeminiFile(bytes: Buffer, fileName: string, mimeType: string, budgetMs = DEFAULT_UPLOAD_BUDGET_MS) {
  const deadline = Date.now() + budgetMs;
  const start = await fetch(FILES_UPLOAD_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey(),
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(bytes.byteLength),
      "X-Goog-Upload-Header-Content-Type": mimeType,
    },
    body: JSON.stringify({ file: { displayName: fileName } }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!start.ok) throw new Error(`녹취파일 전송 준비 실패 (${start.status})`);
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("녹취파일 전송 주소를 받지 못했습니다.");

  const upload = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(bytes.byteLength),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    signal: AbortSignal.timeout(120_000),
  });
  if (!upload.ok) throw new Error(`녹취파일 전송 실패 (${upload.status})`);
  const result = await upload.json() as { file?: GeminiFile };
  if (!result.file?.name || !result.file.uri) throw new Error("전송된 녹취파일 정보를 확인하지 못했습니다.");
  return waitForGeminiFile(result.file, deadline);
}

async function waitForGeminiFile(file: GeminiFile, deadline: number) {
  let current = file;
  for (let attempt = 0; attempt < 60 && Date.now() < deadline; attempt += 1) {
    if (!current.state || current.state === "ACTIVE") return current;
    if (current.state === "FAILED") throw new Error(current.error?.message || "녹취파일을 처리하지 못했습니다.");
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const response = await fetch(`${FILES_API}/${current.name}`, {
      headers: { "x-goog-api-key": apiKey() },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`녹취파일 처리 상태 확인 실패 (${response.status})`);
    current = await response.json() as GeminiFile;
  }
  throw new Error("녹취파일 처리 시간이 초과되었습니다.");
}

export async function deleteGeminiFile(fileName: string) {
  try {
    await fetch(`${FILES_API}/${fileName}`, {
      method: "DELETE",
      headers: { "x-goog-api-key": apiKey() },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // The original recording remains in Supabase; temporary Gemini cleanup can be retried later.
  }
}
