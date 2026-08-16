import { requireTeamSession } from "@/lib/auth/guard";
import { LearnerInput, sanitizeLearners } from "@/lib/learners";
import { findColumns, readSheetRows } from "@/lib/xlsx";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SHEET_BYTES = 10 * 1024 * 1024;

/**
 * 고객사가 보내 준 수강생 명단 엑셀을 읽는다. 저장하지 않고 돌려주기만 한다 — 담당자가
 * 화면에서 확인하고 고친 뒤 저장한다. 명단은 사람 이름이 들어가는 자료라 무턱대고
 * 들이지 않는다.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireTeamSession();
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!UUID.test(id)) return Response.json({ error: "기업 정보를 확인하지 못했습니다." }, { status: 400 });

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "엑셀 파일을 올려 주세요." }, { status: 400 });
    if (!/\.xlsx$/i.test(file.name)) {
      return Response.json(
        { error: "xlsx 파일만 읽을 수 있습니다. 엑셀에서 '다른 이름으로 저장 → xlsx' 후 올려 주세요." },
        { status: 400 },
      );
    }
    if (file.size > MAX_SHEET_BYTES) return Response.json({ error: "파일은 최대 10MB까지 올릴 수 있습니다." }, { status: 400 });

    const rows = readSheetRows(Buffer.from(await file.arrayBuffer()));
    const columns = findColumns(rows);
    if (!columns) {
      return Response.json(
        { error: "명단에서 '이름' 열을 찾지 못했습니다. 첫 줄에 이름·부서·직급·이메일 머리글이 있는지 확인해 주세요." },
        { status: 422 },
      );
    }

    const pick = (row: string[], index: number) => (index >= 0 ? row[index] || "" : "");
    const learners: LearnerInput[] = sanitizeLearners(
      rows.slice(columns.header + 1).map((row) => ({
        name: pick(row, columns.name),
        department: pick(row, columns.department),
        jobTitle: pick(row, columns.jobTitle),
        email: pick(row, columns.email),
        notes: "",
      })),
    );

    if (!learners.length) {
      return Response.json({ error: "명단에서 사람을 찾지 못했습니다." }, { status: 422 });
    }
    return Response.json({ learners, count: learners.length, headerRow: columns.header + 1 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    return Response.json({ error: detail || "엑셀을 읽지 못했습니다." }, { status: 422 });
  }
}
