import { requireTeamSession } from "@/lib/auth/guard";
import {
  INSTRUCTOR_DOCUMENTS_BUCKET,
  MAX_INSTRUCTOR_DOCUMENT_SIZE,
  resolveInstructorDocument,
} from "@/lib/instructors";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { cleanFileName } from "@/lib/file-names";

export const runtime = "nodejs";

// roster 는 수강생 명단이다. 추출에만 쓰고 instructor_documents 행으로 남기지 않으므로
// 그 테이블의 kind 제약과는 무관하다 — 저장 경로만 나눈다.
const KINDS = new Set(["profile", "outline", "materials", "signed_contract", "roster"]);

export async function POST(request: Request) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const body = await request.json() as { fileName?: string; fileSize?: number; kind?: string };
    const fileName = cleanFileName(body.fileName);
    const kind = typeof body.kind === "string" && KINDS.has(body.kind) ? body.kind : "";
    if (!fileName || !kind) return Response.json({ error: "업로드 정보를 확인하지 못했습니다." }, { status: 400 });

    // MIME 은 브라우저가 한글·파워포인트를 octet-stream 으로 보내는 경우가 흔해 믿지 않는다.
    const resolved = resolveInstructorDocument(fileName);
    if (!resolved) {
      return Response.json({ error: "PDF, HWP, HWPX, DOC, DOCX, PPT, PPTX 파일만 올릴 수 있습니다." }, { status: 400 });
    }
    if (!body.fileSize || body.fileSize > MAX_INSTRUCTOR_DOCUMENT_SIZE) {
      return Response.json({ error: "파일은 최대 50MB까지 올릴 수 있습니다." }, { status: 400 });
    }

    const path = `${kind}/${crypto.randomUUID()}.${resolved.extension}`;
    const { data, error } = await createSupabaseAdmin()
      .storage.from(INSTRUCTOR_DOCUMENTS_BUCKET)
      .createSignedUploadUrl(path);
    if (error || !data?.token) throw new Error(error?.message || "업로드 주소를 만들지 못했습니다.");

    return Response.json({
      bucket: INSTRUCTOR_DOCUMENTS_BUCKET,
      path,
      token: data.token,
      mimeType: resolved.mimeType,
      parsable: resolved.parsable,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "업로드를 준비하지 못했습니다." },
      { status: 422 },
    );
  }
}
