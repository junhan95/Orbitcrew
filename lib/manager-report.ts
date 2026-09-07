/**
 * 팀원 실행이 끝나면 그 결과를 매니저 대화에 '보고' 메시지로 남깁니다.
 * 대화에서 위임한 업무는 백그라운드로 돌기 때문에(lib/manager-tools asyncDelegation), 매니저는 맡긴 사실만 알리고
 * 답변을 끝내며, 실제 결과는 이 메시지로 대화에 도착합니다. 다음 턴의 매니저는 이 메시지를 히스토리로 읽고 검토합니다.
 */
import { chatMessageIndex } from './chat-agent';
import type { RunTaskSuccess } from './run-task';
import { listTaskFiles } from './task-files';

const REPORT_MAX_CHARS = 6_000;

export type ReportDelivery = { delivered: boolean; agentId?: string; projectId?: string; threadId?: string; owner?: string; title?: string };

export async function reportToManagerChat(db: D1Database, userId: string, taskId: string, outcome: RunTaskSuccess): Promise<ReportDelivery> {
  const task = await db.prepare('SELECT title, owner, project_id AS projectId, parent_task_id AS parentTaskId FROM tasks WHERE id = ? AND user_id = ?').bind(taskId, userId)
    .first<{ title: string; owner: string; projectId: string | null; parentTaskId: string | null }>();
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
  const files = await listTaskFiles(db, userId, taskId);
  if (files.length) lines.push('', `📎 산출물 파일: ${files.map((file) => `\`${file.path}\``).join(' · ')}`);
  if (outcome.proof.length) lines.push('', `검증 근거: ${outcome.proof.join(' · ')}`);
  if (outcome.nextActions.length) lines.push('', `다음 단계: ${outcome.nextActions.join(' · ')}`);
  // 중간 보고에는 결과 링크를 넣지 않습니다 — 사용자에게는 검토까지 끝난 최종 결과만 매니저가 안내합니다 (카드 id 는 매니저가 링크를 만들 때 씁니다).
  lines.push('', `_카드 id ${taskId} · 매니저가 검토를 거쳐 최종 결과를 안내합니다._`);
  const content = lines.join('\n');

  const id = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    // 보고는 위임이 나간 임무 스레드로 들어갑니다 (부모 카드가 없으면 일반 대화).
    db.prepare('INSERT INTO chat_messages (id, user_id, project_id, agent_id, role, content, created_at, task_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, userId, task.projectId, manager.id, 'assistant', content, now, task.parentTaskId),
    chatMessageIndex(db, { userId, messageId: id, projectId: task.projectId, agentName: manager.name, role: 'assistant', content, createdAt: now }),
  ]);
  return { delivered: true, agentId: manager.id, projectId: task.projectId, threadId: task.parentTaskId ?? '', owner: task.owner, title: task.title };
}
