import { getCurrentUser } from '@/app/auth';
import { getDatabase } from '@/db';
import { OPEN_FILE_MAX_BYTES, putOpenFile } from '@/lib/open-files';

/**
 * POST /api/open-files { name, mime, data(base64) } → { id, url }
 * 브라우저가 변환한 오피스 파일을 잠시 올려 두고, Office URI 스킴(ms-word:ofe|u|<url>)으로 데스크톱 앱이 열게 합니다.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  const body = await request.json().catch(() => null) as { name?: unknown; mime?: unknown; data?: unknown } | null;
  if (typeof body?.name !== 'string' || typeof body.mime !== 'string' || typeof body.data !== 'string' || !body.data) {
    return Response.json({ error: '파일 이름, 형식, 내용이 필요합니다.' }, { status: 400 });
  }
  if (body.data.length > OPEN_FILE_MAX_BYTES * 4 / 3 + 4) return Response.json({ error: '바로 열기는 1.4MB 이하 파일만 지원합니다. 내려받기로 열어 주세요.' }, { status: 413 });
  const name = body.name.split(/[\\/]/).pop()?.slice(0, 200) || 'file';
  const id = await putOpenFile(getDatabase(), user.userId, { name, mime: body.mime.slice(0, 120), data: body.data });
  const origin = new URL(request.url).origin;
  return Response.json({ id, url: `${origin}/api/open-files/${id}/${encodeURIComponent(name)}` });
}
