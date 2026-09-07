/**
 * Word·Excel·PowerPoint 로 바로 열기 (브라우저).
 *
 * 브라우저는 로컬 앱을 실행할 수 없지만 Office 는 URI 스킴(ms-word: / ms-excel: / ms-powerpoint:)을 등록해 두므로,
 * 파일을 서버에 잠시 올린 뒤 그 URL 을 스킴으로 넘기면 데스크톱 Office 가 문서를 바로 엽니다 (lib/open-files, 1시간 뒤 삭제).
 * Office 가 없거나 파일이 크면 false 를 돌려주고, 호출자가 내려받기로 대신합니다.
 */
import { OPEN_FILE_MAX_BYTES } from './open-files';

export type OfficeScheme = 'ms-word' | 'ms-excel' | 'ms-powerpoint';

export function officeSchemeFor(name: string): OfficeScheme | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'docx' || ext === 'doc' || ext === 'rtf') return 'ms-word';
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') return 'ms-excel';
  if (ext === 'pptx' || ext === 'ppt') return 'ms-powerpoint';
  return null;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read-failed'));
    reader.onload = () => { const result = typeof reader.result === 'string' ? reader.result : ''; resolve(result.slice(result.indexOf(',') + 1)); };
    reader.readAsDataURL(blob);
  });
}

/** 성공하면 브라우저가 "Word 를 여시겠습니까?" 를 묻고 앱이 뜹니다. 실패(형식·크기·서버)면 false. */
export async function openWithOfficeApp(name: string, blob: Blob): Promise<boolean> {
  const scheme = officeSchemeFor(name);
  if (!scheme || blob.size > OPEN_FILE_MAX_BYTES) return false;
  try {
    const response = await fetch('/api/open-files', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.split('/').pop() ?? name, mime: blob.type || 'application/octet-stream', data: await blobToBase64(blob) }),
    });
    if (!response.ok) return false;
    const { url } = await response.json() as { url?: string };
    if (!url) return false;
    // ofe = open for edit. 페이지는 그대로 있고 운영체제가 스킴 핸들러(Office)를 띄웁니다.
    window.location.href = `${scheme}:ofe|u|${url}`;
    return true;
  } catch { return false; }
}
