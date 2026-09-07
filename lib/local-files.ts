import type { FsDirHandle } from './folder-access';
const MAX_BYTES = 1_000_000;
export function fileSegments(path: string): string[] {
  const parts = path.split('/');
  if (!path || path.length > 240 || /[\\:<>"|?*]/.test(path) || path.split('').some(char => char.charCodeAt(0) < 32) || parts.some(p => !p || p.startsWith('.') || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)) || parts.some(p => /^(node_modules|credentials?|secrets?)(\.|$)/i.test(p)) || /\.(pem|key)$/i.test(path)) throw new Error('연결 폴더 안의 일반 파일 경로를 입력하세요.');
  return parts;
}
async function parent(root: FsDirHandle, path: string, create = false) {
  const parts = fileSegments(path); let dir = root;
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create });
  return { dir, name: parts[parts.length - 1] };
}
export async function readLocalFile(root: FsDirHandle, path: string): Promise<string> {
  const { dir, name } = await parent(root, path);
  const file = await (await dir.getFileHandle(name)).getFile();
  if (file.size > MAX_BYTES) throw new Error('편집 가능한 파일 크기는 1MB까지입니다.');
  const bytes = await file.arrayBuffer();
  if (new Uint8Array(bytes).includes(0)) throw new Error('텍스트 파일만 편집할 수 있습니다.');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
export async function saveLocalFile(root: FsDirHandle, path: string, text: string | Blob, original: string | null): Promise<void> {
  fileSegments(path);
  const bytes = typeof text === 'string' ? new TextEncoder().encode(text).length : text.size;
  if (bytes > MAX_BYTES * 5) throw new Error('저장 가능한 파일 크기는 5MB까지입니다.');
  if (root.queryPermission && await root.queryPermission({ mode: 'readwrite' }) !== 'granted') {
    if (!root.requestPermission || await root.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('파일을 저장하려면 폴더 쓰기 권한이 필요합니다.');
  }
  let current: string | null = null;
  try { current = await readLocalFile(root, path); } catch (error) { if ((error as DOMException).name !== 'NotFoundError') throw error; }
  // 오피스 파일(Blob)은 텍스트 원본과 비교할 수 없으므로 같은 경로가 있으면 덮어씁니다 (에이전트 산출물의 최신본).
  if (typeof text === 'string' && current !== original) throw new Error('파일이 이미 있거나 다른 곳에서 변경되었습니다. 파일을 다시 열어 확인하거나 다른 이름으로 저장하세요.');
  const { dir, name } = await parent(root, path, true);
  const handle = await dir.getFileHandle(name, { create: true });
  const writer = await handle.createWritable();
  try { await writer.write(text); await writer.close(); } catch (error) { await writer.abort().catch(() => {}); throw error; }
}
export function codeFiles(message: string): Array<{ name: string; content: string }> {
  const extensions: Record<string, string> = { html: 'html', css: 'css', javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', json: 'json', python: 'py', markdown: 'md' };
  return [...message.matchAll(/```([a-zA-Z]+)[^\n]*\n([\s\S]*?)```/g)].flatMap((m, i) => {
    const ext = extensions[m[1].toLowerCase()];
    return ext ? [{ name: ext === 'html' && i === 0 ? 'index.html' : `file-${i + 1}.${ext}`, content: m[2] }] : [];
  }).slice(0, 12);
}
