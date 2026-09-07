import { traceRequest } from '@/lib/telemetry';
import { getCurrentUser } from '@/app/auth';
import { getDatabase, getRuntimeConfig } from '@/db';
import { runTask } from '@/lib/run-task';
import { credentialErrorResponse, resolveCredential } from '@/lib/credits';
import type { ClaudeCredential } from '@/lib/claude';
import { runReportChain, type ChainResult } from '@/lib/mission-chain';
import { traceError } from '@/lib/telemetry';

/**
 * POST /api/agents/run { taskId, force?, folderContext?, reportToManager?, chainDepth? }
 * reportToManager 가 true 면 실행이 끝난 뒤 그 프로젝트 매니저의 대화에 '📥 보고' 메시지를 남기고,
 * 이어서 매니저가 다음 단계(검토 위임 → 최종 안내)를 자동으로 진행하고, 새로 위임된 카드까지 이 요청 안에서 실행합니다 (lib/mission-chain).
 * 깊이 상한에 걸려 실행하지 못한 위임은 chain.followUps[].delegated 에 'queued' 로 남고, 브라우저가 chainDepth+1 로 이어 갑니다.
 * 실제 실행 로직은 lib/run-task.ts (매니저의 delegate_task 와 같은 코어) 에 있습니다.
 */
async function handlePOST(request: Request) {
  const user = await getCurrentUser();
  const body = await request.json().catch(() => null) as { taskId?: unknown; force?: unknown; folderContext?: unknown; reportToManager?: unknown; chainDepth?: unknown } | null;
  if (typeof body?.taskId !== 'string') return Response.json({ error: '실행할 업무가 필요합니다.' }, { status: 400 });

  const { model: fallbackModel } = getRuntimeConfig();
  let apiKey: ClaudeCredential;
  try { apiKey = await resolveCredential(getDatabase(), user.userId); }
  catch (error) { const denied = credentialErrorResponse(error); if (denied) return denied; throw error; }

  const outcome = await runTask({
    db: getDatabase(), userId: user.userId, taskId: body.taskId, apiKey, fallbackModel,
    force: body.force === true,
    folderContext: typeof body.folderContext === 'string' ? body.folderContext : '',
  });
  if (!outcome.ok) return Response.json({ error: outcome.error, ...(outcome.code ? { code: outcome.code } : {}), ...(outcome.circuitBreaker ? { circuitBreaker: outcome.circuitBreaker } : {}) }, { status: outcome.status });
  const { ok: _ok, ...payload } = outcome;
  let chain: ChainResult | null = null;
  // 'auto' — 임무(부모 카드)에 매달린 카드일 때만 보고합니다 (카드 상세의 '실행' 버튼).
  let wantsReport = body.reportToManager === true;
  if (body.reportToManager === 'auto') {
    const row = await getDatabase().prepare('SELECT parent_task_id AS parentTaskId FROM tasks WHERE id = ? AND user_id = ?').bind(body.taskId, user.userId).first<{ parentTaskId: string | null }>();
    wantsReport = Boolean(row?.parentTaskId);
  }
  if (wantsReport) {
    // 보고 → 매니저 자동 진행 → 위임 실행 → 보고 … 를 이 요청 안에서 끝까지 이어 갑니다 (깊이 제한).
    const depth = typeof body.chainDepth === 'number' && Number.isFinite(body.chainDepth) ? Math.max(0, Math.floor(body.chainDepth)) : 0;
    try {
      chain = await runReportChain(getDatabase(), user.userId, {
        taskId: body.taskId, outcome, depth, apiKey, fallbackModel,
        folderContext: typeof body.folderContext === 'string' ? body.folderContext : '',
      });
    } catch (error) { traceError('run.chain_failed', error); }
  }
  return Response.json({ ...payload, reported: chain?.reported ?? { delivered: false }, chain });
}

export const POST = traceRequest('/api/agents/run', handlePOST);
