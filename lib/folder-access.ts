/**
 * 사용자 컴퓨터의 폴더를 프로젝트에 연결합니다.
 *
 * 이 앱의 서버는 Cloudflare Workers 위에서 돌기 때문에 파일시스템에 접근할 수 없습니다.
 * 그래서 폴더는 브라우저의 File System Access API 로 열고, 얻은 디렉터리 핸들은
 * IndexedDB 에 보관합니다. 서버(D1)에는 "이 프로젝트에 이런 이름의 폴더가 연결돼 있다"는
 * 메타데이터만 남고, 실제 파일 읽기는 전부 브라우저에서 일어납니다.
 *
 * 따라서 핸들은 '그 브라우저에만' 존재합니다. 다른 브라우저/PC 에서 열면 폴더 카드가
 * '연결 필요' 상태로 보이고, 사용자가 다시 폴더를 고르면 같은 레코드에 핸들만 다시 붙습니다.
 */

// ── File System Access API 최소 타입 ────────────────────────────────
// lib.dom 에 showDirectoryPicker / values() / queryPermission 이 없어서 직접 좁게 선언합니다.
type FsPermissionMode = { mode: 'read' | 'readwrite' };
export type FsFileHandle = { kind: 'file'; name: string; getFile(): Promise<File>; createWritable(): Promise<{ write(data: string | Blob): Promise<void>; close(): Promise<void>; abort(): Promise<void> }> };
export type FsDirHandle = {
  kind: 'directory';
  name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FsDirHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FsFileHandle>;
  values(): AsyncIterableIterator<FsDirHandle | FsFileHandle>;
  queryPermission?(descriptor: FsPermissionMode): Promise<PermissionState>;
  requestPermission?(descriptor: FsPermissionMode): Promise<PermissionState>;
};
type PickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite'; id?: string; startIn?: FsDirHandle }) => Promise<FsDirHandle>;
  showOpenFilePicker?: (options?: { multiple?: boolean; id?: string; startIn?: FsDirHandle }) => Promise<FsFileHandle[]>;
};

export type ProjectFolder = { id: string; name: string; pathHint: string; fileCount: number; addedAt: number };
export type FolderLinkState = 'ready' | 'blocked' | 'missing';
export type ScannedFile = { path: string; size: number; readable: boolean };

// ── 스캔 규칙 ───────────────────────────────────────────────────────
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', '.svelte-kit', '.wrangler', '.turbo', '.cache',
  'dist', 'build', 'out', 'coverage', 'target', '.venv', 'venv', '__pycache__', '.idea', '.vscode', '.DS_Store',
]);
// 비밀값이 들어가기 쉬운 파일은 아예 읽지 않습니다.
const SECRET_PATTERNS = [/^\.env/i, /\.pem$/i, /\.key$/i, /^id_rsa/i, /credentials?\.json$/i, /secrets?\./i];
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'mdx', 'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'csv', 'tsv', 'sql',
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'css', 'scss', 'less', 'html', 'htm', 'svg', 'vue', 'svelte',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'sh', 'ps1', 'bat', 'gradle',
]);

const MAX_DEPTH = 4;
const MAX_ENTRIES = 400;
const MAX_FILE_CHARS = 12_000;
const DEFAULT_BUDGET = 60_000;

const DB_NAME = 'cowork-folders';
const STORE = 'handles';

function extensionOf(name: string) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function isSecret(name: string) {
  return SECRET_PATTERNS.some((pattern) => pattern.test(name));
}

function isReadable(name: string) {
  return !isSecret(name) && TEXT_EXTENSIONS.has(extensionOf(name));
}

/** 이 브라우저가 폴더 선택기를 지원하는지. (Chrome/Edge 계열만 지원) */
export function supportsFolderPicker(): boolean {
  return typeof window !== 'undefined' && typeof (window as PickerWindow).showDirectoryPicker === 'function';
}

/** 폴더 선택 대화상자를 엽니다. 사용자가 취소하면 null. */
export async function pickDirectory(): Promise<FsDirHandle | null> {
  const picker = (window as PickerWindow).showDirectoryPicker;
  if (!picker) throw new Error('이 브라우저는 폴더 선택을 지원하지 않습니다. Chrome 또는 Edge 에서 열어 주세요.');
  try {
    return await picker({ mode: 'readwrite', id: 'cowork-project-folder' });
  } catch (error) {
    // 사용자가 취소를 누른 경우는 오류가 아닙니다.
    if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'NotAllowedError')) return null;
    throw error;
  }
}

/**
 * 연결 폴더를 운영체제의 파일 열기 창으로 엽니다 — '폴더 추가' 와 같은 종류의 창이지만 그 폴더 안에서 시작하고 파일까지 보입니다.
 * 사용자가 파일을 고르면 그 핸들을, 취소하면 null 을 돌려줍니다.
 */
export async function openFolderDialog(startIn: FsDirHandle): Promise<FsFileHandle[] | null> {
  const picker = (window as PickerWindow).showOpenFilePicker;
  if (!picker) throw new Error('이 브라우저는 폴더 열기를 지원하지 않습니다. Chrome 또는 Edge 에서 열어 주세요.');
  try {
    return await picker({ multiple: true, id: 'cowork-open-folder', startIn });
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'NotAllowedError')) return null;
    throw error;
  }
}

// ── IndexedDB (핸들 보관) ───────────────────────────────────────────
function openHandleStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('폴더 저장소를 열지 못했습니다.'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openHandleStore();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('폴더 저장소 접근에 실패했습니다.'));
    });
  } finally { db.close(); }
}

export async function saveHandle(folderId: string, handle: FsDirHandle): Promise<void> {
  await withStore('readwrite', (store) => store.put(handle, folderId) as IDBRequest<IDBValidKey>);
}

export async function getHandle(folderId: string): Promise<FsDirHandle | null> {
  try {
    const stored = await withStore('readonly', (store) => store.get(folderId) as IDBRequest<FsDirHandle | undefined>);
    return stored ?? null;
  } catch { return null; }
}

export async function forgetHandle(folderId: string): Promise<void> {
  try { await withStore('readwrite', (store) => store.delete(folderId) as IDBRequest<undefined>); }
  catch { /* 핸들이 없으면 지울 것도 없습니다 */ }
}

/**
 * 읽기 권한을 확인합니다. 브라우저를 다시 켜면 권한이 'prompt' 로 돌아가는데,
 * requestPermission 은 사용자 제스처(클릭) 직후에만 통합니다 — 그래서 버튼 핸들러 첫머리에서 부르세요.
 */
export async function ensureReadPermission(handle: FsDirHandle, interactive = true): Promise<boolean> {
  if (!handle.queryPermission) return true;
  const current = await handle.queryPermission({ mode: 'read' });
  if (current === 'granted') return true;
  if (!interactive || !handle.requestPermission) return false;
  return (await handle.requestPermission({ mode: 'read' })) === 'granted';
}

/** 폴더가 이 브라우저에서 바로 읽히는 상태인지 확인합니다(권한 창은 띄우지 않음). */
export async function inspectFolder(folderId: string): Promise<FolderLinkState> {
  const handle = await getHandle(folderId);
  if (!handle) return 'missing';
  if (!handle.queryPermission) return 'ready';
  return (await handle.queryPermission({ mode: 'read' })) === 'granted' ? 'ready' : 'blocked';
}

// ── 스캔 ────────────────────────────────────────────────────────────
/** 폴더를 훑어 파일 목록을 만듭니다. 무거운 디렉터리(node_modules 등)와 비밀 파일은 건너뜁니다. */
export async function scanDirectory(handle: FsDirHandle, maxEntries = MAX_ENTRIES): Promise<{ files: ScannedFile[]; truncated: boolean }> {
  const files: ScannedFile[] = [];
  let truncated = false;

  async function walk(dir: FsDirHandle, prefix: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || truncated) return;
    const children: FsDirHandle[] = [];
    for await (const entry of dir.values()) {
      if (files.length >= maxEntries) { truncated = true; return; }
      if (entry.kind === 'directory') {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) children.push(entry);
        continue;
      }
      if (isSecret(entry.name)) continue;
      let size = 0;
      try { size = (await entry.getFile()).size; } catch { /* 읽지 못하는 파일은 크기 0 으로 둡니다 */ }
      files.push({ path: `${prefix}${entry.name}`, size, readable: isReadable(entry.name) });
    }
    for (const child of children) {
      if (truncated) return;
      await walk(child, `${prefix}${child.name}/`, depth + 1);
    }
  }

  await walk(handle, '', 0);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, truncated };
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

async function readFileAt(handle: FsDirHandle, path: string): Promise<string | null> {
  const segments = path.split('/');
  let dir = handle;
  try {
    for (const segment of segments.slice(0, -1)) {
      let next: FsDirHandle | null = null;
      for await (const entry of dir.values()) {
        if (entry.kind === 'directory' && entry.name === segment) { next = entry; break; }
      }
      if (!next) return null;
      dir = next;
    }
    const fileName = segments[segments.length - 1];
    for await (const entry of dir.values()) {
      if (entry.kind === 'file' && entry.name === fileName) {
        const text = await (await entry.getFile()).text();
        return text.length > MAX_FILE_CHARS ? `${text.slice(0, MAX_FILE_CHARS)}\n…(이하 생략)` : text;
      }
    }
  } catch { /* 읽기 실패는 조용히 건너뜁니다 */ }
  return null;
}

/** README·문서를 앞으로, 작은 파일을 먼저 — 예산 안에서 가장 쓸모 있는 순서. */
function priority(file: ScannedFile) {
  const name = file.path.split('/').pop() ?? '';
  if (/^readme/i.test(name)) return 0;
  if (/\.(md|mdx|txt)$/i.test(name)) return 1;
  if (!file.path.includes('/')) return 2;
  return 3;
}

/**
 * 에이전트에게 넘길 폴더 컨텍스트(마크다운)를 만듭니다.
 * 파일 목록은 항상 넣고, 본문은 예산(기본 60,000자) 안에서 우선순위대로 채웁니다.
 */
export async function buildFolderContext(folders: ProjectFolder[], budget = DEFAULT_BUDGET): Promise<string> {
  const blocks: string[] = [];
  let remaining = budget;

  for (const folder of folders) {
    const handle = await getHandle(folder.id);
    if (!handle) { blocks.push(`### ${folder.name}\n(이 브라우저에 폴더 연결이 없어 내용을 읽지 못했습니다)`); continue; }
    if (!(await ensureReadPermission(handle))) { blocks.push(`### ${folder.name}\n(읽기 권한이 없어 내용을 읽지 못했습니다)`); continue; }

    const { files, truncated } = await scanDirectory(handle);
    const tree = files.slice(0, 200).map((file) => `- ${file.path} (${formatSize(file.size)})`).join('\n');
    const parts = [`### ${folder.name}\n파일 ${files.length}개${truncated ? '+ (상한에서 잘림)' : ''}\n\n#### 파일 목록\n${tree || '(파일 없음)'}`];

    const candidates = files.filter((file) => file.readable && file.size > 0 && file.size < 200_000)
      .sort((a, b) => priority(a) - priority(b) || a.size - b.size);
    const bodies: string[] = [];
    for (const file of candidates) {
      if (remaining < 1_500) break;
      const text = await readFileAt(handle, file.path);
      if (!text) continue;
      const clipped = text.length > remaining ? `${text.slice(0, remaining)}\n…(예산 초과로 생략)` : text;
      remaining -= clipped.length;
      bodies.push(`##### ${file.path}\n\`\`\`\n${clipped}\n\`\`\``);
    }
    if (bodies.length) parts.push(`#### 파일 내용 (${bodies.length}개)\n${bodies.join('\n\n')}`);
    blocks.push(parts.join('\n\n'));
  }

  return blocks.join('\n\n');
}

/** 프로젝트에 연결된 폴더 목록을 서버에서 받아옵니다. */
export async function fetchProjectFolders(projectId: string): Promise<ProjectFolder[]> {
  try {
    const response = await fetch(`/api/projects/${projectId}/folders`);
    if (!response.ok) return [];
    const data = await response.json() as { folders?: ProjectFolder[] };
    return data.folders ?? [];
  } catch { return []; }
}

/**
 * 업무 실행 직전에 부르는 한 방 함수. 폴더가 없거나 읽지 못하면 빈 문자열을 돌려주고,
 * 실행 자체는 막지 않습니다.
 */
export async function buildProjectFolderContext(projectId: string | null | undefined): Promise<string> {
  if (!projectId || !supportsFolderPicker()) return '';
  const folders = await fetchProjectFolders(projectId);
  if (!folders.length) return '';
  try { return await buildFolderContext(folders); }
  catch { return ''; }
}
