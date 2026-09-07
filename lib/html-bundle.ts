/**
 * HTML 산출물을 새 탭(blob: URL)으로 열 때 상대 경로 자원을 안에 묶어 넣습니다.
 *
 * blob: 주소에서는 `<link href="style.css">`·`<script src="script.js">`·`<img src="logo.png">` 같은 상대 경로가 아무것도 가리키지 못해
 * 에이전트가 파일을 나눠 만든 앱이 "동작하지 않는" 것처럼 보입니다. 그래서 열기 전에 같은 폴더의 파일을 읽어
 * CSS 는 <style>, JS 는 인라인 <script>, 이미지는 data: URL 로 바꿔 넣습니다. 절대 URL(http·https·data·//)은 그대로 둡니다.
 */
import type { FsDirHandle } from './folder-access';

/** 상대 경로 하나를 읽어 옵니다. 없으면 null — 그 태그는 원본 그대로 남깁니다. */
export type SiblingReader = (relativePath: string) => Promise<Blob | null>;

const ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

/** HTML 파일 위치 기준으로 상대 경로를 정리합니다 ("./", "../" 처리). 폴더 밖으로 나가면 null. */
export function resolveRelative(htmlPath: string, ref: string): string | null {
  const clean = ref.split(/[?#]/)[0];
  if (!clean || ABSOLUTE.test(clean) || clean.startsWith('/')) return null;
  const base = htmlPath.split('/').slice(0, -1);
  for (const part of clean.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') { if (!base.length) return null; base.pop(); continue; }
    base.push(part);
  }
  return base.join('/');
}

function escapeClose(text: string, tag: string): string {
  return text.replace(new RegExp(`</${tag}`, 'gi'), `<\\/${tag}`);
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read-failed'));
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsDataURL(blob);
  });
}

async function replaceAsync(input: string, pattern: RegExp, replacer: (match: RegExpExecArray) => Promise<string | null>): Promise<string> {
  let output = '';
  let last = 0;
  for (const match of input.matchAll(pattern)) {
    const replacement = await replacer(match as RegExpExecArray);
    if (replacement === null) continue;
    output += input.slice(last, match.index) + replacement;
    last = (match.index ?? 0) + match[0].length;
  }
  return output + input.slice(last);
}

const attr = (tag: string, name: string) => new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
const attrValue = (tag: string, name: string) => { const m = attr(tag, name); return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null; };

/** 상대 경로 자원을 인라인한 HTML 을 돌려줍니다. 읽지 못한 자원은 원문 그대로 둡니다. */
export async function bundleHtml(html: string, htmlPath: string, read: SiblingReader): Promise<string> {
  const load = async (ref: string | null) => {
    const path = ref ? resolveRelative(htmlPath, ref) : null;
    if (!path) return null;
    try { return await read(path); } catch { return null; }
  };
  // <link rel="stylesheet" href="…">
  let out = await replaceAsync(html, /<link\b[^>]*>/gi, async (match) => {
    const tag = match[0];
    if (!/\brel\s*=\s*["']?stylesheet/i.test(tag)) return null;
    const blob = await load(attrValue(tag, 'href'));
    return blob ? `<style>\n${escapeClose(await blob.text(), 'style')}\n</style>` : null;
  });
  // <script src="…"></script>
  out = await replaceAsync(out, /<script\b([^>]*)>\s*<\/script>/gi, async (match) => {
    const attrs = match[1];
    const src = attrValue(`<script${attrs}>`, 'src');
    if (!src) return null;
    const blob = await load(src);
    if (!blob) return null;
    const rest = attrs.replace(/\ssrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '');
    return `<script${rest}>\n${escapeClose(await blob.text(), 'script')}\n</script>`;
  });
  // <img src="…"> · <source src> · <video poster> 등 이미지·미디어
  out = await replaceAsync(out, /<(?:img|source|audio|video)\b[^>]*>/gi, async (match) => {
    const tag = match[0];
    const src = attrValue(tag, 'src');
    const blob = await load(src);
    if (!blob || !src) return null;
    const dataUrl = await readAsDataUrl(blob);
    return tag.replace(src, dataUrl);
  });
  return out;
}

/** 폴더 권한(File System Access)으로 HTML 의 형제 파일을 읽는 SiblingReader. */
export function siblingReaderFromDir(root: FsDirHandle): SiblingReader {
  return async (path) => {
    const parts = path.split('/');
    let dir = root;
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
    const file = await (await dir.getFileHandle(parts[parts.length - 1])).getFile();
    return file.size > 5_000_000 ? null : file;
  };
}

/**
 * 파일 열기 창에서 고른 HTML 이 어느 연결 폴더의 최상위에 있는지 찾아 그 폴더 기준 SiblingReader 를 만듭니다.
 * (파일 핸들만으로는 폴더를 알 수 없어, 이름·크기·수정 시각이 같은 파일이 폴더 최상위에 있으면 같은 파일로 봅니다.)
 */
export async function siblingReaderForPickedFile(picked: File, roots: FsDirHandle[]): Promise<SiblingReader | null> {
  for (const root of roots) {
    try {
      const candidate = await (await root.getFileHandle(picked.name)).getFile();
      if (candidate.size === picked.size && candidate.lastModified === picked.lastModified) return siblingReaderFromDir(root);
    } catch { /* 이 폴더에는 없음 */ }
  }
  return null;
}
