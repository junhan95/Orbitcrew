/**
 * 업무 상태. 보드의 열 순서이기도 합니다.
 *
 *  대기 → 진행 중 → 검토 중 → 검토 완료
 *
 * 검토 단계는 에이전트 상태와 실시간으로 연동됩니다:
 *  - 팀원이 결과를 내면 '검토 중' (검토 에이전트가 버그·스펙·정책·근거 패스를 도는 동안)
 *  - 검토 에이전트가 판정(승인 가능 / 수정 요청)을 남기면 '검토 완료'
 * 사람은 언제든 카드를 옮길 수 있고, '검토 완료' 에서 '대기' 로 되돌리면 이전 결과는 지워집니다.
 */
export const TASK_STATUSES = ['대기', '진행 중', '검토 중', '검토 완료'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** 검토 단계(검토 중·검토 완료) 여부 — "결과가 나온 업무" 를 세는 모든 곳이 이걸 씁니다. */
export const REVIEW_STATUSES: readonly TaskStatus[] = ['검토 중', '검토 완료'];

/** 응답 없이 굳은 실행을 정리(lib/stale-runs)할 때 카드에 남기는 막힘 사유 — 대화 화면은 이 사유의 카드를 한 번 자동으로 다시 맡깁니다. */
export const STALE_RUN_REASON = '응답 없이 중단되었습니다 — 실행 중 창이 닫혔거나 연결이 끊긴 것으로 보입니다. 다시 실행해 주세요.';
export function isReviewStatus(value: unknown): boolean {
  return value === '검토 중' || value === '검토 완료';
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value);
}

/** 상태 표시용 색 클래스 (board-chip / status-dot / chat-task-dot 이 공유) */
export function statusTone(status: string): '' | 'doing' | 'review' | 'done' {
  if (status === '진행 중') return 'doing';
  if (status === '검토 중') return 'review';
  if (status === '검토 완료') return 'done';
  return '';
}
