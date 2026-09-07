/**
 * 에이전트가 이 브라우저에서 저장한 산출물 목록.
 * 파일 저장(File System Access API)이 브라우저 단위로 일어나므로 기록도 같은 브라우저(localStorage)에 둡니다.
 * 프로젝트 상세의 '결과보기' 버튼은 이 목록이 비어 있지 않을 때만 켜집니다.
 */
export type ProjectArtifact = { folderId: string; path: string; savedAt: number };

const EVENT = 'orbit-artifacts-changed';
const MAX_ARTIFACTS = 50;
const key = (projectId: string) => `orbit.project-artifacts.${projectId}`;

export function readArtifacts(projectId: string): ProjectArtifact[] {
  try {
    const raw = localStorage.getItem(key(projectId));
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is ProjectArtifact =>
      Boolean(item) && typeof item === 'object'
      && typeof (item as ProjectArtifact).folderId === 'string'
      && typeof (item as ProjectArtifact).path === 'string'
      && typeof (item as ProjectArtifact).savedAt === 'number');
  } catch { return []; }
}

/** 같은 폴더·경로는 하나로 합치고 최신 저장이 앞에 오게 둡니다. */
export function recordArtifact(projectId: string, folderId: string, path: string, savedAt = Date.now()) {
  const rest = readArtifacts(projectId).filter(item => !(item.folderId === folderId && item.path.toLowerCase() === path.toLowerCase()));
  const next = [{ folderId, path, savedAt }, ...rest].slice(0, MAX_ARTIFACTS);
  try { localStorage.setItem(key(projectId), JSON.stringify(next)); } catch { /* 저장 공간이 없어도 화면은 계속 동작합니다. */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
  return next;
}

/** 폴더 연결을 해제하면 그 폴더의 산출물 기록도 지웁니다. */
export function forgetFolderArtifacts(projectId: string, folderId: string) {
  const next = readArtifacts(projectId).filter(item => item.folderId !== folderId);
  try { localStorage.setItem(key(projectId), JSON.stringify(next)); } catch { /* ignore */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
}

export function subscribeArtifacts(listener: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key?.startsWith('orbit.project-artifacts.')) listener(); };
  window.addEventListener('storage', onStorage);
  window.addEventListener(EVENT, listener);
  return () => { window.removeEventListener('storage', onStorage); window.removeEventListener(EVENT, listener); };
}

/** 브라우저에서 바로 열 수 있는 파일 — 새 탭에 렌더링합니다. 나머지는 텍스트로 보여 줍니다. */
export function isBrowserViewable(path: string): boolean {
  return /\.(html?|svg|pdf|png|jpe?g|gif|webp)$/i.test(path);
}

export function mimeOf(path: string): string {
  const ext = path.toLowerCase().split('.').pop() ?? '';
  return ({
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', csv: 'text/csv',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ppt: 'application/vnd.ms-powerpoint',
    html: 'text/html', htm: 'text/html', svg: 'image/svg+xml', pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', md: 'text/markdown', txt: 'text/plain', json: 'application/json', css: 'text/css', js: 'text/javascript' } as Record<string, string>)[ext] ?? 'text/plain';
}
