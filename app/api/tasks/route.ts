import { getCurrentUser } from '@/app/auth';
import { getDatabase } from '@/db';
import { PRIORITY_ORDER_SQL, isPriority } from '@/lib/priority';
import { isTaskStatus } from '@/lib/task-status';
import { recallDocUpsert } from '@/lib/recall';
import { sweepStaleRuns } from '@/lib/stale-runs';

type TaskRow = {
  id: string; title: string; label: string; owner: string; status: string;
  priority: string; accent: string; result: string | null; summary: string | null; blockedReason: string | null; reviewVerdict: string | null; projectId: string | null; parentTaskId: string | null;
  updatedAt?: number;
  /** 이 카드의 실행 횟수 — 0 이면 위임만 되고 아직 시작되지 않은 카드 (대화 화면이 이어서 시작합니다). */
  runCount?: number;
};

// 중요도 높은 카드가 위에 오고, 같은 중요도면 만든 순서를 지킵니다.
const TASK_COLUMNS = 'id, title, label, owner, status, priority, accent, result, summary, blocked_reason AS blockedReason, review_verdict AS reviewVerdict, project_id AS projectId, parent_task_id AS parentTaskId, updated_at AS updatedAt, (SELECT COUNT(*) FROM agent_runs r WHERE r.task_id = tasks.id AND r.user_id = tasks.user_id) AS runCount';
const SELECT_TASKS = `SELECT ${TASK_COLUMNS} FROM tasks WHERE user_id = ? ORDER BY ${PRIORITY_ORDER_SQL}, created_at ASC`;
const SELECT_PROJECT_TASKS = `SELECT ${TASK_COLUMNS} FROM tasks WHERE user_id = ? AND project_id = ? ORDER BY ${PRIORITY_ORDER_SQL}, created_at ASC`;

/**
 * 업무 목록.
 * 데모용 시드는 만들지 않습니다 — 업무는 항상 사용자가(또는 에이전트가) 프로젝트 안에서 만든 것만 존재합니다.
 * ?projectId=... 를 주면 그 프로젝트의 업무만 돌려줍니다.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  const db = getDatabase();
  const projectId = new URL(request.url).searchParams.get('projectId');
  // 탭이 닫혀 끝맺음이 기록되지 않은 실행은 여기서 정리해, 보드가 '진행 중' 에 굳어 있지 않게 합니다 (lib/stale-runs).
  await sweepStaleRuns(db, user.userId).catch(() => undefined);
  const result = projectId
    ? await db.prepare(SELECT_PROJECT_TASKS).bind(user.userId, projectId).all<TaskRow>()
    : await db.prepare(SELECT_TASKS).bind(user.userId).all<TaskRow>();
  return Response.json({ tasks: result.results });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  const body = await request.json().catch(() => null) as {
    title?: unknown; owner?: unknown; label?: unknown; priority?: unknown; status?: unknown; projectId?: unknown; description?: unknown;
  } | null;

  if (typeof body?.title !== 'string' || !body.title.trim() || body.title.trim().length > 100) {
    return Response.json({ error: '업무 이름은 1~100자로 입력해 주세요.' }, { status: 400 });
  }
  if (body.priority !== undefined && !isPriority(body.priority)) {
    return Response.json({ error: '중요도는 높음·중간·낮음 중 하나여야 합니다.' }, { status: 400 });
  }
  if (body.status !== undefined && !isTaskStatus(body.status)) {
    return Response.json({ error: '업무 상태가 올바르지 않습니다.' }, { status: 400 });
  }

  const db = getDatabase();

  // 업무는 반드시 프로젝트에 속합니다. 지정이 없으면 가장 최근에 손댄 프로젝트로 붙이고,
  // 프로젝트가 하나도 없으면 만들지 않습니다(대쉬보드에서 영영 안 보이는 고아 업무 방지).
  let projectId = typeof body.projectId === 'string' && body.projectId ? body.projectId : null;
  if (projectId) {
    const owned = await db.prepare('SELECT id FROM projects WHERE user_id = ? AND id = ?').bind(user.userId, projectId).first<{ id: string }>();
    if (!owned) return Response.json({ error: '존재하지 않는 프로젝트입니다.' }, { status: 400 });
  } else {
    const fallback = await db.prepare('SELECT id FROM projects WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1').bind(user.userId).first<{ id: string }>();
    projectId = fallback?.id ?? null;
  }
  if (!projectId) return Response.json({ error: '먼저 프로젝트를 만들어 주세요. 업무는 프로젝트 안에서만 만들 수 있습니다.' }, { status: 400 });

  // 담당을 지정하면 그 에이전트에게, 비워 두면 그 프로젝트의 매니저에게 갑니다.
  // (사용자는 매니저에게 지시하고, 매니저가 필요한 직무를 합류시켜 나눠 맡깁니다.)
  const requestedOwner = typeof body.owner === 'string' && body.owner.trim() ? body.owner.trim() : null;
  const agent = requestedOwner
    ? await db.prepare('SELECT name, color FROM agents WHERE user_id = ? AND name = ? LIMIT 1').bind(user.userId, requestedOwner).first<{ name: string; color: string }>()
    : await db.prepare('SELECT name, color FROM agents WHERE user_id = ? AND project_id = ? AND is_manager = 1 LIMIT 1').bind(user.userId, projectId).first<{ name: string; color: string }>();
  if (requestedOwner && !agent) return Response.json({ error: '존재하지 않는 에이전트입니다.' }, { status: 400 });
  if (!agent) return Response.json({ error: '이 프로젝트의 매니저를 찾지 못했습니다.' }, { status: 400 });

  const task: TaskRow = {
    id: crypto.randomUUID(),
    title: body.title.trim(),
    label: typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 20) : '신규',
    owner: agent.name,
    status: isTaskStatus(body.status) ? body.status : '대기',
    priority: isPriority(body.priority) ? body.priority : '중간',
    accent: agent.color,
    result: null,
    summary: null,
    blockedReason: null,
    reviewVerdict: null,
    projectId,
    parentTaskId: null,
  };

  const description = typeof body.description === 'string' ? body.description.slice(0, 8000) : '';
  const now = Date.now();
  await db.batch([
    db.prepare('INSERT INTO tasks (id, user_id, title, label, owner, status, priority, accent, project_id, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(task.id, user.userId, task.title, task.label, task.owner, task.status, task.priority, task.accent, task.projectId, description, now, now),
    recallDocUpsert(db, { userId: user.userId, kind: 'task', refId: task.id, projectId: task.projectId, agentName: task.owner, title: task.title, content: `[${task.label}] ${task.title} — 담당 ${task.owner}`, createdAt: now }),
  ]);
  await db.prepare('UPDATE projects SET updated_at = ? WHERE id = ? AND user_id = ?').bind(now, task.projectId, user.userId).run();
  return Response.json({ task }, { status: 201 });
}
