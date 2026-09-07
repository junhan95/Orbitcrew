/**
 * 임무(스레드) — 한 프로젝트 안에서 사용자가 매니저에게 내린 지시 하나.
 *
 * 매니저 대화는 임무 단위로 나뉩니다. 사용자가 '새 임무' 로 첫 메시지를 보내면 매니저 소유의 임무 카드가 만들어지고
 * (tasks.owner = 매니저, parent_task_id = NULL), 그 스레드의 메시지는 chat_messages.task_id 로 묶입니다.
 * 스레드에서 위임된 팀원 카드는 parent_task_id 로 임무에 매달려, 보드에서 임무별 행으로 나뉩니다.
 *
 * 임무 카드의 상태는 팀원 카드에서 파생됩니다 (syncMissionStatus):
 *   팀원 카드 하나라도 대기·진행 중 → 진행 중 / 전부 검토 단계인데 검토 중이 남음 → 검토 중 / 전부 검토 완료 → 검토 완료
 */

/** 스레드 필터 — task_id 가 NULL 인 옛 메시지는 '' (일반 대화) 로 봅니다. */
export const THREAD_WHERE = "COALESCE(task_id, '') = ?";

/** 첫 메시지에서 임무 제목을 만듭니다: 첫 줄, 마크다운 기호 제거, 60자. */
export function deriveMissionTitle(message: string): string {
  const line = message.split(/\r?\n/).map((item) => item.trim()).find(Boolean) ?? '';
  const plain = line.replace(/^[#>*\-\d.\s]+/, '').replace(/[*_`]/g, '').trim();
  const clipped = plain.length > 60 ? `${plain.slice(0, 59).trimEnd()}…` : plain;
  return clipped || '새 임무';
}

/** 팀원 카드 상태들로 임무 카드 상태를 정합니다. 팀원 카드가 없으면 null (건드리지 않음). */
export function missionStatusOf(children: readonly string[]): '진행 중' | '검토 중' | '검토 완료' | null {
  if (!children.length) return null;
  if (children.some((status) => status === '대기' || status === '진행 중')) return '진행 중';
  if (children.every((status) => status === '검토 완료')) return '검토 완료';
  return '검토 중';
}

export type MissionRow = { id: string; title: string; description: string; status: string };

/** 매니저 소유의 임무 카드를 만듭니다 (새 스레드의 첫 메시지). */
export async function createMission(db: D1Database, userId: string, params: {
  projectId: string; managerName: string; managerColor: string; message: string;
}): Promise<MissionRow> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const title = deriveMissionTitle(params.message);
  const description = params.message.trim().slice(0, 4000);
  await db.prepare(`INSERT INTO tasks (id, user_id, title, label, owner, status, priority, accent, project_id, description, parent_task_id, created_at, updated_at)
      VALUES (?, ?, ?, '임무', ?, '진행 중', '중간', ?, ?, ?, NULL, ?, ?)`)
    .bind(id, userId, title, params.managerName, params.managerColor, params.projectId, description, now, now).run();
  return { id, title, description, status: '진행 중' };
}

/** 스레드로 쓸 임무 카드를 찾습니다. 팀원 카드 id 가 오면 그 부모 임무를 돌려줍니다. */
export async function resolveMission(db: D1Database, userId: string, projectId: string, taskId: string): Promise<MissionRow | null> {
  const row = await db.prepare('SELECT id, title, description, status, parent_task_id AS parentTaskId FROM tasks WHERE id = ? AND user_id = ? AND project_id = ?')
    .bind(taskId, userId, projectId).first<MissionRow & { parentTaskId: string | null }>();
  if (!row) return null;
  if (!row.parentTaskId) return { id: row.id, title: row.title, description: row.description, status: row.status };
  return resolveMission(db, userId, projectId, row.parentTaskId);
}

/** 임무에 매달린 팀원 카드 (시스템 프롬프트의 '이번 임무' 섹션과 상태 파생에 씁니다). */
export async function loadMissionChildren(db: D1Database, userId: string, missionId: string) {
  const rows = await db.prepare('SELECT id, title, owner, status, summary, blocked_reason AS blockedReason FROM tasks WHERE user_id = ? AND parent_task_id = ? ORDER BY created_at ASC')
    .bind(userId, missionId).all<{ id: string; title: string; owner: string; status: string; summary: string | null; blockedReason: string | null }>();
  return rows.results;
}

/** 팀원 카드가 바뀐 뒤 부모 임무의 상태를 다시 맞춥니다. childTaskId 가 임무 자체이거나 부모가 없으면 아무것도 안 합니다. */
export async function syncMissionStatus(db: D1Database, userId: string, childTaskId: string): Promise<void> {
  const child = await db.prepare('SELECT parent_task_id AS parentTaskId FROM tasks WHERE id = ? AND user_id = ?').bind(childTaskId, userId).first<{ parentTaskId: string | null }>();
  if (!child?.parentTaskId) return;
  const children = await loadMissionChildren(db, userId, child.parentTaskId);
  const next = missionStatusOf(children.map((item) => item.status));
  if (!next) return;
  await db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status != ?')
    .bind(next, Date.now(), child.parentTaskId, userId, next).run();
}

/** 시스템 프롬프트용 '이번 임무' 섹션 */
export function renderMissionSection(mission: MissionRow | null, children: Awaited<ReturnType<typeof loadMissionChildren>>): string {
  if (!mission) return '';
  const lines = [
    '## 이번 임무 (이 대화 스레드)',
    `- 제목: ${mission.title} (카드 id ${mission.id}, 상태 ${mission.status})`,
    mission.description ? `- 최초 지시: ${mission.description.slice(0, 600).replace(/\s+/g, ' ')}` : '',
    '- 이 스레드에서 위임한 업무는 이 임무 카드 아래에 묶입니다. 다른 임무(스레드)의 업무와 섞지 마세요.',
  ];
  if (children.length) {
    lines.push('- 이 임무에서 맡긴 업무:');
    for (const child of children) {
      const note = child.blockedReason ? ` — 진행 불가: ${child.blockedReason.slice(0, 120)}` : child.summary ? ` — ${child.summary.slice(0, 120).replace(/\s+/g, ' ')}` : '';
      lines.push(`  - [${child.status}] ${child.title} · 담당 ${child.owner} (id ${child.id})${note}`);
    }
  } else {
    lines.push('- 아직 이 임무에서 맡긴 업무가 없습니다.');
  }
  return lines.filter(Boolean).join('\n');
}
