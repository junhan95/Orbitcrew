/**
 * 대화 첨부 파일.
 *
 * 파일은 보관하지 않습니다 — 보내는 그 턴에만 Claude 에게 전달하고,
 * 대화 기록에는 파일 이름만 남습니다. (환경 설정과 마찬가지로 이 기기 안에서만 처리)
 *
 *   이미지 · PDF → base64 로 그대로 모델에 넘겨 Claude 가 직접 봅니다.
 *   텍스트·코드·CSV·Markdown → 내용을 읽어 텍스트 블록으로 붙입니다.
 *   Word(.docx)·Excel(.xlsx/.xls)·PowerPoint(.pptx) → 브라우저에서 텍스트를 뽑아 텍스트 블록으로 붙입니다 (lib/office-read).
 *   그 밖의 형식은 받지 않습니다.
 */
import { extractOfficeText, isOfficeTextSource } from './office-read';
export type AttachmentKind = 'image' | 'document' | 'text';

export type ChatAttachment = {
  /** 목록에서 지울 때 쓰는 임시 키 (서버로 보내지 않습니다) */
  key: string;
  name: string;
  kind: AttachmentKind;
  mediaType: string;
  size: number;
  /** image·document 는 base64, text 는 파일 내용 그대로 */
  data: string;
};

/** 서버로 보내는 모양 — key 를 뺀 나머지입니다. */
export type AttachmentPayload = Omit<ChatAttachment, 'key'>;

export const MAX_ATTACHMENTS = 5;
/** 한 파일 최대 크기. Claude 이미지 권장 상한(약 5MB)과 PDF 를 함께 고려한 값입니다. */
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_ATTACHMENT_TOTAL_BYTES = 16 * 1024 * 1024;
/** 텍스트 파일에서 읽어 붙일 최대 글자 수 */
export const MAX_TEXT_CHARS = 60_000;

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'yaml', 'yml', 'xml', 'html', 'css',
  'js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'cs',
  'sh', 'sql', 'ini', 'toml', 'env', 'log',
]);

/** <input type="file"> 의 accept 값 */
export const ATTACHMENT_ACCEPT = [
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf',
  '.docx', '.xlsx', '.xls', '.pptx',
  ...[...TEXT_EXTENSIONS].map((extension) => `.${extension}`),
].join(',');

function extensionOf(name: string): string {
  const index = name.lastIndexOf('.');
  return index < 0 ? '' : name.slice(index + 1).toLowerCase();
}

/** 이 파일을 받을 수 있는지, 받는다면 어떤 방식으로 읽을지 정합니다. */
export function classifyAttachment(file: File): AttachmentKind | null {
  if (IMAGE_TYPES.has(file.type)) return 'image';
  if (file.type === 'application/pdf' || extensionOf(file.name) === 'pdf') return 'document';
  if (file.type.startsWith('text/') || TEXT_EXTENSIONS.has(extensionOf(file.name))) return 'text';
  // 오피스 문서는 텍스트를 뽑아 텍스트 첨부로 보냅니다.
  if (isOfficeTextSource(file.name)) return 'text';
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read-failed'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      // data:<mime>;base64,<데이터> — 뒤쪽만 씁니다.
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}

/**
 * 고른 파일 하나를 첨부로 만듭니다.
 * 형식이 맞지 않거나 너무 크면 이유를 담은 error 를 돌려줍니다(예외를 던지지 않습니다).
 */
export async function readAttachment(file: File): Promise<{ attachment: ChatAttachment } | { error: 'type' | 'size' | 'read' }> {
  const kind = classifyAttachment(file);
  if (!kind) return { error: 'type' };
  if (file.size > MAX_ATTACHMENT_BYTES) return { error: 'size' };
  try {
    const data = kind === 'text'
      ? (isOfficeTextSource(file.name) ? await extractOfficeText(file) : await file.text()).slice(0, MAX_TEXT_CHARS)
      : await readAsBase64(file);
    if (kind === 'text' && !data.trim()) return { error: 'read' };
    const mediaType = kind === 'document'
      ? 'application/pdf'
      : kind === 'image' ? file.type : (isOfficeTextSource(file.name) ? 'text/plain' : (file.type || 'text/plain'));
    return {
      attachment: { key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: file.name, kind, mediaType, size: file.size, data },
    };
  } catch {
    return { error: 'read' };
  }
}

/** 서버로 보낼 모양으로 바꿉니다. */
export function toPayload(attachments: ChatAttachment[]): AttachmentPayload[] {
  return attachments.map(({ key: _key, ...rest }) => rest);
}
