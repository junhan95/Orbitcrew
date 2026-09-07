/**
 * 팀원 실행이 끝나면 그 결과를 매니저 대화에 '보고' 메시지로 남깁니다.
 * 대화에서 위임한 업무는 백그라운드로 돌기 때문에(lib/manager-tools asyncDelegation), 매니저는 맡긴 사실만 알리고
 * 답변을 끝내며, 실제 결과는 이 메시지로 대화에 도착합니다. 다음 턴의 매니저는 이 메시지를 히스토리로 읽고 검토합니다.
 */
import { chatMessageIndex } from './chat-agent';
import type { RunTaskSuccess } from './run-task';

const REPORT_MAX_CHARS = 6_000;

export async function reportToManagerChat(db: D1Database, userId: string, taskId: string, outcome: RunTaskSuccess): Promise<{ delivered: boolean; agentId?: string }> {
  const task = await db.prepare('SELECT title, owner, project_id AS projectId FROM tasks WHERE id = ? AND user_id = ?').bind(taskId, userId)
    .first<{ title: string; owner: string; projectId: string | null }>();
  if (!task?.projectId) return { delivered: false };
  const manager = await db.prepare('SELECT id, name FROM agents WHERE user_id = ? AND project_id = ? AND is_manager = 1 LIMIT 1').bind(userId, task.projectId)
    .first<{ id: string; name: string }>();
  if (!manager) return { delivered: false };

  const body = outcome.blocked
    ? `⚠️ 진행 불가: ${outcome.blockedReason ?? '사유 미기재'}`
    : (outcome.summary || outcome.output || '').trim() || '(요약 없음)';
  const clipped = body.length > REPORT_MAX_CHARS ? `${body.slice(0, REPORT_MAX_CHARS)}…` : body;
  const lines = [
    `📥 **${task.owner}** 보고 — ${task.title}`,
    '',
    clipped,
  ];
  if (outcome.proof.length) lines.push('', `검증 근거: ${outcome.proof.join(' · ')}`);
  if (outcome.nextActions.length) lines.push('', `다음 단계: ${outcome.nextActions.join(' · ')}`);
  lines.push('', `_전체 결과: [**'${task.title}' 결과 보기**](#task/${taskId}) — 검토가 필요하면 말씀해 주세요._`);
  const content = lines.join('\n');

  const id = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db.prepare('INSERT INTO chat_messages (id, user_id, project_id, agent_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, userId, task.projectId, manager.id, 'assistant', content, now),
    chatMessageIndex(db, { userId, messageId: id, projectId: task.projectId, agentName: manager.name, role: 'assistant', content, createdAt: now }),
  ]);
  return { delivered: true, agentId: manager.id };
}
