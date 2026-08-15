import { requireTeamSession } from "@/lib/auth/guard";
import { recordFromProfile, sanitizeProfile } from "@/lib/instructors";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const COLUMNS =
  "id,name,affiliation,job_title,email,phone,expertise,career,education,teaching_history,certifications,preferred_style,notes,reuse_aggregate,reuse_share_original,status,created_at,updated_at";

export async function GET() {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const supabase = createSupabaseAdmin();
    const { data: instructors, error } = await supabase
      .from("instructors")
      .select(COLUMNS)
      .order("updated_at", { ascending: false });
    if (error) throw error;

    // 목록에 필요한 것은 건수와 최근 진행일뿐이라 강의 행을 통째로 내려보내지 않는다.
    const { data: sessions, error: sessionsError } = await supabase
      .from("course_sessions")
      .select("instructor_id,held_on,status");
    if (sessionsError) throw sessionsError;

    const stats = new Map<string, { delivered: number; planned: number; lastHeldOn: string | null }>();
    (sessions || []).forEach((session) => {
      const key = session.instructor_id as string;
      const current = stats.get(key) || { delivered: 0, planned: 0, lastHeldOn: null };
      if (session.status === "delivered") current.delivered += 1;
      else if (session.status !== "cancelled") current.planned += 1;
      const heldOn = session.held_on as string | null;
      if (heldOn && (!current.lastHeldOn || heldOn > current.lastHeldOn)) current.lastHeldOn = heldOn;
      stats.set(key, current);
    });

    return Response.json({
      instructors: (instructors || []).map((instructor) => ({
        ...instructor,
        stats: stats.get(instructor.id as string) || { delivered: 0, planned: 0, lastHeldOn: null },
      })),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "강사 목록을 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}

type SourceDocument = { storagePath?: string; fileName?: string; mimeType?: string; fileSize?: number; parsed?: boolean };

export async function POST(request: Request) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const body = await request.json() as { profile?: unknown; sourceDocument?: SourceDocument };
    const profile = sanitizeProfile(body.profile);
    if (!profile.name) return Response.json({ error: "강사 이름은 반드시 필요합니다." }, { status: 400 });

    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase
      .from("instructors")
      .insert(recordFromProfile(profile))
      .select(COLUMNS)
      .single();
    if (error) throw error;

    // 추출에 쓴 원본을 강사에 붙인다. 여기서 실패해도 강사 등록은 이미 끝났으므로 되돌리지 않는다.
    const source = body.sourceDocument;
    if (source?.storagePath && source.fileName) {
      const { error: documentError } = await supabase.from("instructor_documents").insert({
        instructor_id: data.id,
        kind: "profile",
        file_name: source.fileName,
        storage_path: source.storagePath,
        mime_type: source.mimeType || "",
        file_size: Math.max(0, Number(source.fileSize) || 0),
        parse_status: source.parsed ? "completed" : "skipped",
      });
      if (documentError) console.error(`[instructors] 프로필 원본 기록 실패: ${documentError.message}`);
    }

    return Response.json({ instructor: { ...data, stats: { delivered: 0, planned: 0, lastHeldOn: null } } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "강사를 등록하지 못했습니다." },
      { status: 422 },
    );
  }
}
