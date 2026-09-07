/**
 * 게이트 결정 로그 (플레이북: "Hook 결정은 allow/block/ask 와 시각으로 남긴다").
 *
 * 서킷브레이커·회상 상한·기억/스킬 위협 스캔처럼 서버가 "막았다"는 사실을 gate_events 에 남깁니다.
 * 관제 밴드(lib/health.ts)가 실행당 차단 비율을 지표로 쓰고, 대시보드는 게이트별 차단 횟수를 보여 줄 수 있습니다.
 * 기록은 절대 요청을 실패시키지 않습니다 — 실패해도 조용히 넘어갑니다.
 */

export type GateName = 'circuit_breaker' | 'recall_cap' | 'file_deliverable' | 'memory_threat' | 'skill_threat' | 'health_check' | 'approval';
export type GateDecision = 'block' | 'allow' | 'ask' | 'raise' | 'noop';

export type GateEvent = {
  gate: GateName; decision: GateDecision;
  projectId?: string | null; taskId?: string | null; detail?: string | null;
};

/** statement 로 돌려줘 batch 에 끼우거나 .run() 으로 바로 실행할 수 있게 합니다 */
export function gateEventInsert(db: D1Database, userId: string, event: GateEvent) {
  return db.prepare('INSERT INTO gate_events (id, user_id, gate, decision, project_id, task_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), userId, event.gate, event.decision, event.projectId ?? null, event.taskId ?? null, (event.detail ?? '').slice(0, 400) || null, Date.now());
}

/** 요청 흐름을 막지 않는 기록 — 실패는 로그만 */
export function logGate(db: D1Database, userId: string, event: GateEvent): void {
  gateEventInsert(db, userId, event).run().catch((error: unknown) => {
    console.error('[gate]', error instanceof Error ? error.message : error);
  });
}

export type GateSummaryRow = { gate: string; decision: string; count: number };

export async function summarizeGates(db: D1Database, userId: string, since: number): Promise<GateSummaryRow[]> {
  const rows = await db.prepare('SELECT gate, decision, COUNT(*) AS count FROM gate_events WHERE user_id = ? AND created_at >= ? GROUP BY gate, decision ORDER BY count DESC')
    .bind(userId, since).all<GateSummaryRow>();
  return rows.results;
}
