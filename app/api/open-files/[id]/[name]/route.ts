import { getDatabase } from '@/db';
import { decodeBase64, getOpenFile } from '@/lib/open-files';

type RouteContext = { params: Promise<{ id: string; name: string }> | { id: string; name: string } };

/**
 * GET /api/open-files/<id>/<name> — Office 앱이 직접 받아 가는 경로 (세션 쿠키 없음: id 가 무작위 토큰이고 1시간 뒤 사라집니다).
 * Office 는 먼저 OPTIONS/HEAD 로 WebDAV 여부를 물으므로 그것도 받아 줍니다.
 */
export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const file = await getOpenFile(getDatabase(), id);
  if (!file) return new Response('not found', { status: 404 });
  const bytes = decodeBase64(file.data);
  return new Response(new Blob([bytes as BlobPart]), {
    headers: {
      'content-type': file.mime || 'application/octet-stream',
      'content-length': String(bytes.byteLength),
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'cache-control': 'private, max-age=3600',
      'accept-ranges': 'bytes',
    },
  });
}

export async function HEAD(request: Request, context: RouteContext) {
  const response = await GET(request, context);
  return new Response(null, { status: response.status, headers: response.headers });
}

export function OPTIONS() {
  return new Response(null, { status: 200, headers: { allow: 'GET, HEAD, OPTIONS', } });
}
