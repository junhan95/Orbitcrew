/**
 * 대화 라우트(일반·스트리밍) 공용 헬퍼.
 * /api/chat 과 /api/chat/stream 이 같은 시스템 프롬프트·툴·색인을 쓰게 하려고 분리했습니다.
 *
 * 스트리밍 라우트에서의 사용법 (streamClaude → streamClaudeAgent 로 바꾸면 됩니다):
 *
 *   const chat = await prepareChatTurn(db, user.userId, { projectId, agentId, context, historyWindow: 12 });
 *   const result = await streamClaudeAgent({
 *     apiKey, model, maxTokens: 2500,
 *     system: chat.system, messages: chat.messages,
 *     tools: chat.tools, executeTool: chat.executeTool, maxIterations: 4,
 *     onDelta: (text) => send({ type: 'delta', text }),
 *     onToolCall: (name) => send({ type: 'tool', name }),      // 선택: "과거 기록 검색 중…" 표시용
 *   });
 *   // 저장 시 chatMessageIndex(...) 를 batch 에 함께 넣어 회상 인덱스에 반영합니다.
 */
import type { Autonomy } from './autonomy';
import type { ClaudeCredential, ClaudeMessage, ToolDefinition, ToolExecutor } from './claude';
import { CONTEXT_MAX_MESSAGES, loadChatSummary, renderChatSummary, type ChatSummary } from './compaction';
import {
  MANAGER_TOOLS, MANAGER_TOOL_NAMES, READ_TASK_TOOL, createManagerLog, executeManagerTool, loadMembers, renderTeam,
  type ManagerContext, type ManagerEvent, type ManagerLog,
} from './manager-tools';
import { MEMORY_GUIDANCE, MEMORY_TOOL, executeMemoryTool, loadMemoryScopes, renderMemorySection } from './memory';
import { loadProfile, renderProfileSection } from './profile';
import { RECALL_TOOL, executeRecallTool, recallDocKey, recallDocUpsert } from './recall';
import { USE_SKILL_TOOL, executeSkillTool, listSkills, renderSkillIndex } from './skills';
import { CREATE_TASK_TOOL, createTaskToolLog, executeTaskTool, type TaskToolContext, type TaskToolLog } from './task-tools';

export type ChatContext = {
  projectName: string; projectDescription: string;
  agentName: string; agentRole: string; instructions: string;
};

/**
 * 매니저와 대화할 때만 켜지는 옵션.
 * 켜지면 대화 중에도 recruit_agent / delegate_task / create_task 를 쓸 수 있습니다
 * — 업무 카드 실행과 똑같은 도구입니다 (lib/manager-tools.ts).
 */
export type ChatManagerOptions = {
  apiKey: ClaudeCredential;
  fallbackModel: string;
  /** 브라우저가 읽어 보낸 연결 폴더 스냅샷 */
  folderContext?: string;
  /** 합류·위임 진행을 실시간으로 받고 싶을 때 (스트리밍 라우트). */
  onEvent?: (event: ManagerEvent) => void;
  /** 사용자가 대화창에서 고른 자율도. 기본은 'auto'(전부 허용). */
  autonomy?: Autonomy;
};

/** 자율도 'tasks' — 채용·위임 없이 카드만 만들 때의 규칙 */
const MANAGER_TASKS_ONLY_RULES = [
  '',
  '## 당신은 이 프로젝트의 매니저입니다 (이번 대화는 카드 생성만 허용)',
  '- 사용자가 자율도를 낮춰 두어 이번 대화에서는 팀원 합류(recruit_agent)와 위임(delegate_task)을 할 수 없습니다.',
  '- 결과물이 필요한 요청이면 직접 답할 수 있는 만큼 답하고, 나머지는 create_task 로 보드에 카드만 남기세요.',
  '- 위임이 필요하다고 판단되면 그 사실을 답변에 적고, 사용자가 자율도를 \'자동\'으로 올리면 바로 진행하겠다고 알리세요.',
].join('\n');

const MANAGER_CHAT_RULES = [
  '',
  '## 당신은 이 프로젝트의 매니저입니다',
  '- 사용자의 요청이 실제 산출물을 필요로 하면 혼자 답하지 말고, 필요한 직무를 recruit_agent 로 합류시킨 뒤 delegate_task 로 맡기세요.',
  "- delegate_task 는 카드를 만들고 실행을 시작만 합니다. 결과는 팀원이 끝나는 대로 이 대화에 '📥 보고' 메시지로 도착합니다. 맡긴 직후에는 결과를 기다리거나 지어내지 말고 '○○에게 ~ 업무를 부여했습니다' 처럼 누구에게 무엇을 맡겼는지 알리고 답변을 짧게 끝내세요.",
  "- 대화에 '📥 보고' 메시지가 있으면 그것이 팀원의 실제 결과입니다. 사용자가 결과·검토를 물으면 그 보고를 검토해(빠진 것, 근거가 약한 것, 어긋나는 것) 답하고, 보완이 필요하면 다시 맡기세요.",
  '- 상태 확인·의견·간단한 질문은 위임 없이 바로 답합니다. 위임은 결과물이 필요할 때만.',
  '- delegate_task 의 brief 는 60,000자까지 잘리지 않고 그대로 전달되고, 팀원 실행은 긴 출력에도 타임아웃되지 않습니다. 과거 기록·기억에 "코드가 잘린다", "524 타임아웃", "여러 조각으로 나눠 보내야 한다" 같은 내용이 남아 있어도 이미 해결된 문제이니, 그것을 이유로 코드를 조각내거나 재시도 계획을 세우지 말고 파일 전체를 한 번에 맡기세요.',
  '- 지금 실행할 필요는 없고 보드에 남겨 둘 후속 업무는 create_task 로 카드만 만드세요.',
  '- 위임은 delegate_task 호출이 성공해 task_id 가 돌아왔을 때만 이루어진 것입니다. 도구를 호출하지 않았거나 오류가 돌아왔으면 절대 "위임했습니다/맡겼습니다" 라고 쓰지 말고, 오류 내용을 그대로 알리세요. 위임을 "안내" 하거나 "예정" 으로만 적지 말고 실제로 호출하세요.',
  "- 팀원 결과의 전문이 필요하면(검토, 다른 팀원에게 넘기기) read_task_result 로 읽으세요. '📥 보고' 와 회상 발췌는 요약이라 본문이 짧게 보일 뿐, 실제 결과는 잘리지 않았습니다. 다른 팀원에게 검토를 맡길 때는 읽은 전문을 brief 에 그대로 넣으세요.",
  '- 답변에는 누구를 합류시켰고 누가 무엇을 했는지, 어떤 카드를 만들었는지 밝히세요.',
  '- 정보가 조금 부족해도 되묻기만 하지 말고, 합리적인 가정을 세워 진행 가능한 부분은 맡겨 결과를 만든 뒤 가정과 확인이 필요한 항목을 함께 적으세요.',
].join('\n');

export type PreparedChatTurn = {
  system: string;
  messages: ClaudeMessage[];
  tools: ToolDefinition[];
  executeTool: ToolExecutor;
  /** 컨텍스트에 이미 들어간 메시지 id — 회상 결과에서 제외됩니다 */
  includedMessageIds: string[];
  /** 이 대화에서 사용자가 보낸 메시지 수 (리뷰 패스 주기 계산용) */
  userTurnCount: number;
  /** 압축 요약 이후 쌓인 메시지 수 — shouldCompact() 판단용 (이번 턴의 사용자 메시지 포함) */
  messagesSinceSummary: number;
  summary: ChatSummary | null;
  /** 매니저 대화일 때 이 턴에서 합류·위임한 내역 (아니면 빈 배열) */
  managerLog: ManagerLog;
  /** 이 턴에서 만든 업무 카드 */
  taskLog: TaskToolLog;
  /** 매니저 대화에서 위임 도구를 쓸 수 있는지 (자율도 'auto') */
  canDelegate: boolean;
  /** 팀원 이름 (매니저 제외) — 답변의 '위임했다' 주장 검증용 */
  teamNames: string[];
  /** 매니저 대화 여부 — 라우트가 반복 상한·토큰 상한을 올리는 데 씁니다 */
  isManager: boolean;
};

export const CHAT_HISTORY_WINDOW = 12;
/** 대화 한 턴에서 허용하는 회상 호출 수 */
export const RECALL_CALL_LIMIT = 3;
/** 사용자 메시지 N개마다 기억 리뷰 패스를 돌립니다 (Hermes memory.nudge_interval) */
export const MEMORY_REVIEW_EVERY = 10;

/**
 * 답변이 팀원에게 "위임했다/맡겼다" 고 말하는지 봅니다.
 * 이번 턴에 delegate_task 가 실제로 성공하지 않았는데 이런 말이 있으면, 카드도 실행도 없는 '말뿐인 위임' 입니다
 * — 라우트가 이를 잡아 도구 호출을 다시 시키고, 그래도 없으면 사용자에게 알립니다.
 */
export function claimsDelegation(text: string, teamNames: string[]): boolean {
  if (!text) return false;
  if (!/(위임했|위임하였|위임을 완료|맡겼|맡겨 두었|맡겨두었|부여했|부여하였|배정했|배정하였|넘겼|delegated|assigned)/.test(text)) return false;
  return teamNames.some((name) => name && text.includes(name));
}

/** 말뿐인 위임을 잡았을 때 매니저에게 되묻는 메시지 (시스템이 넣는 사용자 턴) */
export const DELEGATION_RETRY_PROMPT = [
  '[시스템 확인] 방금 답변에서 팀원에게 업무를 위임했다고 했지만, 이번 턴에 delegate_task 도구는 호출되지 않았고 보드에 카드도 만들어지지 않았습니다.',
  '위임이 실제로 필요하면 지금 delegate_task 를 호출하세요. 팀원 결과 전문이 brief 에 필요하면 read_task_result 로 먼저 읽어 넣으세요.',
  '호출 결과의 task_id 를 확인한 뒤, 누구에게 무엇을 맡겼는지 한두 문장으로만 알리세요. 위임이 필요 없다면 그 이유를 한 문장으로 적으세요.',
].join(' ');

/** 되물어도 위임이 없을 때 답변 끝에 붙이는 안내 */
export const DELEGATION_MISSING_NOTE = '\n\n---\n※ 매니저가 위임했다고 답했지만 실제 위임(delegate_task)은 확인되지 않아 보드에 카드가 만들어지지 않았습니다. 다시 요청해 주세요.';

export function buildChatSystem(context: ChatContext, historyWindow = CHAT_HISTORY_WINDOW, memorySection = '', summarySection = '', skillSection = '', managerSection = '', profileSection = ''): string {
  return [
    `당신은 ${context.agentName}, ${context.agentRole}입니다.`,
    context.instructions,
    `현재 프로젝트: ${context.projectName}`,
    `프로젝트 설명: ${context.projectDescription || '(설명 없음)'}`,
    '',
    '사용자가 이전 대화나 과거 작업을 언급하거나 관련 맥락이 있을 법하면, 다시 물어보기 전에 recall_history 로 먼저 찾아보세요.',
    summarySection
      ? '지금 보이는 대화는 아래 요약 이후의 메시지뿐입니다. 요약 이전의 원문과 다른 에이전트의 실행 결과는 검색으로만 볼 수 있습니다.'
      : `지금 보이는 대화는 최근 ${historyWindow}개 메시지뿐이고, 그 이전과 다른 에이전트의 실행 결과는 검색으로만 볼 수 있습니다.`,
    '답변은 한국어로, 프로젝트 맥락에 맞춰 구체적으로 작성하세요.',
    '',
    profileSection ? `${profileSection}\n` : '',
    MEMORY_GUIDANCE,
    '',
    memorySection,
    skillSection ? `\n${skillSection}\n사용자가 "어떻게 하지?" 류의 절차를 물으면 맞는 스킬을 use_skill 로 읽고 그 절차를 근거로 답하세요.` : '',
    managerSection ? `\n${managerSection}` : '',
    summarySection ? `\n${summarySection}` : '',
  ].filter((line) => line !== undefined && line !== '').join('\n');
}

/**
 * 최근 대화 이력을 읽어 Claude 호출에 필요한 system/messages/tools 를 한 번에 준비합니다.
 * 사용자 메시지는 이미 chat_messages 에 INSERT 된 뒤에 호출하세요 (이력에 포함되도록).
 */
export async function prepareChatTurn(db: D1Database, userId: string, params: {
  projectId: string; agentId: string; context: ChatContext; historyWindow?: number;
  /** 상대가 이 프로젝트의 매니저일 때만 넘기세요. 채용·위임·카드 생성 도구가 붙습니다. */
  manager?: ChatManagerOptions | null;
}): Promise<PreparedChatTurn> {
  const window = params.historyWindow ?? CHAT_HISTORY_WINDOW;
  // 압축 요약이 있으면 요약이 끝나는 지점 이후의 메시지만 원문으로 넣습니다 (없으면 최근 window 개).
  const summary = await loadChatSummary(db, userId, params.projectId, params.agentId);
  const since = summary?.coversTo ?? 0;
  const limit = summary ? CONTEXT_MAX_MESSAGES : window;
  const [history, sinceCount, userTurns, memory, skills, profile] = await Promise.all([
    db.prepare('SELECT id, role, content FROM chat_messages WHERE user_id = ? AND project_id = ? AND agent_id = ? AND created_at > ? ORDER BY created_at DESC LIMIT ?')
      .bind(userId, params.projectId, params.agentId, since, limit).all<{ id: string; role: string; content: string }>(),
    db.prepare('SELECT COUNT(*) AS n FROM chat_messages WHERE user_id = ? AND project_id = ? AND agent_id = ? AND created_at > ?')
      .bind(userId, params.projectId, params.agentId, since).first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE user_id = ? AND project_id = ? AND agent_id = ? AND role = 'user'")
      .bind(userId, params.projectId, params.agentId).first<{ n: number }>(),
    // 기억 스냅샷: 이 턴 동안 동결됩니다 (Hermes 의 frozen snapshot)
    loadMemoryScopes(db, userId, { projectId: params.projectId, projectName: params.context.projectName, agentId: params.agentId, agentName: params.context.agentName }),
    listSkills(db, userId, params.projectId),
    // 사용자 프로필: 호칭과 보고 눈높이를 맞추는 데 씁니다 (계정 화면에서 편집).
    loadProfile(db, userId),
  ]);
  const recent = history.results.slice().reverse();
  const excludeDocKeys = recent.map((item) => recallDocKey('chat', item.id));
  const memoryFailures = { count: 0 };
  let recallCalls = 0;

  // ── 매니저 대화: 업무 카드 실행과 같은 채용·위임 도구를 붙입니다 ──────────
  const managerLog = createManagerLog();
  const taskLog = createTaskToolLog();
  const managerContext: ManagerContext | null = params.manager ? {
    db, userId,
    apiKey: params.manager.apiKey,
    fallbackModel: params.manager.fallbackModel,
    projectId: params.projectId,
    projectName: params.context.projectName,
    projectDescription: params.context.projectDescription,
    managerName: params.context.agentName,
    // 대화에는 부모 카드가 없습니다.
    managerTaskId: null,
    asyncDelegation: true,
    folderContext: params.manager.folderContext ?? '',
    onEvent: params.manager.onEvent,
  } : null;
  const taskContext: TaskToolContext = {
    db, userId, agentName: params.context.agentName, projectId: params.projectId, taskId: '',
  };
  // 자율도가 'tasks' 면 채용·위임 도구를 아예 붙이지 않습니다 (모델에게 없는 도구는 쓸 수 없습니다).
  const canDelegate = Boolean(managerContext) && (params.manager?.autonomy ?? 'auto') === 'auto';
  const members = managerContext ? await loadMembers(db, userId, params.projectId) : [];
  const teamNames = members.filter((member) => !member.isManager).map((member) => member.name);
  const managerSection = managerContext
    ? `${canDelegate ? MANAGER_CHAT_RULES : MANAGER_TASKS_ONLY_RULES}\n\n${renderTeam(members)}`
    : '';

  return {
    system: buildChatSystem(params.context, window, renderMemorySection(memory), renderChatSummary(summary), renderSkillIndex(skills), managerSection, renderProfileSection(profile, '')),
    messages: recent.map((item) => ({ role: item.role === 'assistant' ? 'assistant' : 'user', content: item.content })),
    tools: [
      RECALL_TOOL as unknown as ToolDefinition, MEMORY_TOOL, USE_SKILL_TOOL,
      ...(managerContext ? [...(canDelegate ? MANAGER_TOOLS : []), READ_TASK_TOOL, CREATE_TASK_TOOL] : []),
    ],
    executeTool: (name, input) => {
      if (managerContext && MANAGER_TOOL_NAMES.has(name)) {
        // 결과 읽기는 자율도와 무관하게 허용합니다.
        if (name === READ_TASK_TOOL.name) return executeManagerTool(name, input, managerContext, managerLog);
        if (!canDelegate) return Promise.resolve({ error: '이번 대화는 자율도가 낮아 합류·위임을 할 수 없습니다. create_task 로 카드만 남기고 직접 답하세요.' });
        return executeManagerTool(name, input, managerContext, managerLog);
      }
      if (managerContext && name === 'create_task') {
        return executeTaskTool(name, input, taskContext, taskLog);
      }
      if (name === 'recall_history') {
        recallCalls += 1;
        if (recallCalls > RECALL_CALL_LIMIT) return Promise.resolve({ error: `회상 호출 상한(${RECALL_CALL_LIMIT}회)에 도달했습니다. 지금까지의 결과로 답하세요.` });
        return executeRecallTool(db, userId, input, { projectId: params.projectId, excludeDocKeys });
      }
      if (name === 'memory') {
        return executeMemoryTool(db, input, { userId, projectId: params.projectId, agentId: params.agentId, actor: params.context.agentName, failures: memoryFailures });
      }
      if (name === 'use_skill') {
        return executeSkillTool(name, input, { db, userId, projectId: params.projectId, actor: params.context.agentName, saves: { count: 0, names: [] } });
      }
      throw new Error(`알 수 없는 툴: ${name}`);
    },
    includedMessageIds: recent.map((item) => item.id),
    userTurnCount: Number(userTurns?.n ?? 0),
    messagesSinceSummary: Number(sinceCount?.n ?? 0),
    summary,
    managerLog,
    taskLog,
    canDelegate,
    teamNames,
    isManager: Boolean(managerContext),
  };
}

/** chat_messages 한 건을 회상 인덱스에 넣는 statement (db.batch 에 끼워 넣으세요) */
export function chatMessageIndex(db: D1Database, params: {
  userId: string; messageId: string; projectId: string; agentName: string;
  role: 'user' | 'assistant'; content: string; createdAt: number;
}) {
  return recallDocUpsert(db, {
    userId: params.userId, kind: 'chat', refId: params.messageId, projectId: params.projectId,
    agentName: params.agentName, role: params.role, content: params.content, createdAt: params.createdAt,
  });
}
