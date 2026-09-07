/**
 * 데스크톱 앱으로 바로 열기 (open_files).
 *
 * 브라우저는 로컬 앱을 직접 실행할 수 없지만, Office 는 `ms-word:ofe|u|<https URL>` 같은 URI 스킴을 등록해 두어
 * URL 의 문서를 Word·Excel·PowerPoint 에서 바로 엽니다. 그래서 브라우저가 파일을 잠시 서버에 올리고(무작위 id, 1시간 뒤 삭제),
 * 그 URL 을 Office 스킴으로 넘깁니다. 원본 폴더의 파일을 편집하는 것은 아니고(URL 의 사본을 엽니다) 저장은 '다른 이름으로 저장' 이 됩니다.
 */

export const OPEN_FILE_TTL_MS = 60 * 60 * 1000;
/** D1 행 크기 한도(2MB)를 고려한 파일 상한 — base64 로 4/3 배가 됩니다. */
export const OPEN_FILE_MAX_BYTES = 1_400_000;

export type OpenFileRow = { id: string; name: string; mime: string; data: string; createdAt: number };

export async function putOpenFile(db: D1Database, userId: string, params: { name: string; mime: string; data: string }): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM open_files WHERE created_at < ?').bind(now - OPEN_FILE_TTL_MS),
    db.prepare('INSERT INTO open_files (id, user_id, name, mime, data, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, userId, params.name, params.mime, params.data, now),
  ]);
  return id;
}

export async function getOpenFile(db: D1Database, id: string): Promise<OpenFileRow | null> {
  const row = await db.prepare('SELECT id, name, mime, data, created_at AS createdAt FROM open_files WHERE id = ?').bind(id).first<OpenFileRow>();
  if (!row || row.createdAt < Date.now() - OPEN_FILE_TTL_MS) return null;
  return row;
}

/** base64 → bytes (Workers 에서도 동작) */
export function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
