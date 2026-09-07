/**
 * 대화 압축 (Hermes compaction 의 축소판).
 *
 * 대화가 길어지면 앞부분을 저가 모델로 요약해 chat_summaries 에 한 줄(대화당 1행, 누적 갱신)로 보관합니다.
 * 이후 턴에는 [요약] + [요약 이후의 메시지] 만 프롬프트에 들어가고, 원문은 지우지 않고 recall_docs 에서
 * compacted=1 로 표시해 recall_history 로 계속 찾을 수 있게 둡니다 (Hermes: 아카이브 + 복구 포인터).
 *
 * 트리거: 요약 이후 메시지가 COMPACT_TRIGGER 개를 넘으면, 최근 KEEP_RECENT 개를 남기고 나머지를 요약에 흡수.
 * 응답을 막지 않도록 runInBackground 로 돌립니다.
 */
import { runClaudeAgent, type ClaudeCredential, type ClaudeMessage } from './claude';
import { THREAD_WHERE } from './mission';
import { recallDocUpsert } from './recall';
import { usageInsert } from './usage';
import { atomicBatch, isPreconditionError } from './atomic';
import { traceEvent } from './telemetry';

/** 요약 이후 메시지가 이 개수를 넘으면 압축을 돌립니다 (사용자+어시스턴트 합산) */
export const COMPACT_TRIGGER = 24;
/** 압축 후에도 원문으로 남겨 두는 최근 메시지 수 */
export const KEEP_RECENT = 12;
/** 프롬프트에 넣는 '요약 이후 메시지' 상한 (압축이 아직 안 돌았을 때의 안전망) */
export const CONTEXT_MAX_MESSAGES = 40;
/** 누적 요약의 문자 예산 — 넘으면 모델에게 더 압축하라고 요구합니다 */
export const SUMMARY_MAX_CHARS = 3_000;
const SUMMARY_MAX_TOKENS = 1_500;
const BATCH_INPUT_MAX_CHARS = 40_000;

export type ChatSummary = {
  id: string; content: string; messageCount: number; coversFrom: number; coversTo: number; updatedAt: number;
};

type MessageRow = { id: string; role: string; content: string; createdAt: number };

export async function loadChatSummary(db: D1Database, userId: string, projectId: string, agentId: string, taskId = ''): Promise<ChatSummary | null> {
  return db.prepare(`SELECT id, content, message_count AS messageCount, covers_from AS coversFrom, covers_to AS coversTo, updated_at AS updatedAt
      FROM chat_summaries WHERE user_id = ? AND project_id = ? AND agent_id = ? AND task_id = ?`)
    .bind(userId, projectId, agentId, taskId).first<ChatSummary>();
}

/** 시스템 프롬프트에 넣는 요약 블록 */
export function renderChatSummary(summary: ChatSummary | null): string {
  if (!summary) return '';
  return [
    `## 이전 대화 요약 (${summary.messageCount}개 메시지, ${formatWhen(summary.coversFrom)} ~ ${formatWhen(summary.coversTo)})`,
    '아래는 압축된 요약입니다. 세부 문구나 수치가 필요하면 recall_history 로 원문을 찾으세요.',
    summary.content,
  ].join('\n');
}

/** 압축이 필요한지 판단 — 호출자는 이 값이 true 면 runInBackground(compactConversation) 를 겁니다 */
export function shouldCompact(messagesSinceSummary: number): boolean {
  return messagesSinceSummary > COMPACT_TRIGGER;
}

export type CompactParams = {
  db: D1Database; userId: string; projectId: string; agentId: string; agentName: string;
  apiKey: ClaudeCredential; model: string;
  /** 스레드(임무 카드 id). 생략하면 일반 대화. */
  taskId?: string;
};

/**
 * 요약 이후 메시지 중 최근 KEEP_RECENT 개를 뺀 나머지를 기존 요약과 합쳐 새 요약을 만듭니다.
 * 동시에 두 번 돌아도 covers_to 조건 덕에 같은 메시지를 두 번 흡수하지는 않습니다 (뒤의 것이 덮어씀).
 */
export async function compactConversation(params: CompactParams): Promise<{ compacted: number } | { skipped: string }> {
  const { db, userId, projectId, agentId } = params;
  const taskId = params.taskId ?? '';
  const previous = await loadChatSummary(db, userId, projectId, agentId, taskId);
  const since = previous?.coversTo ?? 0;

  const rows = await db.prepare(`SELECT id, role, content, created_at AS createdAt FROM chat_messages
      WHERE user_id = ? AND project_id = ? AND agent_id = ? AND ${THREAD_WHERE} AND created_at > ? ORDER BY created_at ASC`)
    .bind(userId, projectId, agentId, taskId, since).all<MessageRow>();
  const pending = rows.results;
  if (pending.length <= KEEP_RECENT) return { skipped: '압축할 만큼 쌓이지 않음' };

  // 최근 KEEP_RECENT 개는 원문으로 남기고, 그 앞을 흡수. 사용자 턴 경계에서 자르면 맥락이 덜 깨집니다.
  let cut = pending.length - KEEP_RECENT;
  while (cut < pending.length && pending[cut].role !== 'user') cut += 1;
  const batch = pending.slice(0, cut);
  if (!batch.length) return { skipped: '자를 경계 없음' };

  const transcript = clipTranscript(batch);
  const messages: ClaudeMessage[] = [{
    role: 'user',
    content: [
      previous ? `## 지금까지의 요약\n${previous.content}\n` : '',
      `## 새로 흡수할 대화 (${batch.length}개 메시지)\n${transcript}`,
      '',
      '위 내용을 하나의 누적 요약으로 다시 쓰세요.',
    ].filter(Boolean).join('\n'),
  }];

  const result = await runClaudeAgent({
    apiKey: params.apiKey,
    model: params.model,
    system: [
      `당신은 ${params.agentName} 와 사용자 사이의 대화를 압축하는 기록자입니다.`,
      '목표: 이후 대화에서 맥락을 잃지 않도록, 지금까지의 대화를 한 덩어리 요약으로 유지합니다.',
      '',
      '규칙:',
      `- ${SUMMARY_MAX_CHARS}자 이내. 넘길 것 같으면 오래된 세부를 먼저 버립니다.`,
      '- 반드시 남길 것: 사용자가 요청·결정·거절한 것, 확정된 사실과 수치, 미해결 질문, 진행 중인 작업과 그 상태, 사용자의 선호.',
      '- 버릴 것: 인사, 반복, 이미 해결된 시행착오의 과정.',
      '- 형식: 짧은 단락 또는 항목. 시간 순서를 유지하고 "사용자가 ~라고 함 / 에이전트가 ~라고 답함" 처럼 주체를 명시.',
      '- 요약 본문만 출력하세요. 머리말이나 설명을 붙이지 마세요.',
    ].join('\n'),
    messages,
    maxTokens: SUMMARY_MAX_TOKENS,
    maxIterations: 1,
  });
  const content = result.text.trim().slice(0, SUMMARY_MAX_CHARS + 500);
  if (!content) return { skipped: '요약이 비어 있음' };

  const now = Date.now();
  const summaryId = previous?.id ?? crypto.randomUUID();
  const coversFrom = previous?.coversFrom ?? batch[0].createdAt;
  const coversTo = batch[batch.length - 1].createdAt;
  const messageCount = (previous?.messageCount ?? 0) + batch.length;

  await usageInsert(db, { userId, kind: 'compaction', result, refId: summaryId, projectId, agentName: params.agentName }).run();
  try {
  await atomicBatch(db, `(? IS NULL OR EXISTS (SELECT 1 FROM projects WHERE id = ? AND user_id = ?))
    AND (? IS NULL OR EXISTS (SELECT 1 FROM agents WHERE id = ? AND user_id = ?))`,
  [projectId, projectId, userId, agentId, agentId, userId], [
    db.prepare(`INSERT INTO chat_summaries (id, user_id, project_id, agent_id, task_id, content, message_count, covers_from, covers_to, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, project_id, agent_id, task_id) DO UPDATE SET
          content = excluded.content, message_count = excluded.message_count, covers_to = excluded.covers_to, updated_at = excluded.updated_at`)
      .bind(summaryId, userId, projectId, agentId, taskId, content, messageCount, coversFrom, coversTo, previous ? previous.updatedAt : now, now),
    // 흡수된 원문은 회상 인덱스에서 compacted 로 표시 (검색은 계속 됨)
    db.prepare(`UPDATE recall_docs SET active = 0, compacted = 1 WHERE user_id = ? AND kind = 'chat' AND ref_id IN (${batch.map(() => '?').join(',')})`)
      .bind(userId, ...batch.map((row) => row.id)),
    // 요약 자체도 검색 가능하게
    recallDocUpsert(db, {
      userId, kind: 'summary', refId: summaryId, projectId, agentName: params.agentName, role: 'assistant',
      title: `${params.agentName} 와의 대화 요약`, content, createdAt: coversTo,
    }),
  ]);
  } catch (error) {
    if (!isPreconditionError(error)) throw error;
    traceEvent('compaction.skipped', { reason: 'target_deleted' });
    return { skipped: '요약 대상이 삭제됨' };
  }
  return { compacted: batch.length };
}

function clipTranscript(batch: MessageRow[]): string {
  const lines = batch.map((row) => `[${row.role === 'user' ? '사용자' : '에이전트'}] ${row.content.replace(/\s+/g, ' ').trim()}`);
  let text = lines.join('\n');
  if (text.length > BATCH_INPUT_MAX_CHARS) text = `${text.slice(0, BATCH_INPUT_MAX_CHARS)}\n…[이후 생략]`;
  return text;
}

function formatWhen(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}
