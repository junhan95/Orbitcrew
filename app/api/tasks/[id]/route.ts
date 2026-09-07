import { getCurrentUser } from '@/app/auth';
import { getDatabase } from '@/db';
import { isPriority } from '@/lib/priority';
import { isReviewStatus, isTaskStatus } from '@/lib/task-status';
import { recallDocDelete, recallDocUpsert } from '@/lib/recall';

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

type TaskRow = {
  id: string; title: string; label: string; owner: string; status: string;
  priority: string; accent: string; result: string | null; summary: string | null; blockedReason: string | null; reviewVerdict: string | null; projectId: string | null;
};

const SELECT_TASK = 'SELECT id, title, label, owner, status, priority, accent, result, summary, blocked_reason AS blockedReason, review_verdict AS reviewVerdict, project_id AS projectId FROM tasks WHERE id = ? AND user_id = ?';

export async function PATCH(request: Request, context: RouteContext) {
  const user = await getCurrentUser();
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: '요청 본문이 올바르지 않습니다.' }, { status: 400 });

  const db = getDatabase();
  const existing = await db.prepare(SELECT_TASK).bind(id, user.userId).first<TaskRow>();
  if (!existing) return Response.json({ error: '업무를 찾을 수 없습니다.' }, { status: 404 });

  const columns: string[] = [];
  const values: (string | number | null)[] = [];

  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 100) {
      return Response.json({ error: '업무 이름은 1~100자로 입력해 주세요.' }, { status: 400 });
    }
    columns.push('title = ?'); values.push(body.title.trim());
  }
  if (body.status !== undefined) {
    if (!isTaskStatus(body.status)) return Response.json({ error: '업무 상태가 올바르지 않습니다.' }, { status: 400 });
    columns.push('status = ?'); values.push(body.status);
    // 사람이 상태를 직접 옮기면 '막힘' 표시는 해제합니다 (다음 실행 컨텍스트에는 댓글로 남은 사유가 여전히 보입니다).
    if (existing.blockedReason) { columns.push('blocked_reason = ?'); values.push(null); }
    // 사람이 상태를 옮기면 이전 검토 판정도 지웁니다 (새 결과에 새 검토).
    if (existing.reviewVerdict) { columns.push('review_verdict = ?'); values.push(null); }
  }
  if (body.label !== undefined) {
    if (typeof body.label !== 'string' || !body.label.trim()) return Response.json({ error: '분류를 입력해 주세요.' }, { status: 400 });
    columns.push('label = ?'); values.push(body.label.trim().slice(0, 20));
  }
  if (body.priority !== undefined) {
    if (!isPriority(body.priority)) return Response.json({ error: '중요도는 높음·중간·낮음 중 하나여야 합니다.' }, { status: 400 });
    columns.push('priority = ?'); values.push(body.priority);
  }
  if (body.owner !== undefined) {
    if (typeof body.owner !== 'string' || !body.owner.trim()) return Response.json({ error: '담당 에이전트를 지정해 주세요.' }, { status: 400 });
    const agent = await db.prepare('SELECT name, color FROM agents WHERE user_id = ? AND name = ? LIMIT 1').bind(user.userId, body.owner.trim()).first<{ name: string; color: string }>();
    if (!agent) return Response.json({ error: '존재하지 않는 에이전트입니다.' }, { status: 400 });
    columns.push('owner = ?'); values.push(agent.name);
    columns.push('accent = ?'); values.push(agent.color);
  }
  if (body.projectId !== undefined) {
    if (body.projectId !== null && typeof body.projectId !== 'string') {
      return Response.json({ error: '프로젝트 값이 올바르지 않습니다.' }, { status: 400 });
    }
    if (typeof body.projectId === 'string') {
      const owned = await db.prepare('SELECT id FROM projects WHERE user_id = ? AND id = ?').bind(user.userId, body.projectId).first<{ id: string }>();
      if (!owned) return Response.json({ error: '존재하지 않는 프로젝트입니다.' }, { status: 400 });
    }
    columns.push('project_id = ?'); values.push(body.projectId as string | null);
  }
  // 상태를 검토 단계(검토 중·검토 완료) 밖으로 되돌리면 이전 실행 결과는 지웁니다.
  if (body.status !== undefined && !isReviewStatus(body.status) && existing.result) {
    columns.push('result = ?'); values.push(null);
    columns.push('summary = ?'); values.push(null);
  }

  if (!columns.length) return Response.json({ error: '변경할 항목이 없습니다.' }, { status: 400 });

  columns.push('updated_at = ?'); values.push(Date.now());
  await db.prepare(`UPDATE tasks SET ${columns.join(', ')} WHERE id = ? AND user_id = ?`).bind(...values, id, user.userId).run();

  const task = await db.prepare(SELECT_TASK).bind(id, user.userId).first<TaskRow>();
  if (task) {
    await recallDocUpsert(db, { userId: user.userId, kind: 'task', refId: task.id, projectId: task.projectId, agentName: task.owner, title: task.title, content: `[${task.label}] ${task.title} — 담당 ${task.owner}`, createdAt: Date.now() }).run();
  }
  return Response.json({ task });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const user = await getCurrentUser();
  const { id } = await context.params;
  const db = getDatabase();
  const existing = await db.prepare('SELECT id FROM tasks WHERE id = ? AND user_id = ?').bind(id, user.userId).first<{ id: string }>();
  if (!existing) return Response.json({ error: '업무를 찾을 수 없습니다.' }, { status: 404 });
  // agent_runs 는 FK ON DELETE CASCADE 로 함께 정리됩니다. 회상 인덱스는 FK 가 없어 직접 지웁니다.
  await db.batch([
    db.prepare(`DELETE FROM recall_docs WHERE user_id = ? AND ((kind = 'task' AND ref_id = ?) OR (kind = 'run' AND ref_id IN (SELECT id FROM agent_runs WHERE task_id = ?)))`).bind(user.userId, id, id),
    recallDocDelete(db, 'task', id),
    db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').bind(id, user.userId),
  ]);
  return Response.json({ id });
}
