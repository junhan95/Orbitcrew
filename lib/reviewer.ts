/**
 * 검토 에이전트 — AI-Native SDLC 플레이북의 REVIEW.md / 양방향 PR 검토를 카드에 옮긴 것.
 *
 * 실행이 '검토 중' 열에 올라오면, 작성한 에이전트가 아닌 다른 에이전트(QA 우선)가 세 패스로 검토합니다:
 *   bug(논리 오류·빠진 경우) · spec(카드 본문·하위 작업·완료 조건과 일치) · policy(프로젝트 기억·검토 정책 준수) · proof(검증 근거)
 * 발견은 Important / Nit 으로 나누고 Nit 은 카드당 5개까지만 보고합니다.
 * 발견은 승인을 대신하지 않습니다 — 판정이 남으면 카드는 '검토 완료' 열로 올라가고, 사람이 승인하거나 수정 요청을 반영해 다시 실행합니다.
 * (플레이북: "발견은 merge 를 막지 않는다. 승인은 branch protection 의 사람 몫.")
 *
 * 검토 정책은 프로젝트/전역 스킬 중 이름이 '검토 정책' 인 것이 있으면 그 본문을, 없으면 DEFAULT_REVIEW_POLICY 를 씁니다.
 */
import { runClaudeAgent, type ClaudeCredential, type ToolDefinition, type ToolInput } from './claude';
import { loadMemoryScopes, renderMemorySection } from './memory';
import { agentCommentInsert } from './run-loop';
import { usageInsert } from './usage';
import { atomicBatch, isPreconditionError } from './atomic';
import { traceEvent, withTrace } from './telemetry';

export const REVIEW_POLICY_SKILL_NAME = '검토 정책';
export const MAX_NITS = 5;
const REVIEW_MAX_TOKENS = 4_000;
const OUTPUT_MAX_CHARS = 24_000;

export type ReviewPass = 'bug' | 'spec' | 'policy' | 'proof';
export type ReviewFinding = { severity: 'important' | 'nit'; pass: ReviewPass; message: string; location?: string };
export type ReviewVerdict = 'approve' | 'changes_requested';
export type ReviewResult = {
  reviewer: string; verdict: ReviewVerdict; summary: string; findings: ReviewFinding[]; hiddenNits: number;
};

export const DEFAULT_REVIEW_POLICY = [
  '## 패스',
  '세 패스를 돌리고 각 발견에 태그를 붙입니다:',
  '- bug: 논리 오류, 빠진 경우, 서로 어긋나는 주장, 근거 없는 수치',
  '- spec: 카드 본문·하위 작업·완료 조건과 결과가 일치하는가. 요구한 것을 빠뜨렸거나 범위를 벗어났는가',
  '- policy: 프로젝트 기억(확정된 결정·제약)과 어긋나는가. 사용자 대면 문구가 규칙(언어·형식)을 지키는가',
  '- proof: 검증 근거(무엇으로 확인했는지)가 있는가. 없으면 그 자체가 important',
  '',
  '## important 의 뜻',
  '결과를 믿고 쓰면 잘못된 행동이나 결정으로 이어지는 것만. 문체·표현·순서는 nit.',
  '',
  `## nit 상한: 카드당 ${MAX_NITS}개. 나머지는 개수만.`,
  '',
  '## 보고하지 말 것',
  '이미 카드 댓글에서 사람이 "괜찮다"고 한 것, 카드 범위 밖의 개선 아이디어(그건 next_actions 감).',
].join('\n');

const SUBMIT_REVIEW_TOOL: ToolDefinition = {
  name: 'submit_review',
  description: '검토 결과를 제출합니다. 반드시 한 번만 호출하세요. 발견이 없으면 findings 를 비우고 approve 로 제출합니다.',
  input_schema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: ['approve', 'changes_requested'], description: 'important 가 하나라도 있으면 changes_requested' },
      summary: { type: 'string', description: '검토 결론 1~3문장. 무엇을 확인했고 왜 이 판정인지' },
      findings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            severity: { type: 'string', enum: ['important', 'nit'] },
            pass: { type: 'string', enum: ['bug', 'spec', 'policy', 'proof'] },
            message: { type: 'string', description: '무엇이 문제이고 어떻게 고치면 되는지 (1~3문장)' },
            location: { type: 'string', description: '결과물의 어느 부분인지 (섹션 제목, 인용 등). 선택' },
          },
          required: ['severity', 'pass', 'message'],
        },
      },
    },
    required: ['verdict', 'summary', 'findings'],
  },
};

type TaskRow = {
  id: string; title: string; label: string; owner: string; status: string; description: string | null;
  summary: string | null; result: string | null; blockedReason: string | null; projectId: string | null; updatedAt: number;
};
type RunRow = { id: string; outcome: string | null; summary: string | null; output: string | null; metadata: string | null };
type AgentRow = { id: string; name: string; role: string; roleKey: string | null };

/** 작성자가 아닌 검토자를 고릅니다: 프로젝트 팀의 QA → 프로젝트 팀의 다른 에이전트 → 전체 에이전트 중 다른 사람 */
export async function pickReviewer(db: D1Database, userId: string, projectId: string | null, owner: string): Promise<AgentRow | null> {
  const candidates = await db.prepare(`SELECT a.id, a.name, a.role, a.role_key AS roleKey,
        CASE WHEN a.project_id = ? OR EXISTS (SELECT 1 FROM project_agents pa WHERE pa.agent_id = a.id AND pa.user_id = a.user_id AND pa.project_id = ?) THEN 1 ELSE 0 END AS inProject
      FROM agents a
      WHERE a.user_id = ? AND a.name != ?
      ORDER BY inProject DESC, CASE WHEN a.role_key = 'qa' OR a.role LIKE '%QA%' OR a.role LIKE '%검토%' THEN 0 ELSE 1 END, a.created_at ASC
      LIMIT 1`)
    .bind(projectId, projectId, userId, owner).first<AgentRow>();
  return candidates ?? null;
}

async function loadReviewPolicy(db: D1Database, userId: string, projectId: string | null): Promise<string> {
  const skill = await db.prepare(`SELECT body FROM skills WHERE user_id = ? AND name = ? AND (scope = 'global' OR project_id = ?) ORDER BY scope ASC LIMIT 1`)
    .bind(userId, REVIEW_POLICY_SKILL_NAME, projectId).first<{ body: string }>();
  return skill?.body ?? DEFAULT_REVIEW_POLICY;
}

export type ReviewParams = {
  db: D1Database; userId: string; apiKey: ClaudeCredential; model: string; taskId: string;
  /** 검토 대상 실행. 생략하면 이 카드의 최근 완료 실행 */
  runId?: string | null;
};

export async function runTaskReview(params: ReviewParams): Promise<ReviewResult | { skipped: string }> {
  return withTrace({ taskId: params.taskId, runId: params.runId ?? undefined, operation: 'task.review' }, () => runTaskReviewInternal(params));
}
async function runTaskReviewInternal(params: ReviewParams): Promise<ReviewResult | { skipped: string }> {
  const { db, userId, taskId } = params;
  const task = await db.prepare(`SELECT id, title, label, owner, status, description, summary, result, blocked_reason AS blockedReason, project_id AS projectId, updated_at AS updatedAt
      FROM tasks WHERE id = ? AND user_id = ?`).bind(taskId, userId).first<TaskRow>();
  if (!task) return { skipped: '업무 없음' };
  if (!task.result && !task.summary) return { skipped: '검토할 결과가 없음' };

  const run = params.runId
    ? await db.prepare('SELECT id, outcome, summary, output, metadata FROM agent_runs WHERE id = ? AND user_id = ?').bind(params.runId, userId).first<RunRow>()
    : await db.prepare(`SELECT id, outcome, summary, output, metadata FROM agent_runs WHERE task_id = ? AND user_id = ? AND status = 'completed' ORDER BY started_at DESC LIMIT 1`).bind(taskId, userId).first<RunRow>();
  const metadata = safeJson(run?.metadata);
  const proof = Array.isArray(metadata.proof) ? (metadata.proof as unknown[]).filter((item): item is string => typeof item === 'string') : [];

  const [reviewer, policy, subtasks, memory, comments] = await Promise.all([
    pickReviewer(db, userId, task.projectId, task.owner),
    loadReviewPolicy(db, userId, task.projectId),
    db.prepare('SELECT title, done FROM subtasks WHERE user_id = ? AND task_id = ? ORDER BY position ASC').bind(userId, taskId).all<{ title: string; done: number }>(),
    (async () => {
      const project = task.projectId ? await db.prepare('SELECT name FROM projects WHERE id = ? AND user_id = ?').bind(task.projectId, userId).first<{ name: string }>() : null;
      return loadMemoryScopes(db, userId, { projectId: task.projectId, projectName: project?.name ?? null });
    })(),
    db.prepare(`SELECT author, author_kind AS authorKind, content FROM task_comments WHERE user_id = ? AND task_id = ? AND author_kind = 'user' ORDER BY created_at DESC LIMIT 5`)
      .bind(userId, taskId).all<{ author: string; authorKind: string; content: string }>(),
  ]);
  const reviewerName = reviewer?.name ?? '검토자';

  const system = [
    `당신은 ${reviewerName}${reviewer?.role ? `, ${reviewer.role}` : ''}입니다. 동료 에이전트 ${task.owner} 가 끝낸 업무를 검토합니다.`,
    '당신은 결과를 승인하는 사람이 아닙니다 — 사람이 결정할 수 있게 발견을 정확히 등급 매겨 보고하는 것이 일입니다.',
    '결과물을 다시 쓰거나 대신 작업하지 마세요. 확인할 수 없는 것은 "확인 불가"로 적고 추측으로 important 를 만들지 마세요.',
    '',
    '# 검토 정책',
    policy,
    '',
    renderMemorySection(memory),
  ].join('\n');

  const card = [
    `# 카드: ${task.title} (${task.label} · 담당 ${task.owner})`,
    task.description ? `## 본문\n${task.description}` : '## 본문\n(없음)',
    subtasks.results.length ? `## 하위 작업\n${subtasks.results.map((item) => `- [${item.done ? 'x' : ' '}] ${item.title}`).join('\n')}` : '',
    comments.results.length ? `## 사람이 남긴 최근 댓글\n${comments.results.map((item) => `- ${item.content.replace(/\s+/g, ' ').slice(0, 400)}`).join('\n')}` : '',
    '',
    `# 실행 결과 (${run?.outcome ?? task.status})`,
    `## 요약\n${run?.summary ?? task.summary ?? '(없음)'}`,
    `## 검증 근거 (proof)\n${proof.length ? proof.map((item) => `- ${item}`).join('\n') : '(제출된 근거 없음)'}`,
    `## 본문\n${clip(run?.output ?? task.result ?? '', OUTPUT_MAX_CHARS)}`,
    '',
    '별도 설명 없이 submit_review로만 제출하세요. summary는 400자 이내, 발견은 중요한 순서로 최대 10개, 각 message는 200자 이내로 간결하게 작성하세요.',
  ].filter(Boolean).join('\n\n');

  const captured: { value: ReviewResult | null } = { value: null };
  const result = await runClaudeAgent({
    apiKey: params.apiKey,
    model: params.model,
    system,
    messages: [{ role: 'user', content: card }],
    maxTokens: REVIEW_MAX_TOKENS,
    maxIterations: 1,
    toolChoice: 'submit_review',
    tools: [SUBMIT_REVIEW_TOOL],
    executeTool(name, input) {
      if (name !== 'submit_review') throw new Error(`알 수 없는 툴: ${name}`);
      captured.value = parseReview(input, reviewerName);
      return Promise.resolve({ ok: true, note: '검토가 접수되었습니다. 더 이상 아무것도 하지 마세요.' });
    },
  });
  // Retain metering even when the report is truncated or its task disappears meanwhile.
  await usageInsert(db, { userId, kind: 'review', result, refId: run?.id ?? taskId, projectId: task.projectId, agentName: reviewerName }).run();
  if (!captured.value) {
    traceEvent('review.incomplete', { stopReason: result.stopReason, outputTokens: result.usage.outputTokens, maxTokens: REVIEW_MAX_TOKENS }, 'warn');
    throw Object.assign(new Error(`검토 결과를 받지 못했습니다 (${result.stopReason ?? '이유 미상'}). 다시 검토해 주세요.`), { code: 'review_incomplete' });
  }
  const review = captured.value;

  const now = Date.now();
  try {
  await atomicBatch(db, `EXISTS (SELECT 1 FROM tasks WHERE id = ? AND user_id = ? AND updated_at = ?)
    AND (? IS NULL OR EXISTS (SELECT 1 FROM agent_runs WHERE id = ? AND task_id = ? AND user_id = ?))`,
  [taskId, userId, task.updatedAt, run?.id ?? null, run?.id ?? null, taskId, userId], [
    agentCommentInsert(db, { userId, taskId, author: reviewerName, createdAt: now, content: formatReviewComment(review) }),
    // 검토 판정이 남는 순간 '검토 중' → '검토 완료'. 사람이 그새 다른 열로 옮겼으면 그대로 둡니다.
    db.prepare(`UPDATE tasks SET review_verdict = ?, reviewed_at = ?, updated_at = ?,
        status = CASE WHEN status = '검토 중' THEN '검토 완료' ELSE status END WHERE id = ? AND user_id = ?`).bind(review.verdict, now, now, taskId, userId),
  ]);
  } catch (error) {
    if (!isPreconditionError(error)) throw error;
    traceEvent('review.skipped', { reason: 'target_changed_or_deleted' });
    return { skipped: '검토 대상이 변경되었거나 삭제됨' };
  }
  return review;
}

function parseReview(input: ToolInput, reviewer: string): ReviewResult {
  const raw = Array.isArray(input.findings) ? (input.findings as Record<string, unknown>[]) : [];
  const findings: ReviewFinding[] = raw
    .filter((item) => item && typeof item === 'object' && typeof item.message === 'string' && (item.message as string).trim())
    .map((item) => ({
      severity: item.severity === 'important' ? 'important' : 'nit',
      pass: (['bug', 'spec', 'policy', 'proof'] as const).includes(item.pass as ReviewPass) ? (item.pass as ReviewPass) : 'spec',
      message: (item.message as string).trim().slice(0, 600),
      location: typeof item.location === 'string' && item.location.trim() ? item.location.trim().slice(0, 120) : undefined,
    }));
  const important = findings.filter((item) => item.severity === 'important');
  const nits = findings.filter((item) => item.severity === 'nit');
  // important 가 있으면 verdict 는 무조건 changes_requested (모델의 판정과 무관하게 규칙으로 고정)
  const verdict: ReviewVerdict = important.length ? 'changes_requested' : input.verdict === 'changes_requested' ? 'changes_requested' : 'approve';
  return {
    reviewer, verdict,
    summary: typeof input.summary === 'string' ? input.summary.trim().slice(0, 800) : '',
    findings: [...important, ...nits.slice(0, MAX_NITS)],
    hiddenNits: Math.max(0, nits.length - MAX_NITS),
  };
}

const PASS_LABEL: Record<ReviewPass, string> = { bug: '버그', spec: '스펙', policy: '정책', proof: '근거' };

export function formatReviewComment(review: ReviewResult): string {
  const important = review.findings.filter((item) => item.severity === 'important');
  const nits = review.findings.filter((item) => item.severity === 'nit');
  const lines = [
    `🔍 검토 — ${review.verdict === 'approve' ? '승인 가능' : '수정 요청'} (Important ${important.length} · Nit ${nits.length + review.hiddenNits})`,
    review.summary,
  ];
  if (important.length) lines.push('', 'Important:', ...important.map((item) => `- [${PASS_LABEL[item.pass]}] ${item.message}${item.location ? ` (${item.location})` : ''}`));
  if (nits.length) lines.push('', 'Nit:', ...nits.map((item) => `- [${PASS_LABEL[item.pass]}] ${item.message}${item.location ? ` (${item.location})` : ''}`));
  if (review.hiddenNits) lines.push(`- … 외 ${review.hiddenNits}건`);
  if (important.length) lines.push('', '다시 실행하면 Important 항목이 지시로 전달됩니다. 검토 발견은 상태를 바꾸지 않으니 승인 여부는 사람이 정합니다.');
  return lines.join('\n');
}

function safeJson(text: string | null | undefined): Record<string, unknown> {
  if (!text) return {};
  try { const parsed = JSON.parse(text) as unknown; return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}; } catch { return {}; }
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n…[${text.length - max}자 생략]` : text;
}
