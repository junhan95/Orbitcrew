/**
 * 업무 실행 코어 — /api/agents/run 과 매니저의 delegate_task(lib/manager-tools runWorker) 가 함께 씁니다.
 * 워커 컨텍스트·기억·스킬·게이트·검토·관제·기억 리뷰가 전부 여기 한곳에 있어야 두 경로의 동작이 같습니다.
 */
import { getRuntimeConfig } from '@/db';
import { runClaudeAgent, type ClaudeCredential, type ToolDefinition } from '@/lib/claude';
import { PRIORITY_HINT, toPriority } from '@/lib/priority';
import {
  MANAGER_TOOLS, MANAGER_TOOL_NAMES, createManagerLog, executeManagerTool, loadMembers, renderTeam,
  type ManagerContext,
} from '@/lib/manager-tools';
import { MEMORY_GUIDANCE, MEMORY_TOOL, executeMemoryTool, loadMemoryScopes, renderMemorySection } from '@/lib/memory';
import { loadProfile, renderProfileSection } from '@/lib/profile';
import { gateCreateTask } from '@/lib/approvals';
import { logGate } from '@/lib/gates';
import { maybeRunHealthCheck } from '@/lib/health';
import { runInBackground, runMemoryReview } from '@/lib/memory-review';
import { resolveAgentModel } from '@/lib/models';
import { RECALL_TOOL, executeRecallTool, recallDocUpsert } from '@/lib/recall';
import { runTaskReview } from '@/lib/reviewer';
import { addTrace, traceEvent, traceError, withTrace } from '@/lib/telemetry';
import { agentCommentInsert, checkCircuitBreaker, describeTaskCard, formatRunComment } from '@/lib/run-loop';
import { SAVE_SKILL_TOOL, SKILL_GUIDANCE, USE_SKILL_TOOL, executeSkillTool, listSkills, renderSkillIndex, type SkillToolContext } from '@/lib/skills';
import { TASK_TOOLS, TASK_TOOL_NAMES, createTaskToolLog, describeFields, executeTaskTool, type TaskToolContext } from '@/lib/task-tools';
import { usageInsert } from '@/lib/usage';
import { acquireLease, leasedBatch, LeaseLostError, releaseLease, renewLease } from '@/lib/leases';
import { isPreconditionError } from '@/lib/atomic';
import { completionState } from '@/lib/run-completion';

type TaskRow = {
  id: string; title: string; label: string; owner: string; status: string; priority: string; projectId: string | null;
  description: string | null; blockedReason: string | null; updatedAt: number;
};
type ProjectRow = { id: string; name: string; description: string; status: string };
type PriorRun = { id: string; status: string; outcome: string | null; summary: string | null; output: string | null; startedAt: number; completedAt: number | null };
type SiblingTask = { id: string; title: string; owner: string; label: string; summary: string | null; result: string | null; updatedAt: number };

const MAX_ITERATIONS = 8;
/** 매니저는 채용·위임·검토를 한 실행 안에서 돌리므로 여유를 더 줍니다 */
const MANAGER_MAX_ITERATIONS = 16;
const PRIOR_RUNS = 10;
const SIBLING_TASKS = 8;
/** 브라우저가 읽어 보내는 연결 폴더 스냅샷의 상한 (약 60,000자 ≒ 2만 토큰) */
const MAX_FOLDER_CONTEXT = 60_000;
/** 실행당 회상 호출 상한 — 검증에서 3~4회가 나왔고 그 이상은 거의 중복입니다 */
const RECALL_CALL_LIMIT = 3;

/** Hermes kanban_complete 에 해당. 실행을 끝내면서 구조화된 보고를 남깁니다. */
const COMPLETE_TOOL: ToolDefinition = {
  name: 'complete_task',
  description: [
    '업무를 마치면서 결과를 구조화해 보고합니다. 실행의 마지막에 반드시 한 번 호출하세요.',
    "정보가 부족해 제대로 진행할 수 없으면 추측으로 채우지 말고 status='blocked' 로 무엇이 필요한지 밝히세요.",
    '작업 중 발견한 후속 업무 중 카드로 만든 것은 create_task 로 이미 처리했을 테니, 여기 next_actions 에는 사람이 판단해야 하는 것만 적으세요.',
    'proof 에는 결과를 무엇으로 검증했는지 적으세요. 검증 없이 완료라고 보고하지 마세요.',
  ].join(' '),
  input_schema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['completed', 'blocked'], description: 'completed = 검토 단계로 넘김, blocked = 진행 불가' },
      summary: { type: 'string', description: '핵심 결론 2~4문장. 다음 담당자가 이것만 읽고도 상황을 알 수 있게.' },
      blocked_reason: { type: 'string', description: "status='blocked' 일 때 무엇이 필요한지" },
      next_actions: { type: 'array', items: { type: 'string' }, description: '후속으로 필요한 업무 (0~5개)' },
      proof: { type: 'array', items: { type: 'string' }, description: "무엇으로 결과를 확인했는지 (1~5개). 예: '확인한 파일 경로', '실행한 명령과 결과', '참조한 출처', '검토한 카드/댓글'. completed 면 반드시 채우세요 — 없으면 검토에서 '근거 없음'으로 잡힙니다." },
    },
    required: ['status', 'summary'],
  },
};

function clip(text: string | null | undefined, max: number): string {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function formatWhen(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 16).replace('T', ' ');
}

export type RunTaskParams = {
  db: D1Database; userId: string; taskId: string;
  apiKey: ClaudeCredential; fallbackModel: string;
  /** 서킷브레이커 무시 */
  force?: boolean;
  /** 브라우저가 읽어 보낸 연결 폴더 스냅샷 */
  folderContext?: string;
  /** 매니저가 위임한 실행이면 출처 (메타데이터·프롬프트에 남김) */
  delegatedBy?: { managerName: string; parentTaskId: string | null } | null;
};

export type RunTaskFailure = { ok: false; status: number; error: string; circuitBreaker?: unknown };
export type RunTaskSuccess = {
  ok: true; runId: string; taskId: string; status: string; output: string; summary: string;
  blocked: boolean; blockedReason: string | null; nextActions: string[]; proof: string[];
  iterations: number; toolCalls: string[];
  skillSaves: { scope: string; pendingApproval: boolean; error?: string }[];
  createdTasks: unknown[]; createdFields: unknown[]; setFields: unknown[]; recruited: unknown[]; delegated: unknown[];
};

export async function runTask(params: RunTaskParams): Promise<RunTaskFailure | RunTaskSuccess> {
  return withTrace({ taskId: params.taskId, operation: 'task.run' }, () => runTaskInternal(params));
}

async function runTaskInternal(params: RunTaskParams): Promise<RunTaskFailure | RunTaskSuccess> {
  const { db, apiKey, fallbackModel } = params;
  const user = { userId: params.userId };
  const body = { force: params.force === true };
  const folderContext = (params.folderContext ?? '').trim().slice(0, MAX_FOLDER_CONTEXT);

  const task = await db.prepare(`SELECT id, title, label, owner, status, priority, project_id AS projectId, description, blocked_reason AS blockedReason, updated_at AS updatedAt
      FROM tasks WHERE id = ? AND user_id = ?`)
    .bind(params.taskId, user.userId).first<TaskRow>();
  if (!task) return { ok: false, status: 404, error: '업무를 찾을 수 없습니다.' };

  // 서킷브레이커: 사람 개입 없이 연속 실패/막힘이 상한에 닿으면 자동 실행을 멈춥니다. force=true 면 무시.
  const breaker = await checkCircuitBreaker(db, user.userId, task.id);
  if (breaker.tripped && !body.force) {
    logGate(db, user.userId, { gate: 'circuit_breaker', decision: 'block', projectId: task.projectId, taskId: task.id, detail: `연속 ${breaker.consecutive}회` });
    return {
      ok: false, status: 409,
      error: `이 업무는 연속 ${breaker.consecutive}회 실패하거나 막혀 자동 실행을 멈췄습니다. 카드 댓글로 지시를 남기거나 본문을 보완한 뒤 다시 실행해 주세요.`,
      circuitBreaker: breaker,
    };
  }

  // ── 워커 컨텍스트 (Hermes build_worker_context) ─────────────────────────────
  const [agent, project, priorRuns, siblings] = await Promise.all([
    db.prepare('SELECT id, role, instructions, model, is_manager AS isManager FROM agents WHERE user_id = ? AND name = ? LIMIT 1')
      .bind(user.userId, task.owner).first<{ id: string; role: string; instructions: string; model: string | null; isManager: number }>(),
    task.projectId
      ? db.prepare('SELECT id, name, description, status FROM projects WHERE id = ? AND user_id = ?').bind(task.projectId, user.userId).first<ProjectRow>()
      : Promise.resolve(null),
    db.prepare('SELECT id, status, outcome, summary, output, started_at AS startedAt, completed_at AS completedAt FROM agent_runs WHERE task_id = ? AND user_id = ? ORDER BY started_at DESC LIMIT ?')
      .bind(task.id, user.userId, PRIOR_RUNS).all<PriorRun>(),
    task.projectId
      ? db.prepare(`SELECT id, title, owner, label, summary, result, updated_at AS updatedAt FROM tasks
          WHERE user_id = ? AND project_id = ? AND id != ? AND status IN ('검토 중', '검토 완료') AND (summary IS NOT NULL OR result IS NOT NULL)
          ORDER BY updated_at DESC LIMIT ?`).bind(user.userId, task.projectId, task.id, SIBLING_TASKS).all<SiblingTask>()
      : Promise.resolve({ results: [] as SiblingTask[] }),
  ]);

  const contextSections: string[] = [];
  contextSections.push(project
    ? `## 프로젝트\n이름: ${project.name}\n상태: ${project.status}\n설명: ${project.description || '(설명 없음)'}`
    : '## 프로젝트\n(이 업무는 아직 프로젝트에 속해 있지 않습니다)');

  if (priorRuns.results.length) {
    const lines = priorRuns.results.map((run) => {
      const label = run.outcome ?? run.status;
      const gist = run.summary ?? clip(run.output, 300);
      return `- ${formatWhen(run.startedAt)} · ${label}${gist ? ` · ${gist}` : ''}`;
    });
    contextSections.push(`## 이 업무의 이전 시도 (최근 ${lines.length}건, 최신순)\n같은 실수를 반복하지 말고, 이전 결과 위에서 이어가세요.\n${lines.join('\n')}`);
  }

  const toolContext: TaskToolContext = { db, userId: user.userId, agentName: task.owner, projectId: task.projectId, taskId: task.id };
  // 기억 스냅샷 (이 실행 동안 동결) — user / project / agent 세 스코프
  const [cardSection, fieldGuide, memory, skills, profile] = await Promise.all([
    describeTaskCard(db, user.userId, task),
    describeFields(toolContext),
    loadMemoryScopes(db, user.userId, {
      projectId: task.projectId, projectName: project?.name ?? null, agentId: agent?.id ?? null, agentName: task.owner,
    }),
    listSkills(db, user.userId, task.projectId),
    // 사용자 프로필: 호칭과 보고 눈높이를 맞추는 데 씁니다 (계정 화면에서 편집).
    loadProfile(db, user.userId),
  ]);
  contextSections.push(cardSection);
  if (fieldGuide) contextSections.push(fieldGuide);

  if (siblings.results.length) {
    const lines = siblings.results.map((item) => `- [${item.owner} · ${item.label}] ${item.title} — ${item.summary ?? clip(item.result, 240)}`);
    contextSections.push(`## 같은 프로젝트에서 검토 단계에 있는 업무 (참고)\n${lines.join('\n')}`);
  }

  // 매니저 실행이면 팀 현황을 프롬프트에 싣고 채용·위임 도구를 붙입니다.
  const isManager = Boolean(agent?.isManager) && Boolean(task.projectId) && Boolean(project);
  if (isManager) contextSections.push(renderTeam(await loadMembers(db, user.userId, task.projectId as string)));

  if (folderContext) {
    contextSections.push([
      '## 연결된 작업 폴더 (사용자 컴퓨터)',
      '사용자가 이 프로젝트에 연결한 폴더의 스냅샷입니다. 파일 목록과 일부 파일 본문이 들어 있습니다.',
      '실제 파일이므로 추측보다 우선하는 1차 근거입니다. 인용할 때는 경로를 함께 적고, 목록에만 있는 파일의 내용은 지어내지 마세요.',
      '',
      folderContext,
    ].join('\n'));
  }

  const managerRules = [
    '- 당신은 이 프로젝트의 매니저입니다. 실무를 직접 다 처리하지 말고, 무엇이 필요한지 판단해 팀에 맡기고 결과를 검토하세요.',
    '- 맡길 사람이 팀에 없으면 recruit_agent 로 필요한 직무를 합류시키세요. 업무 성격에 맞는 직무 하나만 고릅니다.',
    '- delegate_task 로 업무를 맡기면 그 자리에서 실행되어 보고가 반환값으로 돌아옵니다. brief 에는 배경·요구사항·완료 조건을 충분히 적으세요.',
    '- delegate_task 의 brief 는 60,000자까지 잘리지 않고 그대로 전달되고, 팀원 실행은 긴 출력에도 타임아웃되지 않습니다. 과거 기록·기억에 "코드가 잘린다", "524 타임아웃", "여러 조각으로 나눠 보내야 한다" 같은 내용이 남아 있어도 이미 해결된 문제이니, 그것을 이유로 코드를 조각내거나 재시도 계획을 세우지 말고 파일 전체를 한 번에 맡기세요.',
    '- 팀원의 보고를 그대로 옮기지 말고 검토하세요 — 빠진 것, 근거가 약한 것, 서로 어긋나는 것을 짚고 필요하면 보완 지시로 다시 맡깁니다.',
    "- 팀원이 blocked 로 돌아오면 지시를 구체화해 다시 맡기거나, 사용자에게 무엇이 필요한지 complete_task(status='blocked') 로 알리세요.",
    '- 조사 한 건이면 충분한 일을 여러 명에게 쪼개 맡기지 마세요. 위임은 꼭 필요한 만큼만.',
    '- 정보가 좀 부족하다고 바로 blocked 로 끝내지 마세요. 합리적인 가정을 세워 진행 가능한 부분은 위임해 결과를 만들고, 세운 가정과 사용자에게 확인이 필요한 항목을 보고에 적으세요. 가정만으로는 아무것도 만들 수 없을 때만 blocked 입니다.',
    '- 최종 산출물은 사용자가 읽는 보고서입니다: 결론 → 담당자별 결과 요약 → 사용자가 결정할 것 순으로 한국어로 씁니다.',
    "- 보고는 반드시 complete_task 로 끝내세요. summary 에 결론과 담당자별 결과, proof 에 팀원 보고·검증 근거(무엇을 확인했는지), next_actions 에 사용자가 결정할 항목을 넣습니다. 팀원이 blocked 였다면 그 사유를 summary 에 그대로 남기고, 위임 결과가 하나도 없으면 status='blocked' 입니다.",
  ];
  const workerRules = [
    '- 지금 업무의 범위를 벗어나는 후속 업무가 보이면 create_task 로 카드를 만들고 적임자를 owner 로 지정하세요. 범위 안의 일은 직접 끝내세요.',
    '- 결과는 한국어로, 핵심 결론 → 수행 내용 → 다음 행동 순으로 정리합니다.',
  ];

  const system = [
    isManager
      ? `당신은 ${task.owner}, '${project?.name}' 프로젝트의 전담 프로젝트 매니저입니다.`
      : `당신은 ${task.owner}${agent?.role ? `, ${agent.role}` : ''}라는 프로젝트 실행 에이전트입니다.`,
    agent?.instructions ?? '',
    '',
    '## 작업 규칙',
    '- 먼저 아래 맥락(프로젝트, 이전 시도, 이 카드의 본문·댓글, 완료된 업무)을 파악하고 시작하세요. 카드 댓글에 사람이 남긴 지시가 있으면 그것이 최우선입니다.',
    '- 과거 논의나 관련 작업이 있었을 법하면 추측하지 말고 recall_history 로 먼저 찾아보세요. 결과가 없으면 없다고 판단하고 진행합니다.',
    '- 최신 정보가 필요하면 웹 검색을 쓰고, 사실과 추측을 구분해 표시하세요.',
    "- 핵심 정보가 없어 진행할 수 없으면 추측으로 채우지 말고 complete_task(status='blocked') 로 필요한 것을 밝히세요.",
    ...(isManager ? managerRules : workerRules),
    '- 이 업무를 추적하는 데 반복적으로 필요한 정보가 있으면 define_field 로 필드를 만들고 set_field 로 값을 채우세요. 한 번 쓰고 마는 메모는 요약에 적습니다.',
    '- 마지막에는 반드시 complete_task 를 호출해 요약을 남기세요. 툴을 호출하지 않고 끝내면 보고가 남지 않고, proof 가 비면 "검증 근거 없음" 으로 표시되어 검토 에이전트가 수정 요청을 냅니다.',
    '',
    renderProfileSection(profile, ''),
    '',
    MEMORY_GUIDANCE,
    '',
    SKILL_GUIDANCE,
    '',
    ...contextSections,
    '',
    renderMemorySection(memory),
    '',
    renderSkillIndex(skills),
  ].filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n');

  const priority = toPriority(task.priority);
  const prompt = [
    `업무: ${task.title}`,
    `분류: ${task.label}`,
    `담당 에이전트: ${task.owner}`,
    `중요도: ${priority} — ${PRIORITY_HINT[priority]}`,
    ...(params.delegatedBy ? [`위임: '${params.delegatedBy.managerName}'(프로젝트 매니저)가 맡긴 업무입니다. 카드 본문의 지시 범위 안에서 끝까지 수행하고 보고하세요.`] : []),
    '',
    '이 업무를 실제로 수행해 주세요.',
  ].join('\n');

  // 에이전트에 지정된 모델이 있으면 그것으로, 없으면 .env 기본 모델로 실행합니다.
  const model = resolveAgentModel(agent?.model, fallbackModel);

  const runId = crypto.randomUUID();
  addTrace({ runId, projectId: task.projectId });
  traceEvent('run.started');
  const startedAt = Date.now();
  const lease = await acquireLease(db, `task:${user.userId}:${task.id}`);
  if (!lease) return { ok: false, status: 409, error: '이미 실행 중인 업무입니다. 현재 실행이 끝난 뒤 다시 시도하세요.' };
  let leaseLost = false;
  const heartbeat = setInterval(() => { renewLease(db, lease).catch(() => { leaseLost = true; }); }, 30_000);
  try {
  await leasedBatch(db, lease, [
    db.prepare("UPDATE agent_runs SET status = 'failed', outcome = 'failed', completed_at = ? WHERE task_id = ? AND user_id = ? AND status = 'running'").bind(startedAt, task.id, user.userId),
    db.prepare('INSERT INTO agent_runs (id, task_id, user_id, agent_name, status, prompt, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(runId, task.id, user.userId, task.owner, 'running', prompt, startedAt),
    db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .bind('진행 중', startedAt, task.id, user.userId),
  ]);

  type Completion = { status: 'completed' | 'blocked'; summary: string; blockedReason: string | null; nextActions: string[]; proof: string[] };
  // 클로저 안에서 채워지므로 객체로 감쌉니다 (TS 흐름 분석이 let 재할당을 못 봅니다)
  const report: { value: Completion | null } = { value: null };
  // 실행 중 에이전트가 만든 카드/필드 기록 (UI 가 보드를 다시 읽을지 판단하는 데 씁니다)
  const toolLog = createTaskToolLog();
  const managerLog = createManagerLog();
  const skillContext: SkillToolContext = { db, userId: user.userId, projectId: task.projectId, actor: task.owner, saves: { count: 0, names: [] }, taskId: task.id, runId };
  const skillSaves: RunTaskSuccess['skillSaves'] = [];
  const createCounter = { created: 0 };
  const memoryFailures = { count: 0 };
  const counters = { recall: 0 };

  const managerContext: ManagerContext | null = isManager && project ? {
    db, userId: user.userId, apiKey, fallbackModel,
    projectId: project.id, projectName: project.name, projectDescription: project.description,
    managerName: task.owner, managerTaskId: task.id, folderContext,
  } : null;

  try {
    const result = await runClaudeAgent({
      beforeIteration: async () => { if (leaseLost) throw new LeaseLostError(); await renewLease(db, lease); },
      apiKey, model, system,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 8000,
      maxOutputRetries: 2,
      maxIterations: managerContext ? MANAGER_MAX_ITERATIONS : MAX_ITERATIONS,
      webSearchMaxUses: 3,
      tools: [
        RECALL_TOOL as unknown as ToolDefinition, MEMORY_TOOL, USE_SKILL_TOOL, SAVE_SKILL_TOOL, ...TASK_TOOLS,
        ...(managerContext ? MANAGER_TOOLS : []),
        COMPLETE_TOOL,
      ],
      async executeTool(name, input) {
        if (leaseLost) throw new LeaseLostError();
        await renewLease(db, lease);
        if (managerContext && MANAGER_TOOL_NAMES.has(name)) {
          return executeManagerTool(name, input, managerContext, managerLog);
        }
        if (name === 'use_skill' || name === 'save_skill') {
          const outcome = await executeSkillTool(name, input, skillContext);
          if (name === 'save_skill') skillSaves.push({ scope: typeof input.scope === 'string' ? input.scope : '(missing)', pendingApproval: typeof outcome.pending_approval === 'string', ...(typeof outcome.error === 'string' ? { error: outcome.error } : {}) });
          return outcome;
        }
        if (name === 'recall_history') {
          counters.recall += 1;
          if (counters.recall > RECALL_CALL_LIMIT) {
            if (counters.recall === RECALL_CALL_LIMIT + 1) logGate(db, user.userId, { gate: 'recall_cap', decision: 'block', projectId: task.projectId, taskId: task.id });
            return { error: `회상 호출 상한(${RECALL_CALL_LIMIT}회)에 도달했습니다. 지금까지의 결과로 진행하세요.` };
          }
          return executeRecallTool(db, user.userId, input, { projectId: task.projectId });
        }
        if (name === 'memory') {
          return executeMemoryTool(db, input, { userId: user.userId, projectId: task.projectId, agentId: agent?.id ?? null, actor: task.owner, failures: memoryFailures });
        }
        if (TASK_TOOL_NAMES.has(name)) {
          // 실행당 카드 생성이 상한을 넘으면 만들지 않고 승인 대기에 넣습니다 (물어보기형 게이트)
          if (name === 'create_task') {
            const asked = await gateCreateTask(db, user.userId, { input, counter: createCounter, actor: task.owner, projectId: task.projectId, taskId: task.id, runId });
            if (asked) return asked;
          }
          return executeTaskTool(name, input, toolContext, toolLog);
        }
        if (name === 'complete_task') {
          const status = input.status === 'blocked' ? 'blocked' : 'completed';
          const summary = typeof input.summary === 'string' ? input.summary.trim() : '';
          if (!summary) throw new Error('summary 는 비울 수 없습니다.');
          report.value = {
            status,
            summary: summary.slice(0, 1200),
            blockedReason: typeof input.blocked_reason === 'string' ? input.blocked_reason.trim().slice(0, 600) : null,
            nextActions: Array.isArray(input.next_actions) ? input.next_actions.filter((item): item is string => typeof item === 'string').slice(0, 5) : [],
            proof: Array.isArray(input.proof) ? input.proof.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim().slice(0, 300)).slice(0, 5) : [],
          };
          return { ok: true, note: '보고가 저장되었습니다. 이 호출은 완료되었으니 반복하지 말고 짧게 마무리하세요.' };
        }
        throw new Error(`알 수 없는 툴: ${name}`);
      },
    });

    const completedAt = Date.now();
    const done = report.value;
    const { blocked, blockedReason } = completionState(done, result.stopReason);
    const truncated = result.stopReason === 'max_tokens';
    // 산출물 본문: complete_task 를 부른 턴의 텍스트가 실제 결과물입니다 (그 뒤 턴은 짧은 마무리 발화).
    // 없으면 가장 긴 턴을 쓰고, 마지막 턴이 별도 내용을 담고 있으면 뒤에 붙입니다.
    const reportTurn = result.turns.find((turn) => turn.toolNames.includes('complete_task'));
    const longest = result.turns.reduce<string>((best, turn) => turn.text.length > best.length ? turn.text : best, '');
    const mainText = reportTurn?.text || longest;
    const closing = result.text && result.text !== mainText && result.text.length > 40 ? result.text : '';
    const outputBody = [mainText, closing].filter(Boolean).join('\n\n') || done?.summary || '';
    const output = [
      blocked ? `⛔ 진행 불가: ${blockedReason}\n` : '',
      outputBody,
      truncated ? '\n\n---\n※ 출력 토큰 한도에 걸려 여기서 끊겼습니다. 자동 재시도 한도에 도달했습니다. 작업을 더 작은 파일이나 기능으로 나누어 다시 요청해 주세요.' : '',
      result.stopReason === 'max_iterations' ? '\n\n---\n※ 툴 호출 반복 상한에 도달해 중단했습니다.' : '',
      result.stopReason === 'insufficient_credits' ? '\n\n---\n※ 크레딧 잔액이 부족해 여기서 중단했습니다. 충전하거나 본인 API 키를 연결한 뒤 다시 실행해 주세요.' : '',
    ].join('').trim();
    // complete_task 를 안 부르고 끝난 경우의 안전망: 본문 앞부분을 요약으로 씁니다.
    const summary = done?.summary ?? clip(outputBody.replace(/\s+/g, ' '), 300);
    const outcome = blocked ? 'blocked' : 'completed';
    const metadata = JSON.stringify({
      nextActions: done?.nextActions ?? [],
      blockedReason,
      iterations: result.iterations,
      stopReason: result.stopReason,
      toolCalls: result.toolCalls.map((call) => ({ name: call.name, ok: call.ok, query: typeof call.input.query === 'string' ? call.input.query : undefined })),
      reportedViaTool: Boolean(done),
      createdTasks: toolLog.createdTasks,
      createdFields: toolLog.createdFields,
      setFields: toolLog.setFields,
      recruited: managerLog.recruited,
      delegated: managerLog.delegated,
      delegatedBy: params.delegatedBy?.managerName ?? null,
      parentTaskId: params.delegatedBy?.parentTaskId ?? null,
      memoryWrites: result.toolCalls.filter((call) => call.name === 'memory' && call.ok).length,
      proof: done?.proof ?? [],
      unverified: Boolean(done) && !blocked && !(done?.proof.length),
      skillsUsed: result.toolCalls.filter((call) => call.name === 'use_skill' && call.ok).map((call) => (typeof call.input.name === 'string' ? call.input.name : '')),
      skillsSaved: skillContext.saves.names,
      skillSaves,
      usagePerIteration: result.usagePerIteration.map((u) => ({ in: u.inputTokens, out: u.outputTokens, cacheWrite: u.cacheCreationTokens, cacheRead: u.cacheReadTokens })),
    });
    // 결과가 나오면 '검토 중' — 곧이어 검토 에이전트가 돌고, 판정이 남으면 lib/reviewer 가 '검토 완료' 로 올립니다.
    const nextStatus = blocked ? '대기' : '검토 중';

    await leasedBatch(db, lease, [
      db.prepare('UPDATE agent_runs SET status = ?, outcome = ?, output = ?, summary = ?, metadata = ?, response_id = ?, completed_at = ? WHERE id = ? AND user_id = ?')
        .bind('completed', outcome, output, summary, metadata, result.id, completedAt, runId, user.userId),
      db.prepare('UPDATE tasks SET status = ?, result = ?, summary = ?, blocked_reason = ?, updated_at = ? WHERE id = ? AND user_id = ?')
        .bind(nextStatus, output, summary, blockedReason, completedAt, task.id, user.userId),
      // 실행 결과를 카드 댓글로 남겨 상세 패널에서 흐름이 읽히게 합니다 (Hermes: 완료 보고를 카드 댓글로).
      agentCommentInsert(db, {
        userId: user.userId, taskId: task.id, author: task.owner, createdAt: completedAt,
        content: formatRunComment({
          blocked, summary, blockedReason, nextActions: done?.nextActions ?? [], proof: done?.proof ?? [],
          // 매니저가 위임해 만든 카드도 '만든 카드'로 함께 남깁니다.
          createdTasks: [...toolLog.createdTasks, ...managerLog.delegated.map((item) => ({ title: item.title, owner: item.agent }))],
        }),
      }),
      usageInsert(db, { userId: user.userId, kind: 'agent_run', result, refId: runId, projectId: task.projectId, agentName: task.owner }),
      recallDocUpsert(db, {
        userId: user.userId, kind: 'run', refId: runId, projectId: task.projectId, agentName: task.owner, role: 'assistant',
        title: task.title, content: `[${task.owner} · ${task.label}] ${task.title}\n\n${summary}\n\n${output}`, createdAt: completedAt,
      }),
    ]);

    // 관제 밴드 — 실패율·근거 없음·검토 수정 요청·게이트 차단·비용을 기준선과 비교, 이탈하면 매니저에게 진단 카드 (시간당 1회).
    runInBackground(() => maybeRunHealthCheck(db, user.userId), 'health.review');
    // 결과 검토 — 작성자가 아닌 다른 에이전트가 세 패스(버그·스펙·정책·근거)로 검토해 댓글과 판정을 남깁니다 (백그라운드).
    if (!blocked) {
      runInBackground(() => runTaskReview({ db, userId: user.userId, apiKey, model: fallbackModel, taskId: task.id, runId }), 'task.review');
    }
    // 기억 리뷰 패스 — 응답을 막지 않고 백그라운드에서 저가 모델로 "남길 것이 있나"만 묻습니다.
    const { reviewModel } = getRuntimeConfig();
    if (!blocked) runInBackground(() => runMemoryReview({
      db, userId: user.userId, apiKey, model: reviewModel, system,
      transcript: [{ role: 'user', content: prompt }, { role: 'assistant', content: `${summary}\n\n${output}` }],
      projectId: task.projectId, agentId: agent?.id ?? null, agentName: task.owner, refId: runId,
    }), 'memory.review');

    traceEvent('run.finished', { blocked, stopReason: result.stopReason, iterations: result.iterations });
    return {
      ok: true, runId, taskId: task.id, status: nextStatus, output, summary,
      blocked, blockedReason, nextActions: done?.nextActions ?? [], proof: done?.proof ?? [],
      iterations: result.iterations, toolCalls: result.toolCalls.map((call) => call.name), skillSaves,
      createdTasks: toolLog.createdTasks, createdFields: toolLog.createdFields, setFields: toolLog.setFields,
      recruited: managerLog.recruited, delegated: managerLog.delegated,
    };
  } catch (error) {
    traceError('run.failed', error);
    const message = error instanceof Error ? error.message : '에이전트 실행에 실패했습니다.';
    if (leaseLost || error instanceof LeaseLostError || isPreconditionError(error)) return { ok: false, status: 409, error: '실행 권한이 만료되어 결과를 저장하지 않았습니다. 현재 업무 상태를 확인하세요.' };
    try {
    await leasedBatch(db, lease, [
      db.prepare('UPDATE agent_runs SET status = ?, outcome = ?, output = ?, completed_at = ? WHERE id = ? AND user_id = ?')
        .bind('failed', 'failed', message, Date.now(), runId, user.userId),
      agentCommentInsert(db, { userId: user.userId, taskId: task.id, author: task.owner, createdAt: Date.now(), content: `⚠️ 실행 실패 — ${message}` }),
      // 실행 전 상태로 되돌려 보드가 '진행 중'에 멈춰 있지 않게 합니다 (위임으로 만든 카드는 '대기'로).
      db.prepare('UPDATE tasks SET status = ?, blocked_reason = ?, updated_at = ? WHERE id = ? AND user_id = ?')
        .bind(task.status === '진행 중' ? '대기' : task.status, params.delegatedBy ? message : task.blockedReason, Date.now(), task.id, user.userId),
    ]);
    } catch (writeError) { if (!isPreconditionError(writeError)) throw writeError; }
    const status = error instanceof Error && 'status' in error && typeof error.status === 'number' ? error.status : 502;
    return { ok: false, status, error: message };
  }
  } finally { clearInterval(heartbeat); await releaseLease(db, lease); }
}
