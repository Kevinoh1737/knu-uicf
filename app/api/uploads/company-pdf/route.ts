import { requireTeamSession } from "@/lib/auth/guard";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const BUCKET = "company-source-documents";
const MAX_FILE_SIZE = 50 * 1024 * 1024;

export async function POST(request: Request) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const body = await request.json() as { fileName?: string; fileSize?: number; mimeType?: string };
    if (body.mimeType !== "application/pdf" || !body.fileName?.toLowerCase().endsWith(".pdf")) {
      return Response.json({ error: "PDF 파일만 업로드할 수 있습니다." }, { status: 400 });
    }
    if (!body.fileSize || body.fileSize > MAX_FILE_SIZE) {
      return Response.json({ error: "PDF는 최대 50MB까지 업로드할 수 있습니다." }, { status: 400 });
    }

    const path = `company-intake/${crypto.randomUUID()}.pdf`;
    const { data, error } = await createSupabaseAdmin().storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data?.token) throw new Error(error?.message || "업로드 주소를 만들지 못했습니다.");
    return Response.json({ bucket: BUCKET, path, token: data.token });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "업로드를 준비하지 못했습니다." }, { status: 422 });
  }
}
