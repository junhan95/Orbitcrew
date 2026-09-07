/**
 * 프로젝트 매니저 전용 도구.
 *
 *  - recruit_agent : 직무 카탈로그(lib/agent-catalog.ts)에서 필요한 직무를 골라 팀에 합류시킴
 *  - delegate_task : 팀원에게 업무를 맡기고 '그 자리에서' 실행해 보고를 받아옴
 *
 * delegate_task 는 카드만 만드는 게 아니라 하위 에이전트를 실제로 돌립니다.
 * 그래서 매니저 실행 한 번 = 매니저 1회 + 위임한 팀원 수만큼의 실행이며,
 * 폭주를 막으려고 실행당 합류 4명 · 위임 4건으로 상한을 둡니다.
 */
import { AGENT_CATALOG, findCatalogRole, renderCatalog, uniqueAgentName } from '@/lib/agent-catalog';
import type { ClaudeCredential, ToolDefinition } from '@/lib/claude';
import { runTask } from '@/lib/run-task';
import { type Priority, toPriority } from '@/lib/priority';
import { recallDocUpsert } from '@/lib/recall';
import { syncMissionStatus } from '@/lib/mission';
import { listTaskFiles } from '@/lib/task-files';

export const MAX_RECRUITS = 4;
export const MAX_DELEGATIONS = 4;
/** delegate_task brief 상한. 검토 대상 파일 전문(수만 자)이 들어가도 잘리지 않을 만큼 넉넉하게 잡습니다. */
export const MAX_BRIEF_CHARS = 60_000;
/** 매니저에게 돌려주는 하위 결과 본문 길이 상한 */
const REPORT_CLIP = 48_000;

export const RECRUIT_TOOL: ToolDefinition = {
  name: 'recruit_agent',
  description: [
    '이 프로젝트에 필요한 직무의 에이전트를 팀에 합류시킵니다.',
    '업무를 맡길 사람이 팀에 없을 때만 부르세요 — 이미 팀에 있는 직무를 다시 부르면 그 사람을 그대로 돌려줍니다.',
    `한 번의 실행에서 최대 ${MAX_RECRUITS}명까지 합류시킬 수 있습니다.`,
    '아래 role_key 중에서 고르세요:',
    `\n${renderCatalog()}`,
  ].join(' '),
  input_schema: {
    type: 'object',
    properties: {
      role_key: { type: 'string', enum: AGENT_CATALOG.map((role) => role.key), description: '합류시킬 직무의 키' },
      reason: { type: 'string', description: '왜 이 직무가 필요한지 한 문장' },
    },
    required: ['role_key'],
  },
};

export const DELEGATE_TOOL: ToolDefinition = {
  name: 'delegate_task',
  description: [
    '팀원에게 업무를 맡기고 결과 보고를 받습니다. 카드가 보드에 만들어지고 그 자리에서 실행됩니다.',
    'brief 에는 맡을 사람이 이것만 읽고 시작할 수 있도록 배경·요구사항·완료 조건을 충분히 적으세요.',
    '산출물이 있는 업무면 파일명·형식·저장 폴더와 "결과는 파일로 저장하고 요약만 보고" 를 brief 에 명시하세요.',
    '결과는 이 호출의 반환값으로 돌아옵니다 — 받아서 검토한 뒤 사용자에게 보고하세요.',
    `한 번의 실행에서 최대 ${MAX_DELEGATIONS}건까지 위임할 수 있습니다. 같은 일을 두 번 맡기지 마세요.`,
  ].join(' '),
  input_schema: {
    type: 'object',
    properties: {
      agent_name: { type: 'string', description: '팀에 있는 에이전트 이름 (recruit_agent 가 돌려준 이름)' },
      title: { type: 'string', description: '업무 제목 (1~100자)' },
      brief: { type: 'string', description: `배경, 해야 할 일, 완료 조건. 검토·수정을 맡길 때는 대상 코드나 문서 전문을 그대로 넣어도 됩니다 (최대 ${MAX_BRIEF_CHARS.toLocaleString()}자 — 넘으면 거부되니 나눠 맡기세요).` },
      label: { type: 'string', description: "분류 태그 (예: '리서치', '마케팅')" },
      priority: { type: 'string', enum: ['높음', '중간', '낮음'], description: "중요도. 목표 달성에 먼저 필요한 일일수록 '높음'. 생략하면 '중간'." },
    },
    required: ['agent_name', 'title', 'brief'],
  },
};

/**
 * 팀원이 끝낸 업무의 결과 전문을 읽습니다.
 * 대화의 '📥 보고' 는 요약뿐이라, 매니저가 검토·재위임 brief 작성에 전문이 필요할 때 씁니다
 * (예전엔 회상 발췌만 보여 "본문이 잘렸다"고 오해했습니다).
 */
export const READ_TASK_TOOL: ToolDefinition = {
  name: 'read_task_result',
  description: [
    '이 프로젝트 보드에 있는 업무 카드의 결과 전문을 읽습니다.',
    "대화의 '📥 보고' 메시지는 요약이므로, 팀원 결과를 검토하거나 그 내용을 다른 팀원에게 넘길 때는 이 도구로 전문을 먼저 읽으세요.",
    "task_id 는 보고 메시지의 링크(#task/<id>)나 delegate_task 반환값에 있습니다. 모르면 title 로 찾습니다.",
  ].join(' '),
  input_schema: {
    type: 'object',
    properties: {
      task_id: { type: 'string', description: '업무 카드 id (우선)' },
      title: { type: 'string', description: 'id 를 모를 때 제목(일부 일치)' },
    },
  },
};

export const MANAGER_TOOLS: ToolDefinition[] = [RECRUIT_TOOL, DELEGATE_TOOL];
export const MANAGER_TOOL_NAMES = new Set([...MANAGER_TOOLS, READ_TASK_TOOL].map((tool) => tool.name));

/**
 * 매니저가 일하는 도중 밖으로 흘려보내는 진행 이벤트.
 * 스트리밍 대화가 이걸 받아 "Uri에게 맡김 → Uri 보고 도착" 을 실시간으로 보여줍니다.
 * 위임 한 건은 하위 에이전트 실행이라 수십 초가 걸리므로, 시작과 끝을 따로 알립니다.
 */
export type ManagerEvent =
  | { kind: 'recruited'; agent: string; role: string }
  | { kind: 'delegate_start'; agent: string; role: string; title: string }
  | { kind: 'delegate_queued'; agent: string; role: string; title: string; taskId: string }
  | { kind: 'delegate_done'; agent: string; title: string; taskId: string; outcome: 'completed' | 'blocked'; summary: string };

export type ManagerContext = {
  db: D1Database;
  userId: string;
  apiKey: ClaudeCredential;
  fallbackModel: string;
  projectId: string;
  projectName: string;
  projectDescription: string;
  managerName: string;
  /** 지금 실행 중인 매니저 업무 id. 대화에서 위임할 때는 부모 카드가 없어 null 입니다. */
  managerTaskId: string | null;
  /** 브라우저가 읽어 보낸 연결 폴더 스냅샷 (없으면 빈 문자열) */
  folderContext: string;
  /** 진행 이벤트 구독자 (스트리밍 대화용). 없으면 아무 데도 흘리지 않습니다. */
  onEvent?: (event: ManagerEvent) => void;
  /**
   * true 면 delegate_task 가 카드만 만들고 바로 돌아옵니다 (실행은 브라우저가 /api/agents/run 으로 따로 시작, 결과는 대화에 보고로 도착).
   * 대화 모드가 이렇게 동작해 매니저가 "맡겼습니다" 하고 곧장 대화 가능 상태로 돌아옵니다. 카드 실행(부모 카드가 있는 경우)은 동기 위임 그대로.
   */
  asyncDelegation?: boolean;
};

export type ManagerLog = {
  recruited: Array<{ name: string; role: string }>;
  delegated: Array<{ taskId: string; title: string; agent: string; outcome: string; summary: string }>;
};

export function createManagerLog(): ManagerLog {
  return { recruited: [], delegated: [] };
}

type MemberRow = { id: string; name: string; role: string; color: string; instructions: string; model: string | null; roleKey: string | null; isManager: number };

/** 이 프로젝트에 배정된 에이전트들 (매니저 포함) */
export async function loadMembers(db: D1Database, userId: string, projectId: string): Promise<MemberRow[]> {
  const rows = await db.prepare(`SELECT a.id, a.name, a.role, a.color, a.instructions, a.model, a.role_key AS roleKey, a.is_manager AS isManager
      FROM agents a JOIN project_agents pa ON pa.agent_id = a.id AND pa.user_id = a.user_id
      WHERE a.user_id = ? AND pa.project_id = ? ORDER BY a.is_manager DESC, pa.assigned_at ASC`)
    .bind(userId, projectId).all<MemberRow>();
  return rows.results;
}

/** 시스템 프롬프트용 '현재 팀' 섹션 */
export function renderTeam(members: MemberRow[]): string {
  if (!members.length) return '## 현재 팀\n(아직 당신뿐입니다. 필요한 직무는 recruit_agent 로 합류시키세요.)';
  const lines = members.map((member) => `- ${member.name} · ${member.role}${member.isManager ? ' (당신)' : ''}`);
  return `## 현재 팀\n${lines.join('\n')}`;
}

function clip(text: string | null | undefined, max: number): string {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}


/**
 * 하위 에이전트 한 명을 실제로 실행합니다.
 * 카드 생성 → 실행 → 카드/실행기록/댓글/사용량/회상 저장까지 끝내고 매니저에게 줄 보고를 돌려줍니다.
 */
/** 위임 카드를 만듭니다. 실행은 /api/agents/run 과 같은 코어(lib/run-task.ts)가 맡습니다 — 기억·회상·스킬·검증·관제·승인 게이트가 똑같이 적용되도록. */
async function createWorkerCard(context: ManagerContext, member: MemberRow, params: { title: string; brief: string; label: string; priority: Priority }, status: '진행 중' | '대기') {
  const { db, userId } = context;
  const now = Date.now();
  const taskId = crypto.randomUUID();
  await db.batch([
    db.prepare(`INSERT INTO tasks (id, user_id, title, label, owner, status, priority, accent, project_id, description, parent_task_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(taskId, userId, params.title, params.label, member.name, status, params.priority, member.color, context.projectId, params.brief, context.managerTaskId, now, now),
    recallDocUpsert(db, {
      userId, kind: 'task', refId: taskId, projectId: context.projectId, agentName: member.name, title: params.title,
      content: `[${params.label}] ${params.title} — 담당 ${member.name} (${context.managerName} 위임)\n${params.brief}`, createdAt: now,
    }),
  ]);
  if (context.managerTaskId) await syncMissionStatus(db, userId, taskId);
  return taskId;
}

async function runWorker(context: ManagerContext, member: MemberRow, params: { title: string; brief: string; label: string; priority: Priority }) {
  const { db, userId } = context;
  const taskId = await createWorkerCard(context, member, params, '진행 중');

  const outcome = await runTask({
    db, userId, taskId, apiKey: context.apiKey, fallbackModel: context.fallbackModel,
    folderContext: context.folderContext,
    delegatedBy: { managerName: context.managerName, parentTaskId: context.managerTaskId },
  });
  if (!outcome.ok) {
    return { taskId, status: '대기', blocked: true, summary: '', output: '', blockedReason: outcome.error };
  }
  return { taskId, status: outcome.status, blocked: outcome.blocked, summary: outcome.summary, output: outcome.output, blockedReason: outcome.blockedReason };
}

export async function executeManagerTool(
  name: string,
  input: Record<string, unknown>,
  context: ManagerContext,
  log: ManagerLog,
): Promise<unknown> {
  const { db, userId, projectId } = context;

  if (name === 'recruit_agent') {
    if (log.recruited.length >= MAX_RECRUITS) {
      return { ok: false, error: `이번 실행에서는 ${MAX_RECRUITS}명까지만 합류시킬 수 있습니다. 지금 팀으로 진행하세요.` };
    }
    const role = findCatalogRole(input.role_key);
    if (!role) return { ok: false, error: `알 수 없는 직무입니다. 가능한 role_key: ${AGENT_CATALOG.map((item) => item.key).join(', ')}` };

    const existing = await db.prepare(`SELECT a.name, a.role FROM agents a JOIN project_agents pa ON pa.agent_id = a.id AND pa.user_id = a.user_id
        WHERE a.user_id = ? AND pa.project_id = ? AND a.role_key = ? LIMIT 1`)
      .bind(userId, projectId, role.key).first<{ name: string; role: string }>();
    if (existing) return { ok: true, agent_name: existing.name, role: existing.role, note: '이미 팀에 있는 직무라 그대로 씁니다.' };

    const now = Date.now();
    const id = crypto.randomUUID();
    const agentName = await uniqueAgentName(db, userId, role.name);
    await db.batch([
      db.prepare(`INSERT INTO agents (id, user_id, name, role, description, instructions, color, is_default, created_at, project_id, is_manager, role_key)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?)`)
        .bind(id, userId, agentName, role.role, role.description, role.instructions, role.color, now, projectId, role.key),
      db.prepare('INSERT OR IGNORE INTO project_agents (project_id, agent_id, user_id, assigned_at) VALUES (?, ?, ?, ?)')
        .bind(projectId, id, userId, now),
    ]);
    log.recruited.push({ name: agentName, role: role.role });
    context.onEvent?.({ kind: 'recruited', agent: agentName, role: role.role });
    return { ok: true, agent_name: agentName, role: role.role, note: '팀에 합류했습니다. delegate_task 로 업무를 맡기세요.' };
  }

  if (name === 'read_task_result') {
    const taskId = typeof input.task_id === 'string' ? input.task_id.trim() : '';
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!taskId && !title) return { ok: false, error: 'task_id 또는 title 을 주세요.' };
    type TaskRow = { id: string; title: string; owner: string; status: string; summary: string | null; result: string | null; blockedReason: string | null; description: string };
    const row = taskId
      ? await db.prepare('SELECT id, title, owner, status, summary, result, blocked_reason AS blockedReason, description FROM tasks WHERE id = ? AND user_id = ? AND project_id = ?')
        .bind(taskId, userId, projectId).first<TaskRow>()
      : await db.prepare('SELECT id, title, owner, status, summary, result, blocked_reason AS blockedReason, description FROM tasks WHERE user_id = ? AND project_id = ? AND title LIKE ? ORDER BY updated_at DESC LIMIT 1')
        .bind(userId, projectId, `%${title}%`).first<TaskRow>();
    if (!row) return { ok: false, error: '그런 업무 카드가 이 프로젝트에 없습니다.' };
    const files = await listTaskFiles(db, userId, row.id);
    return {
      ok: true,
      task_id: row.id, title: row.title, agent: row.owner, status: row.status,
      summary: row.summary ?? '',
      blocked_reason: row.blockedReason ?? undefined,
      result: row.result ? clip(row.result, REPORT_CLIP) : '',
      files: files.map((file) => ({ path: file.path, folder_id: file.folderId, content: clip(file.content, 30_000) })),
      note: files.length
        ? '팀원이 저장한 산출물 파일(files)과 결과 요약입니다. 검토를 맡길 때는 files 의 내용을 brief 에 그대로 넣으세요.'
        : row.result ? '결과 전문입니다 (잘리지 않았으면 끝까지 그대로입니다). 산출물 파일은 없습니다 — 파일이 필요하면 파일로 저장하도록 다시 맡기세요.' : '아직 결과가 없습니다 — 팀원이 진행 중이거나 시작 전입니다.',
    };
  }

  if (name === 'delegate_task') {
    if (log.delegated.length >= MAX_DELEGATIONS) {
      return { ok: false, error: `이번 실행에서는 ${MAX_DELEGATIONS}건까지만 위임할 수 있습니다. 남은 것은 보고에 다음 단계로 적으세요.` };
    }
    const agentName = typeof input.agent_name === 'string' ? input.agent_name.trim() : '';
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const brief = typeof input.brief === 'string' ? input.brief.trim() : '';
    if (!title || title.length > 100) return { ok: false, error: 'title 은 1~100자여야 합니다.' };
    if (!brief) return { ok: false, error: 'brief 를 비워 두면 팀원이 무엇을 해야 할지 알 수 없습니다.' };
    // 예전엔 8,000자에서 조용히 잘라 팀원이 반쪽짜리 코드를 받았습니다. 이제는 잘라 보내지 않고 매니저에게 되돌립니다.
    if (brief.length > MAX_BRIEF_CHARS) {
      return { ok: false, error: `brief 가 ${brief.length.toLocaleString()}자로 상한 ${MAX_BRIEF_CHARS.toLocaleString()}자를 넘습니다. 잘라 보내지 않았습니다 — 파일별로 나눠 맡기거나 불필요한 부분을 줄이세요.` };
    }

    const members = await loadMembers(db, userId, projectId);
    const member = members.find((item) => item.name === agentName && !item.isManager);
    if (!member) {
      const names = members.filter((item) => !item.isManager).map((item) => item.name);
      return {
        ok: false,
        error: names.length
          ? `'${agentName}' 는 이 프로젝트 팀에 없습니다. 가능한 팀원: ${names.join(', ')}`
          : '아직 팀원이 없습니다. recruit_agent 로 필요한 직무를 먼저 합류시키세요.',
      };
    }

    const label = typeof input.label === 'string' && input.label.trim() ? input.label.trim().slice(0, 20) : member.role.slice(0, 20);
    const priority = toPriority(input.priority);
    if (context.asyncDelegation) {
      // 대화 위임: 카드만 만들고 바로 돌아갑니다. 실행 시작은 브라우저가, 결과 보고는 lib/manager-report 가 대화에 남깁니다.
      const taskId = await createWorkerCard(context, member, { title, brief, label, priority }, '대기');
      log.delegated.push({ taskId, title, agent: member.name, outcome: 'queued', summary: '' });
      context.onEvent?.({ kind: 'delegate_queued', agent: member.name, role: member.role, title, taskId });
      return {
        ok: true,
        task_id: taskId,
        agent: member.name,
        status: 'queued',
        note: `${member.name} 에게 맡겼고 실행이 곧 시작됩니다. 결과는 팀원이 끝나는 대로 이 대화에 '📥 보고' 메시지로 도착합니다. 지금은 결과를 기다리거나 추측하지 말고, 누구에게 무엇을 맡겼는지 사용자에게 알린 뒤 답변을 끝내세요.`,
      };
    }
    // 하위 실행은 수십 초가 걸립니다 — 시작을 먼저 알려 화면이 멈춘 것처럼 보이지 않게 합니다.
    context.onEvent?.({ kind: 'delegate_start', agent: member.name, role: member.role, title });
    const result = await runWorker(context, member, { title, brief, label, priority });
    const outcome = result.blocked ? 'blocked' as const : 'completed' as const;
    log.delegated.push({ taskId: result.taskId, title, agent: member.name, outcome, summary: result.summary });
    context.onEvent?.({
      kind: 'delegate_done', agent: member.name, title, taskId: result.taskId, outcome,
      summary: result.blocked ? (result.blockedReason ?? '사유 미기재') : result.summary,
    });

    return {
      ok: true,
      task_id: result.taskId,
      agent: member.name,
      status: result.blocked ? 'blocked' : 'completed',
      blocked_reason: result.blockedReason,
      summary: result.summary,
      report: clip(result.output, REPORT_CLIP),
      note: result.blocked
        ? '팀원이 진행하지 못했습니다. 지시를 보완해 다시 맡기거나, 사용자에게 무엇이 필요한지 보고하세요.'
        : '팀원의 보고입니다. 검토한 뒤 사용자 보고에 반영하세요.',
    };
  }

  throw new Error(`알 수 없는 툴: ${name}`);
}
