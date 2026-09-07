/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Preserve the composite component element/ref contract and explicit ARIA semantics. */
'use client';

import { FolderPermissions } from '@/components/folder-permissions';
import { useAIFileChanges } from '@/components/ai-file-changes';
import { LocalFileWorkspace, SaveCodeFiles } from '@/components/local-file-workspace';
import { ProjectFileButtons } from '@/components/project-files';
import { forgetFolderArtifacts } from '@/lib/project-artifacts';
import { ProjectTutorialFields } from '@/components/project-tutorial-fields';
import { tutorialEvent, tutorialExample } from '@/components/tutorial';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bot, BriefcaseBusiness, Check, ChevronDown, ChevronRight, CirclePlus, Clock3, Cpu, EllipsisVertical, FileImage, FileText, Flag, FolderKanban, FolderPlus, KeyRound, LayoutGrid, Languages, List, ListChecks, LoaderCircle, MessageSquare, Monitor, Moon, Pencil, Plus, Send, Settings2, ShieldCheck, Sparkles, Sun, Trash2, UserRound, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { Markdown } from '@/components/markdown';
import { ReviewActions, ReviewBadge, ReviewComment, isReviewComment } from '@/components/review-panel';
import { type ApiKeyState, ApiKeyDialog, fetchApiKeyState } from '@/components/api-key-dialog';
import { CreditsCard } from '@/components/credits-card';
import { PRIORITIES, type Priority, byPriority, toPriority } from '@/lib/priority';
import { TASK_STATUSES, type TaskStatus } from '@/lib/task-status';
import { FIELD_TYPES, FIELD_TYPE_LABELS, type FieldType, type ProjectField } from '@/lib/fields';
import {
  type FolderLinkState, type FsDirHandle, type ProjectFolder,
  ensureReadPermission, fetchProjectFolders, forgetHandle, getHandle,
  inspectFolder, pickDirectory, saveHandle, scanDirectory, supportsFolderPicker,
} from '@/lib/folder-access';
import { AGENT_MODELS, DEFAULT_MODEL_FALLBACK, agentModelLabel } from '@/lib/models';
import {
  ATTACHMENT_ACCEPT, type ChatAttachment, MAX_ATTACHMENTS, MAX_ATTACHMENT_TOTAL_BYTES,
  formatBytes, readAttachment, toPayload,
} from '@/lib/attachments';
import { type Autonomy, DEFAULT_AUTONOMY, isAutonomy } from '@/lib/autonomy';
import { LANGUAGES, LANGUAGE_LABEL, type Lang, t, tf } from '@/lib/i18n';
import {
  AVATAR_MAX_CHARS, AVATAR_SIZE, EMPTY_PROFILE, PROFILE_LIMITS,
  type ProfileField, type UserProfile, affiliationLine,
} from '@/lib/profile';
import { type Prefs, THEME_CHOICES, type ThemeChoice, updatePrefs, usePrefs } from '@/lib/prefs';

export type WorkspaceSection = '프로젝트' | '에이전트' | '대화' | '설정' | '계정';

/**
 * '대화하기' 로 넘어올 때 실어 오는 문맥.
 * 업무는 사람이 상태를 바꾸거나 직접 실행하지 않고, 담당 에이전트와의 대화로 지시·확인합니다.
 * key 는 같은 업무를 다시 눌러도 대화 화면이 새로 반응하도록 매번 새로 만듭니다.
 */
export type ChatTarget = { projectId: string; agentName: string; draft: string; key: number };

/** 중요도 배지 색. 높음만 눈에 띄게 하고 나머지는 조용하게 둡니다. */
const PRIORITY_CLASS: Record<Priority, string> = { 높음: 'high', 중간: 'mid', 낮음: 'low' };
type Project = { id: string; name: string; description: string; color: string; status: string; taskCount: number; agentCount: number; folderCount?: number };
type Agent = {
  id: string; name: string; role: string; description: string; instructions: string; model: string | null; color: string; isDefault: number;
  // 에이전트는 프로젝트에 귀속되고, 그중 한 명이 그 프로젝트의 매니저입니다.
  projectId?: string | null; isManager?: number; roleKey?: string | null;
};
type Assignment = { projectId: string; agentId: string };
type ProjectTask = { id: string; title: string; label: string; owner: string; status: string; priority: string; accent: string; result: string | null; summary?: string | null; description?: string; projectId: string | null; blockedReason?: string | null; reviewVerdict?: string | null; parentTaskId?: string | null; updatedAt?: number };

/** 접힌 팀원 칸에 보여 줄 요약 — 상태별 건수와 가장 최근에 움직인 카드. */
function briefOf(tasks: ProjectTask[]) {
  const counts = TASK_STATUSES.map((status) => ({ status, count: tasks.filter((task) => task.status === status).length })).filter((item) => item.count > 0);
  const latest = [...tasks].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0] ?? null;
  return { counts, latest };
}
type FieldValueRow = { taskId: string; fieldId: string; value: string };
type TaskCounts = { taskId: string; subtasks: number; doneSubtasks: number; comments: number };
type Subtask = { id: string; title: string; done: number; owner: string | null; position: number };
type TaskComment = { id: string; author: string; authorKind: string; content: string; createdAt: number };
type ChatSummaryInfo = { id: string; content: string; messageCount: number; coversFrom: number; coversTo: number; updatedAt: number };
type TaskRun = { id: string; outcome: string | null; summary: string | null; startedAt: number; completedAt: number | null };
type TaskDetail = {
  task: ProjectTask & { description: string; summary: string | null };
  fields: ProjectField[];
  values: Record<string, string>;
  subtasks: Subtask[];
  comments: TaskComment[];
  runs: TaskRun[];
};
type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string; createdAt: number };

export function WorkspaceView({ section, displayName, email, onNotice, chatTarget, onOpenChat, onProfileSaved, projectTarget, onProjectTargetConsumed, onOpenProject, visible = true }: {
  visible?: boolean;
  section: WorkspaceSection; displayName: string; email: string; onNotice: (message: string) => void;
  chatTarget?: ChatTarget | null; onOpenChat?: (target: Omit<ChatTarget, 'key'>) => void;
  /** 프로젝트 화면이 이 프로젝트 상세로 바로 들어가야 할 때 (대화의 '프로젝트 바로가기'). key 가 바뀔 때마다 다시 엽니다. */
  projectTarget?: { projectId: string; taskId?: string; key: number } | null;
  /** projectTarget 이 적용된 뒤 호출 — 1회성 이동이라 부모가 비웁니다. */
  onProjectTargetConsumed?: () => void;
  onOpenProject?: (projectId: string, taskId?: string) => void;
  /** 계정 화면에서 프로필을 저장했을 때 — 사이드바 아바타·인사말을 바로 맞춥니다. */
  onProfileSaved?: (next: { displayName: string; email: string; avatar: string }) => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  // 서버가 실제로 쓰는 기본 모델(.env 의 ANTHROPIC_MODEL). 모델 미지정 표시에 이 이름을 씁니다.
  const [defaultModel, setDefaultModel] = useState(DEFAULT_MODEL_FALLBACK);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/workspace');
      const data = await response.json() as { projects?: Project[]; agents?: Agent[]; assignments?: Assignment[]; defaultModel?: string; error?: string };
      if (!response.ok) throw new Error(data.error || t("워크스페이스를 불러오지 못했습니다."));
      setProjects(data.projects || []); setAgents(data.agents || []); setAssignments(data.assignments || []);
      if (data.defaultModel) setDefaultModel(data.defaultModel);
    } catch (error) { onNotice(error instanceof Error ? error.message : t("워크스페이스를 불러오지 못했습니다.")); }
    finally { setLoading(false); }
  }, [onNotice]);

  // oxlint-disable-next-line react/react-compiler -- async server hydration is intentional here
  useEffect(() => { if (visible) void refresh(); }, [refresh, visible]);

  if (loading) return <div className="view-loading"><LoaderCircle className="spin" /><span>{t("워크스페이스를 불러오는 중")}</span></div>;
  if (section === '프로젝트') return <ProjectsView projects={projects} agents={agents} assignments={assignments} onCreated={refresh} onNotice={onNotice} onOpenChat={onOpenChat} projectTarget={projectTarget} onTargetConsumed={onProjectTargetConsumed} />;
  if (section === '에이전트') return <AgentsView agents={agents} projects={projects} assignments={assignments} defaultModel={defaultModel} onCreated={refresh} onNotice={onNotice} onOpenChat={onOpenChat} />;
  if (section === '대화') return <ChatView projects={projects} agents={agents} assignments={assignments} onNotice={onNotice} onRefresh={refresh} initial={chatTarget ?? null} visible={visible} onOpenProject={onOpenProject} />;
  if (section === '설정') return <SettingsView onNotice={onNotice} />;
  return <AccountView displayName={displayName} email={email} onNotice={onNotice} onProfileSaved={onProfileSaved} />;
}

function ViewHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="workspace-heading"><div><span className="section-kicker">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

const PROJECT_VIEW_KEY = 'cowork.projects.view';
const AGENT_VIEW_KEY = 'cowork.agents.view';
// 대화창에서 고른 자율도. 이 기기에만 남습니다.
const CHAT_AUTONOMY_KEY = 'cowork.chat.autonomy';
// 프로젝트 삭제는 되돌릴 수 없어서, 이름을 그대로 입력하고 삭제 버튼을 이만큼 누르고 있어야 실행됩니다.
const DELETE_HOLD_MS = 3000;
type ProjectLayout = 'card' | 'list';

// ── 작업 폴더 ───────────────────────────────────────────────────────
// 폴더는 브라우저(File System Access API)로 열고, 서버에는 이름·파일 수만 저장합니다.
// 자세한 배경은 lib/folder-access.ts 주석 참고.
type PendingFolder = { key: string; name: string; fileCount: number; handle: FsDirHandle };
type LinkedFolder = ProjectFolder & { link: FolderLinkState };

/** 폴더 선택기 지원 여부. 서버 렌더와 어긋나지 않게 마운트 후에 확인합니다. */
function useFolderPicker() {
  const [ready, setReady] = useState(false);
  // oxlint-disable-next-line react/react-compiler -- 브라우저 기능 확인은 마운트 후에만 가능합니다.
  useEffect(() => { setReady(supportsFolderPicker()); }, []);
  return ready;
}

function FolderUnsupported() {
  return <p className="folder-hint warn">{t("이 브라우저는 폴더 선택을 지원하지 않습니다. Chrome 또는 Edge 에서 열어 주세요.")}</p>;
}

function folderStateLabel(folder: LinkedFolder) {
  if (folder.link === 'ready') return tf("파일 {0}개 · 이 브라우저에서 읽을 수 있어요", folder.fileCount);
  if (folder.link === 'blocked') return t("읽기 권한이 꺼져 있어요 — 다시 연결하면 복구됩니다");
  return t("이 브라우저에는 연결이 없어요 — 폴더를 다시 골라 주세요");
}

/** 프로젝트 상세의 '작업 폴더' 섹션. 추가 / 다시 연결 / 해제를 담당합니다. */
function ProjectFolders({ projectId, onNotice }: { projectId: string; onNotice: (message: string) => void }) {
  const pickerReady = useFolderPicker();
  const [folders, setFolders] = useState<LinkedFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const rows = await fetchProjectFolders(projectId);
    setFolders(await Promise.all(rows.map(async (folder) => ({ ...folder, link: await inspectFolder(folder.id) }))));
    setLoading(false);
  }, [projectId]);

  // oxlint-disable-next-line react/react-compiler -- 진입 시 한 번 확인합니다.
  useEffect(() => { void load(); }, [load]);

  async function addFolder() {
    if (busy) return;
    setBusy(true);
    try {
      const handle = await pickDirectory();
      if (!handle) return;
      const { files } = await scanDirectory(handle);
      const response = await fetch(`/api/projects/${projectId}/folders`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: handle.name, fileCount: files.length }),
      });
      const data = await response.json() as { folder?: ProjectFolder; error?: string };
      if (!response.ok || !data.folder) throw new Error(data.error || t("폴더를 연결하지 못했습니다."));
      await saveHandle(data.folder.id, handle);
      await load();
      onNotice(tf("'{0}' 폴더를 연결했습니다 (파일 {1}개).", handle.name, files.length));
    } catch (error) { onNotice(error instanceof Error ? error.message : t("폴더를 연결하지 못했습니다.")); }
    finally { setBusy(false); }
  }

  async function relinkFolder(folder: LinkedFolder) {
    if (busy) return;
    setBusy(true);
    try {
      // 권한만 꺼진 경우에는 다시 고를 필요 없이 허용만 받으면 됩니다.
      if (folder.link === 'blocked') {
        const stored = await getHandle(folder.id);
        if (stored && await ensureReadPermission(stored)) { await load(); onNotice('폴더 읽기 권한을 다시 받았습니다.'); return; }
      }
      const handle = await pickDirectory();
      if (!handle) return;
      const { files } = await scanDirectory(handle);
      await saveHandle(folder.id, handle);
      await fetch(`/api/projects/${projectId}/folders/${folder.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: handle.name, fileCount: files.length }),
      });
      await load();
      onNotice(tf("'{0}' 폴더를 이 브라우저에 다시 연결했습니다.", handle.name));
    } catch (error) { onNotice(error instanceof Error ? error.message : t("폴더를 다시 연결하지 못했습니다.")); }
    finally { setBusy(false); }
  }

  async function removeFolder(folder: LinkedFolder) {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/folders/${folder.id}`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error || t("폴더 연결을 해제하지 못했습니다."));
      }
      await forgetHandle(folder.id);
      forgetFolderArtifacts(projectId, folder.id);
      await load();
      onNotice('폴더 연결을 해제했습니다. 컴퓨터의 파일은 그대로입니다.');
    } catch (error) { onNotice(error instanceof Error ? error.message : t("폴더 연결을 해제하지 못했습니다.")); }
    finally { setBusy(false); }
  }

  return <section className="detail-section">
    <div className="folder-section-head">
      <h2>{t("작업 폴더")}</h2><LocalFileWorkspace projectId={projectId} />
      <button className="folder-add" onClick={() => void addFolder()} disabled={!pickerReady || busy}>
        {busy ? <LoaderCircle className="spin" size={14} /> : <CirclePlus size={14} />} {t("폴더 추가")}
      </button>
    </div>
    {!pickerReady
      ? <FolderUnsupported />
      : loading
        ? <p className="detail-empty">{t("폴더 연결 상태를 확인하는 중…")}</p>
        : folders.length
          ? <div className="folder-cards">{folders.map((folder) => <article className={`folder-card ${folder.link}`} key={folder.id}>
              <span className="folder-symbol"><FolderKanban size={16} /></span>
              <div><b>{folder.name}</b><small>{folderStateLabel(folder)}</small></div>
              {folder.link !== 'ready' && <button className="folder-relink" onClick={() => void relinkFolder(folder)} disabled={busy}>{t("다시 연결")}</button>}
              <button className="folder-remove" onClick={() => void removeFolder(folder)} disabled={busy} aria-label={tf("{0} 연결 해제", folder.name)} title={t("연결 해제")}><Trash2 size={14} /></button>
            </article>)}</div>
          : <p className="detail-empty">{t("연결된 폴더가 없습니다. 폴더를 추가하면 에이전트가 업무를 실행할 때 그 안의 파일 목록과 내용을 함께 읽습니다.")}</p>}
  </section>;
}

function ProjectsView({ projects, agents, assignments, onCreated, onNotice, onOpenChat, projectTarget, onTargetConsumed }: { projects: Project[]; agents: Agent[]; assignments: Assignment[]; onCreated: () => Promise<void>; onNotice: (message: string) => void; onOpenChat?: (target: Omit<ChatTarget, 'key'>) => void; projectTarget?: { projectId: string; taskId?: string; key: number } | null; onTargetConsumed?: () => void }) {
  const [name, setName] = useState(''); const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  // 새 프로젝트 다이얼로그에서 고른 폴더들. 프로젝트가 만들어진 뒤에 핸들을 저장합니다.
  const [pendingFolders, setPendingFolders] = useState<PendingFolder[]>([]);
  const [folderBusy, setFolderBusy] = useState(false);
  const pickerReady = useFolderPicker();
  const [layout, setLayout] = useState<ProjectLayout>('card');
  const [openedId, setOpenedId] = useState<string | null>(projectTarget?.projectId ?? null);
  // 대화의 '프로젝트 바로가기' 로 들어오면 그 프로젝트 상세를 바로 엽니다 (key 가 바뀔 때마다).
  const appliedProjectTarget = useRef<number | null>(projectTarget?.key ?? null);
  useEffect(() => {
    if (!projectTarget) return;
    if (projectTarget.key !== appliedProjectTarget.current) {
      appliedProjectTarget.current = projectTarget.key;
      setOpenedId(projectTarget.projectId);
    }
    // 카드까지 열어야 하면 ProjectDetail 이 연 뒤에 비웁니다 (아래 onFocusApplied).
    if (!projectTarget.taskId) onTargetConsumed?.();
  }, [projectTarget, onTargetConsumed]);
  const [editing, setEditing] = useState<Project | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [removing, setRemoving] = useState<Project | null>(null);
  // 삭제 확인: 프로젝트 이름 입력 + 삭제 버튼 3초 길게 누르기
  const [confirmName, setConfirmName] = useState('');
  const [holdRatio, setHoldRatio] = useState(0);
  const holdTimer = useRef<number | null>(null);
  const [busy, setBusy] = useState(false);

  const startRename = useCallback((project: Project) => {
    setEditing(project); setEditName(project.name); setEditDescription(project.description);
  }, []);

  const askRemove = useCallback((project: Project) => {
    setRemoving(project); setConfirmName(''); setHoldRatio(0);
  }, []);

  function stopHold() {
    if (holdTimer.current !== null) { window.clearInterval(holdTimer.current); holdTimer.current = null; }
    setHoldRatio(0);
  }

  function closeRemove() {
    stopHold(); setConfirmName(''); setRemoving(null);
  }

  async function renameProject() {
    if (!editing || !editName.trim()) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/projects/${editing.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim(), description: editDescription.trim() }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || t("프로젝트를 수정하지 못했습니다."));
      setEditing(null); await onCreated(); onNotice('프로젝트 정보를 수정했습니다.');
    } catch (error) { onNotice(error instanceof Error ? error.message : t("프로젝트를 수정하지 못했습니다.")); }
    finally { setBusy(false); }
  }

  async function deleteProject() {
    if (!removing) return;
    setBusy(true);
    try {
      // 업무는 프로젝트 안에서만 살기 때문에 프로젝트와 함께 지웁니다 (남겨 두면 어느 화면에도 보이지 않습니다).
      const response = await fetch(`/api/projects/${removing.id}?withTasks=1`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error || t("프로젝트를 삭제하지 못했습니다."));
      }
      if (openedId === removing.id) setOpenedId(null);
      const removedTasks = removing.taskCount;
      setConfirmName(''); setRemoving(null); await onCreated();
      onNotice(removedTasks ? tf("프로젝트와 업무 {0}건을 삭제했습니다.", removedTasks) : t("프로젝트를 삭제했습니다."));
    } catch (error) { onNotice(error instanceof Error ? error.message : t("프로젝트를 삭제하지 못했습니다.")); }
    finally { setBusy(false); }
  }

  /** 삭제 버튼을 누르고 있는 동안 게이지를 채우고, 3초를 채우면 그때 실제로 지웁니다. */
  function startHold() {
    if (holdTimer.current !== null || busy || !canDelete) return;
    const startedAt = Date.now();
    holdTimer.current = window.setInterval(() => {
      const ratio = Math.min(1, (Date.now() - startedAt) / DELETE_HOLD_MS);
      if (ratio >= 1) { stopHold(); void deleteProject(); return; }
      setHoldRatio(ratio);
    }, 40);
  }

  const projectMenu = (project: Project) => <DropdownMenu>
    <DropdownMenuTrigger render={<button className="project-menu" aria-label={tf("{0} 메뉴", project.name)} />}><EllipsisVertical size={16} /></DropdownMenuTrigger>
    <DropdownMenuContent className="project-menu-content" align="end">
      <DropdownMenuItem onClick={() => startRename(project)}><Pencil size={14} /> {t("이름 변경")}</DropdownMenuItem>
      <DropdownMenuItem variant="destructive" onClick={() => askRemove(project)}><Trash2 size={14} /> {t("프로젝트 삭제")}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;

  const canDelete = Boolean(removing) && confirmName.trim() === removing?.name;
  const holdSecondsLeft = Math.max(1, Math.ceil((DELETE_HOLD_MS * (1 - holdRatio)) / 1000));

  const projectDialogs = <>
    <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
      <DialogContent className="create-entity-dialog">
        <DialogHeader><DialogTitle>{t("프로젝트 수정")}</DialogTitle><DialogDescription>{t("이름과 설명을 바꿔도 업무와 대화 기록은 그대로 유지됩니다.")}</DialogDescription></DialogHeader>
        <label className="entity-field"><span>{t("프로젝트 이름")}</span><input value={editName} onChange={(event) => setEditName(event.target.value)} /></label>
        <label className="entity-field"><span>{t("설명")}</span><textarea value={editDescription} onChange={(event) => setEditDescription(event.target.value)} /></label>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t("취소")}</DialogClose>
          <DialogClose render={<Button disabled={!editName.trim() || busy} onClick={renameProject} />}>{busy ? t("저장 중") : t("저장")}</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={Boolean(removing)} onOpenChange={(open) => !open && closeRemove()}>
      <DialogContent className="create-entity-dialog">
        <DialogHeader>
          <DialogTitle>{removing?.name} {t("삭제")}</DialogTitle>
          <DialogDescription>{t("이 작업은 되돌릴 수 없습니다. 프로젝트에 남은 대화 기록도 함께 삭제됩니다.")}</DialogDescription>
        </DialogHeader>
        <div className="danger-option">
          <Trash2 size={15} />
          <span><b>{t("업무")} {removing?.taskCount ?? 0}{t("건이 함께 삭제됩니다")}</b><small>{t("업무는 프로젝트 안에서만 존재합니다. 하위 작업·댓글·실행 기록도 같이 지워집니다.")}</small></span>
        </div>
        <label className="entity-field delete-confirm">
          <span>{t("확인을 위해 프로젝트 이름")} <b>{removing?.name}</b> {t("을(를) 그대로 입력하세요")}</span>
          <input value={confirmName} onChange={(event) => { setConfirmName(event.target.value); stopHold(); }}
            data-tab-example={removing?.name ?? ''} placeholder={removing?.name ?? ''} autoComplete="off" spellCheck={false} aria-label={t("삭제 확인용 프로젝트 이름")} />
        </label>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t("취소")}</DialogClose>
          <Button className="danger-button hold-delete" disabled={!canDelete || busy}
            onPointerDown={startHold} onPointerUp={stopHold} onPointerLeave={stopHold} onPointerCancel={stopHold}
            onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) { event.preventDefault(); startHold(); } }}
            onKeyUp={(event) => { if (event.key === 'Enter' || event.key === ' ') stopHold(); }}
            aria-label={t("삭제하려면 3초간 누르세요")}>
            <i className="hold-fill" style={{ width: `${Math.round(holdRatio * 100)}%` }} aria-hidden="true" />
            <span className="hold-label">{busy ? t("삭제 중") : holdRatio > 0 ? tf("{0}초 더 누르세요", holdSecondsLeft) : t("3초간 누르기")}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;

  // 마지막으로 고른 보기 방식을 브라우저에 기억해 둡니다.
  useEffect(() => {
    // oxlint-disable-next-line react/react-compiler -- Hydrate browser-only preference after SSR; a lazy initializer would mismatch server markup.
    try { const stored = window.localStorage.getItem(PROJECT_VIEW_KEY); if (stored === 'card' || stored === 'list') setLayout(stored); } catch { /* 저장소 접근 불가 시 기본값 유지 */ }
  }, []);
  const changeLayout = useCallback((next: ProjectLayout) => {
    setLayout(next);
    try { window.localStorage.setItem(PROJECT_VIEW_KEY, next); } catch { /* 저장 실패는 무시 */ }
  }, []);
  async function addPendingFolder() {
    if (folderBusy) return;
    setFolderBusy(true);
    try {
      const handle = await pickDirectory();
      if (!handle) return;
      const { files } = await scanDirectory(handle);
      setPendingFolders((current) => current.some((item) => item.name === handle.name)
        ? current
        : [...current, { key: crypto.randomUUID(), name: handle.name, fileCount: files.length, handle }]);
    } catch (error) { onNotice(error instanceof Error ? error.message : t("폴더를 읽지 못했습니다.")); }
    finally { setFolderBusy(false); }
  }

  async function createProject() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const response = await fetch('/api/projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, folders: pendingFolders.map((folder) => ({ name: folder.name, fileCount: folder.fileCount })) }),
      });
      const data = await response.json() as { project?: { id: string }; manager?: { name: string }; folders?: { id: string }[]; error?: string };
      if (!response.ok) throw new Error(data.error || t("프로젝트를 만들지 못했습니다."));
      // 서버가 보낸 순서 = 우리가 보낸 순서. 그 id 로 디렉터리 핸들을 이 브라우저에 저장합니다.
      await Promise.all((data.folders ?? []).map((folder, index) => {
        const pending = pendingFolders[index];
        return pending ? saveHandle(folder.id, pending.handle) : Promise.resolve();
      }));
      const folderCount = pendingFolders.length;
      setName(''); setDescription(''); setPendingFolders([]);
      await onCreated();
      if (data.project?.id && document.body.dataset.tutorial) { try { localStorage.setItem('orbit.tutorial-project', data.project.id); } catch {} }
      tutorialEvent('project-created');
      onNotice(tf('{0}가 배정되었습니다{1}.', data.manager?.name ?? t('프로젝트 매니저'), folderCount ? tf(' · 폴더 {0}개 연결', folderCount) : ''));
    } catch (error) { onNotice(error instanceof Error ? error.message : t("프로젝트를 만들지 못했습니다.")); }
    finally { setSaving(false); }
  }
  const layoutToggle = <div className="layout-toggle" role="group" aria-label={t("프로젝트 보기 방식")}>
    <button className={layout === 'card' ? 'active' : ''} aria-pressed={layout === 'card'} onClick={() => changeLayout('card')} title={t("카드 보기")}><LayoutGrid size={15} /> {t("카드")}</button>
    <button className={layout === 'list' ? 'active' : ''} aria-pressed={layout === 'list'} onClick={() => changeLayout('list')} title={t("리스트 보기")}><List size={15} /> {t("리스트")}</button>
  </div>;
  const createDialog = <Dialog><DialogTrigger render={<Button className="view-primary" data-tour="create-project" />}><Plus size={16} /> {t("프로젝트 만들기")}</DialogTrigger><DialogContent className="create-entity-dialog">
    <DialogHeader><DialogTitle>{t("새 프로젝트")}</DialogTitle><DialogDescription>{t("목표와 작업 폴더만 정하면 됩니다. 전담 프로젝트 매니저가 배정되고, 필요한 에이전트는 매니저가 합류시킵니다.")}</DialogDescription></DialogHeader>
    <ProjectTutorialFields name={name} description={description} onName={setName} onDescription={setDescription} />
    <div className="folder-picker">
      <div className="folder-picker-head">
        <span>{t("작업 폴더")} <em>{t("선택")}</em></span>
        <button type="button" className="folder-add" data-tour="project-folder" onClick={() => void addPendingFolder()} disabled={!pickerReady || folderBusy}>
          {folderBusy ? <LoaderCircle className="spin" size={13} /> : <CirclePlus size={13} />} {t("폴더 선택")}
        </button>
      </div>
      {!pickerReady
        ? <FolderUnsupported />
        : pendingFolders.length
          ? <ul className="folder-chips">{pendingFolders.map((folder) => <li key={folder.key}>
              <FolderKanban size={13} /><b>{folder.name}</b><small>{t("파일")} {folder.fileCount}</small>
              <button type="button" onClick={() => setPendingFolders((current) => current.filter((item) => item.key !== folder.key))} aria-label={tf("{0} 제외", folder.name)} title={t("제외")}><Trash2 size={12} /></button>
            </li>)}</ul>
          : <p className="folder-hint">{t("폴더를 연결하면 에이전트가 업무를 실행할 때 그 안의 파일을 함께 읽습니다. 파일은 이 브라우저에서만 읽히고 서버에는 폴더 이름만 저장됩니다.")}</p>}
    </div>
    {name.trim() && <p className="manager-preview"><UserRound size={13} /> {t("배정될 매니저:")} <b>{name.trim()} {t("프로젝트 매니저")}</b></p>}
    <DialogFooter><DialogClose render={<Button variant="outline" />}>{t("취소")}</DialogClose><DialogClose render={<Button data-tour="project-submit" disabled={!name.trim() || saving} onClick={createProject} />}>{saving ? t("생성 중") : t("프로젝트 생성")}</DialogClose></DialogFooter>
  </DialogContent></Dialog>;
  const action = <div className="view-actions">{projects.length > 0 && layoutToggle}{createDialog}</div>;
  const opened = projects.find((project) => project.id === openedId) || null;
  if (opened) return <>
    <ProjectDetail project={opened} agents={agents} assignments={assignments} onBack={() => setOpenedId(null)} onNotice={onNotice}
      onRename={() => startRename(opened)} onDelete={() => askRemove(opened)} onOpenChat={onOpenChat}
      focusTask={projectTarget?.projectId === opened.id ? projectTarget : null} onFocusApplied={onTargetConsumed} />
    {projectDialogs}
  </>;
  return <div className="workspace-view"><ViewHeading eyebrow="Projects" title={t("프로젝트")} description={t("진행 중인 프로젝트와 참여 에이전트를 관리합니다.")} action={action} />
    {projects.length > 0 && (layout === 'card'
      ? <div className="project-grid">{projects.map((project) => <article className="project-card is-clickable" key={project.id}><button className="open-overlay" tabIndex={-1} aria-hidden="true" onClick={() => setOpenedId(project.id)} /><div className="project-card-top"><span className="project-symbol" style={{ background: project.color }}><FolderKanban size={20} /></span><span className="project-card-tools"><span className="project-status"><i />{t(project.status)}</span>{projectMenu(project)}</span></div><h2>{project.name}</h2><p>{project.description || t("프로젝트 설명이 없습니다.")}</p><div className="project-stats"><span><BriefcaseBusiness size={14} />{t("업무")} {project.taskCount}</span><span><Users size={14} />{t("에이전트")} {project.agentCount}</span>{Boolean(project.folderCount) && <span><FolderKanban size={14} />{t("폴더")} {project.folderCount}</span>}</div><button className="project-card-open" onClick={() => setOpenedId(project.id)} aria-label={tf("{0} 프로젝트 열기", project.name)}>{t("프로젝트 열기")} <ChevronRight size={15} /></button></article>)}</div>
      : <div className="project-table" role="table" aria-label={t("프로젝트 목록")}>
          <div className="project-row head" role="row"><span role="columnheader">{t("프로젝트")}</span><span role="columnheader">{t("상태")}</span><span role="columnheader">{t("업무")}</span><span role="columnheader">{t("에이전트")}</span><span role="columnheader" aria-label={t("작업")} /></div>
          {projects.map((project) => <div className="project-row is-clickable" role="row" key={project.id}>
            <button className="open-overlay" tabIndex={-1} aria-hidden="true" onClick={() => setOpenedId(project.id)} />
            <span className="project-row-main" role="cell"><i className="project-dot" style={{ background: project.color }}><FolderKanban size={15} /></i><b>{project.name}</b><small>{project.description || t("프로젝트 설명이 없습니다.")}</small></span>
            <span role="cell"><em className="project-status"><i />{t(project.status)}</em></span>
            <span className="project-row-metric" role="cell"><BriefcaseBusiness size={14} />{project.taskCount}</span>
            <span className="project-row-metric" role="cell"><Users size={14} />{project.agentCount}</span>
            <span className="project-row-tools" role="cell"><button className="project-row-open" onClick={() => setOpenedId(project.id)} aria-label={tf("{0} 프로젝트 열기", project.name)}>{t("열기")} <ChevronRight size={15} /></button>{projectMenu(project)}</span>
          </div>)}
        </div>)}
    {!projects.length && <div className="entity-empty"><CirclePlus size={30} /><h2>{t("첫 프로젝트를 만들어 보세요")}</h2><p>{t("목표와 에이전트를 한곳에서 관리할 수 있어요.")}</p></div>}
    {projectDialogs}
  </div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 프로젝트 상세 = Asana 식 TASK 보드
//   · 컬럼 그룹 기준을 담당자 / 상태 / 분류 중에서 고릅니다 (기본: 담당자).
//   · 카드를 누르면 TASK 상세 패널이 열리고, 프로젝트 커스텀 필드를 여기서 채웁니다.
//   · 필드 정의는 프로젝트 단위이며 사용자와 에이전트 양쪽이 만들 수 있습니다.
// ─────────────────────────────────────────────────────────────────────────────

const BOARD_GROUPS = ['담당자', '상태', '분류'] as const;
type BoardGroup = (typeof BOARD_GROUPS)[number];
const BOARD_GROUP_KEY = 'cowork.board.group';
const UNASSIGNED = '__none__';

type BoardColumn = { key: string; title: string; subtitle?: string; color?: string; owner?: string; isManager?: boolean; status?: TaskStatus; label?: string; tasks: ProjectTask[] };
/**
 * 담당자 보기의 한 행('업무 칸'). parent 가 있으면 매니저 카드 하나에서 위임된 카드들, 없으면 대화에서 바로 위임된 카드들입니다.
 * 각 에이전트 열은 접혀 있는 것이 기본이고, 머리를 누르면 그 칸의 카드가 펼쳐집니다.
 */
type BoardSection = { key: string; parent: ProjectTask | null; agents: { key: string; name: string; role: string; color: string | undefined; tasks: ProjectTask[] }[] };

function ProjectDetail({ project, agents, assignments, onBack, onNotice, onRename, onDelete, onOpenChat, focusTask, onFocusApplied }: { focusTask?: { taskId?: string; key: number } | null; onFocusApplied?: () => void; project: Project; agents: Agent[]; assignments: Assignment[]; onBack: () => void; onNotice: (message: string) => void; onRename: () => void; onDelete: () => void; onOpenChat?: (target: Omit<ChatTarget, 'key'>) => void }) {
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [fields, setFields] = useState<ProjectField[]>([]);
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});
  const [counts, setCounts] = useState<Record<string, TaskCounts>>({});
  const [loading, setLoading] = useState(true);
  const [openTaskId, setOpenTaskId] = useState<string | null>(focusTask?.taskId ?? null);
  // 대화의 '📥 보고' 링크로 들어오면 그 카드를 바로 엽니다 (key 가 바뀔 때마다).
  const appliedFocus = useRef<number | null>(focusTask?.key ?? null);
  useEffect(() => {
    if (!focusTask?.taskId) return;
    if (focusTask.key !== appliedFocus.current) {
      appliedFocus.current = focusTask.key;
      setOpenTaskId(focusTask.taskId);
    }
    // 1회성 이동 — 열었으니 부모가 target 을 비워 다음 마운트에서 또 뜨지 않게 합니다.
    onFocusApplied?.();
  }, [focusTask, onFocusApplied]);
  const [group, setGroup] = useState<BoardGroup>('담당자');
  // 보드를 다시 읽을 때마다 올라갑니다. 열려 있는 상세 패널도 이 값을 보고 자기 데이터를 새로 읽습니다.
  const [revision, setRevision] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [fieldOpen, setFieldOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [owner, setOwner] = useState('');
  const [label, setLabel] = useState('');
  const [priority, setPriority] = useState<Priority>('중간');
  const [createStatus, setCreateStatus] = useState<TaskStatus>('대기');
  const [saving, setSaving] = useState(false);

  const members = useMemo(
    () => agents.filter((agent) => assignments.some((item) => item.projectId === project.id && item.agentId === agent.id)),
    [agents, assignments, project.id],
  );

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(BOARD_GROUP_KEY);
      // oxlint-disable-next-line react/react-compiler -- Hydrate browser-only preference after SSR.
      if (stored && (BOARD_GROUPS as readonly string[]).includes(stored)) setGroup(stored as BoardGroup);
    } catch { /* 저장소 접근 불가 시 기본값 유지 */ }
  }, []);

  const changeGroup = useCallback((next: BoardGroup) => {
    setGroup(next);
    try { window.localStorage.setItem(BOARD_GROUP_KEY, next); } catch { /* 저장 실패는 무시합니다. */ }
  }, []);

  const loadTasks = useCallback(async () => {
    const response = await fetch('/api/tasks');
    const data = await response.json() as { tasks?: ProjectTask[]; error?: string };
    if (!response.ok) throw new Error(data.error || t("프로젝트 업무를 불러오지 못했습니다."));
    setTasks((data.tasks || []).filter((task) => task.projectId === project.id));
  }, [project.id]);

  const loadFields = useCallback(async () => {
    const response = await fetch(`/api/projects/${project.id}/fields?values=1`);
    const data = await response.json() as { fields?: ProjectField[]; values?: FieldValueRow[]; counts?: TaskCounts[]; error?: string };
    if (!response.ok) throw new Error(data.error || t("커스텀 필드를 불러오지 못했습니다."));
    setFields(data.fields || []);
    const next: Record<string, Record<string, string>> = {};
    for (const row of data.values || []) {
      next[row.taskId] ??= {};
      next[row.taskId][row.fieldId] = row.value;
    }
    setValues(next);
    setCounts(Object.fromEntries((data.counts || []).map((row) => [row.taskId, row])));
  }, [project.id]);

  const reload = useCallback(async () => {
    try { await Promise.all([loadTasks(), loadFields()]); setRevision((value) => value + 1); }
    catch (error) { onNotice(error instanceof Error ? error.message : t("프로젝트를 불러오지 못했습니다.")); }
    finally { setLoading(false); }
  }, [loadTasks, loadFields, onNotice]);

  // oxlint-disable-next-line react/react-compiler -- 최초 진입 시 한 번만 불러옵니다.
  useEffect(() => { setLoading(true); void reload(); }, [reload]);

  // 대화 화면이나 다른 탭에 다녀오는 사이 에이전트가 보드를 바꿨을 수 있어, 돌아오면 다시 읽습니다.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== 'visible') return;
      void reload();
    }
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [reload]);

  function openCreate(presetOwner?: string, presetLabel?: string, presetStatus?: TaskStatus) {
    setOwner(presetOwner ?? '');
    setLabel(presetLabel ?? '');
    setTitle(''); setPriority('중간');
    setCreateStatus(presetStatus ?? '대기');
    setCreateOpen(true);
  }

  async function createTask() {
    const trimmed = title.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const response = await fetch('/api/tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed, owner: owner || undefined, label: label.trim() || undefined, status: createStatus, priority, projectId: project.id }),
      });
      const data = await response.json() as { task?: ProjectTask; error?: string };
      if (!response.ok || !data.task) throw new Error(data.error || t("업무를 만들지 못했습니다."));
      setTasks((current) => [...current, data.task as ProjectTask]);
      setTitle(''); setLabel(''); setPriority('중간');
      onNotice(tf("새 업무가 {0}에게 배정되었습니다.", data.task.owner));
    } catch (error) { onNotice(error instanceof Error ? error.message : t("업무를 만들지 못했습니다.")); }
    finally { setSaving(false); }
  }

  const patchTask = useCallback(async (task: ProjectTask, patch: Record<string, unknown>) => {
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, ...patch } as ProjectTask : item));
    try {
      const response = await fetch(`/api/tasks/${task.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      const data = await response.json() as { task?: ProjectTask; error?: string };
      if (!response.ok || !data.task) throw new Error(data.error || t("업무를 수정하지 못했습니다."));
      setTasks((current) => current.map((item) => item.id === task.id ? data.task as ProjectTask : item));
      return data.task;
    } catch (error) {
      setTasks((current) => current.map((item) => item.id === task.id ? task : item));
      onNotice(error instanceof Error ? error.message : t("업무를 수정하지 못했습니다."));
      return null;
    }
  }, [onNotice]);

  /** 보드의 매니저 컬럼에서 '매니저와 대화하기' — 빈 입력란으로 매니저 대화 화면을 엽니다. */
  const openManagerChat = useCallback((agentName: string) => {
    onOpenChat?.({ projectId: project.id, agentName, draft: '' });
  }, [onOpenChat, project.id]);

  /** 업무 카드에서 '대화하기' — 담당 에이전트와의 대화 화면으로 그 업무를 들고 넘어갑니다. */
  const openTaskChat = useCallback((task: ProjectTask) => {
    onOpenChat?.({
      projectId: project.id,
      agentName: task.owner,
      draft: tf("'{0}' 업무를 진행해 주세요. 현재 상태와 다음에 할 일을 알려주고, 바로 처리할 수 있으면 이어서 진행해 주세요.", task.title),
    });
  }, [onOpenChat, project.id]);

  const removeTask = useCallback(async (task: ProjectTask) => {
    const snapshot = tasks;
    setTasks((current) => current.filter((item) => item.id !== task.id));
    try {
      const response = await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error || t("업무를 삭제하지 못했습니다."));
      }
      onNotice('업무를 삭제했습니다.');
    } catch (error) {
      setTasks(snapshot);
      onNotice(error instanceof Error ? error.message : t("업무를 삭제하지 못했습니다."));
    }
  }, [tasks, onNotice]);

  const reviewCount = tasks.filter((task) => task.status === '검토').length;
  const progress = tasks.length ? Math.round((reviewCount / tasks.length) * 100) : 0;
  const cardFields = useMemo(() => fields.filter((field) => field.showOnCard), [fields]);

  // 그룹 기준에 따라 컬럼을 만듭니다. 담당자 기준일 때는 업무가 없는 참여 에이전트도 빈 열로 보입니다.
  const columns = useMemo<BoardColumn[]>(() => {
    if (group === '상태') {
      return TASK_STATUSES.map((status) => ({ key: status, title: status, status, tasks: byPriority(tasks.filter((task) => task.status === status)) }));
    }
    if (group === '분류') {
      const labels = Array.from(new Set(tasks.map((task) => task.label))).sort((a, b) => a.localeCompare(b, 'ko'));
      return labels.map((item) => ({ key: item, title: item, label: item, tasks: byPriority(tasks.filter((task) => task.label === item)) }));
    }
    const roster = members.length ? members : agents;
    const known = new Set(roster.map((agent) => agent.name));
    const columnList: BoardColumn[] = roster.map((agent) => ({
      key: agent.id, title: agent.name, subtitle: t(agent.role), color: agent.color, owner: agent.name, isManager: Boolean(agent.isManager),
      tasks: byPriority(tasks.filter((task) => task.owner === agent.name)),
    }));
    const orphans = tasks.filter((task) => !known.has(task.owner));
    if (orphans.length) columnList.push({ key: UNASSIGNED, title: t("미배정"), subtitle: t("프로젝트에 없는 담당자"), tasks: byPriority(orphans) });
    return columnList;
  }, [group, tasks, members, agents]);

  // 담당자 보기: 매니저 카드(지시)마다 한 행, 그 아래 위임된 카드를 에이전트별로 묶습니다.
  const sections = useMemo<BoardSection[]>(() => {
    if (group !== '담당자') return [];
    const roster = members.length ? members : agents;
    const manager = roster.find((agent) => agent.isManager) ?? null;
    const workers = roster.filter((agent) => !agent.isManager);
    const known = new Set(roster.map((agent) => agent.name));
    const managerTasks = manager ? byPriority(tasks.filter((task) => task.owner === manager.name)) : [];
    const parentIds = new Set(managerTasks.map((task) => task.id));
    const childTasks = tasks.filter((task) => !manager || task.owner !== manager.name);
    const build = (key: string, parent: ProjectTask | null, pool: ProjectTask[], showAll: boolean): BoardSection => {
      const agentCells: BoardSection['agents'] = workers
        .map((agent) => ({ key: agent.id, name: agent.name, role: t(agent.role), color: agent.color, tasks: byPriority(pool.filter((task) => task.owner === agent.name)) }))
        .filter((cell) => showAll || cell.tasks.length);
      const orphans = byPriority(pool.filter((task) => !known.has(task.owner)));
      if (orphans.length) agentCells.push({ key: UNASSIGNED, name: t("미배정"), role: t("프로젝트에 없는 담당자"), color: undefined, tasks: orphans });
      return { key, parent, agents: agentCells };
    };
    const direct = childTasks.filter((task) => !task.parentTaskId || !parentIds.has(task.parentTaskId));
    return [
      build('direct', null, direct, true),
      ...managerTasks.map((parent) => build(parent.id, parent, childTasks.filter((task) => task.parentTaskId === parent.id), false)),
    ];
  }, [group, tasks, members, agents]);
  const managerAgent = (members.length ? members : agents).find((agent) => agent.isManager) ?? null;
  const [openCells, setOpenCells] = useState<Set<string>>(() => new Set());
  const toggleCell = useCallback((key: string) => {
    setOpenCells((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  }, []);

  const openTask = tasks.find((task) => task.id === openTaskId) ?? null;

  const createDialog = <Dialog open={createOpen} onOpenChange={setCreateOpen}>
    <DialogTrigger render={<Button className="view-primary" onClick={() => openCreate()} />}><Plus size={16} /> {t("업무 추가")}</DialogTrigger>
    <DialogContent className="create-entity-dialog">
      <DialogHeader><DialogTitle>{project.name} {t("· 새 업무")}</DialogTitle><DialogDescription>{t("담당을 비워 두면 프로젝트 매니저가 받아 필요한 에이전트를 합류시키고 나눠 맡깁니다. 중요도가 높을수록 보드 위쪽에 놓이고 에이전트도 먼저 처리합니다.")}</DialogDescription></DialogHeader>
      <label className="entity-field"><span>{t("업무 이름")}</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t("예: 결제 플로우 엣지 케이스 정리")} /></label>
      <div className="entity-row">
        <label className="entity-field"><span>{t("담당 에이전트")}</span>
          <NativeSelect value={owner} onChange={(event) => setOwner(event.target.value)}>
            <NativeSelectOption value="">{t("프로젝트 매니저에게 (기본)")}</NativeSelectOption>
            {members.map((agent) => <NativeSelectOption key={agent.id} value={agent.name}>{agent.name} · {t(agent.role)}</NativeSelectOption>)}
          </NativeSelect>
        </label>
        <label className="entity-field"><span>{t("분류")}</span><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder={t("예: 리서치")} /></label>
        <label className="entity-field"><span>{t("중요도")}</span>
          <NativeSelect value={priority} onChange={(event) => setPriority(event.target.value as Priority)}>
            {PRIORITIES.map((option) => <NativeSelectOption key={option} value={option}>{t(option)}</NativeSelectOption>)}
          </NativeSelect>
        </label>
      </div>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>{t("취소")}</DialogClose>
        <DialogClose render={<Button disabled={!title.trim() || saving} onClick={createTask} />}>{saving ? t("배정 중") : t("업무 배정")}</DialogClose>
      </DialogFooter>
    </DialogContent>
  </Dialog>;

  return <div className="workspace-view project-detail">
    <button className="detail-back" onClick={onBack}><ArrowLeft size={15} /> {t("프로젝트 목록")}</button>
    <div className="workspace-heading">
      <div>
        <span className="section-kicker">Project</span>
        <h1>{project.name}</h1>
        <p>{project.description || t("프로젝트 설명이 없습니다.")}</p>
        <ProjectFileButtons projectId={project.id} onNotice={onNotice} />
      </div>
      <div className="view-actions">
        <span className="project-status"><i />{t(project.status)}</span>
        {createDialog}
        <DropdownMenu>
          <DropdownMenuTrigger render={<button className="project-menu" aria-label={t("프로젝트 메뉴")} />}><EllipsisVertical size={16} /></DropdownMenuTrigger>
          <DropdownMenuContent className="project-menu-content" align="end">
            <DropdownMenuItem onClick={onRename}><Pencil size={14} /> {t("이름 변경")}</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onDelete}><Trash2 size={14} /> {t("프로젝트 삭제")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>

    <div className="detail-metrics">
      <article><span>{t("전체 업무")}</span><strong>{tasks.length}</strong></article>
      <article><span>{t("검토 단계")}</span><strong>{reviewCount}</strong></article>
      <article><span>{t("참여 에이전트")}</span><strong>{members.length}</strong></article>
      <article className="detail-progress">
        <span>{t("검토 도달률")}</span><strong>{progress}%</strong>
        <div className="detail-bar"><i style={{ width: `${progress}%` }} /></div>
      </article>
    </div>

    <section className="detail-section board-section">
      <div className="board-toolbar">
        <div className="board-group">
          <LayoutGrid size={14} />
          <span>{t("그룹")}</span>
          <NativeSelect value={group} onChange={(event) => changeGroup(event.target.value as BoardGroup)} aria-label={t("보드 그룹 기준")}>
            {BOARD_GROUPS.map((option) => <NativeSelectOption key={option} value={option}>{t(option)}</NativeSelectOption>)}
          </NativeSelect>
        </div>
        <button className="board-tool" onClick={() => setFieldOpen(true)}>
          <Settings2 size={14} /> {t("사용자 지정 필드")} <em>{fields.length}</em>
        </button>
      </div>

      {loading
        ? <div className="view-loading"><LoaderCircle className="spin" /><span>{t("보드를 불러오는 중")}</span></div>
        : group === '담당자' && managerAgent
          ? <div className="board-sections">{sections.map((section) => <div className="board-section-row" key={section.key}>
              <section className="board-column board-parent">
                {section.parent
                  ? <BoardCard task={section.parent} fields={cardFields} values={values[section.parent.id]} counts={counts[section.parent.id]}
                      onOpen={() => setOpenTaskId(section.parent!.id)} onChat={() => openTaskChat(section.parent!)} />
                  : <>
                    <header className="board-column-head">
                      <span className="board-column-avatar" style={{ background: managerAgent.color }}><Bot size={15} aria-hidden="true" /></span>
                      <div><b>{managerAgent.name}</b><small>{t(managerAgent.role)}</small></div>
                    </header>
                    <div className="board-column-body">
                      <button className="board-chat" onClick={() => openManagerChat(managerAgent.name)}><MessageSquare size={13} /> {t("매니저와 대화하기")}</button>
                      <button className="board-add" onClick={() => openCreate(managerAgent.name)}><Plus size={13} /> {t("작업 추가")}</button>
                    </div>
                  </>}
              </section>
              {section.agents.map((cell) => {
                const cellKey = `${section.key}:${cell.key}`;
                const open = openCells.has(cellKey);
                return <section className={open ? 'board-column board-agent open' : 'board-column board-agent collapsed'} key={cell.key}>
                  <button className="board-column-head board-column-toggle" onClick={() => toggleCell(cellKey)} aria-expanded={open}
                    aria-label={tf(open ? "{0} 업무 접기" : "{0} 업무 펼치기", cell.name)}>
                    {cell.color
                      ? <span className="board-column-avatar" style={{ background: cell.color }}>{cell.name.slice(0, 1)}</span>
                      : <span className="board-column-mark" />}
                    <div><b>{cell.name}</b><small>{cell.role}</small></div>
                    <em>{cell.tasks.length}</em>
                    <ChevronDown size={15} className="board-column-chevron" aria-hidden="true" />
                  </button>
                  {!open && cell.tasks.length > 0 && (() => {
                    const brief = briefOf(cell.tasks);
                    return <div className="board-column-brief">
                      <div className="board-brief-counts">{brief.counts.map((item) => <span className={`board-chip ${item.status === '진행 중' ? 'doing' : item.status === '검토' ? 'review' : ''}`} key={item.status}>{t(item.status)} {item.count}</span>)}</div>
                      {brief.latest && <button className="board-brief-latest" onClick={() => setOpenTaskId(brief.latest!.id)} aria-label={tf("{0} 상세 열기", brief.latest.title)}>
                        <small>{t("최근")}</small>
                        <b>{brief.latest.title}</b>
                        {brief.latest.blockedReason
                          ? <p className="is-blocked">{brief.latest.blockedReason}</p>
                          : brief.latest.summary ? <p>{brief.latest.summary}</p> : null}
                      </button>}
                    </div>;
                  })()}
                  {open && <div className="board-column-body">
                    {cell.tasks.map((task) => <BoardCard
                      key={task.id} task={task} fields={cardFields} values={values[task.id]} counts={counts[task.id]}
                      onOpen={() => setOpenTaskId(task.id)}
                      onChat={() => openTaskChat(task)}
                    />)}
                    {!cell.tasks.length && <p className="board-column-empty">{t("아직 맡은 업무가 없습니다.")}</p>}
                  </div>}
                </section>;
              })}
            </div>)}</div>
        : columns.length
          ? <div className="board-columns">{columns.map((column) => <section className="board-column" key={column.key}>
              <header className="board-column-head">
                {column.color
                  ? <span className="board-column-avatar" style={{ background: column.color }}>{column.isManager ? <Bot size={15} aria-hidden="true" /> : t(column.title).slice(0, 1)}</span>
                  : <span className="board-column-mark" />}
                <div><b>{t(column.title)}</b>{column.subtitle && <small>{t(column.subtitle)}</small>}</div>
                <em>{column.tasks.length}</em>
              </header>
              <div className="board-column-body">
                {column.tasks.map((task) => <BoardCard
                  key={task.id} task={task} fields={cardFields} values={values[task.id]} counts={counts[task.id]}
                  onOpen={() => setOpenTaskId(task.id)}
                  onChat={() => openTaskChat(task)}
                />)}
                {column.isManager && column.owner && <button className="board-chat" onClick={() => openManagerChat(column.owner as string)}>
                  <MessageSquare size={13} /> {t("매니저와 대화하기")}
                </button>}
                <button className="board-add" onClick={() => openCreate(column.owner, column.label, column.status)}>
                  <Plus size={13} /> {t("작업 추가")}
                </button>
              </div>
            </section>)}</div>
          : <p className="detail-empty">{t("아직 이 프로젝트에 등록된 업무가 없습니다. 위의 &lsquo;업무 추가&rsquo;로 매니저에게 첫 업무를 맡겨 보세요.")}</p>}
    </section>

    <ProjectFolders projectId={project.id} onNotice={onNotice} />

    {openTask && <TaskDetailDialog
      task={openTask} project={project} agents={members.length ? members : agents}
      fields={fields} values={values[openTask.id]} reloadKey={revision}
      onClose={() => setOpenTaskId(null)}
      onNotice={onNotice}
      onPatch={(patch) => patchTask(openTask, patch)}
      onDelete={async () => { setOpenTaskId(null); await removeTask(openTask); }}
      onChat={() => { setOpenTaskId(null); openTaskChat(openTask); }}
      onManageFields={() => setFieldOpen(true)}
      onRefresh={reload}
    />}

    <FieldManagerDialog
      open={fieldOpen} onOpenChange={setFieldOpen}
      projectId={project.id} fields={fields} onChanged={reload} onNotice={onNotice}
    />
  </div>;
}

/**
 * 보드 카드. 본체를 누르면 상세가 열립니다.
 * 상태 변경·실행 같은 수동 조작은 두지 않습니다 — 진행은 담당 에이전트와의 대화로 지시합니다.
 */
function BoardCard({ task, fields, values, counts, onOpen, onChat }: {
  task: ProjectTask; fields: ProjectField[]; values?: Record<string, string>; counts?: TaskCounts;
  onOpen: () => void; onChat: () => void;
}) {
  const badges = fields
    .map((field) => ({ field, value: values?.[field.id] ?? '' }))
    .filter((item) => item.value);

  return <article className="board-card">
    <button className="board-card-open" onClick={onOpen} aria-label={tf("{0} 상세 열기", task.title)}>
      <div className="board-card-top">
        <span className="task-label" style={{ color: task.accent, backgroundColor: `${task.accent}14` }}>{task.label}</span>
        <span className={`board-chip ${task.status === '진행 중' ? 'doing' : task.status === '검토' ? 'review' : ''}`}>{t(task.status)}</span>
        <ReviewBadge verdict={task.reviewVerdict} blockedReason={task.blockedReason} />
      </div>
      <b>{task.title}</b>
      {Boolean(badges.length) && <div className="board-card-fields">
        {badges.map(({ field, value }) => <span className="board-field-badge" key={field.id}>
          <i>{field.name}</i>{field.type === 'checkbox' ? t("예") : value}
        </span>)}
      </div>}
      <div className="board-card-meta">
        <span className="mini-avatar" style={{ background: task.accent }}>{task.owner.slice(0, 1)}</span>
        <span>{task.owner}</span>
        <span className={`priority-badge ${PRIORITY_CLASS[toPriority(task.priority)]}`} title={tf("중요도 {0}", t(toPriority(task.priority)))}><Flag size={11} /> {t(toPriority(task.priority))}</span>
      </div>
      {Boolean(counts && (counts.subtasks || counts.comments)) && <div className="board-card-counts">
        {Boolean(counts?.subtasks) && <span><ListChecks size={12} /> {counts?.doneSubtasks}/{counts?.subtasks}</span>}
        {Boolean(counts?.comments) && <span><MessageSquare size={12} /> {counts?.comments}</span>}
      </div>}
    </button>
    <div className="detail-task-actions">
      {task.result
        ? <button className="run-task result" onClick={onOpen}><Check size={13} /> {t("결과")}</button>
        : <button className="run-task chat" onClick={onChat}><MessageSquare size={13} /> {t("대화하기")}</button>}
    </div>
  </article>;
}

/** 커스텀 필드 하나의 입력 위젯. 타입에 맞는 컨트롤을 고릅니다. */
function FieldInput({ field, value, onChange }: { field: ProjectField; value: string; onChange: (next: string) => void }) {
  if (field.type === 'checkbox') {
    return <span className="task-field-check">
      <Checkbox checked={Boolean(value)} aria-label={field.name} onCheckedChange={(checked) => onChange(checked ? '1' : '')} />
      <span>{value ? t("예") : t("아니오")}</span>
    </span>;
  }
  if (field.type === 'select') {
    return <NativeSelect value={value} onChange={(event) => onChange(event.target.value)}>
      <NativeSelectOption value="">—</NativeSelectOption>
      {field.options.map((option) => <NativeSelectOption key={option} value={option}>{option}</NativeSelectOption>)}
    </NativeSelect>;
  }
  return <input
    className="task-field-input"
    type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
    value={value}
    placeholder="—"
    onChange={(event) => onChange(event.target.value)}
  />;
}

/** TASK 상세 패널. Asana 의 작업 상세와 같은 구성입니다. */
function TaskDetailDialog({ task, project, agents, fields, values, reloadKey, onClose, onNotice, onPatch, onDelete, onChat, onManageFields, onRefresh }: {
  task: ProjectTask; project: Project; agents: Agent[]; fields: ProjectField[]; values: Record<string, string> | undefined;
  reloadKey: number; onRefresh?: () => Promise<void>;
  onClose: () => void; onNotice: (message: string) => void;
  onPatch: (patch: Record<string, unknown>) => Promise<ProjectTask | null>;
  onDelete: () => Promise<void>; onChat: () => void; onManageFields: () => void;
}) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [description, setDescription] = useState('');
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [subtaskDraft, setSubtaskDraft] = useState('');
  const [commentDraft, setCommentDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/tasks/${task.id}/detail`);
      const data = await response.json() as (TaskDetail & { error?: string });
      if (!response.ok) throw new Error(data.error || t("업무 상세를 불러오지 못했습니다."));
      setDetail(data);
      setDescription(data.task.description ?? '');
      setTitleDraft(data.task.title);
    } catch (error) { onNotice(error instanceof Error ? error.message : t("업무 상세를 불러오지 못했습니다.")); }
  }, [task.id, onNotice]);

  // oxlint-disable-next-line react/react-compiler -- 패널을 열 때, 그리고 보드가 갱신될 때 다시 읽습니다.
  useEffect(() => { void load(); }, [load, reloadKey]);

  async function saveDetail(patch: { description?: string; values?: Record<string, string> }) {
    try {
      const response = await fetch(`/api/tasks/${task.id}/detail`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || t("저장하지 못했습니다."));
      if (patch.description !== undefined) {
        setDetail((current) => current ? { ...current, task: { ...current.task, description: patch.description as string } } : current);
      }
    } catch (error) { onNotice(error instanceof Error ? error.message : t("저장하지 못했습니다.")); void load(); }
  }

  function setFieldValue(fieldId: string, next: string) {
    setDetail((current) => current ? { ...current, values: { ...current.values, [fieldId]: next } } : current);
  }

  async function addSubtask() {
    const trimmed = subtaskDraft.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/tasks/${task.id}/subtasks`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: trimmed }),
      });
      const data = await response.json() as { subtask?: Subtask; error?: string };
      if (!response.ok || !data.subtask) throw new Error(data.error || t("하위 작업을 추가하지 못했습니다."));
      setDetail((current) => current ? { ...current, subtasks: [...current.subtasks, data.subtask as Subtask] } : current);
      setSubtaskDraft('');
    } catch (error) { onNotice(error instanceof Error ? error.message : t("하위 작업을 추가하지 못했습니다.")); }
    finally { setBusy(false); }
  }

  async function toggleSubtask(subtask: Subtask, done: boolean) {
    setDetail((current) => current ? { ...current, subtasks: current.subtasks.map((item) => item.id === subtask.id ? { ...item, done: done ? 1 : 0 } : item) } : current);
    const response = await fetch(`/api/tasks/${task.id}/subtasks`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subtaskId: subtask.id, done }),
    });
    if (!response.ok) { onNotice('하위 작업을 수정하지 못했습니다.'); void load(); }
  }

  async function removeSubtask(subtask: Subtask) {
    setDetail((current) => current ? { ...current, subtasks: current.subtasks.filter((item) => item.id !== subtask.id) } : current);
    const response = await fetch(`/api/tasks/${task.id}/subtasks?subtaskId=${subtask.id}`, { method: 'DELETE' });
    if (!response.ok) { onNotice('하위 작업을 삭제하지 못했습니다.'); void load(); }
  }

  async function addComment() {
    const trimmed = commentDraft.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/tasks/${task.id}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: trimmed }),
      });
      const data = await response.json() as { comment?: TaskComment; error?: string };
      if (!response.ok || !data.comment) throw new Error(data.error || t("댓글을 남기지 못했습니다."));
      setDetail((current) => current ? { ...current, comments: [...current.comments, data.comment as TaskComment] } : current);
      setCommentDraft('');
    } catch (error) { onNotice(error instanceof Error ? error.message : t("댓글을 남기지 못했습니다.")); }
    finally { setBusy(false); }
  }

  const doneCount = detail?.subtasks.filter((item) => item.done).length ?? 0;

  return <Dialog open onOpenChange={(open) => !open && onClose()}>
    <DialogContent className="task-detail-dialog">
      <DialogHeader className="task-detail-header">
        <DialogTitle>
          <input
            className="task-detail-title" value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={() => { const next = titleDraft.trim(); if (next && next !== task.title) void onPatch({ title: next }); }}
            aria-label={t("업무 이름")}
          />
        </DialogTitle>
        <DialogDescription>{project.name} · {task.label}</DialogDescription>
      </DialogHeader>

      <div className="task-detail-body">
        <dl className="task-detail-meta">
          <div><dt><UserRound size={13} /> {t("담당자")}</dt><dd>
            <NativeSelect value={task.owner} onChange={(event) => void onPatch({ owner: event.target.value })}>
              {agents.map((agent) => <NativeSelectOption key={agent.id} value={agent.name}>{agent.name} · {t(agent.role)}</NativeSelectOption>)}
            </NativeSelect>
          </dd></div>
          <div><dt><Flag size={13} /> {t("중요도")}</dt><dd>
            <NativeSelect value={toPriority(task.priority)} onChange={(event) => void onPatch({ priority: event.target.value })}>
              {PRIORITIES.map((option) => <NativeSelectOption key={option} value={option}>{t(option)}</NativeSelectOption>)}
            </NativeSelect>
          </dd></div>
          <div><dt><ShieldCheck size={13} /> {t("상태")}</dt><dd>
            {/* 상태는 에이전트의 진행에 따라 바뀝니다 — 사람이 직접 옮기지 않습니다. */}
            <span className={`board-chip ${task.status === '진행 중' ? 'doing' : task.status === '검토' ? 'review' : ''}`}>{t(task.status)}</span>
          </dd></div>
          <div><dt><BriefcaseBusiness size={13} /> {t("분류")}</dt><dd>
            <input className="task-field-input" defaultValue={task.label}
              onBlur={(event) => { const next = event.target.value.trim(); if (next && next !== task.label) void onPatch({ label: next }); }} />
          </dd></div>
        </dl>

        <section className="task-detail-section">
          <header>
            <h3>{t("사용자 지정 필드")}</h3>
            <button className="task-detail-add" onClick={onManageFields}><Plus size={13} /> {t("필드 추가")}</button>
          </header>
          {fields.length
            ? <dl className="task-detail-fields">{fields.map((field) => <div key={field.id}>
                <dt>{field.name}{field.createdBy !== 'user' && <em title={tf("{0} 이(가) 만든 필드", field.createdBy)}><Sparkles size={10} /> {field.createdBy}</em>}</dt>
                <dd><FieldInput
                  field={field}
                  value={detail?.values[field.id] ?? values?.[field.id] ?? ''}
                  onChange={(next) => { setFieldValue(field.id, next); void saveDetail({ values: { [field.id]: next } }); }}
                /></dd>
              </div>)}</dl>
            : <p className="detail-empty">{t("아직 필드가 없습니다. 이 프로젝트의 업무가 공통으로 추적할 항목을 만들어 보세요.")}</p>}
        </section>

        <section className="task-detail-section">
          <header><h3>{t("설명")}</h3></header>
          <textarea
            className="task-detail-description" value={description} placeholder={t("이 업무의 배경과 완료 조건을 적어 주세요.")}
            onChange={(event) => setDescription(event.target.value)}
            onBlur={() => { if (description !== (detail?.task.description ?? '')) void saveDetail({ description }); }}
          />
        </section>

        <section className="task-detail-section">
          <header><h3>{t("하위 작업")} <em>{doneCount}/{detail?.subtasks.length ?? 0}</em></h3></header>
          <ul className="task-subtasks">
            {detail?.subtasks.map((subtask) => <li key={subtask.id} className={subtask.done ? 'done' : ''}>
              <Checkbox checked={Boolean(subtask.done)} onCheckedChange={(checked) => void toggleSubtask(subtask, Boolean(checked))} />
              <span>{subtask.title}</span>
              {subtask.owner && <b>{subtask.owner}</b>}
              <button onClick={() => void removeSubtask(subtask)} aria-label={tf("{0} 삭제", subtask.title)}><Trash2 size={12} /></button>
            </li>)}
          </ul>
          <div className="task-inline-add">
            <input value={subtaskDraft} placeholder={t("하위 작업 추가")} onChange={(event) => setSubtaskDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void addSubtask(); } }} />
            <button disabled={!subtaskDraft.trim() || busy} onClick={() => void addSubtask()}><CirclePlus size={14} /></button>
          </div>
        </section>

        {task.result && <section className="task-detail-section">
          <header><h3>{task.owner}{t("의 실행 결과")}</h3></header>
          <div className="agent-result"><Markdown text={task.result} /></div>
        </section>}

        <section className="task-detail-section">
          <header><h3>{t("실행 · 검토")} <ReviewBadge verdict={detail?.task.reviewVerdict ?? task.reviewVerdict} blockedReason={detail?.task.blockedReason ?? task.blockedReason} /></h3></header>
          {(detail?.task.blockedReason ?? task.blockedReason) && <p className="gov-banner"><span><strong>{t("진행 불가")}</strong> — {detail?.task.blockedReason ?? task.blockedReason}</span></p>}
          <ReviewActions taskId={task.id} hasResult={Boolean(detail?.task.result ?? task.result)} onNotice={onNotice} onDone={() => { void load(); void onRefresh?.(); }} />
        </section>

        <section className="task-detail-section">
          <header><h3>{t("댓글")}</h3></header>
          <ul className="task-comments">
            {detail?.comments.map((comment) => <li key={comment.id}>
              <span className={comment.authorKind === 'agent' ? 'comment-avatar agent' : 'comment-avatar'}>{comment.author.slice(0, 1)}</span>
              <div>
                <b>{comment.author}{comment.authorKind === 'agent' && <em><Bot size={10} /> {t("에이전트")}</em>}</b>
                {isReviewComment(comment.content) ? <ReviewComment content={comment.content} /> : <p>{comment.content}</p>}
              </div>
            </li>)}
            {!detail?.comments.length && <li className="detail-empty">{t("아직 댓글이 없습니다.")}</li>}
          </ul>
          <div className="task-inline-add">
            <input value={commentDraft} placeholder={t("댓글 추가")} onChange={(event) => setCommentDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void addComment(); } }} />
            <button disabled={!commentDraft.trim() || busy} onClick={() => void addComment()}><Send size={14} /></button>
          </div>
        </section>
      </div>

      <DialogFooter className="task-detail-footer">
        <button className="task-detail-delete" onClick={() => void onDelete()}><Trash2 size={13} /> {t("업무 삭제")}</button>
        <DialogClose render={<Button variant="outline" />}>{t("닫기")}</DialogClose>
        <Button onClick={onChat}><MessageSquare size={14} /> {task.owner}{t("와 대화하기")}</Button>
      </DialogFooter>

    </DialogContent>
  </Dialog>;
}

/** 프로젝트 커스텀 필드 정의 관리. 여기서 만든 필드는 모든 업무 상세에 나타납니다. */
function FieldManagerDialog({ open, onOpenChange, projectId, fields, onChanged, onNotice }: {
  open: boolean; onOpenChange: (open: boolean) => void; projectId: string; fields: ProjectField[];
  onChanged: () => Promise<void>; onNotice: (message: string) => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<FieldType>('text');
  const [options, setOptions] = useState('');
  const [showOnCard, setShowOnCard] = useState(false);
  const [saving, setSaving] = useState(false);

  async function createField() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/fields`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(), type, showOnCard,
          options: type === 'select' ? options.split(',').map((item) => item.trim()).filter(Boolean) : [],
        }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || t("필드를 만들지 못했습니다."));
      setName(''); setOptions(''); setShowOnCard(false); setType('text');
      await onChanged();
      onNotice('사용자 지정 필드를 추가했습니다.');
    } catch (error) { onNotice(error instanceof Error ? error.message : t("필드를 만들지 못했습니다.")); }
    finally { setSaving(false); }
  }

  async function removeField(field: ProjectField) {
    const response = await fetch(`/api/projects/${projectId}/fields?fieldId=${field.id}`, { method: 'DELETE' });
    if (!response.ok) { onNotice('필드를 삭제하지 못했습니다.'); return; }
    await onChanged();
    onNotice(tf("'{0}' 필드를 삭제했습니다.", field.name));
  }

  async function toggleCard(field: ProjectField, next: boolean) {
    const response = await fetch(`/api/projects/${projectId}/fields`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fieldId: field.id, showOnCard: next }),
    });
    if (!response.ok) { onNotice('필드를 수정하지 못했습니다.'); return; }
    await onChanged();
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="create-entity-dialog field-dialog">
      <DialogHeader>
        <DialogTitle>{t("사용자 지정 필드")}</DialogTitle>
        <DialogDescription>{t("이 프로젝트의 모든 업무가 공유합니다. 에이전트도 실행 중에 필드를 만들 수 있습니다.")}</DialogDescription>
      </DialogHeader>

      <ul className="field-list">
        {fields.map((field) => <li key={field.id}>
          <div>
            <b>{field.name}</b>
            <small>{t(FIELD_TYPE_LABELS[field.type])}{field.type === 'select' && field.options.length ? ` · ${field.options.join(' / ')}` : ''}{field.createdBy !== 'user' ? tf(" · {0} 생성", field.createdBy) : ''}</small>
          </div>
          <span className="field-card-toggle" title={t("보드 카드에 배지로 표시")}>
            <Switch checked={Boolean(field.showOnCard)} aria-label={tf("{0} 카드 표시", field.name)} onCheckedChange={(checked) => void toggleCard(field, Boolean(checked))} />
            <span>{t("카드 표시")}</span>
          </span>
          <button onClick={() => void removeField(field)} aria-label={tf("{0} 삭제", field.name)}><Trash2 size={13} /></button>
        </li>)}
        {!fields.length && <li className="detail-empty">{t("아직 만든 필드가 없습니다.")}</li>}
      </ul>

      <div className="entity-row">
        <label className="entity-field"><span>{t("필드 이름")}</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("예: 리스크 등급")} /></label>
        <label className="entity-field"><span>{t("유형")}</span>
          <NativeSelect value={type} onChange={(event) => setType(event.target.value as FieldType)}>
            {FIELD_TYPES.map((option) => <NativeSelectOption key={option} value={option}>{t(FIELD_TYPE_LABELS[option])}</NativeSelectOption>)}
          </NativeSelect>
        </label>
      </div>
      {type === 'select' && <label className="entity-field"><span>{t("옵션 (쉼표로 구분)")}</span>
        <input value={options} onChange={(event) => setOptions(event.target.value)} data-tab-example={t("높음, 보통, 낮음")} placeholder={t("높음, 보통, 낮음")} />
      </label>}
      <span className="field-card-toggle standalone">
        <Switch checked={showOnCard} aria-label={t("보드 카드에 배지로 표시")} onCheckedChange={(checked) => setShowOnCard(Boolean(checked))} />
        <span>{t("보드 카드에 배지로 표시")}</span>
      </span>

      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>{t("닫기")}</DialogClose>
        <Button disabled={!name.trim() || saving} onClick={() => void createField()}>{saving ? t("추가 중") : t("필드 추가")}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
const ALL_ROLES = '전체';
const MANAGER_ROLE = '프로젝트 매니저';

/** 프로젝트 하나와 그 프로젝트에 속한 에이전트들. id 가 없으면 '프로젝트 미지정' 묶음입니다. */
type AgentGroup = { id: string | null; name: string; color: string; agents: Agent[] };

function AgentsView({ agents, projects, assignments, defaultModel, onCreated, onNotice, onOpenChat }: { agents: Agent[]; projects: Project[]; assignments: Assignment[]; defaultModel: string; onCreated: () => Promise<void>; onNotice: (message: string) => void; onOpenChat?: (target: Omit<ChatTarget, 'key'>) => void }) {
  // '에이전트 설정' 다이얼로그 상태. editing 이 있으면 열립니다.
  const [editing, setEditing] = useState<Agent | null>(null);
  const [draft, setDraft] = useState({ model: '', role: '', description: '', instructions: '' });
  const [updating, setUpdating] = useState(false);
  // 상단 역할 필터. 에이전트가 늘어나면 역할(프로젝트 매니저·엔지니어·QA…)로 좁혀 봅니다.
  const [roleFilter, setRoleFilter] = useState(ALL_ROLES);
  // 모델 미지정 에이전트에 표시할 이름 — 서버가 알려준 기본 모델을 사람이 읽는 이름으로 바꿉니다.
  const defaultModelName = agentModelLabel(defaultModel) ?? defaultModel;
  const [layout, setLayout] = useState<ProjectLayout>('card');

  // 마지막으로 고른 보기 방식을 브라우저에 기억해 둡니다.
  useEffect(() => {
    // oxlint-disable-next-line react/react-compiler -- 브라우저에서만 읽을 수 있는 저장값입니다.
    try { const stored = window.localStorage.getItem(AGENT_VIEW_KEY); if (stored === 'card' || stored === 'list') setLayout(stored); } catch { /* 저장소 접근 불가 시 기본값 유지 */ }
  }, []);
  const changeLayout = useCallback((next: ProjectLayout) => {
    setLayout(next);
    try { window.localStorage.setItem(AGENT_VIEW_KEY, next); } catch { /* 저장 실패는 무시 */ }
  }, []);

  const roleOptions = useMemo(
    () => Array.from(new Set(agents.map((agent) => agent.role.trim()).filter(Boolean)))
      // 프로젝트 매니저를 '전체' 바로 다음에 두고, 나머지는 가나다순으로 둡니다.
      .sort((a, b) => (a === MANAGER_ROLE ? -1 : b === MANAGER_ROLE ? 1 : a.localeCompare(b, 'ko'))),
    [agents],
  );

  // 고른 역할의 에이전트가 모두 사라져도 목록이 비지 않도록, 실제 적용 값은 계산해서 씁니다.
  const activeRole = roleFilter !== ALL_ROLES && roleOptions.includes(roleFilter) ? roleFilter : ALL_ROLES;

  const visibleAgents = useMemo(
    () => (activeRole === ALL_ROLES ? agents : agents.filter((agent) => agent.role.trim() === activeRole)),
    [agents, activeRole],
  );

  /** 에이전트가 참여 중인 프로젝트 id 목록. 소속(projectId)을 앞에 두고 합류(assignments)를 뒤에 붙입니다. */
  const memberships = useCallback((agent: Agent) => {
    const ids = agent.projectId ? [agent.projectId] : [];
    for (const item of assignments) {
      if (item.agentId === agent.id && !ids.includes(item.projectId)) ids.push(item.projectId);
    }
    return ids;
  }, [assignments]);

  /**
   * 프로젝트별로 묶습니다. 한 에이전트가 여러 프로젝트에 걸쳐 있어도 목록이 중복되지 않도록
   * 첫 번째 프로젝트(소속)에만 놓고, 나머지는 카드에 '외 N개 프로젝트' 로 알려 줍니다.
   */
  const groups = useMemo<AgentGroup[]>(() => {
    const bucket = new Map<string, Agent[]>();
    const loose: Agent[] = [];
    for (const agent of visibleAgents) {
      const home = memberships(agent)[0];
      if (!home) { loose.push(agent); continue; }
      const list = bucket.get(home);
      if (list) list.push(agent); else bucket.set(home, [agent]);
    }
    // 매니저를 맨 앞에, 나머지는 이름순으로 둡니다.
    const order = (list: Agent[]) => [...list].sort((a, b) =>
      (b.isManager ? 1 : 0) - (a.isManager ? 1 : 0) || a.name.localeCompare(b.name, 'ko'));
    const result: AgentGroup[] = projects
      .filter((project) => bucket.has(project.id))
      .map((project) => ({ id: project.id, name: project.name, color: project.color, agents: order(bucket.get(project.id) ?? []) }));
    // 목록에 없는 프로젝트(삭제 직후 등)에 붙어 있던 에이전트도 흘리지 않습니다.
    for (const [id, list] of bucket) {
      if (!projects.some((project) => project.id === id)) result.push({ id, name: t('프로젝트 미지정'), color: 'var(--c-surface-tertiary)', agents: order(list) });
    }
    if (loose.length) result.push({ id: null, name: t('프로젝트 미지정'), color: 'var(--c-surface-tertiary)', agents: order(loose) });
    return result;
  }, [visibleAgents, projects, memberships]);

  const openSettings = useCallback((agent: Agent) => {
    setEditing(agent);
    setDraft({ model: agent.model ?? '', role: agent.role, description: agent.description, instructions: agent.instructions });
  }, []);

  async function saveAgent() {
    if (!editing || !draft.role.trim() || !draft.instructions.trim()) return;
    setUpdating(true);
    try {
      const response = await fetch('/api/agents', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editing.id, model: draft.model, role: draft.role.trim(), description: draft.description.trim(), instructions: draft.instructions.trim() }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || t("에이전트를 수정하지 못했습니다."));
      const saved = editing;
      setEditing(null); await onCreated();
      onNotice(tf("{0} 설정을 저장했습니다.", saved.name));
    } catch (error) { onNotice(error instanceof Error ? error.message : t("에이전트를 수정하지 못했습니다.")); }
    finally { setUpdating(false); }
  }

  const settingsDialog = <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open) setEditing(null); }}>
    <DialogContent className="create-entity-dialog agent-settings-dialog">
      <DialogHeader>
        <DialogTitle>{editing?.name} {t("설정")}</DialogTitle>
        <DialogDescription>{t("이 에이전트가 쓸 AI 모델과 역할을 바꿉니다. 이름은 업무 담당자로 참조되고 있어 변경할 수 없습니다.")}</DialogDescription>
      </DialogHeader>
      <label className="entity-field">
        <span>{t("AI 모델")}</span>
        <NativeSelect value={draft.model} onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))}>
          <NativeSelectOption value="">{tf("기본 모델 사용 ({0})", defaultModelName)}</NativeSelectOption>
          {AGENT_MODELS.map((option) => <NativeSelectOption key={option.id} value={option.id}>{option.label} · {t(option.hint)}</NativeSelectOption>)}
        </NativeSelect>
        <small className="entity-hint">{t("업무 실행과 대화 모두 이 모델로 호출합니다. 사용량·비용은 &lsquo;사용량&rsquo; 화면에 모델별로 쌓입니다.")}</small>
      </label>
      <label className="entity-field"><span>{t("역할")}</span><input value={draft.role} onChange={(event) => setDraft((current) => ({ ...current, role: event.target.value }))} placeholder={t("예: 데이터 분석가")} /></label>
      <label className="entity-field"><span>{t("역할 설명")}</span><textarea value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder={t("이 에이전트가 잘해야 하는 일")} /></label>
      <label className="entity-field">
        <span>{t("실행 지침")}</span>
        <textarea className="entity-instructions" value={draft.instructions} onChange={(event) => setDraft((current) => ({ ...current, instructions: event.target.value }))} placeholder={t("이 에이전트가 항상 지켜야 할 작업 방식")} />
        <small className="entity-hint">{t("에이전트가 업무와 대화에서 따를 기본 지침입니다.")}</small>
      </label>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>{t("취소")}</DialogClose>
        <Button disabled={!draft.role.trim() || !draft.instructions.trim() || updating} onClick={saveAgent}>{updating ? t("저장 중") : t("설정 저장")}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;

  /** 대화는 프로젝트 단위라, 소속 프로젝트(없으면 참여 중인 첫 프로젝트)를 찾아서 넘깁니다. */
  const chatProjectId = useCallback((agent: Agent) => memberships(agent)[0] ?? '', [memberships]);

  const openAgentChat = useCallback((agent: Agent) => {
    const projectId = chatProjectId(agent);
    if (!projectId) { onNotice(tf("{0} 은(는) 아직 참여 중인 프로젝트가 없어 대화를 열 수 없습니다.", agent.name)); return; }
    onOpenChat?.({ projectId, agentName: agent.name, draft: '' });
  }, [chatProjectId, onNotice, onOpenChat]);

  const roleSwitch = roleOptions.length > 1
    ? <fieldset className="view-switch small" aria-label={t("역할 필터")}>
        <button className={activeRole === ALL_ROLES ? 'selected' : ''} onClick={() => setRoleFilter(ALL_ROLES)}>{t("전체")}</button>
        {roleOptions.map((role) => (
          <button className={activeRole === role ? 'selected' : ''} key={role} onClick={() => setRoleFilter(role)}>{t(role)}</button>
        ))}
      </fieldset>
    : null;

  const layoutToggle = <fieldset className="layout-toggle" aria-label={t("에이전트 보기 방식")}>
    <button className={layout === 'card' ? 'active' : ''} aria-pressed={layout === 'card'} onClick={() => changeLayout('card')} title={t("카드 보기")} type="button"><LayoutGrid size={15} /> {t("카드")}</button>
    <button className={layout === 'list' ? 'active' : ''} aria-pressed={layout === 'list'} onClick={() => changeLayout('list')} title={t("리스트 보기")} type="button"><List size={15} /> {t("리스트")}</button>
  </fieldset>;

  const action = <div className="view-actions">{roleSwitch}{agents.length > 0 && layoutToggle}</div>;

  /** 다른 프로젝트에도 걸쳐 있으면 카드·행에 그 사실을 한 줄로 덧붙입니다. */
  const alsoIn = (agent: Agent) => {
    const extra = memberships(agent).length - 1;
    return extra > 0 ? tf("외 {0}개 프로젝트 참여", extra) : null;
  };

  const modelTag = (agent: Agent) => <span className="agent-model-tag" title={agent.model ? tf("이 에이전트는 {0} 로 실행됩니다.", agent.model) : tf("모델을 따로 고르지 않아 기본 모델 {0} 로 실행됩니다.", defaultModel)}><Cpu size={12} />{agentModelLabel(agent.model) ?? defaultModelName}</span>;

  const chatButton = (agent: Agent) => <button className="agent-profile-chat" onClick={() => openAgentChat(agent)} disabled={!chatProjectId(agent)}
    title={chatProjectId(agent) ? tf("{0} 와(과) 대화하기", agent.name) : t("참여 중인 프로젝트가 없어 대화를 열 수 없습니다.")}><MessageSquare size={13} /> {t("대화하기")}</button>;

  const agentCard = (agent: Agent) => <article className={agent.isManager ? 'agent-profile manager is-clickable' : 'agent-profile is-clickable'} key={agent.id}>
    <button className="open-overlay" tabIndex={-1} aria-hidden="true" onClick={() => openSettings(agent)} />
    <div className="agent-profile-head">
      <span style={{ background: agent.color }}>{agent.name[0]}</span>
      <div><h2>{agent.name}</h2><p>{t(agent.role)}</p></div>
      {Boolean(agent.isManager) && <em><Sparkles size={11} /> {t("매니저")}</em>}
    </div>
    <p className="agent-description">{agent.description}</p>
    <div className="agent-model-line">{modelTag(agent)}</div>
    {alsoIn(agent) && <div className="agent-capability"><Check size={13} />{alsoIn(agent)}</div>}
    <div className="agent-profile-actions">
      {chatButton(agent)}
      <button className="agent-profile-open" onClick={() => openSettings(agent)} aria-label={tf("{0} 에이전트 설정 열기", agent.name)}>{t("에이전트 설정")} <ChevronRight size={15} /></button>
    </div>
  </article>;

  // 표 모양이지만 실제로는 '한 줄에 에이전트 하나' 목록이라 ARIA table 역할은 붙이지 않습니다.
  const agentTable = (group: AgentGroup) => <ul className="agent-table" aria-label={t("에이전트 목록")}>
    <li className="agent-row head" aria-hidden="true">
      <span>{t("에이전트")}</span>
      <span>{t("역할")}</span>
      <span>{t("모델")}</span>
      <span />
    </li>
    {group.agents.map((agent) => <li className="agent-row is-clickable" key={agent.id}>
      <button className="open-overlay" onClick={() => openSettings(agent)} aria-label={tf("{0} 에이전트 설정 열기", agent.name)} />
      <span className="agent-row-main">
        <i className="agent-row-avatar" style={{ background: agent.color }}>{agent.name[0]}</i>
        <b>{agent.name}{Boolean(agent.isManager) && <em className="agent-row-badge"><Sparkles size={10} /> {t("매니저")}</em>}</b>
        <small>{agent.description || alsoIn(agent) || t("역할 설명이 없습니다.")}</small>
      </span>
      <span className="agent-row-role">{t(agent.role)}</span>
      <span>{modelTag(agent)}</span>
      <span className="agent-row-tools">
        {chatButton(agent)}
        <button className="project-row-open" onClick={() => openSettings(agent)}>{t("설정")} <ChevronRight size={15} /></button>
      </span>
    </li>)}
  </ul>;

  return <div className="workspace-view"><ViewHeading eyebrow="Agent Library" title={t("에이전트")} description={t("프로젝트마다 전담 매니저가 있고, 나머지 팀원은 매니저가 필요할 때 합류시킵니다.")} action={action} />
    {agents.length
      ? groups.length
        ? <div className="agent-groups">{groups.map((group) => <section className="agent-group" key={group.id ?? 'unassigned'}>
            <div className="agent-group-head">
              <span className="agent-group-mark" style={{ background: group.color }}>{group.id ? <FolderKanban size={14} /> : <Users size={14} />}</span>
              <b>{group.name}</b>
              <small>{group.agents.length === 1 ? t("1명") : tf("{0}명", group.agents.length)}</small>
            </div>
            {layout === 'card'
              ? <div className="agent-library">{group.agents.map(agentCard)}</div>
              : agentTable(group)}
          </section>)}</div>
        : <div className="entity-empty"><Users size={30} /><h2>{t(activeRole)} {t("역할의 에이전트가 없어요")}</h2><p>{t("다른 역할을 골라 보거나 &lsquo;전체&rsquo; 로 돌아가세요.")}</p></div>
      : <div className="entity-empty"><CirclePlus size={30} /><h2>{t("아직 에이전트가 없어요")}</h2><p>{t("프로젝트를 만들면 그 프로젝트의 전담 매니저가 함께 생깁니다.")}</p></div>}
    <div className="agent-template-note"><ShieldCheck size={20} /><div><strong>{t("매니저가 팀을 꾸립니다")}</strong><p>{t("업무를 지시하면 매니저가 직무 카탈로그(리서처·마케터·엔지니어·데이터 분석가 등)에서 필요한 사람을 합류시키고, 맡기고, 보고를 검토합니다.")}</p></div></div>
    {settingsDialog}
  </div>;
}

/**
 * 매니저가 대화 중에 팀을 꾸리고 업무를 맡기는 과정을 한 줄씩 쌓아 보여줍니다.
 * 위임 한 건은 하위 에이전트를 실제로 돌리는 것이라 수십 초가 걸려서,
 * 시작(running)과 결과(completed/blocked)를 나눠 표시합니다.
 */
/**
 * 대화 사이드바의 에이전트 상태 점.
 * running(녹색 깜빡임) 업무 진행 중 · done(녹색) 결과가 검토 대기 중 · failed(빨강 깜빡임) 진행 불가/실패 · idle(회색 테두리) 맡은 일 없음.
 */
type Presence = 'running' | 'done' | 'failed' | 'idle' | 'complete';
const PRESENCE_LABEL: Record<Presence, string> = { running: '업무 진행 중', done: '결과 검토 대기', failed: '진행 불가 — 확인 필요', idle: '대기 중', complete: '임무 완료' };
function agentPresence(name: string, tasks: ProjectTask[], busy: boolean): Presence {
  const mine = tasks.filter((task) => task.owner === name);
  if (mine.some((task) => task.blockedReason && task.status !== '검토')) return 'failed';
  if (busy || mine.some((task) => task.status === '진행 중')) return 'running';
  if (mine.some((task) => task.status === '검토')) return 'done';
  return 'idle';
}
/** 매니저는 팀 전체를 봅니다 — 팀원 중 하나라도 진행 중이면 진행, 막힌 팀원이 있으면 실패, 맡긴 일이 전부 검토 단계에 이르렀으면 임무 완료(녹색 체크). */
function managerPresence(tasks: ProjectTask[], sending: boolean, teammatesBusy: boolean): Presence {
  if (tasks.some((task) => task.blockedReason && task.status !== '검토')) return 'failed';
  if (sending || teammatesBusy || tasks.some((task) => task.status === '진행 중')) return 'running';
  if (tasks.length && tasks.every((task) => task.status === '검토')) return 'complete';
  if (tasks.some((task) => task.status === '검토')) return 'done';
  return 'idle';
}

type ManagerStep =
  | { id: string; kind: 'recruited'; agent: string; role: string }
  | { id: string; kind: 'delegate'; agent: string; role: string; title: string; state: 'running' | 'completed' | 'blocked'; summary?: string; taskId?: string };

/** 스트리밍 중 표시할 도구별 진행 문구 */
const CHAT_TOOL_LABELS: Record<string, string> = {
  recall_history: '과거 기록을 찾는 중…',
  memory: '기억을 정리하는 중…',
  use_skill: '스킬 문서를 읽는 중…',
  recruit_agent: '필요한 에이전트를 합류시키는 중…',
  delegate_task: '팀원에게 업무를 맡기는 중…',
  read_task_result: '팀원 결과 전문을 읽는 중…',
  create_task: '업무 카드를 만드는 중…',
};

function ChatView({ projects, agents, assignments, onNotice, onRefresh, initial, visible = true, onOpenProject }: { projects: Project[]; agents: Agent[]; assignments: Assignment[]; onNotice: (message: string) => void; onRefresh: () => Promise<void>; initial?: ChatTarget | null; visible?: boolean; onOpenProject?: (projectId: string, taskId?: string) => void }) {
  // 업무 카드에서 '대화하기' 로 들어오면 그 문맥으로 시작합니다 (WorkspaceView 가 key 를 바꿔 새로 마운트합니다).
  const [projectId, setProjectId] = useState(initial?.projectId || projects[0]?.id || '');
  const aiFiles = useAIFileChanges(projectId);
  const availableAgents = useMemo(() => agents.filter((agent) => assignments.some((item) => item.projectId === projectId && item.agentId === agent.id)), [agents, assignments, projectId]);
  const [agentId, setAgentId] = useState('');
  // 업무 카드에서 '대화하기' 로 들어오면 그 업무의 담당자를 이름으로 먼저 잡아 둡니다 (에이전트 목록이 늦게 와도 안전).
  const [wantedAgent, setWantedAgent] = useState(initial?.agentName ?? '');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // 압축된 이전 대화 요약 (lib/compaction). 있으면 메시지 목록 위에 접힌 배너로 보여 줍니다.
  const [summary, setSummary] = useState<ChatSummaryInfo | null>(null);
  const [draft, setDraft] = useState('');
  // 답변 진행 중에 보낸 메시지 — 이번 답변이 끝나면 순서대로 전송됩니다. ref 는 finally 안에서 최신 값을 읽기 위한 것.
  const [queued, setQueued] = useState<{ id: string; text: string; attachments: ChatAttachment[] }[]>([]);
  const queueRef = useRef<{ id: string; text: string; attachments: ChatAttachment[] }[]>([]);
  const sendingRef = useRef(false);
  // 대화에서 위임돼 백그라운드로 도는 팀원 실행. 끝나면 매니저 대화에 '📥 보고' 가 도착하고 목록에서 빠집니다.
  const [background, setBackground] = useState<{ taskId: string; agent: string; title: string }[]>([]);
  const [messageReload, setMessageReload] = useState(0);
  // '대화하기'·업무 목록에서 넘어온 제안 문장. 입력란에 회색(placeholder)으로만 보이고, 사용자가 아무것도 안 적고 보내면 이 문장이 나갑니다.
  const [suggestion, setSuggestion] = useState(initial?.draft ?? '');
  const [sending, setSending] = useState(false);
  const appliedTarget = useRef(initial?.key);
  // Keep an active stream alive; apply a requested conversation after it finishes.
  useEffect(() => {
    if (!initial || initial.key === appliedTarget.current || sending) return;
    appliedTarget.current = initial.key;
    setProjectId(initial.projectId); setAgentId(''); setWantedAgent(initial.agentName ?? '');
    setDraft(''); setSuggestion(initial.draft ?? '');
  }, [initial, sending]);

  const [streamText, setStreamText] = useState('');
  const [toolNote, setToolNote] = useState('');
  const [steps, setSteps] = useState<ManagerStep[]>([]);
  // 사이드바에 띄우는 이 프로젝트의 업무. 대화 중 매니저가 카드를 만들거나 끝내면 다시 읽습니다.
  const [boardTasks, setBoardTasks] = useState<ProjectTask[]>([]);
  // 이번 턴에만 함께 보낼 첨부 파일 (보관하지 않습니다 — lib/attachments 주석 참고).
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 이 대화에서 에이전트에게 허용할 자율도.
  const [autonomy, setAutonomy] = useState<Autonomy>(DEFAULT_AUTONOMY);
  // 대화창 아래에서 바로 관리하는 이 프로젝트의 작업 폴더.
  const [folders, setFolders] = useState<ProjectFolder[]>([]);
  const [folderBusy, setFolderBusy] = useState(false);
  const pickerReady = useFolderPicker();
  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const wanted = wantedAgent ? availableAgents.find((agent) => agent.name === wantedAgent) : undefined;
  const selectedAgentId = wanted?.id || (availableAgents.some((agent) => agent.id === agentId) ? agentId : availableAgents[0]?.id || '');
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);

  const loadBoardTasks = useCallback(() => {
    if (!projectId) return;
    fetch(`/api/tasks?projectId=${encodeURIComponent(projectId)}`)
      .then(async (response) => await response.json() as { tasks?: ProjectTask[] })
      .then((data) => setBoardTasks(data.tasks || []))
      .catch(() => { /* 업무 목록은 보조 정보라 실패해도 대화를 막지 않습니다. */ });
  }, [projectId]);

  useEffect(() => { loadBoardTasks(); }, [loadBoardTasks]);
  // 상태 점이 실시간에 가깝게 따라가도록, 화면이 보이는 동안 8초마다 업무를 다시 읽습니다.
  useEffect(() => {
    if (!visible || !projectId) return;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') loadBoardTasks(); }, 8_000);
    return () => clearInterval(timer);
  }, [visible, projectId, loadBoardTasks]);

  const loadFolders = useCallback(() => {
    if (!projectId) return;
    fetchProjectFolders(projectId).then(setFolders).catch(() => setFolders([]));
  }, [projectId]);

  useEffect(() => { loadFolders(); }, [loadFolders]);

  useEffect(() => {
    let stored: string | null = null;
    try { stored = window.localStorage.getItem(CHAT_AUTONOMY_KEY); } catch { /* 저장소 접근 불가 시 기본값 유지 */ }
    if (!isAutonomy(stored)) return;
    // oxlint-disable-next-line react/react-compiler -- 브라우저에서만 읽을 수 있는 저장값이라 마운트 후에 한 번 반영합니다.
    setAutonomy(stored);
  }, []);

  /** 대화창의 '폴더 추가' — 프로젝트 상세의 작업 폴더와 같은 목록을 씁니다. */
  async function addChatFolder() {
    if (!projectId || folderBusy) return;
    setFolderBusy(true);
    try {
      const handle = await pickDirectory();
      if (!handle) return;
      const { files } = await scanDirectory(handle);
      const response = await fetch(`/api/projects/${projectId}/folders`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: handle.name, pathHint: handle.name, fileCount: files.length }),
      });
      const data = await response.json() as { folder?: ProjectFolder; error?: string };
      if (!response.ok || !data.folder) throw new Error(data.error || t("폴더를 연결하지 못했습니다."));
      await saveHandle(data.folder.id, handle);
      loadFolders();
      onNotice(tf("'{0}' 폴더를 연결했습니다 (파일 {1}개).", handle.name, files.length));
    } catch (error) { onNotice(error instanceof Error ? error.message : t("폴더를 연결하지 못했습니다.")); }
    finally { setFolderBusy(false); }
  }

  /** '+' 로 고른 파일을 첨부 목록에 담습니다. 형식·크기가 안 맞으면 그 파일만 건너뜁니다. */
  async function pickAttachments(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;
    const accepted: ChatAttachment[] = [];
    const skipped: string[] = [];
    let total = attachments.reduce((sum, item) => sum + item.size, 0);
    for (const file of files) {
      if (attachments.length + accepted.length >= MAX_ATTACHMENTS) { skipped.push(file.name); continue; }
      if (total + file.size > MAX_ATTACHMENT_TOTAL_BYTES) { skipped.push(file.name); continue; }
      const result = await readAttachment(file);
      if ('error' in result) { skipped.push(file.name); continue; }
      accepted.push(result.attachment);
      total += file.size;
    }
    if (accepted.length) setAttachments((current) => [...current, ...accepted]);
    if (skipped.length) onNotice(tf("첨부하지 못한 파일: {0}", skipped.join(', ')));
  }

  const removeAttachment = useCallback((key: string) => {
    setAttachments((current) => current.filter((item) => item.key !== key));
  }, []);

  // 다른 창에 다녀오면 그 사이 바뀐 카드를 반영합니다.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== 'visible') return;
      loadBoardTasks();
    }
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [loadBoardTasks]);

  useEffect(() => { if (!projectId || !selectedAgentId) return; let canceled = false; fetch(`/api/chat?projectId=${encodeURIComponent(projectId)}&agentId=${encodeURIComponent(selectedAgentId)}`).then(async (response) => await response.json() as { messages?: ChatMessage[]; summary?: ChatSummaryInfo | null }).then((data) => { if (canceled) return; setMessages(data.messages || []); setSummary(data.summary ?? null); }).catch(() => { if (canceled) return; setMessages([]); setSummary(null); }); return () => { canceled = true; }; }, [projectId, selectedAgentId, messageReload]);

  // 사용자가 위로 스크롤해 지난 대화를 보고 있으면 자동 스크롤을 멈춥니다.
  const handleScroll = useCallback(() => {
    const node = listRef.current;
    if (!node) return;
    pinnedRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
  }, []);

  // 메시지 목록 자체를 스크롤합니다 — scrollIntoView 는 바깥 page-content 까지 끌어올려 입력창을 밀어냈습니다.
  // 'auto' 는 CSS scroll-behavior:smooth 를 따르는데, 렌더가 잦으면 부드러운 스크롤이 시작도 못 하고 취소돼 제자리에 머뭅니다 — 항상 즉시 붙입니다.
  // 말풍선은 렌더 뒤에도 자랍니다(마크다운 파싱·이미지·스트리밍) — 자식 크기 변화를 감시해 바닥에 붙어 있던 동안은 계속 따라갑니다.
  useEffect(() => {
    const node = listRef.current;
    if (!node || !visible) return;
    const pin = () => { if (pinnedRef.current) node.scrollTo({ top: node.scrollHeight, behavior: 'instant' }); };
    pin();
    const observer = new ResizeObserver(pin);
    for (const child of Array.from(node.children)) observer.observe(child);
    return () => observer.disconnect();
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- 숨겨져 있다가 다시 보일 때(높이 0 → 실제 높이) 한 번 더 붙입니다.
  }, [messages, streamText, sending, steps, visible]);

  useEffect(() => { pinnedRef.current = true; }, [projectId, selectedAgentId]);

  // 보고 메시지의 '결과 보기' 링크(#task/<id>) — 새 탭 대신 프로젝트 상세의 그 업무를 엽니다. (마크다운이 만든 <a> 를 위임으로 가로챕니다)
  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest?.('a[href^="#task/"]') as HTMLAnchorElement | null;
      if (!anchor || !projectId) return;
      event.preventDefault();
      onOpenProject?.(projectId, anchor.getAttribute('href')?.slice('#task/'.length));
    };
    node.addEventListener('click', onClick);
    return () => node.removeEventListener('click', onClick);
  }, [projectId, onOpenProject]);

  useEffect(() => {
    const insert = (event: Event) => { if ((event as CustomEvent<string>).detail === 'insert-example' && !sending) { if (draft.trim()) { onNotice(t('입력한 내용이 있습니다. 예시를 참고해 직접 수정하세요.')); return; } setDraft(tutorialExample()); } };
    window.addEventListener('orbit-tutorial', insert);
    return () => window.removeEventListener('orbit-tutorial', insert);
  }, [draft, sending, onNotice]);

  /**
   * 대화에서 위임된 카드를 백그라운드로 실행합니다. 매니저의 답변은 이미 끝나 대화는 열려 있고,
   * 이 요청이 끝나면 서버가 매니저 대화에 '📥 보고' 를 남기므로 메시지를 다시 읽어 보여 줍니다.
   */
  async function startBackgroundRun(taskId: string, agent: string, title: string) {
    setBackground((current) => current.some((item) => item.taskId === taskId) ? current : [...current, { taskId, agent, title }]);
    let outcome: 'completed' | 'blocked' = 'completed';
    let summary = '';
    try {
      const session = await aiFiles.prepare();
      const folderContext = JSON.stringify(session.roots.map(root => ({ folderId: root.id, name: root.name, files: Object.fromEntries(root.originals) })));
      const response = await fetch('/api/agents/run', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ taskId, reportToManager: true, folderContext }),
      });
      const data = await response.json().catch(() => null) as { error?: string; blocked?: boolean; blockedReason?: string | null; summary?: string } | null;
      if (!response.ok) throw new Error(data?.error || t("팀원 실행에 실패했습니다."));
      outcome = data?.blocked ? 'blocked' : 'completed';
      summary = (data?.blocked ? data.blockedReason : data?.summary) || '';
      onNotice(data?.blocked ? tf('{0} 에이전트가 진행 중 문제를 매니저에게 보고했습니다.', agent) : tf('{0} 에이전트가 업무를 완료하고 매니저에게 보고했습니다.', agent));
    } catch (error) {
      outcome = 'blocked';
      summary = error instanceof Error ? error.message : t("팀원 실행에 실패했습니다.");
      onNotice(tf("{0} 실행 실패: {1}", agent, summary));
    } finally {
      setBackground((current) => current.filter((item) => item.taskId !== taskId));
      setSteps((current) => current.map((step) => step.kind === 'delegate' && step.taskId === taskId ? { ...step, state: outcome, summary } : step));
      setMessageReload((value) => value + 1);
      loadBoardTasks();
      void onRefresh();
    }
  }

  /**
   * 답변(위임 포함, 수 분 걸릴 수 있음)이 진행 중이어도 입력은 막지 않습니다.
   * 진행 중에 보낸 메시지는 대기열에 들어갔다가 이번 답변이 끝나면 순서대로 자동 전송됩니다 —
   * 같은 대화에 두 턴을 동시에 돌리면 매니저가 앞 턴의 결과를 못 보고, 크레딧 경로는 동시 실행을 거부하기 때문입니다.
   */
  async function sendMessage(forced?: { text: string; attachments: ChatAttachment[] }) {
    const typed = forced ? forced.text : (draft.trim() || suggestion.trim());
    const sent = forced ? forced.attachments : attachments;
    // 파일만 보내도 되게, 글이 비어 있으면 한 줄을 대신 넣습니다.
    const message = typed || (sent.length ? t("첨부한 파일을 확인해 주세요.") : '');
    if (!message || !selectedAgentId) return;
    if (sendingRef.current) {
      queueRef.current.push({ id: `queued-${Date.now()}-${queueRef.current.length}`, text: message, attachments: sent });
      setQueued([...queueRef.current]);
      setDraft(''); setSuggestion(''); setAttachments([]);
      return;
    }
    tutorialEvent('message-sent');
    sendingRef.current = true;
    setDraft(''); setSuggestion(''); setAttachments([]); setSending(true); setStreamText(''); setToolNote(''); setSteps([]); pinnedRef.current = true;
    const shown = sent.length ? `${message}\n\n📎 ${sent.map((item) => item.name).join(', ')}` : message;
    const optimistic: ChatMessage = { id: `local-${Date.now()}`, role: 'user', content: shown, createdAt: Date.now() };
    setMessages((current) => [...current, optimistic]);
    let boardChanged = false;
    let requestAccepted = false;
    let streamed = "";
    let replyRetained = false;
    let finished = false;
    try {
      // 연결된 폴더가 있으면 브라우저에서 읽어 함께 보냅니다 (서버는 파일시스템에 접근할 수 없습니다).
      const fileSession = await aiFiles.prepare();
      const folderContext = JSON.stringify(fileSession.roots.map(root => ({ folderId: root.id, name: root.name, files: Object.fromEntries(root.originals) })));
      const response = await fetch('/api/chat/stream', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, agentId: selectedAgentId, message, folderContext, writableFolders: fileSession.roots.map(root => root.id), autonomy, attachments: toPayload(sent) }),
      });
      if (!response.ok || !response.body) {
        const failure = await response.json().catch(() => null) as { error?: string; code?: string } | null;
        throw Object.assign(new Error(failure?.error || t("메시지를 보내지 못했습니다.")), { code: failure?.code });
      }
      requestAccepted = true;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      let failure = '';
      let failureCode: string | undefined;
      const consume = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let event: {
          fileChanges?: unknown; type?: string; text?: string; error?: string; code?: string; name?: string; message?: ChatMessage;
          kind?: string; agent?: string; role?: string; title?: string; outcome?: string; summary?: string;
          recruited?: Array<{ name: string; role: string }>; delegated?: Array<{ agent: string; title: string; taskId?: string; outcome?: string }>; createdTasks?: Array<{ title: string }>;
          taskId?: string; delegationMissing?: boolean;
        };
        try { event = JSON.parse(trimmed) as typeof event; } catch { return; }
        if (event.type === 'user' && event.message) {
          const saved = event.message;
          setMessages((current) => [...current.filter((item) => item.id !== optimistic.id), saved]);
        }
        // 매니저 진행: 합류 → 위임 시작 → 보고 도착 순으로 한 줄씩 쌓입니다.
        if (event.type === 'manager') {
          const agent = event.agent ?? t("팀원");
          if (event.kind === 'recruited') {
            onNotice(tf('{0} 에이전트가 {1} 역할로 임명되었습니다.', agent, event.role ?? ''));
            setToolNote('');
            setSteps((current) => [...current, { id: `r-${agent}-${current.length}`, kind: 'recruited', agent, role: event.role ?? '' }]);
          }
          if (event.kind === 'delegate_start') {
            setToolNote('');
            setSteps((current) => [...current, {
              id: `d-${agent}-${current.length}`, kind: 'delegate', agent, role: event.role ?? '', title: event.title ?? '', state: 'running',
            }]);
          }
          if (event.kind === 'delegate_queued') {
            setToolNote('');
            setSteps((current) => [...current, {
              id: `q-${agent}-${current.length}`, kind: 'delegate', agent, role: event.role ?? '', title: event.title ?? '', state: 'running', taskId: event.taskId,
            }]);
          }
          if (event.kind === 'delegate_done') {
            onNotice(event.outcome === 'blocked' ? tf('{0} 에이전트가 진행 중 문제를 매니저에게 보고했습니다.', agent) : tf('{0} 에이전트가 업무를 완료하고 매니저에게 보고했습니다.', agent));
            const state = event.outcome === 'blocked' ? 'blocked' as const : 'completed' as const;
            setSteps((current) => {
              // 같은 담당자의 '진행 중' 항목 중 가장 마지막 것을 결과로 바꿉니다.
              let index = -1;
              for (let i = current.length - 1; i >= 0; i -= 1) {
                const step = current[i];
                if (step.kind === 'delegate' && step.agent === agent && step.state === 'running') { index = i; break; }
              }
              if (index === -1) return current;
              const next = current.slice();
              next[index] = { ...(next[index] as Extract<ManagerStep, { kind: 'delegate' }>), state, summary: event.summary };
              return next;
            });
          }
        }
        if (event.type === 'tool' && event.name) setToolNote(t(CHAT_TOOL_LABELS[event.name] ?? '도구를 쓰는 중…'));
        if (event.type === 'delta' && event.text) {
          streamed += event.text;
          setStreamText(streamed);
          setToolNote('');
        }
        if (event.type === 'partial' && event.message) {
          replyRetained = true;
          const saved = event.message;
          setMessages(current => [...current.filter(item => item.id !== saved.id), saved]);
          setStreamText('');
        }
        if (event.type === 'done' && event.message) {
          finished = true; replyRetained = true;
          aiFiles.receive(fileSession, event.fileChanges);
          window.dispatchEvent(new Event('orbit-approvals-refresh'));
          tutorialEvent('reply-ready');
          const saved = event.message;
          setMessages((current) => [...current.filter(item => item.id !== saved.id), saved]);
          setStreamText(''); setToolNote('');
          // 매니저가 대화 중에 팀을 꾸리거나 카드를 만들었으면 사이드바·보드를 다시 읽습니다.
          const queuedRuns = (event.delegated ?? []).filter((item) => item.outcome === 'queued' && item.taskId);
          for (const item of queuedRuns) void startBackgroundRun(item.taskId as string, item.agent, item.title);
          const notes = [
            event.recruited?.length ? tf("에이전트 {0}명 합류", event.recruited.length) : '',
            queuedRuns.length ? tf("업무 {0}건 위임 — 팀원이 작업 중", queuedRuns.length) : (event.delegated?.length ? tf("업무 {0}건 위임·완료", event.delegated.length) : ''),
            event.createdTasks?.length ? tf("카드 {0}개 생성", event.createdTasks.length) : '',
          ].filter(Boolean);
          if (notes.length) { boardChanged = true; onNotice(notes.join(' · ')); }
          else if (event.delegationMissing) onNotice(t('매니저의 위임이 실제로 이루어지지 않았습니다 — 보드에 카드가 없습니다. 다시 요청해 주세요.'));
        }
        if (event.type === 'error') { failure = event.error || t("답변 생성에 실패했습니다."); failureCode = event.code; }
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index = buffer.indexOf('\n');
        while (index !== -1) {
          consume(buffer.slice(0, index));
          buffer = buffer.slice(index + 1);
          index = buffer.indexOf('\n');
        }
      }
      if (buffer) consume(buffer);
      if (!finished && !failure) failure = t("답변 생성에 실패했습니다.");
      if (failure) throw Object.assign(new Error(failure), { code: failureCode });
      if (boardChanged) { await onRefresh(); loadBoardTasks(); }
    }
    catch (error) {
      if (streamed && !replyRetained) {
        const partialReply: ChatMessage = { id: `partial-${optimistic.id}`, role: 'assistant', content: streamed, createdAt: Date.now() };
        setMessages(current => [...current, partialReply]);
      }
      if (!requestAccepted) {
        setMessages((current) => current.filter((item) => item.id !== optimistic.id));
        setDraft(typed); setAttachments(sent);
      }
      const busy = (error as { code?: string })?.code === 'billing_busy';
      tutorialEvent(busy ? 'billing-busy' : 'message-failed');
      onNotice(error instanceof Error ? error.message : t("메시지를 보내지 못했습니다."));
    }
    finally {
      sendingRef.current = false;
      setSending(false); setStreamText(''); setToolNote('');
      // 답변이 끝나면 대기열의 첫 메시지를 이어서 보냅니다.
      const next = queueRef.current.shift();
      setQueued([...queueRef.current]);
      if (next) void sendMessage({ text: next.text, attachments: next.attachments });
    }
  }

  return <div className="workspace-view chat-page"><ViewHeading eyebrow="Agent Chat" title={t("대화")} description={t("매니저에게 지시하면 대화 중에 팀을 꾸리고 업무를 맡겨 결과까지 가져옵니다.")}
    action={<div className="view-actions"><Button variant="outline" disabled={!projectId || !onOpenProject} onClick={() => { if (projectId) onOpenProject?.(projectId); }}><FolderKanban size={15} /> {t("프로젝트 바로가기")}</Button></div>} />
    <div className="chat-shell"><aside className="chat-context"><label>{t("프로젝트")}<NativeSelect data-tour="chat-project" value={projectId} onChange={(event) => { setProjectId(event.target.value); setAgentId(''); setWantedAgent(''); }}><NativeSelectOption value="">{t("프로젝트 선택")}</NativeSelectOption>{projects.map((project) => <NativeSelectOption key={project.id} value={project.id}>{project.name}</NativeSelectOption>)}</NativeSelect></label><strong>{t("참여 에이전트")}</strong>{availableAgents.map((agent) => <button data-tour={agent.isManager ? 'chat-manager' : undefined} aria-pressed={selectedAgentId === agent.id} className={selectedAgentId === agent.id ? 'chat-agent active' : 'chat-agent'} key={agent.id} onClick={() => { setAgentId(agent.id); setWantedAgent(''); if (agent.isManager) tutorialEvent('manager-selected'); }}>{(() => {
                const presence = agent.isManager
                  ? managerPresence(boardTasks, sending && selectedAgentId === agent.id, background.length > 0)
                  : agentPresence(agent.name, boardTasks, background.some((item) => item.agent === agent.name));
                return <i className={`presence ${presence}`} title={t(PRESENCE_LABEL[presence])} aria-label={tf('{0} 상태: {1}', agent.name, t(PRESENCE_LABEL[presence]))}>{presence === 'complete' && <Check size={12} strokeWidth={3} aria-hidden="true" />}</i>;
              })()}<span style={{ background: agent.color }}>{agent.isManager ? <Bot size={17} aria-hidden="true" /> : agent.name[0]}</span><div><b>{agent.name}</b><small>{t(agent.role)}</small></div></button>)}
      <strong className="chat-tasks-title">{t("이 프로젝트의 업무")}<em>{boardTasks.length}</em></strong>
      <div className="chat-tasks">
        {boardTasks.map((task) => <button className="chat-task" key={task.id} title={`${task.owner} · ${t(task.status)}`}
          onClick={() => setSuggestion(tf("'{0}' 업무를 진행해 주세요. 현재 상태와 다음에 할 일을 알려주고, 바로 처리할 수 있으면 이어서 진행해 주세요.", task.title))}>
          <b>{task.title}</b>
          <span>
            <i className={`chat-task-dot ${task.status === '진행 중' ? 'doing' : task.status === '검토' ? 'review' : ''}`} />{t(task.status)}
            <em className={`priority-badge ${PRIORITY_CLASS[toPriority(task.priority)]}`}><Flag size={10} /> {t(toPriority(task.priority))}</em>
          </span>
        </button>)}
        {!boardTasks.length && <p className="chat-tasks-empty">{t("아직 업무가 없습니다. 매니저에게 목표를 알려주면 카드를 만들어 나눠 맡깁니다.")}</p>}
      </div>
    </aside>
      <section className="conversation"><header><span style={{ background: selectedAgent?.color || 'var(--c-inverse)' }}>{selectedAgent?.isManager || !selectedAgent ? <Bot size={17} aria-hidden="true" /> : selectedAgent.name[0]}</span><div><strong>{selectedAgent?.name || t("에이전트를 선택하세요")}</strong><small>{selectedAgent ? t(selectedAgent.role) : t("프로젝트 참여 에이전트")}</small></div><em><i /> {t("대화 가능")}</em></header>
        <div className="message-list" ref={listRef} onScroll={handleScroll}>{summary && <details className="chat-summary"><summary><Sparkles size={13} /> {tf("이전 대화 {0}개 메시지가 요약으로 압축됨", summary.messageCount)}<em>{t("펼쳐서 보기")}</em></summary><div><Markdown text={summary.content} /><small>{t("세부 문구가 필요하면 에이전트에게 물어보세요 — recall_history 로 원문을 찾습니다.")}</small></div></details>}{!messages.length && !streamText && !summary && <div className="chat-welcome"><Sparkles size={24} /><h2>{selectedAgent?.name || t("AI 에이전트")}{t("에게 무엇을 맡길까요?")}</h2><p>{selectedAgent?.isManager
            ? t("목표와 원하는 결과물을 알려주면 필요한 에이전트를 합류시켜 맡기고, 결과를 검토해 보고합니다.")
            : t("목표, 배경, 원하는 결과물을 알려주면 프로젝트 맥락에 맞춰 답합니다.")}</p></div>}{messages.map((message) => <div className={`message ${message.role}`} key={message.id}><span>{message.role === 'assistant' ? (selectedAgent?.isManager ? <Bot size={17} aria-hidden="true" /> : selectedAgent?.name[0]) : t("나")}</span>{message.role === 'assistant' ? <div className="bubble"><Markdown text={message.content} /><SaveCodeFiles projectId={projectId} message={message.content} /></div> : <div className="bubble">{message.content}</div>}</div>)}{aiFiles.view}{Boolean(steps.length) && <div className="manager-trace" aria-live="polite">
          <strong>{sending ? t("매니저가 일하는 중") : background.length ? t("팀원이 작업 중") : t("이번 답변에서 한 일")}</strong>
          <ol>{steps.map((step) => step.kind === 'recruited'
            ? <li className="done" key={step.id}><UserRound size={12} /><span><b>{step.agent}</b>{step.role ? ` · ${t(step.role)}` : ''} {t("합류")}</span></li>
            : <li className={step.state} key={step.id}>
                {step.state === 'running' ? <LoaderCircle className="spin" size={12} /> : step.state === 'blocked' ? <Clock3 size={12} /> : <Check size={12} />}
                <span>
                  {step.state === 'running' ? <><b>{step.agent}</b>{t("에게 맡김 —")} {step.title}</> : null}
                  {step.state === 'completed' ? <><b>{step.agent}</b> {t("보고 도착 —")} {step.summary || step.title}</> : null}
                  {step.state === 'blocked' ? <><b>{step.agent}</b> {t("진행 불가 —")} {step.summary || t("사유 미기재")}</> : null}
                </span>
              </li>)}</ol>
        </div>}
        {sending && (streamText
          ? <div className="message assistant"><span>{selectedAgent?.isManager ? <Bot size={17} aria-hidden="true" /> : selectedAgent?.name[0]}</span><div className="bubble streaming"><Markdown text={streamText} /><i className="caret" /></div></div>
          : <div className="message assistant"><span>{selectedAgent?.isManager ? <Bot size={17} aria-hidden="true" /> : selectedAgent?.name[0]}</span>{toolNote
              ? <div className="bubble tool-note"><LoaderCircle className="spin" size={13} /> {toolNote}</div>
              : <div className="bubble thinking"><i /><i /><i /></div>}</div>)}{queued.map((item) => <div className="message user queued" key={item.id}><span>{t("나")}</span><div className="bubble"><em>{t("전송 대기")}</em>{item.attachments.length ? `${item.text}\n\n📎 ${item.attachments.map((file) => file.name).join(', ')}` : item.text}</div></div>)}<div ref={bottomRef} className="message-anchor" /></div>
        <div className="chat-composer">
          {Boolean(attachments.length) && <ul className="composer-chips">
            {attachments.map((item) => <li key={item.key}>
              {item.kind === 'image' ? <FileImage size={13} /> : <FileText size={13} />}
              <b>{item.name}</b><small>{formatBytes(item.size)}</small>
              <button type="button" onClick={() => removeAttachment(item.key)} aria-label={tf("{0} 첨부 취소", item.name)}><X size={12} /></button>
            </li>)}
          </ul>}
          <button className="composer-add" type="button" onClick={() => fileInputRef.current?.click()}
            disabled={!selectedAgentId || sending || attachments.length >= MAX_ATTACHMENTS}
            title={t("파일·사진 첨부")} aria-label={t("파일·사진 첨부")}><Plus size={18} /></button>
          <input className="composer-file" ref={fileInputRef} type="file" multiple accept={ATTACHMENT_ACCEPT}
            onChange={(event) => void pickAttachments(event)} tabIndex={-1} aria-hidden="true" />
          <textarea data-tour="chat-input" data-manager={Boolean(selectedAgent?.isManager)} aria-label={t("업무 지시 입력")} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder={suggestion || (sending ? t("답변 중에도 이어서 지시할 수 있어요 — 보내면 이번 답변이 끝난 뒤 전달됩니다.") : tf("{0}에게 업무를 지시하세요...", selectedAgent?.name || t('에이전트')))} disabled={!selectedAgentId} />
          <button className="composer-send" type="button" aria-label={t("메시지 보내기")} aria-busy={sending} onClick={() => void sendMessage()} disabled={!selectedAgentId || (!draft.trim() && !suggestion.trim() && !attachments.length)}>{sending && !draft.trim() && !attachments.length ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}</button>
          <div className="composer-bar">
            <button className="composer-tool" type="button" onClick={() => void addChatFolder()} disabled={!projectId || !pickerReady || folderBusy}
              title={pickerReady ? t("이 프로젝트에 작업 폴더를 연결합니다.") : t("이 브라우저는 폴더 선택을 지원하지 않습니다. Chrome 또는 Edge 에서 열어 주세요.")}>
              {folderBusy ? <LoaderCircle className="spin" size={13} /> : <FolderPlus size={13} />} {t("폴더 추가")}
              {Boolean(folders.length) && <em>{folders.length}</em>}
            </button>
            <FolderPermissions onNotice={onNotice} />
            <small>{t("Enter 전송 · Shift+Enter 줄바꿈")}</small>
          </div>
        </div></section>
    </div>
  </div>;
}

/** 테마 선택지의 이름과 아이콘. 값 자체는 lib/prefs 의 THEME_CHOICES 입니다. */
const THEME_LABEL: Record<ThemeChoice, string> = { system: '시스템', dark: '다크', light: '라이트' };
const THEME_ICON: Record<ThemeChoice, typeof Monitor> = { system: Monitor, dark: Moon, light: Sun };

/** 켜고 끄는 항목들. 라벨은 t() 로 번역합니다. */
const PREF_SWITCHES: [key: 'notifications' | 'autoAssign' | 'showTutorial' | 'toastNotifications', title: string, description: string][] = [
  ['toastNotifications', '토스트 알림 표시', '에이전트 임명·업무 완료·보고 등의 알림을 표시합니다. 승인 요청은 항상 모달로 표시됩니다.'],
  ['notifications', '실행 완료 알림', '에이전트가 업무를 마치면 알려줍니다.'],
  ['autoAssign', '에이전트 자동 추천', '새 업무에 가장 적합한 역할을 추천합니다.'],
  ['showTutorial', '튜토리얼 메뉴 표시', '네브바의 튜토리얼 버튼을 보이거나 숨깁니다.'],
];

/**
 * 환경 설정. 모든 값은 이 기기(localStorage)에만 저장되고,
 * 고르는 즉시 화면에 반영됩니다.
 */
function SettingsView({ onNotice }: { onNotice: (message: string) => void }) {
  const prefs = usePrefs();

  function change(patch: Partial<Prefs>) {
    updatePrefs(patch);
  }

  return <div className="workspace-view narrow-view">
    <ViewHeading eyebrow="Preferences" title={t('환경 설정')} description={t('화면 테마와 언어, 업무 방식 기본값을 조정합니다.')} />
    <section className="settings-card" data-preferences-card>
      <div className="settings-title"><Settings2 size={19} /><div><strong>{t('워크스페이스')}</strong><p>{t('이 기기의 인터페이스와 자동화 기본값')}</p></div></div>
      {PREF_SWITCHES.map(([key, title, description]) => <div className="setting-row" key={key}>
        <div><strong>{t(title)}</strong><p>{t(description)}</p></div>
        <Switch aria-label={t(title)} checked={prefs[key]} onCheckedChange={(value) => change({ [key]: value })} />
      </div>)}

      <div className="settings-title settings-title-sub"><Sun size={19} /><div><strong>{t('화면')}</strong><p>{t('테마와 언어는 이 기기에서만 적용됩니다.')}</p></div></div>
      <div className="setting-row">
        <div><strong>{t('테마')}</strong><p>{t('시스템 설정을 따르거나 밝기를 직접 고릅니다.')}</p></div>
        <fieldset className="view-switch setting-choice" aria-label={t('테마 선택')}>
          {THEME_CHOICES.map((choice) => {
            const Icon = THEME_ICON[choice];
            return <button
              aria-pressed={prefs.theme === choice}
              className={prefs.theme === choice ? 'selected' : ''}
              key={choice}
              onClick={() => change({ theme: choice })}
              type="button"
            ><Icon size={14} /> {t(THEME_LABEL[choice])}</button>;
          })}
        </fieldset>
      </div>
      <div className="setting-row">
        <div><strong>{t('언어')}</strong><p>{t('화면에 표시되는 문구의 언어입니다.')}</p></div>
        <fieldset className="view-switch setting-choice" aria-label={t('언어 선택')}>
          {LANGUAGES.map((code: Lang) => <button
            aria-pressed={prefs.lang === code}
            className={prefs.lang === code ? 'selected' : ''}
            key={code}
            onClick={() => change({ lang: code })}
            type="button"
          ><Languages size={14} /> {LANGUAGE_LABEL[code]}</button>)}
        </fieldset>
      </div>

      <Button className="settings-save" onClick={() => onNotice(t('환경 설정이 이 기기에 저장되었습니다.'))}>{t('설정 저장')}</Button>
    </section>
  </div>;
}

/** 프로필 편집 폼의 자유 입력 항목. 상한은 서버(lib/profile.ts)와 같은 값을 씁니다. */
const PROFILE_FORM: { key: ProfileField; label: string; placeholder: string; area?: boolean }[] = [
  { key: 'displayName', label: '이름', placeholder: '예: 홍길동' },
  { key: 'title', label: '직급', placeholder: '예: 부장' },
  { key: 'company', label: '회사', placeholder: '예: Acme' },
  { key: 'department', label: '소속', placeholder: '예: 기술영업팀' },
  { key: 'email', label: '이메일', placeholder: '예: you@example.com' },
  { key: 'phone', label: '연락처', placeholder: '예: 010-0000-0000' },
  { key: 'bio', label: '한 줄 소개', placeholder: '에이전트가 참고할 한 줄. 예: EMC 챔버 견적·규격 검토를 주로 합니다.', area: true },
];

/**
 * 고른 이미지를 정사각형 256px 로 줄여 data URL 로 만듭니다.
 * 원본을 그대로 저장하면 몇 MB 가 DB 에 들어가므로 화면에서 먼저 줄입니다.
 * 가운데를 기준으로 잘라내 얼굴이 치우치지 않게 합니다.
 */
async function toAvatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_SIZE; canvas.height = AVATAR_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error(t('이 브라우저에서는 이미지를 처리할 수 없습니다.'));
    const side = Math.min(bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
    const webp = canvas.toDataURL('image/webp', 0.85);
    // webp 를 못 만드는 브라우저는 toDataURL 이 조용히 png 를 돌려줍니다.
    return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.85);
  } finally { bitmap.close(); }
}

/**
 * 프로필 사진, 없으면 이니셜, 그것도 없으면 기본 아이콘.
 * 사진은 256px data URL 이라 next/image 로 최적화할 수 없어 img 를 그대로 씁니다.
 */
function AvatarFace({ name, size, src }: { name: string; size: number; src: string }) {
  // oxlint-disable-next-line next/no-img-element -- data URL 은 next/image 최적화 대상이 아닙니다
  if (src) return <img alt="" src={src} />;
  if (name.trim()) return <b>{initialsOf(name)}</b>;
  return <UserRound size={size} />;
}

function initialsOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '??';
  // 한글 이름은 성을 뺀 이름 두 글자, 영문은 이니셜 두 자가 자연스럽습니다.
  if (/^[A-Za-z]/.test(trimmed)) {
    const parts = trimmed.split(/\s+/);
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : trimmed.slice(0, 2)).toUpperCase();
  }
  return trimmed.length > 2 ? trimmed.slice(1, 3) : trimmed;
}

/**
 * 계정 화면.
 *
 * 카드를 누르면 프로필 편집 모달이 열립니다. 여기서 고친 이름·이메일은
 * 환경변수(LOCAL_USER_NAME 등)로 정해진 계정 값보다 우선해서 화면에 쓰이고,
 * 회사·소속·직급·한 줄 소개는 에이전트 실행·대화 프롬프트에도 들어갑니다.
 */
function AccountView({ displayName, email, onNotice, onProfileSaved }: {
  displayName: string; email: string;
  onNotice: (message: string) => void;
  onProfileSaved?: (next: { displayName: string; email: string; avatar: string }) => void;
}) {
  const [profile, setProfile] = useState<UserProfile>(EMPTY_PROFILE);
  const [account, setAccount] = useState({ displayName, email });
  const [authMode, setAuthMode] = useState<'local' | 'oauth'>('local');
  const [apiKey, setApiKey] = useState<ApiKeyState | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<UserProfile>(EMPTY_PROFILE);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  type MeResponse = { displayName?: string; email?: string; account?: { displayName: string; email: string }; authMode?: 'local' | 'oauth'; profile?: UserProfile; error?: string };

  // oxlint-disable-next-line react/react-compiler -- async server hydration is intentional here
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const response = await fetch('/api/me');
        const data = await response.json() as MeResponse;
        if (!alive) return;
        if (!response.ok) throw new Error(data.error || t('프로필을 불러오지 못했습니다.'));
        if (data.profile) setProfile({ ...EMPTY_PROFILE, ...data.profile });
        if (data.account) setAccount(data.account);
        if (data.authMode) setAuthMode(data.authMode);
        fetchApiKeyState().then((state) => { if (alive) setApiKey(state); }).catch(() => {});
      } catch (error) {
        if (alive) onNotice(error instanceof Error ? error.message : t('프로필을 불러오지 못했습니다.'));
      } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [onNotice]);

  const shownName = profile.displayName || account.displayName;
  const shownEmail = profile.email || account.email;
  const affiliation = affiliationLine(profile);

  const openEditor = useCallback(() => { setDraft(profile); setEditing(true); }, [profile]);

  async function pickAvatar(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { onNotice(t('이미지 파일만 올릴 수 있습니다.')); return; }
    try {
      const avatar = await toAvatarDataUrl(file);
      if (avatar.length > AVATAR_MAX_CHARS) { onNotice(t('사진이 너무 큽니다. 더 작은 이미지를 골라주세요.')); return; }
      setDraft((current) => ({ ...current, avatar }));
    } catch (error) { onNotice(error instanceof Error ? error.message : t('사진을 처리하지 못했습니다.')); }
  }

  async function saveProfileDraft() {
    setSaving(true);
    try {
      const response = await fetch('/api/me', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft),
      });
      const data = await response.json() as MeResponse;
      if (!response.ok) throw new Error(data.error || t('프로필을 저장하지 못했습니다.'));
      const saved = { ...EMPTY_PROFILE, ...(data.profile ?? draft) };
      setProfile(saved);
      if (data.account) setAccount(data.account);
      setEditing(false);
      onProfileSaved?.({
        displayName: data.displayName || saved.displayName || account.displayName,
        email: data.email || saved.email || account.email,
        avatar: saved.avatar,
      });
      onNotice(t('프로필을 저장했습니다.'));
    } catch (error) { onNotice(error instanceof Error ? error.message : t('프로필을 저장하지 못했습니다.')); }
    finally { setSaving(false); }
  }

  const details: { label: string; value: string }[] = [
    { label: t('회사'), value: profile.company },
    { label: t('소속'), value: profile.department },
    { label: t('직급'), value: profile.title },
    { label: t('연락처'), value: profile.phone },
    { label: t('한 줄 소개'), value: profile.bio },
  ];

  if (loading) return <div className="view-loading"><LoaderCircle className="spin" /><span>{t('프로필을 불러오는 중')}</span></div>;

  return <div className="workspace-view narrow-view">
    <ViewHeading
      eyebrow="Account"
      title={t('계정')}
      description={t('이 워크스페이스가 어떤 사용자로 동작하는지 확인하고, 프로필을 고칩니다.')}
    />

    <button className="account-card account-card-edit" type="button" onClick={openEditor}>
      <span className="account-avatar"><AvatarFace name={shownName} size={27} src={profile.avatar} /></span>
      <div>
        <h2>{shownName}</h2>
        {affiliation ? <p className="account-affiliation">{affiliation}</p> : null}
        <p>{shownEmail}</p>
        <em><ShieldCheck size={13} /> {authMode === 'oauth' ? t('OAuth 로그인 · 세션 30일') : t('로컬 전용 모드 · 외부 인증 없음')}</em>
      </div>
      <span className="account-edit-hint"><Pencil size={12} /> {t('편집')}</span>
    </button>

    <dl className="account-details">
      {details.map((item) => <div key={item.label}>
        <dt>{item.label}</dt>
        <dd className={item.value ? '' : 'empty'}>{item.value || t('아직 없음')}</dd>
      </div>)}
    </dl>

    <CreditsCard onConnectKey={() => setKeyOpen(true)} onNotice={onNotice} refreshKey={apiKey?.configured} />

    <section className="settings-card api-key-card">
      <div className="settings-title"><KeyRound size={16} /><div><strong>{t('Claude API 키')}</strong><p>{t('키를 연결하면 실행·대화가 이 키로 나가고 크레딧은 차감되지 않습니다. 비용은 본인 Anthropic Console 에 청구됩니다.')}</p></div></div>
      <div className="api-key-row">
        {apiKey?.configured
          ? <><span className="api-key-status ok"><ShieldCheck size={13} /> {t('연결됨')}</span><code>{apiKey.hint}</code></>
          : apiKey?.mode === 'local'
            ? <span className="api-key-status"><ShieldCheck size={13} /> {t('로컬 모드 — .env 의 ANTHROPIC_API_KEY 사용')}</span>
            : <span className="api-key-status">{t('연결된 키 없음 — 크레딧으로 실행됩니다')}</span>}
        <span className="api-key-actions">
          <Button onClick={() => setKeyOpen(true)} size="sm" variant="outline">{apiKey?.configured ? t('바꾸기') : t('연결')}</Button>
          {apiKey?.configured ? <Button onClick={async () => {
            const response = await fetch('/api/keys', { method: 'DELETE' });
            if (response.ok) { setApiKey(await response.json() as ApiKeyState); onNotice(t('API 키를 삭제했습니다.')); }
          }} size="sm" variant="ghost">{t('삭제')}</Button> : null}
        </span>
      </div>
      <ApiKeyDialog onNotice={onNotice} onOpenChange={setKeyOpen} onSaved={setApiKey} open={keyOpen} state={apiKey} />
    </section>

    {authMode === 'oauth' ? <form action="/api/auth/logout" className="account-logout" method="post">
      <Button type="submit" variant="outline">{t('로그아웃')}</Button>
      <small className="entity-hint">{t('이 기기의 세션만 끝납니다. 다시 로그인하면 같은 워크스페이스로 돌아옵니다.')}</small>
    </form> : null}

    <Dialog open={editing} onOpenChange={(open) => { if (!open) setEditing(false); }}>
      <DialogContent className="create-entity-dialog profile-dialog">
        <DialogHeader>
          <DialogTitle>{t('프로필 편집')}</DialogTitle>
          <DialogDescription>{t('사진과 소속을 정해 두면 에이전트가 사용자를 알고 그에 맞춰 보고합니다.')}</DialogDescription>
        </DialogHeader>

        <div className="profile-photo-row">
          <span className="account-avatar large"><AvatarFace name={draft.displayName || shownName} size={30} src={draft.avatar} /></span>
          <div className="profile-photo-actions">
            <Button onClick={() => fileInput.current?.click()} size="sm" type="button" variant="outline">
              <FileImage size={13} /> {draft.avatar ? t('사진 바꾸기') : t('사진 올리기')}
            </Button>
            {draft.avatar
              ? <Button onClick={() => setDraft((current) => ({ ...current, avatar: '' }))} size="sm" type="button" variant="ghost">
                  <X size={13} /> {t('제거')}
                </Button>
              : null}
            <small className="entity-hint">{tf('올린 사진은 {0}px 정사각형으로 줄여 저장합니다.', AVATAR_SIZE)}</small>
          </div>
          <input
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(event) => { void pickAvatar(event.target.files?.[0]); event.target.value = ''; }}
            ref={fileInput}
            type="file"
          />
        </div>

        <div className="profile-grid">
          {PROFILE_FORM.map((field) => <label className={field.area ? 'entity-field wide' : 'entity-field'} key={field.key}>
            <span>{t(field.label)}</span>
            {field.area
              ? <textarea
                  maxLength={PROFILE_LIMITS[field.key]}
                  onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                  placeholder={t(field.placeholder)}
                  value={draft[field.key]}
                />
              : <input
                  maxLength={PROFILE_LIMITS[field.key]}
                  onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                  placeholder={t(field.placeholder)}
                  value={draft[field.key]}
                />}
          </label>)}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t('취소')}</DialogClose>
          <Button disabled={saving} onClick={saveProfileDraft}>{saving ? t('저장 중') : t('프로필 저장')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
