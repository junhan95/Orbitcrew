/**
 * 보고 사슬 — 팀원 실행 하나가 끝난 뒤, 매니저 자동 진행과 그 위임 실행을 서버 안에서 끝까지 이어 갑니다.
 *
 *   보고 저장 → 매니저 자동 진행(runManagerFollowUp) → 새로 위임된 카드를 바로 실행(runTask) → 보고 저장 → 자동 진행 …
 *
 * 브라우저가 매 단계마다 다시 요청하지 않아도 되므로(예전 번들·탭 전환에 흔들리지 않음) 한 요청 안에서 사슬이 닫힙니다.
 * 깊이 MAX_FOLLOW_UP_DEPTH 에 닿아 실행하지 못한 위임은 outcome 'queued' 그대로 돌려주고, 브라우저가 이어서 시작합니다.
 */
import { MAX_FOLLOW_UP_DEPTH, runManagerFollowUp, type FollowUpResult } from './manager-followup';
import { reportToManagerChat, type ReportDelivery } from './manager-report';
import { runTask, type RunTaskSuccess } from './run-task';
import type { ClaudeCredential } from './claude';
import type { FileChange } from './ai-file-changes';
import { traceError } from './telemetry';

export type ChainRun = { taskId: string; agent: string; title: string; blocked: boolean; summary: string; fileChanges: FileChange[] };
export type ChainResult = {
  reported: ReportDelivery;
  followUps: FollowUpResult[];
  runs: ChainRun[];
  /** 사슬이 끝난 시점의 깊이 — 남은 'queued' 위임을 브라우저가 이어 갈 때 chainDepth 로 씁니다. */
  depth: number;
};

export async function runReportChain(db: D1Database, userId: string, params: {
  taskId: string; outcome: RunTaskSuccess; depth: number;
  apiKey: ClaudeCredential; fallbackModel: string; folderContext: string;
}): Promise<ChainResult> {
  const followUps: FollowUpResult[] = [];
  const runs: ChainRun[] = [];
  let depth = params.depth;
  let outcome = params.outcome;
  let taskId = params.taskId;

  let reported: ReportDelivery = { delivered: false };
  try { reported = await reportToManagerChat(db, userId, taskId, outcome); }
  catch (error) { traceError('run.report_failed', error); return { reported, followUps, runs, depth }; }

  for (;;) {
    if (!reported.delivered || !reported.agentId || !reported.projectId || depth >= MAX_FOLLOW_UP_DEPTH) break;
    const followUp = await runManagerFollowUp(db, userId, {
      projectId: reported.projectId, managerAgentId: reported.agentId, threadId: reported.threadId ?? '',
      reporter: reported.owner ?? taskId, title: reported.title ?? '', blocked: outcome.blocked, depth,
      apiKey: params.apiKey, fallbackModel: params.fallbackModel, folderContext: params.folderContext,
    });
    followUps.push(followUp);
    const queued = followUp.delegated.filter((item) => item.outcome === 'queued' && item.taskId);
    if (!followUp.ran || !queued.length) break;
    depth += 1;
    // 깊이 상한에 닿으면 위임은 남겨 두고(브라우저가 이어 감) 여기서 멈춥니다.
    if (depth >= MAX_FOLLOW_UP_DEPTH) break;

    let last: { reported: ReportDelivery; outcome: RunTaskSuccess; taskId: string } | null = null;
    for (const item of queued) {
      const result = await runTask({ db, userId, taskId: item.taskId, apiKey: params.apiKey, fallbackModel: params.fallbackModel, folderContext: params.folderContext });
      if (!result.ok) {
        item.outcome = 'failed';
        runs.push({ taskId: item.taskId, agent: item.agent, title: item.title, blocked: true, summary: result.error, fileChanges: [] });
        continue;
      }
      item.outcome = result.blocked ? 'blocked' : 'completed';
      item.summary = result.blocked ? (result.blockedReason ?? '') : result.summary;
      runs.push({ taskId: item.taskId, agent: item.agent, title: item.title, blocked: result.blocked, summary: item.summary, fileChanges: result.fileChanges });
      try {
        const delivery = await reportToManagerChat(db, userId, item.taskId, result);
        last = { reported: delivery, outcome: result, taskId: item.taskId };
      } catch (error) { traceError('run.report_failed', error); }
    }
    if (!last) break;
    reported = last.reported; outcome = last.outcome; taskId = last.taskId;
  }
  return { reported, followUps, runs, depth };
}
