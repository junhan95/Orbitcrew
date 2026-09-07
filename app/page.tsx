'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, BookOpen, Bot, Brain, ChartColumn, Check, ChevronDown, Flag, Inbox, LayoutDashboard, KeyRound, ListChecks, LogOut, MessageSquareText, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings, Trash2, UserRound, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tutorial } from '@/components/tutorial';
import { Markdown } from '@/components/markdown';
import { UsageView } from '@/components/usage-view';
import { ApprovalsView, fetchInboxCount } from '@/components/approvals-view';
import { HealthCard } from '@/components/health-card';
import { MemoryView } from '@/components/memory-view';
import { SkillsView } from '@/components/skills-view';
import { type ApiKeyState, ApiKeyDialog, INSUFFICIENT_CREDITS_EVENT, NO_API_KEY_EVENT, fetchApiKeyState, installNoApiKeyWatcher } from '@/components/api-key-dialog';
import { OrbitMark } from '@/components/orbit-mark';
import { WorkspaceView, type ChatTarget, type WorkspaceSection } from '@/components/workspace-views';
import { PRIORITIES, type Priority, byPriority, toPriority } from '@/lib/priority';
import { TASK_STATUSES, type TaskStatus } from '@/lib/task-status';
import { agentState } from '@/lib/agent-state';
import { locale, t, tf } from '@/lib/i18n';
import { getPrefs, hydratePrefs, updatePrefs, usePrefs, watchSystemTheme } from '@/lib/prefs';

type Task = {
  id: string; title: string; label: string; owner: string; status: TaskStatus;
  priority: string; accent: string; result?: string | null; projectId?: string | null;
};
type RecentRun = { agentName: string; taskTitle: string; status: string; outcome: string | null; startedAt: number; seconds: number | null };
type WeeklyPoint = { from: number; created: number; review: number };
type TrendPoint = { from: number; rate: number };
type StatsAgent = { id: string; name: string; role: string; color: string; runningCount: number; activeTasks: number; lastRunAt: number | null };
type StatsProject = {
  id: string; name: string; description: string; color: string; status: string;
  taskCount: number; waitingCount: number; doingCount: number; reviewCount: number; progress: number; highCount: number;
};
type Stats = {
  tasks: { total: number; waiting: number; doing: number; review: number; completionRate: number };
  runs: { total: number; completed: number; failed: number; running: number; lastHour: number; avgSeconds: number | null; histogram: number[]; recent?: RecentRun[] };
  // 대쉬보드 '주간 업무 처리량' / '검토 도달률 추이' (서버가 아직 안 내려주면 빈 상태로 그립니다)
  weekly?: WeeklyPoint[];
  trend?: TrendPoint[];
  projects: StatsProject[];
  focus: StatsProject | null;
  agents: StatsAgent[];
};

/** 중요도 배지 색. 높음만 눈에 띄게 하고 나머지는 조용하게 둡니다. */
const PRIORITY_CLASS: Record<Priority, string> = { 높음: 'high', 중간: 'mid', 낮음: 'low' };

/** 프로젝트 선택기의 '전체' 값. 개별 프로젝트는 id 를 그대로 씁니다. */
const ALL_PROJECTS = 'all';

/** 상태 분포 도넛의 둘레 (r=74) */
const DONUT_C = 2 * Math.PI * 74;

/** 주간 차트 x축 라벨 — 브라우저 로케일의 짧은 요일 */
function weekdayLabel(timestamp: number) {
  return new Intl.DateTimeFormat(locale(), { weekday: 'short' }).format(new Date(timestamp));
}

/** 대쉬보드 업무 보드는 요약만 — 열당 이 개수까지만 보여 주고 나머지는 '+N건 더' 로 접습니다. */
const DASHBOARD_BOARD_ROWS = 3;
const NAV_ITEMS = [['대쉬보드', LayoutDashboard], ['프로젝트', ListChecks], ['대화', MessageSquareText], ['에이전트', Bot], ['승인함', Inbox], ['기억', Brain], ['스킬', BookOpen], ['사용량', ChartColumn]] as const;

type NavSection = '대쉬보드' | '사용량' | '승인함' | '기억' | '스킬' | WorkspaceSection;

function greeting(hour: number) {
  if (hour < 5) return t('늦은 밤이네요');
  if (hour < 12) return t('좋은 아침이에요');
  if (hour < 18) return t('좋은 오후예요');
  return t('좋은 저녁이에요');
}

function formatDuration(seconds: number | null) {
  if (seconds === null) return '—';
  if (seconds < 60) return tf('{0}초', seconds);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? tf('{0}분 {1}초', minutes, rest) : tf('{0}분', minutes);
}

function formatRelative(timestamp: number) {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return t('방금');
  if (diff < 3_600_000) return tf('{0}분 전', Math.floor(diff / 60_000));
  if (diff < 86_400_000) return tf('{0}시간 전', Math.floor(diff / 3_600_000));
  return tf('{0}일 전', Math.floor(diff / 86_400_000));
}

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [activeNav, setActiveNav] = useState<NavSection>('대쉬보드');
  const [chatVisited, setChatVisited] = useState(false);
  const beforeSettings = useRef<NavSection>('대쉬보드');
  // 승인함 배지 — 승인 대기(카드·스킬) + 기억 pending 합계. 화면 전환마다, 그리고 1분마다 다시 셉니다.
  const [approvalModal, setApprovalModal] = useState(false);
  const announcedApprovals = useRef(new Set<string>());
  const [inboxCount, setInboxCount] = useState(0);
  const refreshInbox = useCallback(() => { void fetchInboxCount().then((count) => {
    setInboxCount(count.total);
    if (count.pendingIds?.some(id => !announcedApprovals.current.has(id))) setApprovalModal(true);
    if (count.pendingIds) announcedApprovals.current = new Set(count.pendingIds);
  }); }, []);
  const [projectFilter, setProjectFilter] = useState('');
  // 빠른 대화 입력값
  const [query, setQuery] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newProject, setNewProject] = useState('');
  const [newPriority, setNewPriority] = useState<Priority>('중간');
  const [noticeQueue, setNoticeQueue] = useState<string[]>([]);
  const notice = noticeQueue[0] ?? '';

  const [displayName, setDisplayName] = useState('사용자');
  const [email, setEmail] = useState('');
  // 계정 화면에서 올린 프로필 사진 (256px data URL). 사이드바 아바타에 씁니다.
  const [avatar, setAvatar] = useState('');
  // 'oauth' 일 때만 사용자 메뉴에 로그아웃이 보입니다 (로컬 모드는 세션이 없습니다).
  const [authMode, setAuthMode] = useState<'local' | 'oauth'>('local');
  // BYOK — 사용자 Anthropic API 키 상태와 연결 모달. OAuth 모드에서 키가 없으면 열립니다.
  const [apiKeyState, setApiKeyState] = useState<ApiKeyState | null>(null);
  const [apiKeyOpen, setApiKeyOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [chatTarget, setChatTarget] = useState<ChatTarget | null>(null);
  // 대화 화면의 '프로젝트 바로가기' — 프로젝트 화면을 열면서 그 프로젝트 상세로 바로 들어갑니다.
  const [projectTarget, setProjectTarget] = useState<{ projectId: string; taskId?: string; key: number } | null>(null);
  const [selectedResult, setSelectedResult] = useState<Task | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [mountedAt, setMountedAt] = useState<Date | null>(null);
  const prefs = usePrefs();
  // 세로 메뉴바 확장/축소 — 선택은 orbit-preferences 에 남습니다.
  const navOpen = prefs.nav === 'expanded';
  const toggleNav = useCallback(() => {
    updatePrefs({ nav: getPrefs().nav === 'expanded' ? 'collapsed' : 'expanded' });
  }, []);
  const searchRef = useRef<HTMLInputElement>(null);

  const flash = useCallback((message: string) => {
    if (getPrefs().toastNotifications) setNoticeQueue(current => [...current, message]);
  }, []);

  useEffect(() => {
    if (!noticeQueue.length) return;
    const timer = window.setTimeout(() => setNoticeQueue(current => current.slice(1)), prefs.toastNotifications ? 4000 : 0);
    return () => window.clearTimeout(timer);
  }, [noticeQueue, prefs.toastNotifications]);

  const refreshStats = useCallback(async () => {
    try {
      const response = await fetch('/api/stats');
      if (!response.ok) return;
      setStats(await response.json() as Stats);
    } catch { /* 통계는 보조 정보라 실패해도 화면을 막지 않습니다. */ }
  }, []);

  const refreshTasks = useCallback(async () => {
    try {
      const response = await fetch('/api/tasks');
      if (!response.ok) return;
      const data = await response.json() as { tasks: Task[] };
      setTasks(data.tasks);
    } catch { /* 목록 새로고침 실패는 조용히 넘기고 기존 화면을 유지합니다. */ }
  }, []);

  // 서버(UTC)와 브라우저 타임존이 달라 생기는 hydration 불일치를 피하려고 마운트 후에 계산합니다.
  // 저장된 테마·언어도 이때 화면에 반영합니다.
  useEffect(() => {
    // oxlint-disable-next-line react/react-compiler -- 마운트 후에만 알 수 있는 값(타임존·저장된 설정)이라 여기서 한 번 채웁니다
    setMountedAt(new Date());
    hydratePrefs();
    return watchSystemTheme();
  }, []);

  // 키가 없어 409 가 돌아오면(실행·대화·계획·검토 어디서든) 연결 모달을 띄웁니다.
  useEffect(() => {
    installNoApiKeyWatcher();
    const open = () => setApiKeyOpen(true);
    window.addEventListener(NO_API_KEY_EVENT, open);
    return () => window.removeEventListener(NO_API_KEY_EVENT, open);
  }, []);


  // 첫 로그인(?welcome=1)이거나 OAuth 모드인데 키가 없으면 온보딩으로 바로 안내합니다.
  useEffect(() => {
    let alive = true;
    fetchApiKeyState().then((state) => {
      if (!alive) return;
      setApiKeyState(state);
      const welcome = new URLSearchParams(window.location.search).get('welcome') === '1';
      if (welcome) {
        window.history.replaceState(null, '', window.location.pathname);
        // 가입 체험 크레딧 안내 — 키 연결은 선택이라 모달 대신 토스트로만 알립니다.
        if (!state.required) flash(t('환영합니다! 체험 크레딧 300 이 지급되었습니다. 프로젝트를 만들면 바로 시작됩니다.'));
      }
      if (state.required && !state.configured) setApiKeyOpen(true);
    }).catch(() => { /* 로그인 전(401)이면 위의 /api/me 처리가 /login 으로 보냅니다 */ });
    return () => { alive = false; };
  }, [flash]);

  const clock = {
    today: mountedAt ? new Intl.DateTimeFormat(locale(), { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(mountedAt) : '',
    hello: mountedAt ? greeting(mountedAt.getHours()) : t('안녕하세요'),
  };

  useEffect(() => {
    Promise.all([fetch('/api/tasks'), fetch('/api/me'), fetch('/api/stats')])
      .then(async ([taskResponse, meResponse, statsResponse]) => {
        if (!taskResponse.ok) throw new Error(t('업무를 불러오지 못했습니다.'));
        const taskData = await taskResponse.json() as { tasks: Task[] };
        setTasks(taskData.tasks);
        if (meResponse.status === 401) {
          // 세션이 없으면(OAuth 모드) 로그인 화면으로. 로컬 모드에서는 401 이 나오지 않습니다.
          window.location.assign('/login');
          return;
        }
        if (meResponse.ok) {
          const me = await meResponse.json() as { displayName: string; email: string; authMode?: 'local' | 'oauth'; profile?: { avatar?: string } };
          if (me.displayName) setDisplayName(me.displayName.split('@')[0]);
          if (me.email) setEmail(me.email);
          if (me.profile?.avatar) setAvatar(me.profile.avatar);
          if (me.authMode) setAuthMode(me.authMode);
        }
        if (statsResponse.ok) setStats(await statsResponse.json() as Stats);
      })
      .catch((error) => flash(error instanceof Error ? error.message : t('데이터를 불러오지 못했습니다.')))
      .finally(() => setLoading(false));
  }, [flash]);

  /** 세션을 지우고 랜딩으로. 서버가 303 으로 보내지만 fetch 는 따라가지 않으므로 직접 이동합니다. */
  useEffect(() => {
    window.addEventListener('orbit-approvals-refresh', refreshInbox);
    return () => window.removeEventListener('orbit-approvals-refresh', refreshInbox);
  }, [refreshInbox]);

  const logout = useCallback(async () => {
    try { await fetch('/api/auth/logout', { method: 'POST', redirect: 'manual' }); }
    finally { window.location.assign('/landing'); }
  }, []);

  /** 화면 이동. 대쉬보드로 돌아올 때는 다른 화면에서 만든 프로젝트·업무가 바로 보이도록 다시 읽습니다. */
  const goTo = useCallback((section: NavSection) => {
    if (section === '설정' && activeNav !== '설정') beforeSettings.current = activeNav;
    if (section === '대화') setChatVisited(true);
    setActiveNav(section);
    if (section === '대쉬보드') { void refreshStats(); void refreshTasks(); }
    refreshInbox();
  }, [activeNav, refreshStats, refreshTasks, refreshInbox]);

  useEffect(() => {
    if (activeNav !== '설정') return;
    const closeOutside = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !document.querySelector('[data-preferences-card]')) return;
      if (target.closest('[data-preferences-card], [role="dialog"], [role="menu"], [role="listbox"]')) return;
      // Explicit navigation and header controls keep their own click behavior.
      if (target.closest('button, a, input, textarea, select, [role="button"]')) return;
      goTo(beforeSettings.current);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('[role="dialog"], [role="menu"]')) goTo(beforeSettings.current);
    };
    document.addEventListener('click', closeOutside);
    document.addEventListener('keydown', closeWithEscape);
    return () => { document.removeEventListener('click', closeOutside); document.removeEventListener('keydown', closeWithEscape); };
  }, [activeNav, goTo]);

  // 토스 결제창에서 돌아온 뒤(?credits=done|error|canceled) — 안내하고 계정 화면으로. 주소는 바로 정리합니다.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('credits');
    if (!result) return;
    window.history.replaceState(null, '', window.location.pathname);
    const message = result === 'done'
      ? tf('충전이 완료되었습니다 — {0} 크레딧이 들어왔습니다.', params.get('amount') ?? '')
      : result === 'canceled' ? t('결제를 취소했습니다.') : (params.get('message') || t('결제에 실패했습니다.'));
    // oxlint-disable-next-line react/react-compiler -- 마운트 후 주소 쿼리를 한 번 읽어 안내하는 것이라 의도된 setState 입니다
    flash(message);
    goTo('계정');
  }, [flash, goTo]);

  // 크레딧이 바닥나 402 가 돌아오면 안내하고 계정 화면(충전 · 키 연결)으로 보냅니다.
  useEffect(() => {
    const onEmpty = (event: Event) => {
      flash((event as CustomEvent<string>).detail || t('크레딧 잔액이 부족합니다. 충전하거나 본인 API 키를 연결해 주세요.'));
      goTo('계정');
    };
    window.addEventListener(INSUFFICIENT_CREDITS_EVENT, onEmpty);
    return () => window.removeEventListener(INSUFFICIENT_CREDITS_EVENT, onEmpty);
  }, [flash, goTo]);

  useEffect(() => {
    refreshInbox();
    const timer = window.setInterval(refreshInbox, 15_000);
    return () => window.clearInterval(timer);
  }, [refreshInbox]);

  // 다른 탭·창에 다녀오는 사이 에이전트가 보드를 바꿨을 수 있으니, 화면으로 돌아오면 다시 읽습니다.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== 'visible') return;
      void refreshStats();
      void refreshTasks();
    }
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [refreshStats, refreshTasks]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setActiveNav('대쉬보드');
        searchRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const agents = stats?.agents ?? [];
  const projects = useMemo(() => stats?.projects ?? [], [stats]);

  // 고른 프로젝트가 없거나(첫 렌더) 삭제되어 사라졌으면 '지금 집중할 프로젝트'(= 가장 최근 프로젝트)로 봅니다.
  const activeProjectId = useMemo(() => {
    if (projectFilter === ALL_PROJECTS) return ALL_PROJECTS;
    if (projectFilter && projects.some((project) => project.id === projectFilter)) return projectFilter;
    return projects[0]?.id ?? ALL_PROJECTS;
  }, [projectFilter, projects]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, projects],
  );

  // 대쉬보드는 프로젝트에 속한 업무만 다룹니다. 프로젝트를 고르면 그 프로젝트의 업무로 좁힙니다.
  const projectTasks = useMemo(
    () => tasks.filter((task) => Boolean(task.projectId) && (activeProjectId === ALL_PROJECTS || task.projectId === activeProjectId)),
    [activeProjectId, tasks],
  );

  const visibleTasks = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return projectTasks.filter((task) => {
      if (!keyword) return true;
      return `${task.title} ${task.owner} ${task.label}`.toLowerCase().includes(keyword);
    });
  }, [projectTasks, query]);

  // 통계 카드도 선택한 범위를 따릅니다. (실행 기록은 워크스페이스 전체 기준)
  const scoped = useMemo(() => {
    const waiting = projectTasks.filter((task) => task.status === '대기').length;
    const doing = projectTasks.filter((task) => task.status === '진행 중').length;
    const review = projectTasks.filter((task) => task.status === '검토').length;
    const total = projectTasks.length;
    return { total, waiting, doing, review, completionRate: total ? Math.round((review / total) * 100) : 0 };
  }, [projectTasks]);

  const scopeLabel = selectedProject ? selectedProject.name : t('전체 프로젝트');
  // 아직 끝나지 않은 '높음' 중요도 업무 — 지금 먼저 봐야 할 일입니다.
  const highCount = useMemo(
    () => projectTasks.filter((task) => task.status !== '검토' && toPriority(task.priority) === '높음').length,
    [projectTasks],
  );

  // ── BankDash 구조 블록들이 쓰는 파생값 ─────────────────────────────
  const recentRuns = stats?.runs.recent ?? [];
  const weekly = useMemo(() => stats?.weekly ?? [], [stats]);
  const weeklyMax = Math.max(1, ...weekly.flatMap((day) => [day.created, day.review]));

  // 대기 / 진행 중 / 검토 세 조각을 이어 붙인 도넛
  const donutSegments = useMemo(() => {
    const parts = [
      { key: '대기', value: scoped.waiting, color: 'var(--c-peach)' },
      { key: '진행 중', value: scoped.doing, color: 'var(--c-inverse)' },
      { key: '검토', value: scoped.review, color: 'var(--c-mint)' },
    ];
    let offset = 0;
    return parts.map((part) => {
      const length = scoped.total ? (part.value / scoped.total) * DONUT_C : 0;
      const segment = { ...part, length, offset };
      offset += length;
      return segment;
    });
  }, [scoped]);

  async function createTask() {
    const title = newTitle.trim();
    if (!title) return;
    // 업무는 프로젝트 안에서만 삽니다. 다이얼로그에서 고른 프로젝트 → 현재 보고 있는 프로젝트 → 첫 프로젝트 순으로 정합니다.
    const targetProjectId = newProject || (activeProjectId !== ALL_PROJECTS ? activeProjectId : projects[0]?.id);
    if (!targetProjectId) {
      flash(t('먼저 프로젝트를 만들어 주세요.'));
      return;
    }
    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // 담당은 보내지 않습니다 — 서버가 그 프로젝트의 매니저에게 배정합니다.
        body: JSON.stringify({ title, projectId: targetProjectId, priority: newPriority }),
      });
      const data = await response.json() as { task?: Task; error?: string };
      if (!response.ok || !data.task) throw new Error(data.error || t('업무를 만들지 못했습니다.'));
      setTasks((current) => [...current, data.task as Task]);
      setNewTitle(''); setNewPriority('중간');
      // 다른 프로젝트에 만들었으면 그 프로젝트로 화면을 옮겨 새 업무가 바로 보이게 합니다.
      if (activeProjectId !== ALL_PROJECTS && targetProjectId !== activeProjectId) setProjectFilter(targetProjectId);
      flash(tf('새 업무가 {0}에게 배정되었습니다.', data.task.owner));
      void refreshStats();
    } catch (error) { flash(error instanceof Error ? error.message : t('업무를 만들지 못했습니다.')); }
  }

  /** 업무 카드에서 '대화하기' — 담당 에이전트와의 대화 화면으로 그 업무를 들고 넘어갑니다. */
  const openChat = useCallback((target: Omit<ChatTarget, 'key'>) => {
    setChatTarget({ ...target, key: Date.now() });
    goTo('대화');
  }, [goTo]);
  const openProject = useCallback((projectId: string, taskId?: string) => {
    setProjectTarget({ projectId, taskId, key: Date.now() });
    goTo('프로젝트');
  }, [goTo]);

  async function deleteTask(task: Task) {
    const snapshot = tasks;
    setTasks((current) => current.filter((item) => item.id !== task.id));
    try {
      const response = await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error || t('업무를 삭제하지 못했습니다.'));
      }
      flash(t('업무를 삭제했습니다.'));
      void refreshStats();
    } catch (error) {
      setTasks(snapshot);
      flash(error instanceof Error ? error.message : t('업무를 삭제하지 못했습니다.'));
    }
  }

  return (
    <main className={`app-shell${navOpen ? ' nav-open' : ''}`} key={prefs.lang}>
      <aside className={`sidebar${navOpen ? ' open' : ''}`}>
        <div className="sidebar-head">
          {/* 로고·워드마크는 홈(대쉬보드) 버튼입니다 — 접힌 상태에서는 로고만 남습니다 */}
          <button className="brand-home" onClick={() => goTo('대쉬보드')} aria-label={t("대쉬보드로 이동")} title={t("대쉬보드")}>
            <span className="brand-mark"><OrbitMark size={28} /></span>
            {navOpen && <b className="brand-word">orbitcrew</b>}
          </button>
          <button className="nav-toggle" onClick={toggleNav} aria-expanded={navOpen}
            aria-label={navOpen ? t("메뉴 접기") : t("메뉴 펼치기")} title={navOpen ? t("메뉴 접기") : t("메뉴 펼치기")}>
            {navOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
        </div>
        <nav className="primary-nav" aria-label={t("주 메뉴")}>
          {NAV_ITEMS.map(([label, Icon]) => (
            <button className={activeNav === label ? 'nav-button active' : 'nav-button'} key={label} data-tour={label === '프로젝트' ? 'nav-project' : label === '대화' ? 'nav-chat' : undefined} onClick={() => goTo(label)} aria-label={t(label)} title={t(label)}>
              <Icon size={20} /><span>{t(label)}</span>
              {label === '승인함' && inboxCount > 0 && <i className="gov-badge" aria-label={tf('대기 {0}건', inboxCount)}>{inboxCount > 99 ? '99+' : inboxCount}</i>}
            </button>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <button className={activeNav === '설정' ? 'nav-button active' : 'nav-button'} onClick={() => goTo('설정')} aria-label={t("설정")} title={t("설정")}><Settings size={20} /><span>{t("설정")}</span></button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <label className="search-box">
            <Search size={17} />
            <input ref={searchRef} aria-label={t("업무 검색")} placeholder={t("업무, 에이전트, 분류 검색")} value={query} onChange={(event) => setQuery(event.target.value)} />
            <kbd>⌘ K</kbd>
          </label>
          <div className="top-actions">
            <Tutorial onNavigate={goTo} />
            <DropdownMenu>
              <DropdownMenuTrigger render={<button className={activeNav === '계정' ? 'user-menu active' : 'user-menu'} aria-label={t("사용자 메뉴")} title={displayName} />}>
                {/* oxlint-disable-next-line next/no-img-element -- 프로필 사진은 data URL 이라 next/image 로 최적화할 수 없습니다 */}
                <i className="user-menu-avatar">{avatar ? <img alt="" src={avatar} /> : displayName.slice(0, 2).toUpperCase()}</i>
                <span className="user-menu-name">{t(displayName)}</span>
                <ChevronDown size={14} />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="user-menu-content" align="end">
                <div className="user-menu-head"><b>{t(displayName)}</b>{email ? <small>{email}</small> : null}</div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => goTo('계정')}><UserRound size={15} /> {t("계정")}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => goTo('설정')}><Settings size={15} /> {t("설정")}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setApiKeyOpen(true)}><KeyRound size={15} /> {apiKeyState?.configured ? t("API 키 바꾸기") : t("API 키 연결")}</DropdownMenuItem>
                <DropdownMenuSeparator />
                {authMode === 'oauth'
                  ? <DropdownMenuItem variant="destructive" onClick={logout}><LogOut size={15} /> {t("로그아웃")}</DropdownMenuItem>
                  : <DropdownMenuItem disabled><LogOut size={15} /> {t("로컬 모드 · 로그아웃 없음")}</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
            <Dialog open={createOpen} onOpenChange={(open) => {
              if (open) setNewProject(activeProjectId !== ALL_PROJECTS ? activeProjectId : projects[0]?.id ?? '');
              setCreateOpen(open);
            }}>
              <DialogContent className="task-dialog">
                <DialogHeader><DialogTitle>{t("새 업무 만들기")}</DialogTitle><DialogDescription>{t("업무는 프로젝트의 매니저에게 배정됩니다. 중요도가 높을수록 보드 위쪽에 놓이고 에이전트도 먼저 처리합니다.")}</DialogDescription></DialogHeader>
                {projects.length
                  ? <>
                      <label className="dialog-field"><span>{t("업무 이름")}</span><input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder={t("예: 결제 플로우 엣지 케이스 정리")} /></label>
                      <label className="dialog-field"><span>{t("프로젝트")}</span>
                        <select value={newProject} onChange={(event) => setNewProject(event.target.value)}>
                          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                        </select>
                      </label>
                      <label className="dialog-field"><span>{t("중요도")}</span>
                        <select value={newPriority} onChange={(event) => setNewPriority(event.target.value as Priority)}>
                          {PRIORITIES.map((option) => <option key={option} value={option}>{t(option)}</option>)}
                        </select>
                      </label>
                    </>
                  : <p className="dialog-hint">{t("아직 프로젝트가 없어요. 프로젝트를 먼저 만들면 그 안에 업무를 배정할 수 있습니다.")}</p>}
                <DialogFooter>
                  <DialogClose render={<Button variant="outline" />}>{t("취소")}</DialogClose>
                  {projects.length
                    ? <DialogClose render={<Button onClick={createTask} disabled={!newTitle.trim()} />}>{t("업무 배정")}</DialogClose>
                    : <DialogClose render={<Button onClick={() => goTo('프로젝트')} />}>{t("프로젝트 만들러 가기")}</DialogClose>}
                </DialogFooter>
              </DialogContent>
            </Dialog>
        </header>

        <div className="page-content">
          {activeNav === '대쉬보드' ? <>
          <div className="page-heading">
            <div>
              <p className="eyebrow">{clock.today}</p>
              <h1>{clock.hello}, {t(displayName)}{t("님.")}</h1>
              <p>{loading
                ? t('워크스페이스를 불러오는 중이에요.')
                : projects.length
                  ? tf('{0} · {1}명의 에이전트가 {2}개 업무에서 협업하고 있어요.', scopeLabel, agents.length, scoped.total)
                  : t('아직 프로젝트가 없어요. 프로젝트를 만들면 여기에 진행 상황이 모입니다.')}</p>
            </div>
          </div>

          <section className="overview-grid" aria-label={t("오늘의 현황")}>
            {/* Current project and recent activity. */}
            <div className="ov-row split-a">
              <div className="ov-block">
                <h2 className="ov-title">
                  {t("집중 프로젝트")}
                  {projects.length > 0 && (
                    <span className="ov-title-aside">
                      <select className="focus-project-select" aria-label={t("프로젝트 선택")} value={activeProjectId} onChange={(event) => setProjectFilter(event.target.value)}>
                        {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                        <option value={ALL_PROJECTS}>{t("전체 프로젝트")}</option>
                      </select>
                    </span>
                  )}
                </h2>
                <div className="pcard-row">
                  <article className="pcard solid">
                    {projects.length ? <>
                      <div className="pcard-top">
                        <div>
                          <p>{scopeLabel}</p>
                          <strong>{scoped.completionRate}%</strong>
                        </div>
                        <span className="pcard-chip"><Zap size={17} fill="currentColor" /></span>
                      </div>
                      <div className="pcard-track"><i style={{ width: `${scoped.completionRate}%` }} /></div>
                      <div className="pcard-mid">
                        <div><span>{t("전체 업무")}</span><strong>{scoped.total}{t("건")}</strong></div>
                        <div><span>{t("검토 도달")}</span><strong>{scoped.review} / {scoped.total}</strong></div>
                      </div>
                      <div className="pcard-foot">
                        <span>{t("평균 실행")} {formatDuration(stats?.runs.avgSeconds ?? null)}</span>
                        <button onClick={() => goTo('프로젝트')}>{t("프로젝트 열기")} <ArrowUpRight size={14} /></button>
                      </div>
                    </> : <>
                      <div className="pcard-top">
                        <div><p>{t("워크스페이스")}</p><strong>{t("프로젝트 없음")}</strong></div>
                        <span className="pcard-chip"><Zap size={17} fill="currentColor" /></span>
                      </div>
                      <div className="pcard-mid"><div><span>{t("시작하기")}</span><strong>{t("프로젝트를 만들면 진행 상황이 모입니다")}</strong></div></div>
                      <div className="pcard-foot">
                        <span>{t("전담 매니저가 함께 생깁니다")}</span>
                        <button onClick={() => goTo('프로젝트')}>{t("프로젝트 만들기")} <ArrowUpRight size={14} /></button>
                      </div>
                    </>}
                  </article>
                  <article className="pcard light">
                    <div className="pcard-top">
                      <div><p>{t("워크스페이스 승인 대기")}</p><strong>{inboxCount}{t("건")}</strong></div>
                      <span className="pcard-chip"><Inbox size={17} /></span>
                    </div>
                    <div className="pcard-mid">
                      <div><span>{t("진행 중")}</span><strong>{scoped.doing}{t("건")}</strong></div>
                      <div><span>{t("중요도 높음")}</span><strong>{highCount}{t("건")}</strong></div>
                    </div>
                    <div className="pcard-foot">
                      <span>{inboxCount ? t("확인이 필요한 요청이 있습니다") : t("대기 중인 승인 요청이 없습니다")}</span>
                      <button onClick={() => goTo('승인함')}>{t("승인함 열기")} <ArrowUpRight size={14} /></button>
                    </div>
                  </article>
                </div>
              </div>

              {/* Recent executions. */}
              <div className="ov-block">
                <h2 className="ov-title">
                  {t("최근 에이전트 실행")}
                  {Boolean(stats?.runs.running) && <span className="ov-title-aside">{tf('{0}건 실행 중', stats?.runs.running ?? 0)}</span>}
                </h2>
                <div className="ov-card">
                  {recentRuns.length ? <div className="run-list">
                    {recentRuns.map((run, index) => {
                      const color = agents.find((agent) => agent.name === run.agentName)?.color ?? 'var(--c-inverse)';
                      const state = run.status === 'running' ? 'live' : run.status === 'failed' || run.outcome === 'failed' ? 'bad' : 'ok';
                      return <div className="run-row" key={`${run.startedAt}-${index}`}>
                        <span className="run-avatar" style={{ background: color }}>{run.agentName.slice(0, 1)}</span>
                        <span className="run-copy">
                          <b>{run.taskTitle || run.agentName}</b>
                          <small>{run.agentName} · {formatRelative(run.startedAt)}</small>
                        </span>
                        <span className={`run-amount ${state}`}>
                          {run.status === 'running' ? t('실행 중') : run.seconds === null ? '—' : formatDuration(run.seconds)}
                        </span>
                      </div>;
                    })}
                  </div> : <p className="ov-empty">{t("아직 실행 기록이 없어요. 에이전트에게 업무를 맡기면 여기에 쌓입니다.")}</p>}
                </div>
              </div>
            </div>

          </section>

          <section className="dashboard-work" aria-label={t("업무 보드")}>
            <div className="board-panel">
              <div className="section-header">
                <div><span className="section-kicker">{t("에이전트 상태")}</span><h2>{t("업무 보드")}</h2><p className="section-note">{scopeLabel}{t("의 업무와 에이전트 실행 상태가 자동으로 반영됩니다.")}</p></div>
                <span className="board-count">{projectTasks.length ? tf('{0}건 표시 중', visibleTasks.length) : t('표시할 업무 없음')}</span>
              </div>
              {!loading && !projects.length
                ? <div className="board-empty">
                    <ListChecks size={26} />
                    <strong>{t("아직 프로젝트가 없어요")}</strong>
                    <p>{t("보드는 프로젝트의 진행 상황을 그대로 보여줍니다. 프로젝트를 만들면 그 안의 업무가 대기 → 진행 중 → 검토 순서로 여기에 표시됩니다.")}</p>
                    <Button className="board-empty-cta" onClick={() => goTo('프로젝트')}><Plus size={16} /> {t("프로젝트 만들기")}</Button>
                  </div>
                : !loading && !projectTasks.length
                ? <div className="board-empty">
                    <ListChecks size={26} />
                    <strong>{selectedProject ? tf(`'{0}'에 아직 업무가 없어요`, selectedProject.name) : t('아직 등록된 업무가 없어요')}</strong>
                    <p>{t("에이전트에게 맡길 업무를 만들면 이 보드에 대기 → 진행 중 → 검토 순서로 표시됩니다.")}</p>
                    <Button className="board-empty-cta" onClick={() => setCreateOpen(true)}><Plus size={16} /> {t("첫 업무 만들기")}</Button>
                  </div>
                : <div className="kanban-board">
                {TASK_STATUSES.map((column) => {
                  const columnTasks = byPriority(visibleTasks.filter((task) => task.status === column));
                  return <div className="kanban-column" key={column}>
                    <div className="column-heading"><span className={`status-dot ${column === '진행 중' ? 'doing' : column === '검토' ? 'review' : ''}`} /><strong>{t(column)}</strong><span>{columnTasks.length}</span></div>
                    <ul className="task-brief-list">
                      {columnTasks.slice(0, DASHBOARD_BOARD_ROWS).map((task) => {
                        const state = agentState(task, false);
                        return <li className="task-brief" key={task.id}>
                          <span className="mini-avatar" style={{ background: task.accent }}>{task.owner[0]}</span>
                          <button className="task-brief-title" title={task.title} onClick={() => task.result ? setSelectedResult(task) : openChat({
                            projectId: task.projectId ?? '',
                            agentName: task.owner,
                            draft: tf(`'{0}' 업무를 진행해 주세요. 현재 상태와 다음에 할 일을 알려주고, 바로 처리할 수 있으면 이어서 진행해 주세요.`, task.title),
                          })}>{task.title}</button>
                          <span className={`agent-state ${state.key}`} title={t(state.label)} aria-label={tf('{0} 상태: {1}', task.owner, t(state.label))}><i className="agent-state-dot" /></span>
                          <span className={`priority-badge ${PRIORITY_CLASS[toPriority(task.priority)]}`} title={tf('중요도 {0}', t(toPriority(task.priority)))}><Flag size={10} /></span>
                          {task.result && <span className="task-brief-done" title={t("결과")}><Check size={12} /></span>}
                          <button className="task-remove" onClick={() => deleteTask(task)} aria-label={tf('{0} 삭제', task.title)} title={t("업무 삭제")}><Trash2 size={12} /></button>
                        </li>;
                      })}
                      {columnTasks.length > DASHBOARD_BOARD_ROWS && <li className="task-brief-more">{tf('+{0}건 더', columnTasks.length - DASHBOARD_BOARD_ROWS)}</li>}
                      {!loading && columnTasks.length === 0 && <li className="empty-column">{query.trim() ? t('조건에 맞는 업무가 없어요.') : t('이 단계의 업무가 없어요.')}</li>}
                    </ul>
                  </div>;
                })}
              </div>}
              {Boolean(selectedProject && projectTasks.length) && <div className="board-footer">
                <button onClick={() => openProject(selectedProject!.id)}>{t("보드 전체 보기")} <ArrowUpRight size={14} /></button>
              </div>}
            </div>


          </section>

          <section className="gov-grid" style={{ marginTop: 14 }}>
            <HealthCard onNotice={flash} onOpenTask={() => goTo('프로젝트')} />
          </section>
          <section className="overview-grid" aria-label={t("업무 통계")}>
            {/* Historical statistics follow active work. */}
            <div className="ov-row split-a">
              <div className="ov-block">
                <h2 className="ov-title">{t("주간 업무 처리량")}</h2>
                <div className="ov-card">
                  <div className="week-legend">
                    <span><i style={{ background: 'var(--c-inverse)' }} /> {t("신규")}</span>
                    <span><i style={{ background: 'var(--c-mint)' }} /> {t("검토 도달")}</span>
                  </div>
                  {weekly.length ? <div className="week-chart">
                    {weekly.map((day) => <div className="week-day" key={day.from}>
                      <div className="week-bars">
                        <i style={{ height: `${Math.max(4, (day.created / weeklyMax) * 100)}%` }} title={tf('신규 {0}건', day.created)} />
                        <i className="b" style={{ height: `${Math.max(4, (day.review / weeklyMax) * 100)}%` }} title={tf('검토 도달 {0}건', day.review)} />
                      </div>
                      <span>{weekdayLabel(day.from)}</span>
                    </div>)}
                  </div> : <p className="ov-empty">{t("표시할 업무 기록이 아직 없어요.")}</p>}
                </div>
              </div>

              <div className="ov-block">
                <h2 className="ov-title">{t("업무 상태 분포")}</h2>
                <div className="ov-card">
                  {scoped.total ? <div className="donut-wrap">
                    <div className="donut">
                      <svg viewBox="0 0 190 190" aria-label={t("업무 상태 분포")}>
                        {donutSegments.map((segment) => (
                          <circle key={segment.key} cx="95" cy="95" r="74" fill="none" stroke={segment.color} strokeWidth="30"
                            strokeDasharray={`${segment.length} ${DONUT_C - segment.length}`} strokeDashoffset={-segment.offset} />
                        ))}
                      </svg>
                      <div className="donut-center"><strong>{scoped.total}</strong><span>{t("전체 업무")}</span></div>
                    </div>
                    <div className="donut-legend">
                      {donutSegments.map((segment) => (
                        <span key={segment.key}><i style={{ background: segment.color }} /> {t(segment.key)} {segment.value}{t("건")}</span>
                      ))}
                    </div>
                  </div> : <p className="ov-empty">{t("이 범위에 표시할 업무가 없어요.")}</p>}
                </div>
              </div>
            </div>

          </section>
          </> : activeNav === '사용량'
            ? <UsageView onNotice={flash} />
            : activeNav === '승인함'
            ? <ApprovalsView onNotice={flash} onChanged={() => { refreshInbox(); void refreshTasks(); }} />
            : activeNav === '기억'
            ? <MemoryView onNotice={flash} onChanged={refreshInbox} />
            : activeNav === '스킬'
            ? <SkillsView onNotice={flash} />
            : activeNav === '대화' ? null : <WorkspaceView section={activeNav} displayName={displayName} email={email} onNotice={flash} chatTarget={chatTarget} onOpenChat={openChat} projectTarget={projectTarget}
                onProfileSaved={(next) => { if (next.displayName) setDisplayName(next.displayName.split('@')[0]); setEmail(next.email); setAvatar(next.avatar); }} />}
          {/* 대화 화면은 탭을 오가도 살려 둡니다. 이 래퍼가 page-content 의 직접 자식이라 세로 공간을 여기서 이어받아야 입력창이 화면 아래에 고정됩니다 (.chat-host). */}
          {(chatVisited || activeNav === '대화') && <div className="chat-host" hidden={activeNav !== '대화'} style={activeNav !== '대화' ? { display: 'none' } : undefined}>
            <WorkspaceView section="대화" visible={activeNav === '대화'} displayName={displayName} email={email} onNotice={flash} chatTarget={chatTarget} onOpenChat={openChat} onOpenProject={openProject} />
          </div>}
        </div>
      </section>

      <Dialog open={approvalModal} onOpenChange={setApprovalModal}>
        <DialogContent className="approval-request-dialog">
          <DialogHeader><DialogTitle>{t('승인 요청')}</DialogTitle><DialogDescription>{t('진행 전에 확인이 필요한 요청입니다. 내용을 확인하고 승인하거나 거절하세요.')}</DialogDescription></DialogHeader>
          <ApprovalsView onNotice={flash} onChanged={() => { refreshInbox(); void refreshTasks(); }} />
        </DialogContent>
      </Dialog>
      {notice && prefs.toastNotifications && <output className="toast"><Check size={16} /> {notice}</output>}

      <ApiKeyDialog onNotice={flash} onOpenChange={setApiKeyOpen} onSaved={setApiKeyState} open={apiKeyOpen} state={apiKeyState} />

      <Dialog open={Boolean(selectedResult)} onOpenChange={(open) => !open && setSelectedResult(null)}>
        <DialogContent className="result-dialog">
          <DialogHeader><DialogTitle>{tf('{0}의 실행 결과', selectedResult?.owner ?? '')}</DialogTitle><DialogDescription>{selectedResult?.title}</DialogDescription></DialogHeader>
          <div className="agent-result"><Markdown text={selectedResult?.result || ''} /></div>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </main>
  );
}
