'use client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { t } from '@/lib/i18n';
import { useRef, useState } from 'react';
import { fetchProjectFolders, getHandle, scanDirectory, type FsDirHandle } from '@/lib/folder-access';
import { readLocalFile } from '@/lib/local-files';
import { validateFileChange } from '@/lib/ai-file-changes';
import { applyFileRows, type FileRow } from '@/lib/ai-file-storage';
import { folderApproval } from '@/lib/folder-permissions';
import { isBrowserViewable, mimeOf, recordArtifact } from '@/lib/project-artifacts';
import { fileSegments } from '@/lib/local-files';
import { downloadBlob } from '@/lib/office-files';

/** 저장된 파일을 폴더 권한으로 읽어 엽니다 — 오피스·CSV 는 내려받아 운영체제 앱으로, HTML·이미지·PDF 는 새 탭으로. */
async function openSavedFile(root: Root, path: string) {
  const parts = fileSegments(path);
  let dir = root.handle;
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
  const file = await (await dir.getFileHandle(parts[parts.length - 1])).getFile();
  const blob = new Blob([await file.arrayBuffer()], { type: mimeOf(path) });
  if (isBrowserViewable(path)) {
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  downloadBlob(path, blob);
}

function openLabel(path: string): string {
  const ext = path.toLowerCase().split('.').pop() ?? '';
  if (ext === 'docx' || ext === 'doc') return 'Word 로 열기';
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') return 'Excel 로 열기';
  if (ext === 'pptx' || ext === 'ppt') return 'PowerPoint 로 열기';
  if (ext === 'pdf') return 'PDF 열기';
  return isBrowserViewable(path) ? '새 탭에서 열기' : '내려받기';
}
type Root = { id: string; name: string; handle: FsDirHandle; originals: Map<string, string> };
type Session = { projectId: string; roots: Root[]; automatic: boolean; received?: boolean };
type Row = FileRow;
type Batch = { id: string; session: Session; rows: Row[]; busy: boolean; canceled: boolean };
export function useAIFileChanges(projectId: string) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const active = useRef(new Map<string, Batch>());
  const [batches, setBatches] = useState<Batch[]>([]);
  async function prepare(): Promise<Session> {
    const roots: Root[] = [];
    let budget = 40_000;
    for (const folder of (await fetchProjectFolders(projectId)).slice(0, 20)) {
      const handle = await getHandle(folder.id);
      if (!handle || await handle.queryPermission?.({ mode: 'read' }) !== 'granted') continue;
      const originals = new Map<string, string>();
      for (const file of (await scanDirectory(handle)).files) {
        if (!file.readable || file.size > 200_000 || file.size > budget) continue;
        try { const text = await readLocalFile(handle, file.path); const size = JSON.stringify([file.path, text]).length; if (size <= budget) { originals.set(file.path, text); budget -= size; } } catch { /* Unreadable files cannot be overwritten. */ }
      }
      roots.push({ id: folder.id, name: folder.name, handle, originals });
    }
    return { projectId, roots, automatic: folderApproval() === 'auto' };
  }
  const update = (batch: Batch) => setBatches(current => current.map(item => item.id === batch.id ? { ...batch, rows: batch.rows.map(row => ({ ...row })) } : item));
  async function apply(id: string) {
    const batch = active.current.get(id);
    if (!batch) return;
    if (batch.busy || batch.canceled) return;
    batch.busy = true; update(batch);
    try {
      const connected = await fetchProjectFolders(batch.session.projectId);
      const roots = batch.session.roots.filter(root => connected.some(folder => folder.id === root.id));
      await applyFileRows(batch.rows, roots, true, () => update(batch));
      // 저장이 끝난 파일은 '결과보기' 목록에 올립니다 (같은 경로는 최신 저장으로 갱신).
      for (const row of batch.rows) if (row.status === 'saved') recordArtifact(batch.session.projectId, row.change.folderId, row.change.path);
    } finally { batch.busy = false; update(batch); }
  }
  function receive(session: Session, raw: unknown) {
    if (session.received || !Array.isArray(raw) || !raw.length) return;
    session.received = true;
    const rows: Row[] = raw.slice(0, 12).map(item => ({ change: validateFileChange(item, session.roots.map(root => root.id)), status: 'pending' }));
    const batch: Batch = { id: crypto.randomUUID(), session, rows, busy: false, canceled: false };
    active.current.set(batch.id, batch);
    setBatches(current => [...current, { ...batch, rows: batch.rows.map(row => ({ ...row })) }]);
    // Only fresh, completed responses can initiate automatic writes. History never replays.
    if (session.automatic && folderApproval() === 'auto') void apply(batch.id);
  }
  function cancelBatch(id: string) {
    const target = active.current.get(id);
    if (target && !target.busy) { target.canceled = true; update(target); }
  }
  const visible = batches.filter(batch => batch.session.projectId === projectId);
  const pending = visible.find(batch => !batch.busy && !batch.canceled && !dismissed.includes(batch.id) && batch.rows.some(row => row.status !== 'saved'));
  const view = <>{visible.map(batch => <div key={batch.id}>{<FileBatchView batch={batch} apply={apply} cancelBatch={cancelBatch} />}{!batch.busy && !batch.canceled && batch.rows.some(row => row.status !== 'saved') && <button type="button" className="tutorial-action" onClick={() => setDismissed(current => current.filter(id => id !== batch.id))}>{t('파일 변경 확인')}</button>}</div>)}
    <Dialog open={Boolean(pending)} onOpenChange={open => { if (!open && pending) setDismissed(current => [...current, pending.id]); }}>
      <DialogContent className="approval-request-dialog">
        <DialogHeader><DialogTitle>{t('파일 변경 승인 요청')}</DialogTitle><DialogDescription>{t('변경 내용을 확인하고 승인하면 파일에 저장합니다. 닫아도 요청은 대화에 남습니다.')}</DialogDescription></DialogHeader>
        {pending && <FileBatchView batch={pending} showActions apply={apply} cancelBatch={cancelBatch} />}
      </DialogContent>
    </Dialog>
  </>;
  return { prepare, receive, view };
}

function FileBatchView({ batch, apply, cancelBatch, showActions = false }: { showActions?: boolean; batch: Batch; apply: (id: string) => Promise<void>; cancelBatch: (id: string) => void }) { return <section className="ai-file-batch" key={batch.id} aria-label="AI 파일 저장">
    <strong>{batch.busy ? '파일 저장 중…' : batch.canceled ? '파일 변경 취소됨' : batch.rows.every(row => row.status === 'saved') ? '파일 저장 완료' : 'AI 파일 변경 확인'}</strong>
    {batch.rows.map((row, index) => <details key={index}><summary>{batch.session.roots.find(root => root.id === row.change.folderId)?.name} / {row.change.path} · {row.status === 'saved' ? '저장 완료' : row.status === 'error' ? '저장 실패' : '승인 대기'}
      {row.status === 'saved' && <button type="button" className="ai-file-open" onClick={(event) => {
        event.preventDefault(); event.stopPropagation();
        const root = batch.session.roots.find(item => item.id === row.change.folderId);
        if (root) void openSavedFile(root, row.change.path).catch(() => { /* 권한이 바뀌었으면 프로젝트의 결과보기로 엽니다 */ });
      }}>{t(openLabel(row.change.path))}</button>}</summary>
      <p>{row.error}</p><h4>변경 전</h4><pre>{batch.session.roots.find(root => root.id === row.change.folderId)?.originals.get(row.change.path) ?? '(새 파일)'}</pre><h4>변경 후</h4><pre>{row.change.content}</pre></details>)}
    {showActions && !batch.canceled && batch.rows.some(row => row.status !== 'saved') && <div><button disabled={batch.busy} onClick={() => void apply(batch.id)}>승인하고 저장{batch.rows.some(row => row.status === 'error') ? ' 재시도' : ''}</button><button disabled={batch.busy} onClick={() => cancelBatch(batch.id)}>취소</button></div>}
    <output aria-live="polite">{batch.rows.filter(row => row.status === 'saved').length} / {batch.rows.length}개 저장됨</output>
  </section>;
}
