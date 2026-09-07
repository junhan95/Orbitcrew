import { getCurrentUser } from '@/app/auth';
import { isReviewStatus } from '@/lib/task-status';
import { getDatabase } from '@/db';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const BUCKETS = 12;
const BUCKET_MS = HOUR / BUCKETS;
// 대쉬보드 '주간 업무 처리량'과 '검토 도달률 추이'가 쓰는 일수
const WEEK_DAYS = 7;

type StatusRow = { status: string; count: number };
type RunSummaryRow = { total: number | null; running: number | null; completed: number | null; failed: number | null; lastHour: number | null; avgMs: number | null };
type RunTickRow = { startedAt: number };
type RecentRunRow = { agentName: string; status: string; outcome: string | null; startedAt: number; completedAt: number | null; taskTitle: string | null };
type TaskTickRow = { status: string; createdAt: number; updatedAt: number };
type ProjectRow = {
  id: string; name: string; description: string; color: string; status: string;
  taskCount: number; waitingCount: number; doingCount: number; reviewCount: number; highCount: number;
};
type AgentRow = { id: string; name: string; role: string; color: string; runningCount: number; activeTasks: number; lastRunAt: number | null };

export async function GET() {
  const user = await getCurrentUser();
  const db = getDatabase();
  const now = Date.now();
  const since = now - HOUR;

  const [statusRows, runSummary, runTicks, recentRuns, taskTicks, projectRows, agentRows] = await Promise.all([
    // 대쉬보드는 프로젝트에 속한 업무만 셉니다. (프로젝트가 지워져 연결이 끊긴 업무는 집계에서 제외)
    db.prepare('SELECT status, COUNT(*) AS count FROM tasks WHERE user_id = ? AND project_id IS NOT NULL GROUP BY status')
      .bind(user.userId).all<StatusRow>(),
    db.prepare(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN started_at >= ? THEN 1 ELSE 0 END) AS lastHour,
        AVG(CASE WHEN status = 'completed' AND completed_at IS NOT NULL THEN completed_at - started_at END) AS avgMs
      FROM agent_runs WHERE user_id = ?`).bind(since, user.userId).first<RunSummaryRow>(),
    db.prepare('SELECT started_at AS startedAt FROM agent_runs WHERE user_id = ? AND started_at >= ?')
      .bind(user.userId, since).all<RunTickRow>(),
    // 대쉬보드 '최근 에이전트 실행' 리스트 — 최근 5건만 보여줍니다.
    db.prepare(`SELECT r.agent_name AS agentName, r.status, r.outcome,
        r.started_at AS startedAt, r.completed_at AS completedAt, t.title AS taskTitle
      FROM agent_runs r LEFT JOIN tasks t ON t.id = r.task_id
      WHERE r.user_id = ? ORDER BY r.started_at DESC LIMIT 5`).bind(user.userId).all<RecentRunRow>(),
    // 주간 처리량·도달률 추이용 원본. 업무 수가 많지 않아 JS 쪽에서 날짜별로 나눕니다.
    db.prepare('SELECT status, created_at AS createdAt, updated_at AS updatedAt FROM tasks WHERE user_id = ? AND project_id IS NOT NULL')
      .bind(user.userId).all<TaskTickRow>(),
    // 프로젝트별 진행 상황 — 대쉬보드의 프로젝트 선택기와 집중 카드가 이 배열을 씁니다.
    db.prepare(`SELECT p.id, p.name, p.description, p.color, p.status,
        COUNT(t.id) AS taskCount,
        SUM(CASE WHEN t.status = '대기' THEN 1 ELSE 0 END) AS waitingCount,
        SUM(CASE WHEN t.status = '진행 중' THEN 1 ELSE 0 END) AS doingCount,
        SUM(CASE WHEN t.status IN ('검토 중', '검토 완료') THEN 1 ELSE 0 END) AS reviewCount,
        SUM(CASE WHEN t.priority = '높음' AND t.status NOT IN ('검토 중', '검토 완료') THEN 1 ELSE 0 END) AS highCount
      FROM projects p LEFT JOIN tasks t ON t.project_id = p.id AND t.user_id = p.user_id
      WHERE p.user_id = ? GROUP BY p.id ORDER BY p.updated_at DESC`).bind(user.userId).all<ProjectRow>(),
    db.prepare(`SELECT a.id, a.name, a.role, a.color,
        (SELECT COUNT(*) FROM agent_runs r WHERE r.user_id = a.user_id AND r.agent_name = a.name AND r.status = 'running') AS runningCount,
        (SELECT COUNT(*) FROM tasks t WHERE t.user_id = a.user_id AND t.owner = a.name AND t.status = '진행 중' AND t.project_id IS NOT NULL) AS activeTasks,
        (SELECT MAX(r.started_at) FROM agent_runs r WHERE r.user_id = a.user_id AND r.agent_name = a.name) AS lastRunAt
      FROM agents a WHERE a.user_id = ? ORDER BY a.is_default DESC, a.created_at ASC`).bind(user.userId).all<AgentRow>(),
  ]);

  const byStatus = new Map(statusRows.results.map((row) => [row.status, Number(row.count) || 0]));
  const waiting = byStatus.get('대기') ?? 0;
  const doing = byStatus.get('진행 중') ?? 0;
  const review = (byStatus.get('검토 중') ?? 0) + (byStatus.get('검토 완료') ?? 0);
  const total = waiting + doing + review;

  // 최근 60분을 5분 단위 12칸으로 나눈 실행 횟수 히스토그램
  const histogram: number[] = Array.from({ length: BUCKETS }, () => 0);
  for (const tick of runTicks.results) {
    const index = Math.min(BUCKETS - 1, Math.max(0, Math.floor((tick.startedAt - since) / BUCKET_MS)));
    histogram[index] += 1;
  }

  const avgMs = runSummary?.avgMs ?? null;

  // 오늘을 포함한 최근 7일. 자정 기준으로 끊습니다.
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const todayStart = midnight.getTime();
  const days = Array.from({ length: WEEK_DAYS }, (_, index) => todayStart - (WEEK_DAYS - 1 - index) * DAY);

  // 일자별 신규 업무 / 검토 도달 건수 (검토 도달 시각은 마지막 수정 시각으로 봅니다)
  const weekly = days.map((from) => {
    const to = from + DAY;
    let created = 0;
    let review = 0;
    for (const row of taskTicks.results) {
      if (row.createdAt >= from && row.createdAt < to) created += 1;
      if (isReviewStatus(row.status) && row.updatedAt >= from && row.updatedAt < to) review += 1;
    }
    return { from, created, review };
  });

  // 그날까지 쌓인 업무 대비 검토 도달 비율 (누적 기준이라 추이가 튀지 않습니다)
  const trend = days.map((from) => {
    const to = from + DAY;
    let opened = 0;
    let reviewed = 0;
    for (const row of taskTicks.results) {
      if (row.createdAt < to) opened += 1;
      if (isReviewStatus(row.status) && row.updatedAt < to) reviewed += 1;
    }
    return { from, rate: opened ? Math.round((reviewed / opened) * 100) : 0 };
  });

  const projects = projectRows.results.map((project) => {
    const taskCount = Number(project.taskCount) || 0;
    const reviewCount = Number(project.reviewCount) || 0;
    return {
      id: project.id, name: project.name, description: project.description, color: project.color, status: project.status,
      taskCount,
      waitingCount: Number(project.waitingCount) || 0,
      doingCount: Number(project.doingCount) || 0,
      reviewCount,
      progress: taskCount ? Math.round((reviewCount / taskCount) * 100) : 0,
      // 아직 끝나지 않은 '높음' 중요도 업무 수 — 대쉬보드가 "지금 먼저 봐야 할 일"로 보여줍니다.
      highCount: Number(project.highCount) || 0,
    };
  });

  return Response.json({
    tasks: {
      total, waiting, doing, review,
      completionRate: total ? Math.round((review / total) * 100) : 0,
    },
    runs: {
      total: Number(runSummary?.total ?? 0),
      completed: Number(runSummary?.completed ?? 0),
      failed: Number(runSummary?.failed ?? 0),
      running: Number(runSummary?.running ?? 0),
      lastHour: Number(runSummary?.lastHour ?? 0),
      avgSeconds: avgMs === null ? null : Math.round(avgMs / 1000),
      histogram,
      recent: recentRuns.results.map((run) => ({
        agentName: run.agentName,
        taskTitle: run.taskTitle ?? '',
        status: run.status,
        outcome: run.outcome ?? null,
        startedAt: run.startedAt,
        seconds: run.completedAt ? Math.max(0, Math.round((run.completedAt - run.startedAt) / 1000)) : null,
      })),
    },
    weekly,
    trend,
    projects,
    // 가장 최근에 손댄 프로젝트 = 지금 집중할 프로젝트 (대쉬보드 기본 선택값)
    focus: projects[0] ?? null,
    agents: agentRows.results.map((agent) => ({
      id: agent.id, name: agent.name, role: agent.role, color: agent.color,
      runningCount: Number(agent.runningCount) || 0,
      activeTasks: Number(agent.activeTasks) || 0,
      lastRunAt: agent.lastRunAt ?? null,
    })),
  });
}
