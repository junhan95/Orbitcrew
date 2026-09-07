'use client';
/**
 * 프로젝트 상세 머리의 '결과보기' · '폴더열기'.
 * - 결과보기: 에이전트가 이 브라우저에서 저장한 최신 산출물(lib/project-artifacts)을 새 탭에서 바로 실행합니다 — 목록 창 없이 결과 화면이 뜹니다.
 *   HTML·이미지·PDF 가 아니면(예: research.md) 텍스트 미리보기 창으로 보여 줍니다.
 * - 폴더열기: 프로젝트를 만들 때 허용한 작업 폴더를 운영체제의 파일 열기 창으로 엽니다 ('폴더 추가' 와 같은 창, 그 폴더에서 시작).
 *   창에서 파일을 고르면 HTML·이미지·PDF 는 새 탭, 텍스트는 미리보기로 엽니다.
 */
import { useCallback, useEffect, useState } from 'react';
import { FolderOpen, LoaderCircle, Sparkles } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ensureReadPermission, fetchProjectFolders, getHandle, openFolderDialog, type FsDirHandle } from '@/lib/folder-access';
import { fileSegments, readLocalFile } from '@/lib/local-files';
import { isBrowserViewable, mimeOf, readArtifacts, subscribeArtifacts, type ProjectArtifact } from '@/lib/project-artifacts';
import { t, tf } from '@/lib/i18n';
import { downloadBlob, isOfficePath, renderOfficeFile } from '@/lib/office-files';
import { openWithOfficeApp } from '@/lib/open-with-app';
import { bundleHtml, siblingReaderForPickedFile, siblingReaderFromDir, type SiblingReader } from '@/lib/html-bundle';

/** Word·Excel·PowerPoint 등 운영체제 앱으로 여는 파일 — 브라우저는 내려받기로 넘깁니다. */
const DESKTOP_APP_FILE = /\.(docx?|xlsx?|pptx?|csv)$/i;

/** 서버에 보관된 산출물 (task_files) — 다른 기기에서 저장했거나 서버 사슬 실행이 만든 파일도 보입니다. */
export type ServerArtifact = { id: string; taskId: string; folderId: string; path: string; updatedAt: number; size: number };
export function useServerArtifacts(projectId: string): ServerArtifact[] {
  const [files, setFiles] = useState<ServerArtifact[]>([]);
  useEffect(() => {
    let canceled = false;
    const load = () => {
      fetch(`/api/projects/${encodeURIComponent(projectId)}/files`)
        .then(async (response) => (response.ok ? await response.json() as { files?: ServerArtifact[] } : { files: [] }))
        .then((data) => { if (!canceled) setFiles(data.files ?? []); })
        .catch(() => { /* 목록은 보조 정보 */ });
    };
    load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 20_000);
    window.addEventListener('orbit-artifacts-changed', load);
    return () => { canceled = true; clearInterval(timer); window.removeEventListener('orbit-artifacts-changed', load); };
  }, [projectId]);
  return files;
}

const isHtml = (path: string) => /\.html?$/i.test(path);

/** 서버 보관본의 형제 자원 — 같은 프로젝트의 task_files 에서 경로가 같은 파일을 찾아 읽습니다. */
async function serverSiblingReader(projectId: string): Promise<SiblingReader> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/files`);
  const list = response.ok ? ((await response.json() as { files?: ServerArtifact[] }).files ?? []) : [];
  return async (path) => {
    const match = list.find((item) => item.path === path);
    if (!match) return null;
    const file = await fetch(`/api/task-files/${encodeURIComponent(match.id)}`);
    const data = await file.json() as { file?: { content: string } };
    return file.ok && data.file ? new Blob([data.file.content], { type: mimeOf(path) }) : null;
  };
}

async function openServerFileInNewTab(id: string, path: string, projectId?: string) {
  const tab = window.open('', '_blank');
  try {
    const response = await fetch(`/api/task-files/${encodeURIComponent(id)}`);
    const data = await response.json() as { file?: { content: string }; error?: string };
    if (!response.ok || !data.file) throw new Error(data.error ?? '파일을 열지 못했습니다.');
    // blob: 주소에서는 상대 경로 CSS·JS 가 안 잡히므로 형제 파일을 안에 묶어 넣습니다 (lib/html-bundle).
    const content = isHtml(path) && projectId ? await bundleHtml(data.file.content, path, await serverSiblingReader(projectId)) : data.file.content;
    const url = URL.createObjectURL(new Blob([content], { type: mimeOf(path) }));
    if (tab) tab.location.href = url; else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) { tab?.close(); throw error; }
}

/**
 * 오피스 파일을 데스크톱 Word·Excel·PowerPoint 로 바로 엽니다 (Office URI 스킴, lib/open-with-app).
 * 브라우저가 "Word 를 여시겠습니까?" 를 한 번 묻고, 앱이 없거나 파일이 크면 내려받기로 대신합니다.
 */
export async function openOfficeBlob(path: string, blob: Blob, onNotice: (message: string) => void) {
  if (await openWithOfficeApp(path, blob)) {
    onNotice(tf('{0} 에서 여는 중입니다 — 브라우저가 묻는 창에서 "열기" 를 눌러 주세요. 편집한 내용은 "다른 이름으로 저장" 으로 남깁니다.', officeAppName(path)));
    return;
  }
  downloadBlob(path, blob);
  onNotice(path.toLowerCase().endsWith('.pdf') ? t('PDF 를 내려받았습니다.') : t('파일을 내려받았습니다 — Word·Excel·PowerPoint 에서 열어 보세요.'));
}

function officeAppName(path: string): string {
  const ext = path.toLowerCase().split('.').pop() ?? '';
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') return 'Excel';
  if (ext === 'pptx' || ext === 'ppt') return 'PowerPoint';
  return 'Word';
}

/**
 * 서버 보관 산출물을 엽니다 — HTML·이미지·PDF 는 새 탭, .docx/.xlsx/.pptx 는 실제 오피스 파일로 변환해 내려받기, CSV 등은 내려받기.
 * 텍스트(.md 등)처럼 화면에서 보여 줘야 하는 파일이면 내용을 돌려주고(false 대신), 호출자가 미리보기를 띄웁니다.
 */
export async function openServerArtifact(file: Pick<ServerArtifact, 'id' | 'path'>, onNotice: (message: string) => void, projectId?: string): Promise<{ opened: true } | { opened: false; text: string }> {
  // .pdf 의 서버 보관본은 인쇄용 HTML 원본 — 먼저 실제 PDF 로 변환해 내려받습니다.
  if (isBrowserViewable(file.path) && !isOfficePath(file.path)) { await openServerFileInNewTab(file.id, file.path, projectId); return { opened: true }; }
  const response = await fetch(`/api/task-files/${encodeURIComponent(file.id)}`);
  const data = await response.json() as { file?: { content: string }; error?: string };
  if (!response.ok || !data.file) throw new Error(data.error ?? '파일을 열지 못했습니다.');
  if (isOfficePath(file.path)) {
    const blob = await renderOfficeFile(file.path, data.file.content);
    if (blob) { await openOfficeBlob(file.path, blob, onNotice); return { opened: true }; }
  }
  if (DESKTOP_APP_FILE.test(file.path)) {
    downloadBlob(file.path, new Blob([data.file.content], { type: mimeOf(file.path) }));
    onNotice(t('파일을 내려받았습니다 — Word·Excel·PowerPoint 에서 열어 보세요. 작업 폴더에도 같은 파일이 있습니다.'));
    return { opened: true };
  }
  return { opened: false, text: data.file.content };
}

/** 업무 카드 하나의 최신 산출물을 바로 엽니다. 산출물이 없으면 false — 호출자가 카드 상세로 대신 안내합니다. */
export async function openTaskArtifact(projectId: string, taskId: string, onNotice: (message: string) => void): Promise<boolean> {
  const [filesResponse, tasksResponse] = await Promise.all([
    fetch(`/api/projects/${encodeURIComponent(projectId)}/files`),
    fetch(`/api/tasks?projectId=${encodeURIComponent(projectId)}`),
  ]);
  if (!filesResponse.ok) return false;
  const files = ((await filesResponse.json() as { files?: ServerArtifact[] }).files ?? []);
  const tasks = tasksResponse.ok ? ((await tasksResponse.json() as { tasks?: Array<{ id: string; parentTaskId?: string | null }> }).tasks ?? []) : [];
  const parentOf = new Map(tasks.map((task) => [task.id, task.parentTaskId ?? null]));
  const mission = parentOf.get(taskId) ?? taskId;
  const sameMission = (id: string) => id === taskId || id === mission || parentOf.get(id) === mission;
  // 실제 산출물(오피스·HTML·CSV·PDF·이미지)을 우선하고, 검토 메모 같은 텍스트 파일은 뒤로 — 같은 카드의 파일이 같은 임무의 다른 카드 파일보다 앞섭니다.
  const isDeliverable = (path: string) => isOfficePath(path) || isBrowserViewable(path) || DESKTOP_APP_FILE.test(path);
  const ranked = files
    .filter((file) => sameMission(file.taskId))
    .map((file) => ({ file, score: (isDeliverable(file.path) ? 2 : 0) + (file.taskId === taskId ? 1 : 0) }))
    .sort((a, b) => b.score - a.score || b.file.updatedAt - a.file.updatedAt);
  const best = ranked[0]?.file;
  // 열 만한 산출물이 없으면(텍스트 결과뿐) 카드 상세에서 결과 본문을 보게 합니다.
  if (!best || !isDeliverable(best.path)) return false;
  const result = await openServerArtifact(best, onNotice, projectId);
  return result.opened;
}

export function useProjectArtifacts(projectId: string): ProjectArtifact[] {
  const [artifacts, setArtifacts] = useState<ProjectArtifact[]>([]);
  useEffect(() => {
    const refresh = () => setArtifacts(readArtifacts(projectId));
    refresh();
    return subscribeArtifacts(refresh);
  }, [projectId]);
  return artifacts;
}

async function folderHandle(folderId: string): Promise<FsDirHandle> {
  const handle = await getHandle(folderId);
  if (!handle || !await ensureReadPermission(handle)) throw new Error(t('프로젝트의 작업 폴더에서 이 폴더를 다시 연결해 주세요.'));
  return handle;
}

/** 바이너리까지 그대로 읽습니다 (이미지·PDF 를 새 탭에 띄울 때). */
async function readFile(root: FsDirHandle, path: string): Promise<File> {
  const parts = fileSegments(path);
  let dir = root;
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
  return (await dir.getFileHandle(parts[parts.length - 1])).getFile();
}

/** 산출물을 새 탭에서 엽니다. 팝업 차단을 피하려고 클릭 동기 구간에서 창을 먼저 열고, 파일을 읽은 뒤 주소를 바꿉니다. */
async function openInNewTab(folderId: string, path: string) {
  const tab = window.open('', '_blank');
  try {
    const root = await folderHandle(folderId);
    const file = await readFile(root, path);
    // HTML 은 같은 폴더의 CSS·JS·이미지를 안에 묶어 넣어야 blob: 탭에서도 동작합니다 (lib/html-bundle).
    const content: Blob | string = isHtml(path) ? await bundleHtml(await file.text(), path, siblingReaderFromDir(root)) : file;
    const url = URL.createObjectURL(new Blob([content], { type: mimeOf(path) }));
    if (tab) tab.location.href = url; else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) { tab?.close(); throw error; }
}

type Preview = { path: string; text: string };

export function ProjectFileButtons({ projectId, onNotice, spotlightKey = 0 }: { projectId: string; onNotice: (message: string) => void;
  /** 0 이 아니면(대화의 '결과 보기' 링크로 들어옴) '결과보기' 버튼을 잠시 강조합니다. 값이 바뀔 때마다 다시 강조. */
  spotlightKey?: number }) {
  const artifacts = useProjectArtifacts(projectId);
  const serverFiles = useServerArtifacts(projectId);
  // 열 수 있는 산출물 수 — 브라우저 저장 기록과 서버 보관본을 경로 기준으로 합칩니다.
  const artifactCount = new Set([...artifacts.map((item) => item.path.toLowerCase()), ...serverFiles.map((item) => item.path.toLowerCase())]).size;
  const [busy, setBusy] = useState<'results' | 'folder' | null>(null);
  // 강조는 클릭하거나 15초가 지나면 꺼집니다.
  const [dismissedKey, setDismissedKey] = useState(0);
  const spotlight = spotlightKey !== 0 && spotlightKey !== dismissedKey && artifactCount > 0;
  useEffect(() => {
    if (!spotlight) return;
    const timer = setTimeout(() => setDismissedKey(spotlightKey), 15_000);
    return () => clearTimeout(timer);
  }, [spotlight, spotlightKey]);
  const [preview, setPreview] = useState<Preview | null>(null);

  const fail = useCallback((error: unknown, fallback: string) => {
    onNotice(error instanceof Error ? t(error.message) : fallback);
  }, [onNotice]);

  /** 결과보기 — 가장 최근 산출물을 바로 띄웁니다. */
  async function showResult() {
    if (busy) return;
    setDismissedKey(spotlightKey);
    setBusy('results');
    try {
      const linked = await fetchProjectFolders(projectId);
      const latest = artifacts.find(item => linked.some(folder => folder.id === item.folderId));
      const server = serverFiles[0];
      // 더 최근 것을 엽니다. 브라우저 저장본은 폴더 권한으로 직접 읽고, 서버 보관본은 내용을 받아 엽니다.
      if (latest && (!server || latest.savedAt >= server.updatedAt)) {
        if (isBrowserViewable(latest.path)) { await openInNewTab(latest.folderId, latest.path); return; }
        if (DESKTOP_APP_FILE.test(latest.path)) {
          // 폴더에 저장된 실제 파일(이미 변환된 오피스 파일)을 그대로 내려받습니다.
          const file = await readFile(await folderHandle(latest.folderId), latest.path);
          await openOfficeBlob(latest.path, new Blob([await file.arrayBuffer()], { type: mimeOf(latest.path) }), onNotice);
          return;
        }
        const text = await readLocalFile(await folderHandle(latest.folderId), latest.path);
        setPreview({ path: latest.path, text });
        return;
      }
      if (!server) { onNotice(t('저장된 산출물이 아직 없습니다.')); return; }
      const result = await openServerArtifact(server, onNotice, projectId);
      if (!result.opened) setPreview({ path: server.path, text: result.text });
    } catch (error) { fail(error, t('파일을 열지 못했습니다.')); }
    finally { setBusy(null); }
  }

  /** 폴더열기 — 연결 폴더에서 시작하는 운영체제 파일 창을 띄우고, 고른 파일이 있으면 엽니다. */
  async function openFolder() {
    if (busy) return;
    setBusy('folder');
    try {
      const linked = await fetchProjectFolders(projectId);
      const folder = linked[0];
      if (!folder) { onNotice(t('아직 연결한 작업 폴더가 없습니다. 아래 작업 폴더 섹션의 폴더 추가로 먼저 연결해 주세요.')); return; }
      const handle = await folderHandle(folder.id);
      const picked = await openFolderDialog(handle);
      const file = picked?.[0];
      if (!file) return;
      const blob = await file.getFile();
      if (isBrowserViewable(file.name)) {
        const tab = window.open('', '_blank');
        // 고른 HTML 이 연결 폴더 최상위에 있으면 형제 CSS·JS 를 묶어 넣습니다 (파일 핸들만으로는 폴더를 알 수 없어 이름·크기·시각으로 맞춥니다).
        let content: Blob | string = blob;
        if (isHtml(file.name)) {
          const roots = (await Promise.all(linked.map((item) => folderHandle(item.id).catch(() => null)))).filter((item): item is FsDirHandle => item !== null);
          const read = await siblingReaderForPickedFile(blob, roots);
          if (read) content = await bundleHtml(await blob.text(), file.name, read);
        }
        const url = URL.createObjectURL(new Blob([content], { type: mimeOf(file.name) }));
        if (tab) tab.location.href = url; else window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        return;
      }
      if (DESKTOP_APP_FILE.test(file.name)) {
        await openOfficeBlob(file.name, new Blob([await blob.arrayBuffer()], { type: mimeOf(file.name) }), onNotice);
        return;
      }
      if (blob.size > 1_000_000) throw new Error('편집 가능한 파일 크기는 1MB까지입니다.');
      setPreview({ path: file.name, text: await blob.text() });
    } catch (error) { fail(error, t('폴더를 열지 못했습니다.')); }
    finally { setBusy(null); }
  }

  return <div className="detail-file-actions">
    <Button variant="outline" className={spotlight ? 'spotlight-pulse' : undefined} disabled={!artifactCount || busy !== null} onClick={() => void showResult()}
      title={artifactCount ? (spotlight ? t('결과물이 준비되었습니다 — 눌러서 바로 확인하세요.') : undefined) : t('에이전트가 작업을 완료하고 파일을 저장하면 열 수 있습니다.')}>
      {busy === 'results' ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />} {t('결과보기')}{artifactCount > 0 && <em className="detail-file-count">{artifactCount}</em>}
    </Button>
    <Button variant="outline" disabled={busy !== null} onClick={() => void openFolder()}>
      {busy === 'folder' ? <LoaderCircle size={14} className="spin" /> : <FolderOpen size={14} />} {t('폴더열기')}
    </Button>
    <Dialog open={preview !== null} onOpenChange={(value) => { if (!value) setPreview(null); }}>
      <DialogContent className="project-files-dialog">
        {preview && <>
          <DialogHeader><DialogTitle>{preview.path}</DialogTitle><DialogDescription>{t('브라우저에서 바로 실행할 수 없는 형식이라 내용을 보여 줍니다.')}</DialogDescription></DialogHeader>
          <div className="project-files-preview"><pre>{preview.text}</pre></div>
        </>}
      </DialogContent>
    </Dialog>
  </div>;
}
