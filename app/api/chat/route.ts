import { traceRequest, traceError } from '@/lib/telemetry';
import { getCurrentUser } from '@/app/auth';
import { getDatabase, getRuntimeConfig } from '@/db';
import { MEMORY_REVIEW_EVERY, chatMessageIndex, prepareChatTurn, type ChatContext } from '@/lib/chat-agent';
import { credentialErrorResponse, resolveCredential } from '@/lib/credits';
import type { ClaudeCredential } from '@/lib/claude';
import { compactConversation, loadChatSummary, shouldCompact } from '@/lib/compaction';
import { runInBackground, runMemoryReview } from '@/lib/memory-review';
import { runClaudeAgent } from '@/lib/claude';
import { resolveAgentModel } from '@/lib/models';
import { usageInsert } from '@/lib/usage';
import { THREAD_WHERE, resolveMission } from '@/lib/mission';

type ChatRow = { id: string; role: 'user' | 'assistant'; content: string; createdAt: number };

const MAX_ITERATIONS = 4;
/** 매니저는 대화 중에도 채용·위임·검토를 하므로 반복 여유를 더 줍니다 */
const MANAGER_MAX_ITERATIONS = 14;
const MAX_FOLDER_CONTEXT = 60_000;

async function handleGET(request: Request) {
  const user = await getCurrentUser();
  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId');
  const agentId = url.searchParams.get('agentId');
  // 스레드(임무 카드 id). 비어 있으면 스레드 없는 일반 대화만.
  let threadId = url.searchParams.get('taskId') ?? '';
  if (!projectId || !agentId) return Response.json({ messages: [], summary: null });
  const db = getDatabase();
  if (threadId) threadId = (await resolveMission(db, user.userId, projectId, threadId))?.id ?? '';
  // 요약(chat_summaries)이 있으면 그 이후 메시지만 원문으로 보내고, 요약은 배너용으로 함께 돌려줍니다.
  const summary = await loadChatSummary(db, user.userId, projectId, agentId, threadId);
  const messages = await db
    .prepare(`SELECT id, role, content, created_at AS createdAt FROM chat_messages WHERE user_id = ? AND project_id = ? AND agent_id = ? AND ${THREAD_WHERE} ORDER BY created_at DESC LIMIT 200`)
    .bind(user.userId, projectId, agentId, threadId).all<ChatRow>();
  return Response.json({ messages: messages.results.reverse(), summary });
}

/** 비스트리밍 대화. 스트리밍은 /api/chat/stream 이 같은 lib/chat-agent 헬퍼로 처리합니다. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  const body = await request.json().catch(() => null) as { projectId?: unknown; agentId?: unknown; message?: unknown; folderContext?: unknown } | null;
  if (typeof body?.projectId !== 'string' || typeof body.agentId !== 'string' || typeof body.message !== 'string' || !body.message.trim()) {
    return Response.json({ error: '프로젝트, 에이전트, 메시지가 필요합니다.' }, { status: 400 });
  }
  const projectId = body.projectId;
  const agentId = body.agentId;
  const message = body.message.trim().slice(0, 4000);
  const folderContext = typeof body.folderContext === 'string' ? body.folderContext.trim().slice(0, MAX_FOLDER_CONTEXT) : '';
  const db = getDatabase();

  const context = await db.prepare(`SELECT p.name AS projectName, p.description AS projectDescription,
      a.name AS agentName, a.role AS agentRole, a.instructions AS instructions, a.model AS agentModel, a.is_manager AS isManager
    FROM projects p
    JOIN project_agents pa ON pa.project_id = p.id AND pa.user_id = p.user_id
    JOIN agents a ON a.id = pa.agent_id AND a.user_id = p.user_id
    WHERE p.id = ? AND a.id = ? AND p.user_id = ?`)
    .bind(projectId, agentId, user.userId).first<ChatContext & { agentModel: string | null; isManager: number }>();
  if (!context) return Response.json({ error: '이 프로젝트에 배정된 에이전트가 아닙니다.' }, { status: 403 });

  const userMessage: ChatRow = { id: crypto.randomUUID(), role: 'user', content: message, createdAt: Date.now() };
  await db.batch([
    db.prepare('INSERT INTO chat_messages (id, user_id, project_id, agent_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(userMessage.id, user.userId, projectId, agentId, 'user', message, userMessage.createdAt),
    chatMessageIndex(db, { userId: user.userId, messageId: userMessage.id, projectId, agentName: context.agentName, role: 'user', content: message, createdAt: userMessage.createdAt }),
  ]);

  const { model: fallbackModel } = getRuntimeConfig();
  const model = resolveAgentModel(context.agentModel, fallbackModel);
  let apiKey: ClaudeCredential;
  try { apiKey = await resolveCredential(db, user.userId); }
  catch (error) { const denied = credentialErrorResponse(error, { userMessage }); if (denied) return denied; throw error; }

  const chat = await prepareChatTurn(db, user.userId, {
    projectId, agentId, context,
    // 매니저와의 대화면 채용·위임·카드 생성 도구를 붙입니다.
    manager: context.isManager ? { apiKey, fallbackModel, folderContext } : null,
  });

  try {
    const result = await runClaudeAgent({
      apiKey, model,
      maxTokens: chat.isManager ? 4000 : 2500,
      maxIterations: chat.isManager ? MANAGER_MAX_ITERATIONS : MAX_ITERATIONS,
      system: chat.system, messages: chat.messages, tools: chat.tools, executeTool: chat.executeTool,
    });
    if (!result.text) throw new Error('답변을 생성하지 못했습니다.');
    if (result.stopReason === 'insufficient_credits') result.text += '\n\n---\n※ 크레딧 잔액이 부족해 여기서 중단했습니다. 충전하거나 본인 API 키를 연결해 주세요.';

    const assistantMessage: ChatRow = { id: crypto.randomUUID(), role: 'assistant', content: result.text, createdAt: Date.now() };
    await db.batch([
      db.prepare('INSERT INTO chat_messages (id, user_id, project_id, agent_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(assistantMessage.id, user.userId, projectId, agentId, 'assistant', assistantMessage.content, assistantMessage.createdAt),
      chatMessageIndex(db, { userId: user.userId, messageId: assistantMessage.id, projectId, agentName: context.agentName, role: 'assistant', content: assistantMessage.content, createdAt: assistantMessage.createdAt }),
      usageInsert(db, { userId: user.userId, kind: 'chat', result, refId: assistantMessage.id, projectId, agentName: context.agentName }),
    ]);
    // 사용자 메시지 N개마다 기억 리뷰 (Hermes: 10턴마다 백그라운드 포크)
    if (chat.userTurnCount > 0 && chat.userTurnCount % MEMORY_REVIEW_EVERY === 0) {
      const { reviewModel } = getRuntimeConfig();
      runInBackground(() => runMemoryReview({
        db, userId: user.userId, apiKey, model: reviewModel, system: chat.system,
        transcript: [...chat.messages, { role: 'assistant', content: result.text }],
        projectId, agentId, agentName: context.agentName, refId: assistantMessage.id,
      }));
    }
    // 요약 이후 메시지가 상한을 넘으면 앞부분을 압축 (백그라운드, 저가 모델)
    if (shouldCompact(chat.messagesSinceSummary + 1)) {
      const { reviewModel } = getRuntimeConfig();
      runInBackground(() => compactConversation({ db, userId: user.userId, projectId, agentId, agentName: context.agentName, apiKey, model: reviewModel }), 'chat.compaction');
    }
    return Response.json({
      userMessage, assistantMessage,
      recalled: result.toolCalls.filter((call) => call.name === 'recall_history').length,
      compacted: Boolean(chat.summary),
      // 매니저가 대화 중에 팀을 꾸리거나 카드를 만들었으면 UI 가 보드를 다시 읽습니다.
      recruited: chat.managerLog.recruited,
      delegated: chat.managerLog.delegated,
      createdTasks: chat.taskLog.createdTasks,
    });
  } catch (error) {
      traceError('chat.failed', error);
    return Response.json({ error: error instanceof Error ? error.message : '답변 생성에 실패했습니다.', userMessage }, { status: 502 });
  }
}

export const GET = traceRequest('/api/chat', handleGET);
