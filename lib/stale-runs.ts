/**
 * 굳어 버린 '진행 중' 카드 정리.
 *
 * 실행(lib/run-task)은 진행하는 동안 runtime_leases 의 `task:<user>:<task>` 임대를 30초마다 갱신합니다.
 * 실행 중 브라우저 탭이 닫히거나 연결이 끊기면 마무리 코드가 돌지 못해 agent_runs 는 'running', 카드는 '진행 중' 으로 남는데,
 * 임대는 갱신이 멈춰 5분(LEASE_TTL_MS) 안에 만료됩니다. 그래서 "running 인데 살아 있는 임대가 없고 시작한 지 충분히 지난" 실행은
 * 끊긴 것으로 보고, 실행을 failed 로 닫고 카드를 '대기'+막힘 사유로 되돌려 사용자가 다시 맡길 수 있게 합니다.
 * 업무 목록을 읽을 때(GET /api/tasks) 사용자 단위로 가볍게 돌립니다.
 */
import { LEASE_TTL_MS } from './leases';
import { syncMissionStatus } from './mission';
import { agentCommentInsert } from './run-loop';

/** 시작 뒤 이만큼 지나야 정리 대상 — 임대 TTL 보다 길게 잡아, 막 시작해 아직 임대 갱신 전인 실행을 건드리지 않습니다. */
export const STALE_RUN_AFTER_MS = LEASE_TTL_MS + 60_000;
export const STALE_RUN_REASON = '응답 없이 중단되었습니다 — 실행 중 창이 닫혔거나 연결이 끊긴 것으로 보입니다. 다시 실행해 주세요.';

type StaleRow = { runId: string; taskId: string; owner: string; startedAt: number };

/** 끊긴 실행을 찾아 닫고 되돌린 카드 id 목록을 돌려줍니다. */
export async function sweepStaleRuns(db: D1Database, userId: string, now = Date.now()): Promise<string[]> {
  const rows = await db.prepare(`SELECT r.id AS runId, r.task_id AS taskId, t.owner AS owner, r.started_at AS startedAt
      FROM agent_runs r JOIN tasks t ON t.id = r.task_id AND t.user_id = r.user_id
      WHERE r.user_id = ? AND r.status = 'running' AND r.started_at < ?
        AND NOT EXISTS (SELECT 1 FROM runtime_leases l WHERE l.resource_key = 'task:' || r.user_id || ':' || r.task_id AND l.expires_at > ?)`)
    .bind(userId, now - STALE_RUN_AFTER_MS, now).all<StaleRow>();
  const stale = rows.results ?? [];
  if (!stale.length) return [];
  const minutes = (row: StaleRow) => Math.max(1, Math.round((now - row.startedAt) / 60_000));
  await db.batch(stale.flatMap((row) => [
    db.prepare("UPDATE agent_runs SET status = 'failed', outcome = 'failed', output = ?, completed_at = ? WHERE id = ? AND user_id = ? AND status = 'running'")
      .bind(STALE_RUN_REASON, now, row.runId, userId),
    // 실행 도중 상태가 이미 바뀐 카드(검토 중 등)는 건드리지 않습니다 — '진행 중' 인 카드만 되돌립니다.
    db.prepare("UPDATE tasks SET status = '대기', blocked_reason = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status = '진행 중'")
      .bind(STALE_RUN_REASON, now, row.taskId, userId),
    agentCommentInsert(db, { userId, taskId: row.taskId, author: row.owner, createdAt: now, content: `⚠️ 실행이 ${minutes(row)}분 넘게 응답 없이 멈춰 중단 처리했습니다. 카드를 다시 실행하면 처음부터 진행합니다.` }),
  ]));
  for (const row of stale) await syncMissionStatus(db, userId, row.taskId).catch(() => undefined);
  return stale.map((row) => row.taskId);
}
