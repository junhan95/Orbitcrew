import { getCurrentUser } from '@/app/auth';
import { getDatabase } from '@/db';
import { getTaskFile } from '@/lib/task-files';

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

/** 산출물 파일 하나의 내용 — '결과보기' 가 새 탭·미리보기로 엽니다. */
export async function GET(_request: Request, context: RouteContext) {
  const user = await getCurrentUser();
  const { id } = await context.params;
  const file = await getTaskFile(getDatabase(), user.userId, id);
  if (!file) return Response.json({ error: '파일을 찾을 수 없습니다.' }, { status: 404 });
  return Response.json({ file });
}
