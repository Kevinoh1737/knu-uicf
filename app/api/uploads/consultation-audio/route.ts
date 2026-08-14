import { requireTeamSession } from "@/lib/auth/guard";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import {
  CONSULTATION_AUDIO_BUCKET,
  MAX_CONSULTATION_AUDIO_SIZE,
  resolveConsultationAudio,
} from "@/lib/consultations";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const body = await request.json() as {
      companyId?: string;
      fileName?: string;
      fileSize?: number;
      mimeType?: string;
    };
    const companyId = String(body.companyId || "");
    const fileName = String(body.fileName || "").trim();
    const audio = resolveConsultationAudio(fileName, body.mimeType);

    if (!UUID.test(companyId)) return Response.json({ error: "기업 정보를 확인하지 못했습니다." }, { status: 400 });
    if (!audio) return Response.json({ error: "MP3, WAV, M4A, AAC, OGG, FLAC 파일을 선택해 주세요." }, { status: 400 });
    if (!body.fileSize || body.fileSize > MAX_CONSULTATION_AUDIO_SIZE) {
      return Response.json({ error: "녹취파일은 최대 50MB까지 업로드할 수 있습니다." }, { status: 400 });
    }

    const supabase = createSupabaseAdmin();
    const { data: company, error: companyError } = await supabase
      .from("company_research")
      .select("id")
      .eq("id", companyId)
      .maybeSingle();
    if (companyError) throw companyError;
    if (!company) return Response.json({ error: "기업 정보를 찾지 못했습니다." }, { status: 404 });

    const path = `${companyId}/${crypto.randomUUID()}.${audio.extension}`;
    const { data, error } = await supabase.storage.from(CONSULTATION_AUDIO_BUCKET).createSignedUploadUrl(path);
    if (error || !data?.token) throw new Error(error?.message || "업로드 주소를 만들지 못했습니다.");
    return Response.json({
      bucket: CONSULTATION_AUDIO_BUCKET,
      path,
      token: data.token,
      mimeType: audio.mimeType,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "업로드를 준비하지 못했습니다." }, { status: 422 });
  }
}
