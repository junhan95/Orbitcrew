import { traceRequest } from '@/lib/telemetry';
import { getCurrentUser } from '@/app/auth';
import { getDatabase, getRuntimeConfig } from '@/db';
import { runTask } from '@/lib/run-task';
import { credentialErrorResponse, resolveCredential } from '@/lib/credits';
import type { ClaudeCredential } from '@/lib/claude';
import { reportToManagerChat, type ReportDelivery } from '@/lib/manager-report';
import { MAX_FOLLOW_UP_DEPTH, runManagerFollowUp, type FollowUpResult } from '@/lib/manager-followup';
import { traceError } from '@/lib/telemetry';

/**
 * POST /api/agents/run { taskId, force?, folderContext?, reportToManager?, chainDepth? }
 * reportToManager 가 true 면 실행이 끝난 뒤 그 프로젝트 매니저의 대화에 '📥 보고' 메시지를 남기고,
 * 이어서 매니저가 다음 단계(검토 위임 → 최종 안내)를 자동으로 진행합니다 (lib/manager-followup).
 * 그 턴에서 새로 위임된 카드는 followUp.delegated 로 돌아오고, 브라우저가 chainDepth+1 로 다시 실행을 시작합니다.
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
  if (!outcome.ok) return Response.json({ error: outcome.error, ...(outcome.circuitBreaker ? { circuitBreaker: outcome.circuitBreaker } : {}) }, { status: outcome.status });
  const { ok: _ok, ...payload } = outcome;
  let reported: ReportDelivery = { delivered: false };
  let followUp: FollowUpResult | null = null;
  if (body.reportToManager === true) {
    try { reported = await reportToManagerChat(getDatabase(), user.userId, body.taskId, outcome); }
    catch (error) { traceError('run.report_failed', error); }
    // 보고가 들어갔으면 매니저가 다음 단계를 스스로 진행합니다 (사슬 깊이 제한).
    const depth = typeof body.chainDepth === 'number' && Number.isFinite(body.chainDepth) ? Math.max(0, Math.floor(body.chainDepth)) : 0;
    if (reported.delivered && reported.agentId && reported.projectId && depth < MAX_FOLLOW_UP_DEPTH) {
      followUp = await runManagerFollowUp(getDatabase(), user.userId, {
        projectId: reported.projectId, managerAgentId: reported.agentId, threadId: reported.threadId ?? '',
        reporter: reported.owner ?? outcome.taskId, title: reported.title ?? '', blocked: outcome.blocked, depth,
        apiKey, fallbackModel, folderContext: typeof body.folderContext === 'string' ? body.folderContext : '',
      });
    }
  }
  return Response.json({ ...payload, reported, followUp, chainDepth: typeof body.chainDepth === 'number' ? body.chainDepth : 0 });
}

export const POST = traceRequest('/api/agents/run', handlePOST);
