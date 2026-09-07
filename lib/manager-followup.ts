/**
 * 매니저 자동 진행 — 팀원 보고가 임무 스레드에 도착하면 사용자가 답하지 않아도 매니저의 차례를 한 번 엽니다.
 *
 *   팀원 실행 끝 → '📥 보고' 저장 (lib/manager-report) → 이 모듈이 매니저 턴 실행
 *     → 검토가 안 됐으면 QA 에게 검토 위임 (카드 생성, 브라우저가 실행 시작)
 *     → 검토 보고까지 왔으면 최종 결과를 사용자에게 안내
 *
 * 위임이 새로 생기면 /api/agents/run 응답의 followUp.delegated 로 돌려주고, 브라우저가 그 실행을 다시 시작합니다
 * (실행 → 보고 → 자동 진행 … 의 사슬). 무한 반복을 막기 위해 사슬 깊이를 MAX_FOLLOW_UP_DEPTH 로 제한합니다.
 */
import { chatMessageIndex, prepareChatTurn, type ChatContext } from './chat-agent';
import { runClaudeAgent, type ClaudeCredential } from './claude';
import type { ManagerLog } from './manager-tools';
import { resolveAgentModel } from './models';
import { usageInsert } from './usage';
import { traceError } from './telemetry';

/** 보고 → 자동 진행 → 위임 → 보고 … 사슬의 최대 깊이 (작성 → 검토 → 수정 → 재검토 → 마무리 정도) */
export const MAX_FOLLOW_UP_DEPTH = 4;
const FOLLOW_UP_MAX_TOKENS = 4_000;
const FOLLOW_UP_MAX_ITERATIONS = 12;

export type FollowUpResult = {
  ran: boolean;
  reason?: string;
  messageId?: string;
  text?: string;
  delegated: ManagerLog['delegated'];
  recruited: ManagerLog['recruited'];
};

/** 매니저에게 건네는 자동 진행 지시 (저장하지 않는 임시 사용자 턴). */
export function followUpPrompt(params: { reporter: string; title: string; blocked: boolean; depth: number }): string {
  const lines = [
    `[자동 진행] ${params.reporter} 의 '${params.title}' 보고가 방금 위 메시지로 도착했습니다. 사용자는 지금 답하지 않습니다 — 임무의 최초 지시와 '이번 임무' 섹션을 기준으로 다음 단계를 스스로 진행하세요.`,
  ];
  if (params.blocked) {
    lines.push('- 보고가 진행 불가입니다. 지시를 보완해 같은 팀원에게 한 번만 다시 맡기거나, 사용자의 결정이 필요하면 무엇이 필요한지 알리고 끝내세요.');
  } else {
    lines.push(
      "- 이 결과가 아직 검토(QA) 팀원의 검토를 거치지 않았다면: read_task_result 로 결과 전문을 읽고, QA 팀원에게 delegate_task 로 검토를 맡기세요 (brief 에 결과 전문과 검토 기준을 그대로 넣습니다). QA 팀원이 없으면 recruit_agent 로 합류시키세요. 임무가 검토 담당을 요구하지 않고 결과가 단순하면 검토를 생략하고 바로 마무리해도 됩니다.",
      '- 방금 도착한 것이 검토 보고라면: important 지적이 결과물에 반영돼야 하면 작성 담당에게 수정을 한 번만 더 맡기고, 그렇지 않으면 최종 결과를 사용자에게 안내하며 끝내세요 — 무엇이 만들어졌고 어디에 저장됐는지(파일명), 핵심 내용 요약, 미확인·확인 필요 항목, 검토 결과 요약. 결과 링크는 보고 메시지의 형식([**\'제목\' 결과 보기**](#task/<id>))을 그대로 쓰세요.',
    );
  }
  lines.push(
    '- 위임했다면 누구에게 무엇을 맡겼는지 한두 문장으로만 알리고 끝내세요. 같은 일을 두 번 맡기지 말고, 이미 검토까지 끝난 결과를 다시 검토시키지 마세요.',
    `- 이번 임무에서 자동 진행은 ${MAX_FOLLOW_UP_DEPTH}단계까지만 이어집니다 (지금 ${params.depth + 1}단계). 남은 단계가 없으면 현재 결과로 마무리 안내를 하세요.`,
  );
  return lines.join('\n');
}

export async function runManagerFollowUp(db: D1Database, userId: string, params: {
  projectId: string; managerAgentId: string; threadId: string;
  reporter: string; title: string; blocked: boolean; depth: number;
  apiKey: ClaudeCredential; fallbackModel: string; folderContext?: string;
}): Promise<FollowUpResult> {
  const empty: FollowUpResult = { ran: false, delegated: [], recruited: [] };
  if (params.depth >= MAX_FOLLOW_UP_DEPTH) return { ...empty, reason: 'depth' };

  const context = await db.prepare(`SELECT p.name AS projectName, p.description AS projectDescription,
      a.name AS agentName, a.role AS agentRole, a.instructions AS instructions, a.model AS agentModel, a.is_manager AS isManager
    FROM projects p
    JOIN project_agents pa ON pa.project_id = p.id AND pa.user_id = p.user_id
    JOIN agents a ON a.id = pa.agent_id AND a.user_id = p.user_id
    WHERE p.id = ? AND a.id = ? AND p.user_id = ?`)
    .bind(params.projectId, params.managerAgentId, userId).first<ChatContext & { agentModel: string | null; isManager: number }>();
  if (!context?.isManager) return { ...empty, reason: 'no_manager' };

  const chat = await prepareChatTurn(db, userId, {
    projectId: params.projectId, agentId: params.managerAgentId, context, taskId: params.threadId,
    manager: { apiKey: params.apiKey, fallbackModel: params.fallbackModel, folderContext: params.folderContext ?? '', autonomy: 'auto' },
  });
  const prompt = followUpPrompt({ reporter: params.reporter, title: params.title, blocked: params.blocked, depth: params.depth });
  const model = resolveAgentModel(context.agentModel, params.fallbackModel);

  try {
    const result = await runClaudeAgent({
      apiKey: params.apiKey, model,
      maxTokens: FOLLOW_UP_MAX_TOKENS, maxIterations: FOLLOW_UP_MAX_ITERATIONS,
      system: chat.system,
      messages: [...chat.messages, { role: 'user', content: prompt }],
      tools: chat.tools, executeTool: chat.executeTool,
    });
    const text = result.text.trim();
    if (!text) return { ...empty, reason: 'empty', delegated: chat.managerLog.delegated, recruited: chat.managerLog.recruited };

    const id = crypto.randomUUID();
    const now = Date.now();
    await db.batch([
      db.prepare('INSERT INTO chat_messages (id, user_id, project_id, agent_id, role, content, created_at, task_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, userId, params.projectId, params.managerAgentId, 'assistant', text, now, params.threadId || null),
      chatMessageIndex(db, { userId, messageId: id, projectId: params.projectId, agentName: context.agentName, role: 'assistant', content: text, createdAt: now }),
      usageInsert(db, { userId, kind: 'chat', result, refId: id, projectId: params.projectId, agentName: context.agentName }),
    ]);
    return { ran: true, messageId: id, text, delegated: chat.managerLog.delegated, recruited: chat.managerLog.recruited };
  } catch (error) {
    traceError('manager.follow_up_failed', error);
    return { ...empty, reason: error instanceof Error ? error.message : 'failed', delegated: chat.managerLog.delegated, recruited: chat.managerLog.recruited };
  }
}
