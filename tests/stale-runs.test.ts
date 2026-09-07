import { afterEach, expect, it } from 'vitest';
import { acquireLease, releaseLease } from '@/lib/leases';
import { STALE_RUN_AFTER_MS, STALE_RUN_REASON, sweepStaleRuns } from '@/lib/stale-runs';
import { testDatabase } from './d1';

const databases: ReturnType<typeof testDatabase>[] = [];
afterEach(() => { for (const { sqlite } of databases.splice(0)) sqlite.close(); });

function seed(sqlite: ReturnType<typeof testDatabase>['sqlite'], taskId: string, startedAt: number, parent: string | null = null) {
  sqlite.prepare(`INSERT INTO tasks (id, user_id, title, label, owner, status, priority, accent, project_id, parent_task_id, created_at, updated_at)
    VALUES (?, 'u', '조사', '업무', 'Coco', '진행 중', '중간', '#000', 'p', ?, ?, ?)`).run(taskId, parent, startedAt, startedAt);
  sqlite.prepare(`INSERT INTO agent_runs (id, task_id, user_id, agent_name, status, prompt, started_at) VALUES (?, ?, 'u', 'Coco', 'running', 'p', ?)`).run(`run-${taskId}`, taskId, startedAt);
}

it('임대가 만료된 채 오래 남은 running 실행은 닫고 카드를 막힘(대기)으로 되돌립니다', async () => {
  const database = testDatabase(); databases.push(database);
  const { db, sqlite } = database;
  const now = Date.now();
  sqlite.exec("INSERT INTO projects (id,user_id,name,created_at,updated_at) VALUES ('p','u','test',0,0)");
  sqlite.prepare(`INSERT INTO tasks (id, user_id, title, label, owner, status, priority, accent, project_id, created_at, updated_at)
    VALUES ('m', 'u', '임무', '임무', '매니저', '진행 중', '중간', '#000', 'p', ?, ?)`).run(now - 600_000, now - 600_000);
  seed(sqlite, 'stale', now - STALE_RUN_AFTER_MS - 1_000, 'm');   // 끊긴 실행
  seed(sqlite, 'fresh', now - 10_000);                             // 막 시작한 실행 (임대 갱신 전)
  seed(sqlite, 'alive', now - STALE_RUN_AFTER_MS - 1_000);         // 오래됐지만 임대가 살아 있는 실행
  const lease = (await acquireLease(db, 'task:u:alive'))!;

  const swept = await sweepStaleRuns(db, 'u', now);
  expect(swept).toEqual(['stale']);
  const task = sqlite.prepare('SELECT status, blocked_reason AS blockedReason FROM tasks WHERE id = ?').get('stale') as { status: string; blockedReason: string };
  expect(task).toEqual({ status: '대기', blockedReason: STALE_RUN_REASON });
  expect((sqlite.prepare('SELECT status, outcome FROM agent_runs WHERE id = ?').get('run-stale') as { status: string; outcome: string })).toEqual({ status: 'failed', outcome: 'failed' });
  expect((sqlite.prepare('SELECT status FROM tasks WHERE id = ?').get('fresh') as { status: string }).status).toBe('진행 중');
  expect((sqlite.prepare('SELECT status FROM tasks WHERE id = ?').get('alive') as { status: string }).status).toBe('진행 중');
  expect((sqlite.prepare("SELECT COUNT(*) AS n FROM task_comments WHERE task_id = 'stale'").get() as { n: number }).n).toBe(1);
  // 다시 돌리면 아무것도 없습니다.
  expect(await sweepStaleRuns(db, 'u', now)).toEqual([]);
  await releaseLease(db, lease);
});
