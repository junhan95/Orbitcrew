import { getCurrentUser } from '@/app/auth';
import { getDatabase } from '@/db';
import { listProjectFiles } from '@/lib/task-files';

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

/** 프로젝트의 산출물 파일 목록 (서버 보관본, 내용 제외) — 프로젝트 상세 '결과보기' 가 씁니다. */
export async function GET(_request: Request, context: RouteContext) {
  const user = await getCurrentUser();
  const { id } = await context.params;
  const db = getDatabase();
  const owned = await db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').bind(id, user.userId).first<{ id: string }>();
  if (!owned) return Response.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
  return Response.json({ files: await listProjectFiles(db, user.userId, id) });
}
