import type { FsDirHandle } from './folder-access';
import type { FileChange } from './ai-file-changes';
import { saveLocalFile } from './local-files';
import { isOfficePath, renderOfficeFile } from './office-files';
export type FileRow = { change: FileChange; status: 'pending' | 'saved' | 'error'; error?: string };
export type SaveRoot = { id: string; handle: FsDirHandle; originals: Map<string, string> };
export async function applyFileRows(rows: FileRow[], roots: SaveRoot[], approved: boolean, onUpdate: () => void = () => {}) {
  if (!approved) return;
  for (const row of rows) {
    if (row.status === 'saved') continue;
    try {
      const root = roots.find(item => item.id === row.change.folderId);
      if (!root) throw new Error('저장 대상 폴더가 없습니다.');
      // .docx/.xlsx/.pptx 는 텍스트 원본(HTML·CSV·마크다운 슬라이드)을 실제 오피스 파일로 변환해 저장합니다.
      const payload = isOfficePath(row.change.path) ? (await renderOfficeFile(row.change.path, row.change.content)) ?? row.change.content : row.change.content;
      await saveLocalFile(root.handle, row.change.path, payload, root.originals.get(row.change.path) ?? null);
      row.status = 'saved'; row.error = undefined;
    } catch (error) { row.status = 'error'; row.error = error instanceof Error ? error.message : '저장 실패'; }
    onUpdate();
  }
}
